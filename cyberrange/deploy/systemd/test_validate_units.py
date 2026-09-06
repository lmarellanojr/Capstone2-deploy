from pathlib import Path

from validate_units import read_env_file_keys, validate_unit

HERE = Path(__file__).resolve().parent

UNIT_OK = """[Service]
EnvironmentFile=/home/llms_admin/cyberrange/env/.env
ExecStart=/usr/bin/python3 provision_api_fastapi.py
"""


def test_ok_unit():
    errs = validate_unit(
        UNIT_OK,
        require_env_file="/home/llms_admin/cyberrange/env/.env",
        exec_must_contain=["provision_api_fastapi.py"],
    )
    assert errs == []


def test_missing_exec():
    errs = validate_unit(
        "[Service]\nEnvironmentFile=/x\n",
        require_env_file="/x",
        exec_must_contain=["python"],
    )
    assert any("ExecStart" in e for e in errs)


def test_wrong_envfile():
    errs = validate_unit(
        UNIT_OK,
        require_env_file="/wrong",
        exec_must_contain=["provision_api_fastapi.py"],
    )
    assert any("EnvironmentFile" in e for e in errs)


def test_read_env_keys_ignores_comments():
    keys = read_env_file_keys("# c\nPROFILE=oci_12gib\nMAX_PODS=1\n")
    assert keys == {"PROFILE", "MAX_PODS"}


def test_api_unit_file():
    text = (HERE / "cyberrange-provision-api.service").read_text(encoding="utf-8")
    assert validate_unit(
        text,
        require_env_file="/home/llms_admin/cyberrange/env/.env",
        exec_must_contain=["provision_api_fastapi.py"],
    ) == []
    assert "WorkingDirectory=/home/llms_admin/cyberrange/src/provisioning" in text


def test_bridge_unit_file():
    text = (HERE / "cyberrange-ssh-bridge.service").read_text(encoding="utf-8")
    assert validate_unit(
        text,
        require_env_file="/home/llms_admin/cyberrange/bridge-src/.env.bridge",
        exec_must_contain=["bridge.py"],
    ) == []
    assert ".venv/bin/python" in text
    assert "PYTHONPATH=/home/llms_admin/cyberrange/src/provisioning" in text


def test_cloudflared_unit_file():
    text = (HERE / "cloudflared.service").read_text(encoding="utf-8")
    assert "ExecStart=" in text
    assert "--token-file /etc/cloudflared/token" in text
    assert "0.0.0.0" not in text
    assert "WantedBy=multi-user.target" in text
    assert "User=llms_admin" in text


def test_pull_release_unit_file():
    text = (HERE / "cyberrange-pull-release.service").read_text(encoding="utf-8")
    assert "Type=oneshot" in text
    assert "MemoryMax=1G" in text or "MemoryMax=1073741824" in text
    assert "pull_release.sh" in text
    assert "0.0.0.0" not in text
    assert "self-hosted" not in text
    timer = (HERE / "cyberrange-pull-release.timer").read_text(encoding="utf-8")
    assert "OnUnitActiveSec=5min" in timer or "OnCalendar=" in timer
    assert "Persistent=true" in timer


def test_portal_unit_file():
    text = (HERE / "cyberrange-portal.service").read_text(encoding="utf-8")
    assert validate_unit(
        text,
        require_env_file="/home/llms_admin/cyberrange/portal/.env.local",
        exec_must_contain=["next", "10.115.77.1", "3000"],
    ) == []
    assert "WorkingDirectory=/home/llms_admin/cyberrange/portal" in text
    assert "0.0.0.0" not in text
