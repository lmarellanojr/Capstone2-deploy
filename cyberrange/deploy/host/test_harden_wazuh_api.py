"""Behavioural tests for harden_wazuh_api.sh (#286).

Runs the real script against a fake `lxc` (the wazuh-manager container: the :55000
listener, api.yaml on disk, restart) and a fake `curl` (the Wazuh API: JWT authenticate,
GET/PUT /security/users). No network, no LXD, no Wazuh. Covers: api.yaml gains a single
top-level `host: 127.0.0.1` with every other key kept; a listener that stays non-loopback
after the restart aborts the run before any credential is touched; both built-ins are
rotated looked up by username; a rotation whose new password is rejected aborts; the new
passwords land in a mode-600 file outside the repo and never reach stdout/stderr; and a
re-run is safe.
"""
from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "harden_wazuh_api.sh"
BASH = shutil.which("bash")
pytestmark = pytest.mark.skipif(
    BASH is None or (os.name == "nt" and not os.environ.get("RUN_SHELL_TESTS_ON_WINDOWS")),
    reason="needs POSIX bash",
)
ADMIN_PW = "Adm1n-pass-do-not-print"

FAKE = r'''
import json, os, re, sys
from urllib.parse import urlparse

state_path = os.environ["FAKE_STATE"]
st = json.load(open(state_path))
mode = sys.argv[1]
args = sys.argv[2:]


def save():
    json.dump(st, open(state_path, "w"))


def host_of(yaml):
    for ln in (yaml or "").splitlines():
        if (len(ln) - len(ln.lstrip())) == 0:
            m = re.match(r"host\s*:\s*(\S+)", ln)
            if m:
                return m.group(1)
    return "0.0.0.0"  # Wazuh apid default when no host key is present


if mode == "lxc":
    # lxc exec <container> -- <cmd> [cmd-args...]
    assert args[0] == "exec" and args[2] == "--", args
    rest = args[3:]
    cmd, rc = rest[0], 0
    if cmd == "ss":
        lines = ["LISTEN 0 128 0.0.0.0:22 0.0.0.0:*"]
        if st.get("bind"):
            lines.append("LISTEN 0 128 %s:55000 0.0.0.0:*" % st["bind"])
        sys.stdout.write("\n".join(lines) + "\n")
    elif cmd == "cat":
        if st.get("disk_yaml") is None:
            rc = 1
        else:
            sys.stdout.write(st["disk_yaml"])
    elif cmd == "test":
        rc = 0 if st.get("disk_yaml") is not None else 1
    elif cmd == "cp":
        st.setdefault("backups", []).append(rest[1:])
    elif cmd == "tee":
        st["disk_yaml"] = sys.stdin.read()
    elif cmd == "systemctl":  # restart wazuh-manager
        if not os.environ.get("FAKE_IGNORE_YAML"):
            st["bind"] = host_of(st.get("disk_yaml"))
    st["calls"].append(["lxc"] + rest[:2])
    save()
    sys.exit(rc)

# mode == "curl"
method, cfg, out, fmt, url, body = "GET", None, None, None, None, None
i = 0
while i < len(args):
    a = args[i]
    if a == "-X": method = args[i + 1]; i += 2
    elif a == "-K": cfg = args[i + 1]; i += 2
    elif a == "-o": out = args[i + 1]; i += 2
    elif a == "-w": fmt = args[i + 1]; i += 2
    elif a in ("--cacert", "-H"): i += 2
    elif a == "--data-binary": body = open(args[i + 1][1:]).read(); i += 2
    elif a.startswith("http"): url = a; i += 1
    else: i += 1
cfgtext = open(cfg).read() if cfg else ""
m = re.search(r'Bearer tok-(\S+?)"', cfgtext)
actor = m.group(1) if m else None
m = re.search(r'user = "([^:]*):(.*)"', cfgtext)
auth = (m.group(1), m.group(2).replace('\\"', '"').replace("\\\\", "\\")) if m else None
path = urlparse(url).path
st["calls"].append(["curl", method, path, actor])
code, payload = 200, {"data": {"affected_items": []}}

if path == "/security/user/authenticate":
    user, pw = auth or (None, None)
    ok = user in st["users"] and st["users"][user]["password"] == pw
    code, payload = (200, {"data": {"token": "tok-" + user}}) if ok else (401, {})
elif actor is not None:
    if path == "/security/users" and method == "GET":
        payload = {"data": {"affected_items": [{"id": v["id"], "username": k}
                                               for k, v in st["users"].items()]}}
    elif re.fullmatch(r"/security/users/\d+", path) and method == "PUT":
        uid = int(path.split("/")[3])
        if not os.environ.get("FAKE_PUT_NOOP"):
            for v in st["users"].values():
                if v["id"] == uid:
                    v["password"] = json.loads(body)["password"]
        code = 200
else:
    code = 401

save()
if out and out != "/dev/null":
    open(out, "w").write(json.dumps(payload))
elif not fmt:
    sys.stdout.write(json.dumps(payload))
if fmt:
    sys.stdout.write(str(code))
'''


@pytest.fixture
def host(tmp_path):
    root, bin_dir, state = tmp_path / "home" / "cyberrange", tmp_path / "bin", tmp_path / "state.json"
    (root / "certs").mkdir(parents=True)
    (root / "certs" / "wazuh-api.crt").write_text("fake")
    bin_dir.mkdir()
    (tmp_path / "fake.py").write_text(FAKE)
    for name in ("curl", "lxc"):
        p = bin_dir / name
        p.write_text(f'#!/bin/bash\nexec "{sys.executable}" "{tmp_path / "fake.py"}" {name} "$@"\n')
        p.chmod(0o755)

    def seed(**parts):
        base = {
            "bind": "0.0.0.0",
            "disk_yaml": "port: 55000\nhttps:\n  enabled: true\n",
            "users": {"wazuh": {"id": 1, "password": ADMIN_PW},
                      "wazuh-wui": {"id": 2, "password": "wazuh-wui"}},
            "backups": [], "calls": [],
        }
        base.update(parts)
        state.write_text(json.dumps(base))

    def run(admin_pw=ADMIN_PW, **env):
        if not state.exists():
            seed()
        e = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
             "CYBERRANGE_ROOT": str(root), "FAKE_STATE": str(state),
             "WAZUH_API_WAIT_TRIES": "2", "WAZUH_API_WAIT_SLEEP": "0"}
        e.pop("WAZUH_ADMIN_PW", None)
        if admin_pw is not None:
            e["WAZUH_ADMIN_PW"] = admin_pw
        e.update(env)
        return subprocess.run([BASH, str(SCRIPT)], capture_output=True, text=True, env=e,
                              timeout=60, stdin=subprocess.DEVNULL)

    run.seed = seed
    run.state = lambda: json.loads(state.read_text())
    run.secrets_file = root / "secrets" / "wazuh-builtin-credentials.env"
    return run


def test_sets_host_to_loopback_keeping_other_keys(host):
    res = host()
    assert res.returncode == 0, res.stderr
    yaml = host.state()["disk_yaml"]
    assert yaml.splitlines()[0] == "host: 127.0.0.1"
    assert yaml.count("host: 127.0.0.1") == 1  # no duplicate host line
    assert "port: 55000" in yaml and "enabled: true" in yaml  # untouched
    assert host.state()["bind"] == "127.0.0.1"
    assert host.state()["backups"], "api.yaml should be backed up before the rewrite"


def test_both_builtins_rotated_looked_up_by_username(host):
    res = host()
    assert res.returncode == 0, res.stderr
    st = host.state()
    assert st["users"]["wazuh"]["password"] != ADMIN_PW
    assert st["users"]["wazuh-wui"]["password"] != "wazuh-wui"
    # looked up by name, then PUT by the discovered id
    assert ["curl", "GET", "/security/users", "wazuh"] in st["calls"]
    puts = {c[2] for c in st["calls"] if c[1] == "PUT"}
    assert "/security/users/1" in puts and "/security/users/2" in puts


def test_a_non_loopback_listener_after_restart_aborts_before_rotating(host):
    host.seed()  # bind starts 0.0.0.0; FAKE_IGNORE_YAML keeps it there after restart
    res = host(FAKE_IGNORE_YAML="1")
    assert res.returncode != 0
    assert "non-loopback" in res.stderr
    st = host.state()
    assert st["users"]["wazuh"]["password"] == ADMIN_PW  # not rotated
    assert st["users"]["wazuh-wui"]["password"] == "wazuh-wui"
    assert not host.secrets_file.exists()


def test_no_listener_after_restart_aborts(host):
    host.seed(bind="", disk_yaml="host: 127.0.0.1\nport: 55000\n")
    res = host(FAKE_IGNORE_YAML="1")
    assert res.returncode != 0 and "did not come back up" in res.stderr


def test_a_rejected_new_password_aborts_and_writes_no_secret(host):
    res = host(FAKE_PUT_NOOP="1")
    assert res.returncode != 0
    assert "new password" in res.stderr
    assert not host.secrets_file.exists()


def test_never_prints_a_password(host):
    res = host()
    assert res.returncode == 0, res.stderr
    st = host.state()
    for secret in (ADMIN_PW, st["users"]["wazuh"]["password"], st["users"]["wazuh-wui"]["password"]):
        assert secret not in res.stdout + res.stderr


def test_secrets_file_is_mode_600_and_holds_the_new_passwords(host):
    res = host()
    assert res.returncode == 0, res.stderr
    assert host.secrets_file.exists()
    if os.name != "nt":
        assert stat.S_IMODE(host.secrets_file.stat().st_mode) == 0o600
    text = host.secrets_file.read_text()
    env = dict(l.split("=", 1) for l in text.splitlines() if "=" in l and not l.startswith("#"))
    st = host.state()
    assert env["WAZUH_ADMIN_PW"] == st["users"]["wazuh"]["password"]
    assert env["WAZUH_WUI_PW"] == st["users"]["wazuh-wui"]["password"]
    # the recorded secrets are the new ones, not the old defaults
    assert env["WAZUH_ADMIN_PW"] != ADMIN_PW and env["WAZUH_WUI_PW"] != "wazuh-wui"


def test_rerun_is_safe_and_does_not_duplicate_the_host_key(host):
    assert host().returncode == 0
    # the first run rotated `wazuh`, so the second must use the current admin password
    res = host(admin_pw=host.state()["users"]["wazuh"]["password"])
    assert res.returncode == 0, res.stderr
    yaml = host.state()["disk_yaml"]
    assert yaml.count("host: 127.0.0.1") == 1
    assert yaml.splitlines()[0] == "host: 127.0.0.1"


def test_rerun_does_not_rewrite_or_restart_when_already_loopback(host):
    host()
    before = host.state()
    res = host(admin_pw=before["users"]["wazuh"]["password"])
    assert res.returncode == 0, res.stderr
    new_calls = host.state()["calls"][len(before["calls"]):]
    assert not [c for c in new_calls if c[0] == "lxc" and c[1] == "tee"]
    assert not [c for c in new_calls if c[0] == "lxc" and c[1] == "systemctl"]


def test_requires_wazuh_wui_to_be_present(host):
    host.seed(users={"wazuh": {"id": 1, "password": ADMIN_PW}})
    res = host()
    assert res.returncode != 0 and "wazuh-wui" in res.stderr and "not found" in res.stderr


def test_refuses_without_an_admin_password(host):
    res = host(admin_pw=None)
    assert res.returncode != 0 and "WAZUH_ADMIN_PW" in res.stderr


def test_wrong_admin_password_is_reported_and_rotates_nothing(host):
    # already loopback so the run reaches the admin auth step without restarting
    host.seed(bind="127.0.0.1", disk_yaml="host: 127.0.0.1\nport: 55000\n")
    res = host(admin_pw="wrong")
    assert res.returncode != 0 and "could not authenticate" in res.stderr
    # the supplied password must not leak ("wrong password" in the message is boilerplate)
    assert "wrong" not in res.stdout + res.stderr.replace("wrong password", "")
    assert host.state()["users"]["wazuh-wui"]["password"] == "wazuh-wui"
    assert not host.secrets_file.exists()
