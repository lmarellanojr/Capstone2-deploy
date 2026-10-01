"""Behavioural tests for pull_release.sh's failure handling.

Runs the real script with a fake $HOME and stub curl / systemctl / journalctl / npm / sleep on
PATH, plus a fake release_sync.py, so no network, systemd or host state is touched. Covers the
2026-10-02 release-promote finding: loud STUCK state instead of a silent skip, --retry-bad,
health polling with crash-loop detection, a failure log with the API traceback, and the
interpreter warning.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "pull_release.sh"
BASH = shutil.which("bash")
pytestmark = pytest.mark.skipif(BASH is None or os.name == "nt", reason="needs POSIX bash")
SHA = "a" * 40

CURL = r"""#!/bin/bash
out=""; fmt=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2;;
    -w) fmt="$2"; shift 2;;
    -H|--max-time) shift 2;;
    http*) url="$1"; shift;;
    *) shift;;
  esac
done
emit() { if [ -n "$out" ] && [ "$out" != /dev/null ]; then printf '%s' "$1" > "$out"; else printf '%s' "$1"; fi; }
case "$url" in
  *releases/tags/*) emit '{"assets":[{"name":"manifest.json","id":1},{"name":"tree.tgz","id":2},{"name":"portal-build.tgz","id":3}]}'; exit 0;;
  *releases/assets/1) emit '{"lockfile_sha256":"LOCK"}'; exit 0;;
  *releases/assets/*) emit ''; exit 0;;
esac
if [ "${FAKE_HEALTH:-ok}" != ok ]; then [ -n "$fmt" ] && printf '000'; exit 7; fi
case "$url" in
  *:5000/health) if [ -n "$fmt" ]; then printf 200; else printf '{"status":"ok"}'; fi;;
  *:3000/login) printf 200;;
  *:3000/api/auth/providers) printf '{}';;
  *:8765/*) printf 101;;
esac
"""

SYSTEMCTL = r"""#!/bin/bash
[ "$1" = "--user" ] && shift
echo "systemctl $*" >> "$FAKE_STATE/calls"
case "$1" in
  show)
    if [ "$3" = NRestarts ]; then
      n=$(cat "$FAKE_STATE/nrestarts" 2>/dev/null || echo 0)
      if [ "${FAKE_CRASHLOOP:-0}" = 1 ]; then n=$((n + 1)); echo "$n" > "$FAKE_STATE/nrestarts"; fi
      echo "$n"
    elif [ "$3" = ExecStart ]; then
      echo "${FAKE_EXEC}"
    fi;;
  is-active) echo active;;
esac
exit 0
"""

SYNC = r"""import os, sys
op = sys.argv[1]
if op == "--check-apply":
    print(os.environ["FAKE_SHA"])
elif op == "--lock-hash":
    print("LOCK")
"""


@pytest.fixture
def host(tmp_path):
    home = tmp_path / "home"
    root, data, state, bin_dir = home / "cyberrange", home / "cyberrange-data", tmp_path / "state", tmp_path / "bin"
    for d in (root / "deploy" / "host", root / "portal", data / "rollback", state, bin_dir):
        d.mkdir(parents=True)
    (root / "deploy" / "host" / "release_sync.py").write_text(SYNC)
    (root / "DEPLOYED_SHA").write_text("b" * 40 + "\n")
    (data / "github-release.env").write_text("GITHUB_OWNER=o\nGITHUB_REPO=r\n")
    (data / "github-release.token").write_text("t\n")
    stubs = {"curl": CURL, "systemctl": SYSTEMCTL, "journalctl": "#!/bin/bash\necho 'journal: provision-api exited 1'\n",
             "npm": "#!/bin/bash\nexit 0\n", "sleep": "#!/bin/bash\nexit 0\n"}
    for name, body in stubs.items():
        p = bin_dir / name
        p.write_text(body)
        p.chmod(0o755)

    def run(*args, **env):
        e = {
            "PATH": f"{bin_dir}:{os.environ['PATH']}", "HOME": str(home), "FAKE_SHA": SHA,
            "FAKE_STATE": str(state), "HEALTH_TIMEOUT": "20",
            "FAKE_EXEC": f"{{ path={root}/.venv/bin/python ; argv[]=python provision_api_fastapi.py }}",
        }
        e.update(env)
        return subprocess.run([BASH, str(SCRIPT), *args], capture_output=True, text=True, env=e, timeout=60)

    run.root, run.data = root, data
    return run


def test_healthy_apply_records_sha_and_clears_stuck(host):
    (host.data / "rollback" / "STUCK").write_text("old")
    res = host()
    assert res.returncode == 0, res.stderr
    assert (host.root / "DEPLOYED_SHA").read_text().strip() == SHA
    assert not (host.data / "rollback" / "STUCK").exists()
    assert "WARNING" not in res.stderr


def test_bad_sha_skip_is_loud_and_writes_stuck_file(host):
    (host.data / "rollback" / "bad-sha").write_text(SHA + "\n")
    res = host()
    assert res.returncode == 0
    assert "STUCK" in res.stderr and "--retry-bad" in res.stderr
    stuck = (host.data / "rollback" / "STUCK").read_text()
    assert SHA in stuck and "b" * 40 in stuck  # names both the failed and the live SHA
    assert (host.root / "DEPLOYED_SHA").read_text().strip() == "b" * 40  # nothing applied


def test_retry_bad_reapplies_a_previously_failed_sha(host):
    (host.data / "rollback" / "bad-sha").write_text(SHA + "\n")
    (host.data / "rollback" / "STUCK").write_text("x")
    res = host("--retry-bad")
    assert res.returncode == 0, res.stderr
    assert (host.root / "DEPLOYED_SHA").read_text().strip() == SHA
    assert not (host.data / "rollback" / "bad-sha").exists()
    assert not (host.data / "rollback" / "STUCK").exists()


def test_crash_loop_fails_fast_with_failure_log(host):
    res = host(FAKE_HEALTH="down", FAKE_CRASHLOOP="1", HEALTH_TIMEOUT="600")
    assert res.returncode == 1
    assert "crash-looping" in res.stderr
    assert (host.data / "rollback" / "bad-sha").read_text().strip() == SHA
    log = (host.data / "rollback" / "last-failure.log").read_text()
    assert "health check failed after apply" in log and "journal: provision-api exited 1" in log
    # Gave up after a couple of polls, not after the 600 s timeout.
    polls = (host.root.parent.parent / "state" / "calls").read_text().count("NRestarts")
    assert polls <= 6


def test_unhealthy_without_crash_loop_times_out(host):
    res = host(FAKE_HEALTH="down", HEALTH_TIMEOUT="20")
    assert res.returncode == 1
    assert "not healthy after" in res.stderr
    assert (host.data / "rollback" / "last-failure.log").exists()


def test_warns_when_api_unit_does_not_use_the_venv(host):
    res = host(FAKE_EXEC="{ path=/usr/bin/python3 ; argv[]=/usr/bin/python3 provision_api_fastapi.py }")
    assert res.returncode == 0, res.stderr
    assert "WARNING" in res.stderr and "install-user-units.sh" in res.stderr
