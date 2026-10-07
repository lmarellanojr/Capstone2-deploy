"""Sync host certs/wazuh-api.crt from the live wazuh-manager LXD guest.

Ampere Admin → System shows Wazuh Degraded (TLS verification failed) when the
on-disk pin does not match the manager cert on localhost:55000. #152 preserves
an existing pin against tarball overwrite; this helper refreshes the pin from
the live manager so every domain can heal on pull_release (or a one-shot run).

Best-effort by default: missing manager / proxy down → skip (exit 0).
Use --strict for operator one-shots that must fail loudly.
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


MANAGER_CRT = "/var/ossec/api/configuration/ssl/server.crt"
DEFAULT_CONNECT = "localhost:55000"
FINGERPRINT_RE = re.compile(r"(?:=)([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){19,})")


@dataclass(frozen=True)
class SyncResult:
    status: str  # installed | unchanged | skipped | failed
    detail: str
    fingerprint: str | None = None


class SyncError(RuntimeError):
    pass


def _openssl_fingerprint(pem: bytes) -> str:
    proc = subprocess.run(
        ["openssl", "x509", "-noout", "-fingerprint", "-sha256"],
        input=pem,
        check=False,
        capture_output=True,
        timeout=15,
    )
    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
        raise SyncError(f"openssl fingerprint failed: {err}")
    out = (proc.stdout or b"").decode("utf-8", errors="replace")
    match = FINGERPRINT_RE.search(out)
    if not match:
        raise SyncError(f"could not parse fingerprint from: {out!r}")
    return match.group(1).strip().upper()


def _openssl_has_dns_localhost(pem: bytes) -> bool:
    proc = subprocess.run(
        ["openssl", "x509", "-noout", "-ext", "subjectAltName"],
        input=pem,
        check=False,
        capture_output=True,
        timeout=15,
    )
    text = b"\n".join([proc.stdout or b"", proc.stderr or b""]).decode(
        "utf-8", errors="replace"
    )
    return "DNS:localhost" in text


def _live_server_pem(connect: str = DEFAULT_CONNECT, servername: str = "localhost") -> bytes:
    proc = subprocess.run(
        ["openssl", "s_client", "-connect", connect, "-servername", servername],
        input=b"",
        check=False,
        capture_output=True,
        timeout=20,
    )
    blob = proc.stdout or b""
    start = blob.find(b"-----BEGIN CERTIFICATE-----")
    end = blob.find(b"-----END CERTIFICATE-----")
    if start < 0 or end < 0:
        raise SyncError(
            f"no certificate from {connect} (s_client rc={proc.returncode})"
        )
    end += len(b"-----END CERTIFICATE-----")
    return blob[start:end] + b"\n"


def _manager_present(lxc_bin: str = "lxc") -> bool:
    proc = subprocess.run(
        [lxc_bin, "info", "wazuh-manager"],
        check=False,
        capture_output=True,
        timeout=20,
    )
    return proc.returncode == 0


def _extract_manager_pem(lxc_bin: str = "lxc") -> bytes:
    proc = subprocess.run(
        [lxc_bin, "exec", "wazuh-manager", "--", "cat", MANAGER_CRT],
        check=False,
        capture_output=True,
        timeout=30,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or b"").decode("utf-8", errors="replace").strip()
        raise SyncError(f"lxc exec cat {MANAGER_CRT} failed: {err}")
    data = proc.stdout or b""
    if b"BEGIN CERTIFICATE" not in data:
        raise SyncError("manager crt output is not a PEM certificate")
    return data


def sync_wazuh_api_cert(
    *,
    root: Path,
    data_dir: Path,
    connect: str = DEFAULT_CONNECT,
    lxc_bin: str = "lxc",
    best_effort: bool = True,
    manager_present: Callable[[str], bool] = _manager_present,
    extract_manager_pem: Callable[[str], bytes] = _extract_manager_pem,
    live_server_pem: Callable[..., bytes] = _live_server_pem,
    fingerprint_pem: Callable[[bytes], str] = _openssl_fingerprint,
    has_dns_localhost: Callable[[bytes], bool] = _openssl_has_dns_localhost,
) -> SyncResult:
    """Refresh root/certs/wazuh-api.crt from live manager when fingerprints match."""
    try:
        if not manager_present(lxc_bin):
            return SyncResult("skipped", "wazuh-manager LXD guest not found")

        extracted = extract_manager_pem(lxc_bin)
        live = live_server_pem(connect)
        ext_fp = fingerprint_pem(extracted)
        live_fp = fingerprint_pem(live)
        if ext_fp != live_fp:
            raise SyncError(
                f"fingerprint mismatch extracted={ext_fp} live={live_fp}"
            )
        if not has_dns_localhost(extracted):
            raise SyncError("extracted cert SAN missing DNS:localhost")

        dest = root / "certs" / "wazuh-api.crt"
        dest.parent.mkdir(parents=True, exist_ok=True)
        data_dir.mkdir(parents=True, exist_ok=True)

        if dest.is_file():
            current_fp = fingerprint_pem(dest.read_bytes())
            if current_fp == ext_fp:
                return SyncResult(
                    "unchanged", "host pin already matches live manager", ext_fp
                )

            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            bak = data_dir / f"wazuh-api.crt.bak-{stamp}"
            shutil.copy2(dest, bak)

        tmp = data_dir / "wazuh-api.crt.new"
        tmp.write_bytes(extracted)
        tmp.chmod(0o644)
        shutil.move(str(tmp), str(dest))
        dest.chmod(0o644)
        return SyncResult("installed", f"wrote {dest}", ext_fp)
    except Exception as exc:  # noqa: BLE001 — boundary for best-effort pulls
        if best_effort:
            return SyncResult("skipped", f"{type(exc).__name__}: {exc}")
        if isinstance(exc, SyncError):
            raise
        raise SyncError(str(exc)) from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.home() / "cyberrange",
        help="cyberrange tree root (default: ~/cyberrange)",
    )
    parser.add_argument(
        "--data",
        type=Path,
        default=Path.home() / "cyberrange-data",
        help="data dir for backups (default: ~/cyberrange-data)",
    )
    parser.add_argument(
        "--connect",
        default=DEFAULT_CONNECT,
        help="openssl s_client -connect target (default: localhost:55000)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit non-zero on sync failure (default: best-effort skip)",
    )
    args = parser.parse_args(argv)

    try:
        result = sync_wazuh_api_cert(
            root=args.root,
            data_dir=args.data,
            connect=args.connect,
            best_effort=not args.strict,
        )
    except SyncError as exc:
        print(f"wazuh-api.crt sync FAILED: {exc}", file=sys.stderr)
        return 1

    print(f"wazuh-api.crt sync {result.status}: {result.detail}")
    if result.fingerprint:
        print(f"fingerprint={result.fingerprint}")
    if args.strict and result.status in {"skipped", "failed"}:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
