"""Behavioural tests for setup_wazuh_provisioner.sh (#210).

Runs the real script against a fake curl that emulates just enough of the Wazuh API
(JWT authenticate, policies, roles, users, and the three permission probes). No network,
no Wazuh, no host state. Covers: the role is least-privilege, the .env is updated in
place at mode 600, the password never reaches stdout/stderr, a re-run is idempotent, and
a role that is too wide is refused before anything is written to .env.
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

SCRIPT = Path(__file__).resolve().parent / "setup_wazuh_provisioner.sh"
BASH = shutil.which("bash")
pytestmark = pytest.mark.skipif(
    BASH is None or (os.name == "nt" and not os.environ.get("RUN_SHELL_TESTS_ON_WINDOWS")),
    reason="needs POSIX bash",
)
ADMIN_PW = "Adm1n-pass-do-not-print"

FAKE_WAZUH = r'''
import json, os, re, sys
from urllib.parse import urlparse, parse_qs

state_path = os.environ["FAKE_STATE"]
st = json.load(open(state_path)) if os.path.exists(state_path) else {
    "policies": {}, "roles": {}, "users": {}, "calls": [], "next": 100, "admin_pw": os.environ["FAKE_ADMIN_PW"]}
args = sys.argv[1:]
method, cfg, out, fmt, url = "GET", None, None, None, None
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
body = locals().get("body")
cfgtext = open(cfg).read() if cfg else ""
u = urlparse(url)
path, q = u.path, parse_qs(u.query)
actor = None
m = re.search(r'Bearer tok-(\S+?)"', cfgtext)
if m: actor = m.group(1)
m = re.search(r'user = "([^:]*):(.*)"', cfgtext)
auth = (m.group(1), m.group(2).replace('\\"', '"').replace("\\\\", "\\")) if m else None
st["calls"].append([method, path, actor])
code, payload = 200, {"data": {"affected_items": []}}

def item(**kw):
    return {"data": {"affected_items": [kw]}}

def nid():
    st["next"] += 1
    return st["next"]

if path == "/security/user/authenticate":
    user, pw = auth or (None, None)
    ok = (user == "wazuh" and pw == st["admin_pw"]) or (user in st["users"] and st["users"][user]["password"] == pw)
    code, payload = (200, {"data": {"token": "tok-" + user}}) if ok else (401, {})
elif actor == "wazuh":
    if path == "/security/policies" and method == "GET":
        items = list(st["policies"].values())
        if os.environ.get("FAKE_REORDER"):  # a real manager may list actions in another order
            items = [{**i, "policy": {**i["policy"], "actions": i["policy"]["actions"][::-1], "resources": i["policy"]["resources"][::-1]}} for i in items]
        payload = {"data": {"affected_items": items}}
    elif path == "/security/policies" and method == "POST":
        p = json.loads(body); p["id"] = nid(); st["policies"][p["name"]] = p; payload = item(id=p["id"])
    elif re.fullmatch(r"/security/policies/\d+", path) and method == "PUT":
        pid = int(path.split("/")[3])
        for p in st["policies"].values():
            if p["id"] == pid:
                p["policy"] = json.loads(body)["policy"]
    elif path == "/security/users" and method == "DELETE" and os.environ.get("FAKE_DELETE_FAIL"):
        code = 500
    elif path == "/security/users" and method == "DELETE":
        gone = {int(x) for x in q["user_ids"][0].split(",")}
        st["users"] = {k: v for k, v in st["users"].items() if v["id"] not in gone}
    elif path == "/security/roles" and method == "GET":
        want = {int(x) for x in q.get("role_ids", [""])[0].split(",") if x}
        payload = {"data": {"affected_items": [r for r in st["roles"].values() if not want or r["id"] in want]}}
    elif re.fullmatch(r"/security/roles/\d+/policies", path) and method == "DELETE":
        rid = int(path.split("/")[3])
        for r in st["roles"].values():
            if r["id"] == rid:
                r["policies"] = [x for x in r["policies"] if x not in {int(y) for y in q["policy_ids"][0].split(",")}]
    elif re.fullmatch(r"/security/users/\d+/roles", path) and method == "DELETE":
        uid = int(path.split("/")[3])
        for v in st["users"].values():
            if v["id"] == uid:
                v["roles"] = [x for x in v["roles"] if x not in {int(y) for y in q["role_ids"][0].split(",")}]
    elif path == "/security/roles" and method == "POST":
        r = json.loads(body); r["id"] = nid(); r["policies"] = []; st["roles"][r["name"]] = r; payload = item(id=r["id"])
    elif re.fullmatch(r"/security/roles/\d+/policies", path):
        rid = int(path.split("/")[3])
        for r in st["roles"].values():
            if r["id"] == rid and not os.environ.get("FAKE_LINK_FAIL"):
                r["policies"] = sorted(set(r["policies"]) | {int(x) for x in q["policy_ids"][0].split(",")})
    elif path == "/security/users" and method == "GET":
        want = {int(x) for x in q.get("user_ids", [""])[0].split(",") if x}
        payload = {"data": {"affected_items": [{"id": v["id"], "username": k, "roles": v["roles"]}
                                               for k, v in st["users"].items() if not want or v["id"] in want]}}
    elif path == "/security/users" and method == "POST":
        b = json.loads(body); st["users"][b["username"]] = {"id": nid(), "password": b["password"], "roles": []}
        payload = item(id=st["users"][b["username"]]["id"])
    elif re.fullmatch(r"/security/users/\d+", path) and method == "PUT":
        uid = int(path.split("/")[3])
        for v in st["users"].values():
            if v["id"] == uid:
                v["password"] = json.loads(body)["password"]
    elif re.fullmatch(r"/security/users/\d+/roles", path):
        uid = int(path.split("/")[3])
        for v in st["users"].values():
            if v["id"] == uid:
                v["roles"] = sorted(set(v["roles"]) | {int(x) for x in q["role_ids"][0].split(",")})
elif actor == "provisioner":
    user = st["users"]["provisioner"]
    role = next((r for r in st["roles"].values() if r["id"] in user["roles"]), None)
    can_read = role is not None
    if path == "/agents" and method == "GET":
        code = 200 if can_read else 403
    elif path == "/security/users" and method == "POST":
        if os.environ.get("FAKE_PROBE_500"):
            code = 500
        elif os.environ.get("FAKE_WIDE"):  # a too-wide role really creates the account
            b = json.loads(body); st["users"][b["username"]] = {"id": nid(), "password": b["password"], "roles": []}
            code = 200
        else:
            code = 403
    elif path == "/agents" and method == "DELETE":
        code = 200 if os.environ.get("FAKE_NO_DENY") else 403
else:
    code = 401

json.dump(st, open(state_path, "w"))
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
    (root / "env").mkdir(parents=True)
    (root / "certs").mkdir()
    (root / "certs" / "wazuh-api.crt").write_text("fake")
    (root / "env" / ".env").write_text("KEYCLOAK_X=keep-me\n# WAZUH_PROVISION_USER=provisioner\n# WAZUH_PROVISION_PW=\nWAZUH_SCORING_USER=scoring\n")
    bin_dir.mkdir()
    (tmp_path / "fake_wazuh.py").write_text(FAKE_WAZUH)
    curl = bin_dir / "curl"
    curl.write_text(f'#!/bin/bash\nexec "{sys.executable}" "{tmp_path / "fake_wazuh.py"}" "$@"\n')
    curl.chmod(0o755)

    def run(admin_pw=ADMIN_PW, **env):
        e = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "CYBERRANGE_ROOT": str(root),
             "FAKE_STATE": str(state), "FAKE_ADMIN_PW": ADMIN_PW}
        e.pop("WAZUH_ADMIN_PW", None)
        if admin_pw is not None:
            e["WAZUH_ADMIN_PW"] = admin_pw
        e.update(env)
        return subprocess.run([BASH, str(SCRIPT)], capture_output=True, text=True, env=e, timeout=60, stdin=subprocess.DEVNULL)

    run.env_file = root / "env" / ".env"
    run.state = lambda: json.loads(state.read_text())
    return run


def _env(host):
    return dict(l.split("=", 1) for l in host.env_file.read_text().splitlines() if "=" in l and not l.startswith("#"))


def test_creates_a_least_privilege_role_and_updates_env_in_place(host):
    res = host()
    assert res.returncode == 0, res.stderr
    st = host.state()
    allow, deny = st["policies"]["provisioner_agents"]["policy"], st["policies"]["provisioner_deny_000"]["policy"]
    assert allow == {"actions": ["agent:read", "agent:delete"], "resources": ["agent:id:*"], "effect": "allow"}
    assert deny == {"actions": ["agent:delete"], "resources": ["agent:id:000"], "effect": "deny"}
    assert sorted(st["roles"]["provisioner"]["policies"]) == sorted(p["id"] for p in st["policies"].values())
    assert st["users"]["provisioner"]["roles"] == [st["roles"]["provisioner"]["id"]]

    env = _env(host)
    assert env["WAZUH_PROVISION_USER"] == "provisioner"
    assert env["WAZUH_PROVISION_PW"] == st["users"]["provisioner"]["password"]
    assert env["KEYCLOAK_X"] == "keep-me" and env["WAZUH_SCORING_USER"] == "scoring"
    text = host.env_file.read_text()
    assert text.count("WAZUH_PROVISION_USER=") == 1 and text.count("WAZUH_PROVISION_PW=") == 1  # placeholders replaced
    if os.name != "nt":  # Windows has no POSIX modes; the shell tests only run there as a local convenience
        assert stat.S_IMODE(host.env_file.stat().st_mode) == 0o600


def test_never_prints_a_password(host):
    res = host()
    assert res.returncode == 0, res.stderr
    pw = host.state()["users"]["provisioner"]["password"]
    assert pw not in res.stdout + res.stderr and ADMIN_PW not in res.stdout + res.stderr


def test_the_role_is_proven_before_env_is_written(host):
    host()
    calls = [(m, p, a) for m, p, a in host.state()["calls"] if a == "provisioner"]
    assert calls == [("GET", "/agents", "provisioner"), ("POST", "/security/users", "provisioner"), ("DELETE", "/agents", "provisioner")]


def test_rerun_is_idempotent_and_keeps_the_password(host):
    host()
    first, before = _env(host)["WAZUH_PROVISION_PW"], host.state()
    res = host()
    assert res.returncode == 0, res.stderr
    after = host.state()
    assert _env(host)["WAZUH_PROVISION_PW"] == first
    assert after["policies"] == before["policies"] and after["roles"] == before["roles"]
    assert after["users"]["provisioner"]["password"] == first
    assert not [c for c in after["calls"][len(before["calls"]):] if c[0] == "PUT"]


def test_existing_user_without_a_stored_password_gets_a_new_one(host):
    host()
    old = _env(host)["WAZUH_PROVISION_PW"]
    host.env_file.write_text("WAZUH_SCORING_USER=scoring\n")  # operator lost the .env entry
    res = host()
    assert res.returncode == 0, res.stderr
    assert _env(host)["WAZUH_PROVISION_PW"] != old
    assert _env(host)["WAZUH_PROVISION_PW"] == host.state()["users"]["provisioner"]["password"]


@pytest.mark.parametrize("fault", ["FAKE_WIDE", "FAKE_NO_DENY"])
def test_a_role_that_is_too_wide_is_refused_and_env_untouched(host, fault):
    before = host.env_file.read_text()
    res = host(**{fault: "1"})
    assert res.returncode != 0
    assert "not writing" in res.stderr
    assert host.env_file.read_text() == before


def test_a_wide_role_does_not_leave_the_probe_account_behind(host):
    res = host(FAKE_WIDE="1")
    assert res.returncode != 0 and "probe account was removed" in res.stderr
    assert "shouldfail" not in host.state()["users"]
    assert "provisioner" in host.state()["users"]  # only the probe is removed


def test_a_stale_same_named_policy_is_corrected_not_trusted(host, tmp_path):
    stale = {"id": 7, "name": "provisioner_agents",
             "policy": {"actions": ["agent:read", "agent:delete", "agent:modify_group"], "resources": ["agent:id:*"], "effect": "allow"}}
    (tmp_path / "state.json").write_text(json.dumps(
        {"policies": {"provisioner_agents": stale}, "roles": {}, "users": {}, "calls": [], "next": 100, "admin_pw": ADMIN_PW}))
    res = host()
    assert res.returncode == 0, res.stderr
    assert "differs from the intended one" in res.stderr
    got = host.state()["policies"]["provisioner_agents"]
    assert got["id"] == 7 and got["policy"] == {"actions": ["agent:read", "agent:delete"], "resources": ["agent:id:*"], "effect": "allow"}


def test_refuses_without_an_admin_password(host):
    res = host(admin_pw=None)
    assert res.returncode != 0 and "WAZUH_ADMIN_PW" in res.stderr


def test_wrong_admin_password_is_reported_and_creates_nothing(host):
    res = host(admin_pw="wrong")
    assert res.returncode != 0 and "could not authenticate" in res.stderr
    assert "wrong" not in res.stdout + res.stderr.replace("wrong password", "")
    assert not _env(host).get("WAZUH_PROVISION_PW")


def _seed(tmp_path, **parts):
    base = {"policies": {}, "roles": {}, "users": {}, "calls": [], "next": 100, "admin_pw": ADMIN_PW}
    base.update(parts)
    (tmp_path / "state.json").write_text(json.dumps(base))


def test_extra_policies_on_the_role_are_removed(host, tmp_path):
    readonly_all = {"id": 5, "name": "agents_all_agents", "policy": {"actions": ["agent:*"], "resources": ["agent:id:*"], "effect": "allow"}}
    _seed(tmp_path, policies={"agents_all_agents": readonly_all},
          roles={"provisioner": {"id": 6, "name": "provisioner", "policies": [5]}})
    res = host()
    assert res.returncode == 0, res.stderr
    assert "removing unexpected role provisioner policies [5]" in res.stderr
    names = {p["id"]: n for n, p in host.state()["policies"].items()}
    assert sorted(names[i] for i in host.state()["roles"]["provisioner"]["policies"]) == ["provisioner_agents", "provisioner_deny_000"]


def test_a_user_with_another_role_is_reduced_to_the_provisioner_role(host, tmp_path):
    _seed(tmp_path, roles={"readonly": {"id": 2, "name": "readonly", "policies": []}},
          users={"provisioner": {"id": 9, "password": "Old-Passw0rd!x", "roles": [2]}})
    host.env_file.write_text("WAZUH_PROVISION_PW=Old-Passw0rd!x" + chr(10))
    res = host()
    assert res.returncode == 0, res.stderr
    assert "removing unexpected user provisioner roles [2]" in res.stderr
    assert host.state()["users"]["provisioner"]["roles"] == [host.state()["roles"]["provisioner"]["id"]]


def test_a_link_that_did_not_take_is_refused_and_env_untouched(host):
    before = host.env_file.read_text()
    res = host(FAKE_LINK_FAIL="1")
    assert res.returncode != 0 and "expected" in res.stderr and "not writing" in res.stderr
    assert host.env_file.read_text() == before


def test_probe_cleanup_message_says_what_really_happened(host):
    res = host(FAKE_WIDE="1")
    assert "The probe account was removed." in res.stderr


def test_a_failed_probe_cleanup_is_not_reported_as_removed(host):
    res = host(FAKE_WIDE="1", FAKE_DELETE_FAIL="1")
    assert res.returncode != 0
    assert "could NOT be removed (HTTP 500)" in res.stderr and "shouldfail" in res.stderr
    assert "was removed" not in res.stderr
    assert "shouldfail" in host.state()["users"]


def test_a_probe_that_created_nothing_says_so(host):
    res = host(FAKE_PROBE_500="1")
    assert res.returncode != 0
    assert "HTTP 500" in res.stderr and "was not created" in res.stderr and "was removed" not in res.stderr


def test_policy_comparison_ignores_list_order(host):
    host()
    before = host.state()
    res = host(FAKE_REORDER="1")
    assert res.returncode == 0, res.stderr
    assert "differs" not in res.stderr
    assert not [c for c in host.state()["calls"][len(before["calls"]):] if c[0] == "PUT" and "policies" in c[1]]
