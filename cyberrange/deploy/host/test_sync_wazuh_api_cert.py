"""Unit tests for sync_wazuh_api_cert (no live LXD required)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

HOST = Path(__file__).resolve().parent
if str(HOST) not in sys.path:
    sys.path.insert(0, str(HOST))

from sync_wazuh_api_cert import SyncError, sync_wazuh_api_cert  # noqa: E402

PEM_A = b"-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n"
PEM_B = b"-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----\n"
FP_A = "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA"
FP_B = "BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB"


def test_skips_when_manager_missing(tmp_path: Path):
    root = tmp_path / "cyberrange"
    data = tmp_path / "data"
    result = sync_wazuh_api_cert(
        root=root,
        data_dir=data,
        manager_present=lambda _b: False,
        best_effort=True,
    )
    assert result.status == "skipped"
    assert "not found" in result.detail


def test_installs_when_pin_missing(tmp_path: Path):
    root = tmp_path / "cyberrange"
    data = tmp_path / "data"

    def fp(pem: bytes) -> str:
        return FP_A if pem == PEM_A else FP_B

    result = sync_wazuh_api_cert(
        root=root,
        data_dir=data,
        manager_present=lambda _b: True,
        extract_manager_pem=lambda _b: PEM_A,
        live_server_pem=lambda *_a, **_k: PEM_A,
        fingerprint_pem=fp,
        has_dns_localhost=lambda _p: True,
        best_effort=False,
    )
    assert result.status == "installed"
    assert result.fingerprint == FP_A
    assert (root / "certs" / "wazuh-api.crt").read_bytes() == PEM_A


def test_unchanged_when_already_matching(tmp_path: Path):
    root = tmp_path / "cyberrange"
    data = tmp_path / "data"
    dest = root / "certs" / "wazuh-api.crt"
    dest.parent.mkdir(parents=True)
    dest.write_bytes(PEM_A)

    result = sync_wazuh_api_cert(
        root=root,
        data_dir=data,
        manager_present=lambda _b: True,
        extract_manager_pem=lambda _b: PEM_A,
        live_server_pem=lambda *_a, **_k: PEM_A,
        fingerprint_pem=lambda _p: FP_A,
        has_dns_localhost=lambda _p: True,
        best_effort=False,
    )
    assert result.status == "unchanged"
    assert dest.read_bytes() == PEM_A


def test_replaces_mismatched_pin_and_backs_up(tmp_path: Path):
    root = tmp_path / "cyberrange"
    data = tmp_path / "data"
    dest = root / "certs" / "wazuh-api.crt"
    dest.parent.mkdir(parents=True)
    dest.write_bytes(PEM_B)

    def fp(pem: bytes) -> str:
        return FP_A if b"AAA" in pem else FP_B

    result = sync_wazuh_api_cert(
        root=root,
        data_dir=data,
        manager_present=lambda _b: True,
        extract_manager_pem=lambda _b: PEM_A,
        live_server_pem=lambda *_a, **_k: PEM_A,
        fingerprint_pem=fp,
        has_dns_localhost=lambda _p: True,
        best_effort=False,
    )
    assert result.status == "installed"
    assert dest.read_bytes() == PEM_A
    backups = list(data.glob("wazuh-api.crt.bak-*"))
    assert len(backups) == 1
    assert backups[0].read_bytes() == PEM_B


def test_mismatch_strict_raises(tmp_path: Path):
    with pytest.raises(SyncError, match="fingerprint mismatch"):
        sync_wazuh_api_cert(
            root=tmp_path / "cyberrange",
            data_dir=tmp_path / "data",
            manager_present=lambda _b: True,
            extract_manager_pem=lambda _b: PEM_A,
            live_server_pem=lambda *_a, **_k: PEM_B,
            fingerprint_pem=lambda pem: FP_A if pem == PEM_A else FP_B,
            has_dns_localhost=lambda _p: True,
            best_effort=False,
        )


def test_mismatch_best_effort_skips(tmp_path: Path):
    result = sync_wazuh_api_cert(
        root=tmp_path / "cyberrange",
        data_dir=tmp_path / "data",
        manager_present=lambda _b: True,
        extract_manager_pem=lambda _b: PEM_A,
        live_server_pem=lambda *_a, **_k: PEM_B,
        fingerprint_pem=lambda pem: FP_A if pem == PEM_A else FP_B,
        has_dns_localhost=lambda _p: True,
        best_effort=True,
    )
    assert result.status == "skipped"
    assert "fingerprint mismatch" in result.detail


def test_missing_san_fails_strict(tmp_path: Path):
    with pytest.raises(SyncError, match="DNS:localhost"):
        sync_wazuh_api_cert(
            root=tmp_path / "cyberrange",
            data_dir=tmp_path / "data",
            manager_present=lambda _b: True,
            extract_manager_pem=lambda _b: PEM_A,
            live_server_pem=lambda *_a, **_k: PEM_A,
            fingerprint_pem=lambda _p: FP_A,
            has_dns_localhost=lambda _p: False,
            best_effort=False,
        )
