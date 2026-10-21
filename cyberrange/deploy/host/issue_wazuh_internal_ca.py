"""Issue a long-lived internal CA and a manager API certificate (issue #168).

The CA private key and the server private key stay under
~/cyberrange-data/wazuh-ca (mode 700). Only the CA public certificate is
written to ~/cyberrange/certs/wazuh-api-ca.crt. Nothing private is printed.

The server certificate has SAN DNS:localhost, which is what the provision
API verifies. After --install, WAZUH_CA_BUNDLE in env/.env points at the CA
file so a later manager-cert rotation does not require a new pin.

  python3 deploy/host/issue_wazuh_internal_ca.py --install
"""
from __future__ import annotations

import argparse
import os
import re
import stat
import subprocess
import sys
from pathlib import Path


CA_DAYS = "3650"
SERVER_DAYS = "825"
MANAGER_CRT = "/var/ossec/api/configuration/ssl/server.crt"
MANAGER_KEY = "/var/ossec/api/configuration/ssl/server.key"


def _run(argv: list[str]) -> None:
    proc = subprocess.run(argv, check=False, capture_output=True, timeout=60)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or b"").decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"{' '.join(argv[:3])} failed: {err}")


def _mode(path: Path, mode: int) -> None:
    path.chmod(mode)


def issue_material(data_dir: Path, root: Path) -> Path:
    """Create the CA and server material. Returns the public CA path."""
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

    public = root / "certs" / "wazuh-api-ca.crt"
    public.parent.mkdir(parents=True, exist_ok=True)
    public.write_bytes(ca_crt.read_bytes())
    _mode(public, 0o644)
    # The private key must not be a regular world-readable file.
    assert stat.S_IMODE(ca_key.stat().st_mode) == 0o600
    assert stat.S_IMODE(server_key.stat().st_mode) == 0o600
    return public


def install_on_manager(data_dir: Path, lxc_bin: str = "lxc") -> None:
    ca_dir = data_dir / "wazuh-ca"
    server_crt = ca_dir / "server.crt"
    server_key = ca_dir / "server.key"
    _run([lxc_bin, "file", "push", str(server_crt), f"wazuh-manager{MANAGER_CRT}"])
    _run([lxc_bin, "file", "push", str(server_key), f"wazuh-manager{MANAGER_KEY}"])
    _run([lxc_bin, "exec", "wazuh-manager", "--", "systemctl", "restart", "wazuh-manager"])


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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / "cyberrange")
    parser.add_argument("--data", type=Path, default=Path.home() / "cyberrange-data")
    parser.add_argument(
        "--install",
        action="store_true",
        help="push the server cert into wazuh-manager and restart it",
    )
    args = parser.parse_args(argv)
    public = issue_material(args.data, args.root)
    if args.install:
        install_on_manager(args.data)
        point_ca_bundle(args.root / "env" / ".env", public)
    print(f"CA public certificate: {public}")
    print("Private keys stayed in the data directory and were not printed.")
    if not args.install:
        print("Re-run with --install on the Ampere host to load the manager cert.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 — operator-facing one-shot
        print(f"issue_wazuh_internal_ca failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
