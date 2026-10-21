"""The one-shot must not publish the CA before the manager serves it."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

HOST = Path(__file__).resolve().parent
if str(HOST) not in sys.path:
    sys.path.insert(0, str(HOST))

import issue_wazuh_internal_ca as issue  # noqa: E402

PULL = HOST / "pull_release.sh"


def test_pull_release_routes_post_extract_smoke_through_fail_apply():
    text = PULL.read_text(encoding="utf-8")
    assert 'smoke_wazuh_ca || fail_apply "Wazuh CA smoke failed"' in text
    assert "sync_wazuh_api_cert\n  smoke_wazuh_ca\n  exit 0" in text
    assert "-verify_hostname localhost" in text
    assert "/security/user/authenticate" in text
    assert "[ $? -eq 0 ] || return 1" in text


def test_require_mode_raises_runtime_error(tmp_path: Path, monkeypatch):
    key = tmp_path / "ca.key"
    key.write_bytes(b"secret")

    class Loose:
        st_mode = 0o100644

    monkeypatch.setattr(Path, "stat", lambda self: Loose())
    with pytest.raises(RuntimeError, match="expected 0o600"):
        issue._require_mode(key, 0o600)


def test_main_without_install_does_not_publish(tmp_path: Path, monkeypatch):
    root = tmp_path / "cyberrange"
    data = tmp_path / "data"
    calls = []

    def fake_issue(data_dir: Path) -> Path:
        calls.append("issue")
        ca = data_dir / "wazuh-ca" / "ca.crt"
        ca.parent.mkdir(parents=True)
        ca.write_bytes(b"CA")
        return ca

    monkeypatch.setattr(issue, "issue_material", fake_issue)
    monkeypatch.setattr(issue, "install_on_manager", lambda *a, **k: calls.append("install"))
    monkeypatch.setattr(issue, "publish_ca", lambda *a, **k: calls.append("publish"))

    rc = issue.main(["--root", str(root), "--data", str(data)])
    assert rc == 0
    assert calls == ["issue"]
    assert not (root / "certs" / "wazuh-api-ca.crt").exists()


def test_main_sets_private_umask(tmp_path: Path, monkeypatch):
    seen = {}
    previous = os.umask(0o022)
    os.umask(previous)

    def spy(mask):
        seen["mask"] = mask
        return previous

    monkeypatch.setattr(issue.os, "umask", spy)
    monkeypatch.setattr(
        issue,
        "issue_material",
        lambda data_dir: data_dir / "wazuh-ca" / "ca.crt",
    )
    issue.main(["--root", str(tmp_path / "root"), "--data", str(tmp_path / "data")])
    assert seen["mask"] == 0o077


def test_install_publishes_only_after_manager_verify(tmp_path: Path, monkeypatch):
    root = tmp_path / "cyberrange"
    data = tmp_path / "data"
    env = root / "env" / ".env"
    env.parent.mkdir(parents=True)
    env.write_text("WAZUH_API_URL=https://localhost:55000\n", encoding="utf-8")
    order = []

    def fake_issue(data_dir: Path) -> Path:
        order.append("issue")
        ca = data_dir / "wazuh-ca" / "ca.crt"
        ca.parent.mkdir(parents=True)
        ca.write_bytes(b"CA")
        return ca

    def fake_install(data_dir: Path, lxc_bin: str = "lxc") -> None:
        order.append("install")
        assert not (root / "certs" / "wazuh-api-ca.crt").exists()

    monkeypatch.setattr(issue, "issue_material", fake_issue)
    monkeypatch.setattr(issue, "install_on_manager", fake_install)

    rc = issue.main(["--install", "--root", str(root), "--data", str(data)])
    assert rc == 0
    assert order == ["issue", "install"]
    assert (root / "certs" / "wazuh-api-ca.crt").read_bytes() == b"CA"
    assert "WAZUH_CA_BUNDLE=" in env.read_text(encoding="utf-8")


def test_install_failure_does_not_publish(tmp_path: Path, monkeypatch):
    root = tmp_path / "cyberrange"
    data = tmp_path / "data"

    def fake_issue(data_dir: Path) -> Path:
        ca = data_dir / "wazuh-ca" / "ca.crt"
        ca.parent.mkdir(parents=True)
        ca.write_bytes(b"CA")
        return ca

    def fake_install(data_dir: Path, lxc_bin: str = "lxc") -> None:
        raise RuntimeError("push failed")

    monkeypatch.setattr(issue, "issue_material", fake_issue)
    monkeypatch.setattr(issue, "install_on_manager", fake_install)

    with pytest.raises(RuntimeError, match="push failed"):
        issue.main(["--install", "--root", str(root), "--data", str(data)])
    assert not (root / "certs" / "wazuh-api-ca.crt").exists()


def test_install_pushes_as_wazuh_and_waits_for_tls(tmp_path: Path, monkeypatch):
    pushed = []
    waited = []

    def capture(argv):
        if argv[-2:] == ["-u", "wazuh"]:
            return "101"
        if argv[-2:] == ["-g", "wazuh"]:
            return "102"
        raise AssertionError(argv)

    monkeypatch.setattr(issue, "_capture", capture)
    monkeypatch.setattr(issue, "_run", lambda argv, timeout=60: pushed.append(argv))
    monkeypatch.setattr(issue, "_wait_until_ca_verifies", lambda ca: waited.append(ca))

    data = tmp_path / "data"
    (data / "wazuh-ca").mkdir(parents=True)
    issue.install_on_manager(data)

    cert_push, key_push, restart = pushed
    assert cert_push[1:8] == ["file", "push", "--uid", "101", "--gid", "102", "--mode"]
    assert cert_push[8] == "0644"
    assert key_push[8] == "0640"
    assert restart[-2:] == ["restart", "wazuh-manager"]
    assert waited == [data / "wazuh-ca" / "ca.crt"]


def test_guest_ids_must_be_numeric(monkeypatch):
    monkeypatch.setattr(issue, "_capture", lambda argv: "wazuh")
    with pytest.raises(RuntimeError, match="not numeric"):
        issue._guest_wazuh_ids("lxc")


def test_wait_raises_when_verify_never_passes(monkeypatch):
    clock = {"now": 0.0}
    monkeypatch.setattr(issue, "_tls_verified", lambda ca: (False, "Verify return code: 21"))

    def sleep(_seconds):
        clock["now"] += 2

    monkeypatch.setattr(issue.time, "sleep", sleep)
    monkeypatch.setattr(issue.time, "monotonic", lambda: clock["now"])
    with pytest.raises(RuntimeError, match="did not verify"):
        issue._wait_until_ca_verifies(Path("ca.crt"), timeout_s=3)


def test_key_mode_check_uses_runtime_error_not_assert():
    text = (HOST / "issue_wazuh_internal_ca.py").read_text(encoding="utf-8")
    assert "assert stat.S_IMODE" not in text
    assert "os.umask(0o077)" in text
