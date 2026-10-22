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
    if os.environ.get("FAKE_SKIP"):
        print("already deployed " + os.environ["FAKE_SHA"])
        sys.exit(2)
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

    run.root, run.data, run.state, run.bin = root, data, state, bin_dir
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


def _write_api_env(host, text):
    env = host.root / "env"
    env.mkdir(parents=True, exist_ok=True)
    (env / ".env").write_text(text)


def test_warns_when_scoring_is_set_but_provisioner_is_missing(host):
    _write_api_env(host, "WAZUH_SCORING_USER=scoring\nWAZUH_SCORING_PW=s3cret-scoring\n# WAZUH_PROVISION_USER=provisioner\n")
    res = host()
    assert res.returncode == 0, res.stderr  # warn only: never blocks the release
    assert "WAZUH_PROVISION_USER" in res.stderr and "setup_wazuh_provisioner.sh" in res.stderr
    assert "s3cret-scoring" not in res.stderr + res.stdout


@pytest.mark.parametrize("pair", ["WAZUH_PROVISION_USER=provisioner\n", "WAZUH_PROVISION_USER=\nWAZUH_PROVISION_PW=x\n",
                                  'WAZUH_PROVISION_USER=""\nWAZUH_PROVISION_PW=""\n'])
def test_warns_on_a_half_set_or_empty_provisioner_pair(host, pair):
    _write_api_env(host, "WAZUH_SCORING_USER=scoring\n" + pair)
    res = host()
    assert res.returncode == 0, res.stderr
    assert "WAZUH_PROVISION_USER" in res.stderr


@pytest.mark.parametrize("env", [
    "WAZUH_SCORING_USER=scoring\nWAZUH_PROVISION_USER=provisioner\nWAZUH_PROVISION_PW=pw\n",
    'WAZUH_SCORING_USER=scoring\nWAZUH_PROVISION_USER="provisioner"\nWAZUH_PROVISION_PW="pw"\n',
    "# Wazuh is not used on this host\n",
])
def test_no_provisioner_warning_when_set_or_wazuh_unused(host, env):
    _write_api_env(host, env)
    res = host()
    assert res.returncode == 0, res.stderr
    assert "WAZUH_PROVISION_USER" not in res.stderr


# #304: cert sync under the real unit PATH, and recovery when the SHA is unchanged.
CERT_HELPER = r"""import os, sys
with open(os.path.join(os.environ["FAKE_STATE"], "cert-sync"), "a") as f:
    f.write(os.environ["PATH"] + "\n")
rc = int(os.environ.get("FAKE_CERT_RC", "0"))
if rc:
    print("wazuh-api.crt sync failed: fake", file=sys.stderr)
else:
    print("wazuh-api.crt sync " + os.environ.get("FAKE_CERT_STATUS", "unchanged") + ": fake")
sys.exit(rc)
"""


def _install_cert_helper(host):
    (host.root / "deploy" / "host" / "sync_wazuh_api_cert.py").write_text(CERT_HELPER)


# Like real s_client: CONNECTED( once TCP connects, then the verify result.
# FAKE_REFUSED=1 mimics a stopped manager (connection refused, exit 1).
OPENSSL_STUB = """#!/bin/bash
if [ -n "$FAKE_REFUSED" ]; then
  echo "connect:errno=111"
  exit 1
fi
echo "CONNECTED(00000003)"
echo "Verify return code: ${FAKE_VERIFY:-21}"
"""


def _install_ca_and_lxc(host):
    certs = host.root / "certs"
    certs.mkdir(exist_ok=True)
    (certs / "wazuh-api-ca.crt").write_text("CA\n")
    stubs = {"lxc": "#!/bin/bash\nexit 0\n",
             "openssl": OPENSSL_STUB}
    for name, body in stubs.items():
        p = host.bin / name
        p.write_text(body)
        p.chmod(0o755)


def _install_auth_ok(host):
    # Stand-in for the venv python that runs the scoring-user authenticate step.
    py = host.root / ".venv" / "bin" / "python"
    py.parent.mkdir(parents=True, exist_ok=True)
    py.write_text('#!/bin/bash\ncat >/dev/null\necho "pull-release: wazuh CA smoke authenticated"\n')
    py.chmod(0o755)


def _sync_paths(host):
    return (host.state / "cert-sync").read_text().splitlines()


def test_service_path_appends_sbin_for_cert_sync(host):
    _install_cert_helper(host)
    res = host(PATH=f"{host.bin}:/usr/bin:/bin", FAKE_SKIP="1")
    assert res.returncode == 0, res.stderr
    # The installed unit's PATH stays first (test stubs win); lxc dirs are appended.
    assert _sync_paths(host) == [f"{host.bin}:/usr/bin:/bin:/usr/sbin:/snap/bin"]


def test_unchanged_release_retries_a_failed_cert_sync(host):
    _install_cert_helper(host)
    first = host(FAKE_SKIP="1", FAKE_CERT_RC="2")
    assert first.returncode == 0, first.stderr  # sync stays non-fatal
    assert "wazuh-api.crt sync FAILED" in first.stderr
    assert "recheck incomplete on unchanged release (sync exited 2)" in first.stderr
    second = host(FAKE_SKIP="1")
    assert second.returncode == 0, second.stderr
    assert "wazuh cert recheck OK on unchanged release" in second.stdout
    assert len(_sync_paths(host)) == 2  # retried without a new release SHA
    assert (host.root / "DEPLOYED_SHA").read_text().strip() == "b" * 40


def test_unchanged_release_ca_smoke_failure_is_loud_then_recovers(host):
    _install_cert_helper(host)
    _install_ca_and_lxc(host)
    _install_auth_ok(host)
    bad = host(FAKE_SKIP="1")
    assert bad.returncode == 1
    assert "TLS-Degraded" in bad.stderr
    assert "recheck FAILED on unchanged release" in bad.stderr
    assert (host.root / "certs" / "wazuh-api-ca.crt").read_text() == "CA\n"
    good = host(FAKE_SKIP="1", FAKE_VERIFY="0")
    assert good.returncode == 0, good.stderr
    assert "wazuh CA smoke authenticated" in good.stdout
    assert "wazuh cert recheck OK on unchanged release" in good.stdout
    assert "recheck incomplete" not in good.stderr
    assert (host.root / "certs" / "wazuh-api-ca.crt").read_text() == "CA\n"


@pytest.mark.skipif(any(Path(d, "lxc").exists() for d in ("/usr/bin", "/bin", "/usr/sbin", "/snap/bin")),
                    reason="host has a real lxc")
def test_ca_mode_without_lxc_logs_an_error(host):
    certs = host.root / "certs"
    certs.mkdir()
    (certs / "wazuh-api-ca.crt").write_text("CA\n")
    _install_cert_helper(host)
    # Without lxc the real helper fails its sync, so mirror that here.
    res = host(PATH=f"{host.bin}:/usr/bin:/bin", FAKE_SKIP="1", FAKE_CERT_RC="2")
    assert res.returncode == 0, res.stderr
    assert "ERROR: wazuh CA smoke cannot run: lxc not found on PATH=" in res.stderr
    assert "recheck incomplete" in res.stderr
    assert "recheck OK" not in res.stdout
    # Even when the sync itself reports fine, a smoke that could not run is not OK.
    res = host(PATH=f"{host.bin}:/usr/bin:/bin", FAKE_SKIP="1")
    assert res.returncode == 0, res.stderr
    assert "recheck incomplete on unchanged release (a check could not run" in res.stderr
    assert "recheck OK" not in res.stdout


def test_unchanged_release_sync_skip_is_incomplete_not_ok(host):
    # Leaf mode, manager stopped: the helper says "sync skipped" with rc 0.
    _install_cert_helper(host)
    res = host(FAKE_SKIP="1", FAKE_CERT_STATUS="skipped")
    assert res.returncode == 0, res.stderr
    assert "wazuh-api.crt sync skipped: fake" in res.stdout
    assert "recheck incomplete on unchanged release (a check could not run" in res.stderr
    assert "recheck OK" not in res.stdout


def test_unchanged_release_without_helper_is_incomplete_not_ok(host):
    res = host(FAKE_SKIP="1")
    assert res.returncode == 0, res.stderr
    assert "sync_wazuh_api_cert.py is absent" in res.stdout
    assert "recheck incomplete" in res.stderr
    assert "recheck OK" not in res.stdout


def test_unchanged_release_ca_smoke_without_creds_is_incomplete(host):
    _install_cert_helper(host)
    _install_ca_and_lxc(host)
    res = host(FAKE_SKIP="1", FAKE_VERIFY="0")
    assert res.returncode == 0, res.stderr
    assert "scoring credentials are not set" in res.stdout
    assert "recheck incomplete" in res.stderr
    assert "recheck OK" not in res.stdout


def test_apply_does_not_roll_back_when_ca_smoke_cannot_run(host):
    _install_cert_helper(host)
    _install_ca_and_lxc(host)
    res = host(FAKE_VERIFY="0")  # creds unset, so the smoke cannot run
    assert res.returncode == 0, res.stderr
    assert "smoke could not run after extract (non-fatal; no rollback)" in res.stderr
    assert (host.root / "DEPLOYED_SHA").read_text().strip() == SHA
    assert not (host.data / "rollback" / "bad-sha").exists()


def test_apply_rolls_back_when_ca_smoke_fails(host):
    _install_cert_helper(host)
    _install_ca_and_lxc(host)
    res = host()  # openssl stub reports a failed verify
    assert res.returncode == 1
    assert (host.data / "rollback" / "bad-sha").read_text().strip() == SHA


def test_unchanged_release_refused_connection_is_incomplete_not_failed(host):
    # Manager stopped in CA mode: s_client never connects, so no chain was checked.
    _install_cert_helper(host)
    _install_ca_and_lxc(host)
    _install_auth_ok(host)
    res = host(FAKE_SKIP="1", FAKE_REFUSED="1")
    assert res.returncode == 0, res.stderr
    assert "wazuh CA smoke skipped: localhost:55000 not accepting connections" in res.stdout
    assert "recheck incomplete" in res.stderr
    assert "recheck OK" not in res.stdout
    assert "recheck FAILED" not in res.stderr
    assert "TLS-Degraded" not in res.stderr


def test_apply_does_not_roll_back_when_connection_is_refused(host):
    _install_cert_helper(host)
    _install_ca_and_lxc(host)
    _install_auth_ok(host)
    res = host(FAKE_REFUSED="1")
    assert res.returncode == 0, res.stderr
    assert "not accepting connections" in res.stdout
    assert "TLS-Degraded" not in res.stderr
    assert (host.root / "DEPLOYED_SHA").read_text().strip() == SHA
    assert not (host.data / "rollback" / "bad-sha").exists()
