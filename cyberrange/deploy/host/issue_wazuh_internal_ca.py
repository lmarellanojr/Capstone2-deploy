"""Issue a long-lived internal CA and a manager API certificate (issue #168).

The CA private key and the server private key stay under
~/cyberrange-data/wazuh-ca (mode 700 directory, mode 600 keys). A run
without --install writes only that directory. certs/wazuh-api-ca.crt is
written only after --install has restarted wazuh-manager and localhost:55000
verifies against the CA. Nothing private is printed.

The server certificate has SAN DNS:localhost, which is what the provision
API verifies. After that check, WAZUH_CA_BUNDLE in env/.env points at the
CA file so a later manager-cert rotation does not require a new pin.

  python3 deploy/host/issue_wazuh_internal_ca.py --install
"""
from __future__ import annotations

import argparse
import os
import re
import stat
import subprocess
import sys
import time
from pathlib import Path


CA_DAYS = "3650"
SERVER_DAYS = "825"
MANAGER_CRT = "/var/ossec/api/configuration/ssl/server.crt"
MANAGER_KEY = "/var/ossec/api/configuration/ssl/server.key"
VERIFY_TIMEOUT_S = 45.0


def _run(argv: list[str], timeout: int = 60) -> None:
    proc = subprocess.run(argv, check=False, capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or b"").decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"{' '.join(argv[:3])} failed: {err}")


def _capture(argv: list[str], timeout: int = 30) -> str:
    proc = subprocess.run(argv, check=False, capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or b"").decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"{' '.join(argv[:4])} failed: {err}")
    return (proc.stdout or b"").decode("utf-8", errors="replace").strip()


def _mode(path: Path, mode: int) -> None:
    path.chmod(mode)


def _require_mode(path: Path, mode: int) -> None:
    """Raise if the mode is wrong. assert would vanish under python -O."""
    actual = stat.S_IMODE(path.stat().st_mode)
    if actual != mode:
        raise RuntimeError(f"{path} mode is {oct(actual)}, expected {oct(mode)}")


def issue_material(data_dir: Path) -> Path:
    """Create the CA and server material under data_dir. Returns ca.crt.

    Does not write certs/wazuh-api-ca.crt. Publishing that file switches
    pull_release into CA mode, so it has to wait until the manager serves
    a certificate that chains to this CA.
    """
    os.umask(0o077)
    ca_dir = data_dir / "wazuh-ca"
    ca_dir.mkdir(parents=True, exist_ok=True)
    _mode(ca_dir, 0o700)
    ca_key = ca_dir / "ca.key"
    ca_crt = ca_dir / "ca.crt"
    server_key = ca_dir / "server.key"
    server_csr = ca_dir / "server.csr"
    server_crt = ca_dir / "server.crt"

    if not ca_key.exists() or not ca_crt.exists():
        _run(
            [
                "openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-keyout", str(ca_key), "-out", str(ca_crt),
                "-days", CA_DAYS, "-nodes",
                "-subj", "/CN=cyberrange-wazuh-api-ca",
            ]
        )
        _mode(ca_key, 0o600)
        _mode(ca_crt, 0o644)

    _run(
        [
            "openssl", "req", "-newkey", "rsa:2048",
            "-keyout", str(server_key), "-out", str(server_csr),
            "-nodes", "-subj", "/CN=wazuh.com",
            "-addext", "subjectAltName=DNS:localhost",
        ]
    )
    _run(
        [
            "openssl", "x509", "-req",
            "-in", str(server_csr),
            "-CA", str(ca_crt), "-CAkey", str(ca_key),
            "-CAcreateserial", "-out", str(server_crt),
            "-days", SERVER_DAYS, "-copy_extensions", "copy",
        ]
    )
    _mode(server_key, 0o600)
    _mode(server_crt, 0o644)
    _require_mode(ca_key, 0o600)
    _require_mode(server_key, 0o600)
    return ca_crt


def _guest_wazuh_ids(lxc_bin: str) -> tuple[str, str]:
    uid = _capture([lxc_bin, "exec", "wazuh-manager", "--", "id", "-u", "wazuh"])
    gid = _capture([lxc_bin, "exec", "wazuh-manager", "--", "id", "-g", "wazuh"])
    if not uid.isdigit() or not gid.isdigit():
        raise RuntimeError(f"wazuh uid/gid not numeric: {uid!r} {gid!r}")
    return uid, gid


def _tls_verified(ca_crt: Path) -> tuple[bool, str]:
    proc = subprocess.run(
        [
            "openssl", "s_client",
            "-connect", "127.0.0.1:55000",
            "-servername", "localhost",
            "-verify_hostname", "localhost",
            "-verify_return_error",
            "-CAfile", str(ca_crt),
        ],
        input=b"",
        capture_output=True,
        timeout=8,
        check=False,
    )
    text = ((proc.stdout or b"") + b"\n" + (proc.stderr or b"")).decode("utf-8", errors="replace")
    return proc.returncode == 0 and "Verify return code: 0" in text, text


def _wait_until_ca_verifies(ca_crt: Path, timeout_s: float = VERIFY_TIMEOUT_S) -> None:
    """Block until the manager API on localhost:55000 chains to ca_crt."""
    deadline = time.monotonic() + timeout_s
    last = "not checked"
    while time.monotonic() < deadline:
        try:
            ok, text = _tls_verified(ca_crt)
        except (subprocess.TimeoutExpired, OSError) as exc:
            ok, text = False, str(exc)
        if ok:
            return
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        last = lines[-1] if lines else "no openssl output"
        time.sleep(2)
    raise RuntimeError(f"manager TLS did not verify against the CA: {last}")


def install_on_manager(data_dir: Path, lxc_bin: str = "lxc") -> None:
    """Push the new server cert as the guest wazuh user and wait until it verifies.

    Does not publish certs/wazuh-api-ca.crt. The caller does that only after
    this returns.
    """
    ca_dir = data_dir / "wazuh-ca"
    server_crt = ca_dir / "server.crt"
    server_key = ca_dir / "server.key"
    ca_crt = ca_dir / "ca.crt"
    uid, gid = _guest_wazuh_ids(lxc_bin)
    _run(
        [
            lxc_bin, "file", "push",
            "--uid", uid, "--gid", gid, "--mode", "0644",
            str(server_crt), f"wazuh-manager{MANAGER_CRT}",
        ]
    )
    _run(
        [
            lxc_bin, "file", "push",
            "--uid", uid, "--gid", gid, "--mode", "0640",
            str(server_key), f"wazuh-manager{MANAGER_KEY}",
        ]
    )
    _run([lxc_bin, "exec", "wazuh-manager", "--", "systemctl", "restart", "wazuh-manager"])
    _wait_until_ca_verifies(ca_crt)


def publish_ca(root: Path, ca_crt: Path) -> Path:
    public = root / "certs" / "wazuh-api-ca.crt"
    public.parent.mkdir(parents=True, exist_ok=True)
    public.write_bytes(ca_crt.read_bytes())
    _mode(public, 0o644)
    return public


def point_ca_bundle(env_path: Path, ca_path: Path) -> None:
    """Set WAZUH_CA_BUNDLE to the CA file. Leave every other line alone."""
    if not env_path.is_file():
        return
    line = f"WAZUH_CA_BUNDLE={ca_path}"
    text = env_path.read_text(encoding="utf-8")
    if re.search(r"(?m)^WAZUH_CA_BUNDLE=", text):
        text = re.sub(r"(?m)^WAZUH_CA_BUNDLE=.*$", line, text)
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += line + "\n"
    env_path.write_text(text, encoding="utf-8")
    os.chmod(env_path, 0o600)


def main(argv: list[str] | None = None) -> int:
    # Keys are created by openssl before chmod. A private umask closes the
    # window where the operator's shell umask would leave them group-readable.
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / "cyberrange")
    parser.add_argument("--data", type=Path, default=Path.home() / "cyberrange-data")
    parser.add_argument(
        "--install",
        action="store_true",
        help="push the server cert into wazuh-manager, restart it, then publish the CA",
    )
    args = parser.parse_args(argv)
    ca_crt = issue_material(args.data)
    if not args.install:
        print(f"CA material is in {ca_crt.parent} only.")
        print("certs/wazuh-api-ca.crt was not written.")
        print("Re-run with --install on the Ampere host to load the manager cert.")
        return 0
    install_on_manager(args.data)
    public = publish_ca(args.root, ca_crt)
    point_ca_bundle(args.root / "env" / ".env", public)
    print(f"CA public certificate: {public}")
    print("Private keys stayed in the data directory and were not printed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 — operator-facing one-shot
        print(f"issue_wazuh_internal_ca failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
