"""Regression tests for the web-terminal bridge.

The overlapping-session guard in fba0fc5 shipped with a 7-space indent that
made bridge.py unimportable (IndentationError). pull_release health did not
cover :8765, so Ampere applied the tree, restarted the unit, and the Kali
CLI tab failed at the WebSocket handshake.
"""
from pathlib import Path
import ast
import asyncio
import importlib.util
import os
import shutil
import subprocess

import pytest

HERE = Path(__file__).resolve().parent
BRIDGE = HERE / "bridge.py"


def test_bridge_module_parses():
    ast.parse(BRIDGE.read_text(encoding="utf-8"))


def test_active_sessions_registry_is_a_dict():
    spec = importlib.util.spec_from_file_location("ssh_bridge", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    assert isinstance(mod._active_sessions, dict)


def test_launch_command_configures_history_before_cold_lab_window_creation():
    spec = importlib.util.spec_from_file_location("ssh_bridge", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)

    command = mod.launch_command_for("kali")[-1]
    cold_path = "tmux start-server \\; set-option -g history-limit 10000 \\; new-session -d -s lab"
    assert "tmux has-session -t lab" in command
    assert cold_path in command
    assert command.index("set-option -g history-limit 10000") < command.index("new-session -d -s lab")
    assert "exec tmux attach-session -t lab" in command


def _load():
    spec = importlib.util.spec_from_file_location("ssh_bridge", BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_resize_message_is_parsed_and_clamped():
    mod = _load()
    assert mod.parse_client_message('{"type":"resize","cols":46,"rows":24}') == ("resize", 24, 46)
    # Out-of-range values used to reach struct.pack("HHHH") and kill the input pump.
    assert mod.parse_client_message('{"type":"resize","cols":70000,"rows":-3}') == ("resize", 5, 500)
    assert mod.parse_client_message('{"type":"resize","cols":1,"rows":9999}') == ("resize", 200, 20)
    bad = '{"type":"resize","cols":"x","rows":1}'
    assert mod.parse_client_message(bad) == ("data", bad)


def test_tmux_resize_command_targets_lab_clients_of_role_user():
    mod = _load()
    argv = mod.tmux_resize_command_for("kali", "pod-lenie-kali", 24, 46)
    assert argv[:7] == ["lxc", "--project", "default", "exec", "pod-lenie-kali", "--", "sh"]
    script = argv[-1]
    assert "/tmp/tmux-$(id -u student)/default" in script
    assert 'list-clients -t lab -F "#{client_tty} #{client_pid}"' in script
    assert 'stty -F "$t" rows 24 cols 46 && kill -WINCH "$p"' in script
    assert "msfadmin" in mod.tmux_resize_command_for("meta", "c", 24, 80)[-1]
    # Sizes are clamped even if a caller skips parse_client_message.
    assert "rows 200 cols 500" in mod.tmux_resize_command_for("kali", "c", 10**6, 10**6)[-1]


def test_resize_coalescer_collapses_a_burst_into_one_latest_apply():
    mod = _load()
    applied = []

    async def apply(r, c):
        applied.append((r, c))

    async def scenario():
        co = mod.ResizeCoalescer(apply, delay=0.05)
        task = asyncio.create_task(co.run())
        for cols in range(60, 40, -1):  # a window drag
            co.submit(24, cols)
            await asyncio.sleep(0)
        await asyncio.sleep(0.2)
        co.submit(30, 100)
        await asyncio.sleep(0.2)
        task.cancel()

    asyncio.run(scenario())
    assert applied == [(24, 41), (30, 100)]


def test_resize_coalescer_survives_a_failing_apply():
    mod = _load()
    calls = []

    async def apply(r, c):
        calls.append((r, c))
        raise RuntimeError("lxc exec failed")

    async def scenario():
        co = mod.ResizeCoalescer(apply, delay=0.01)
        task = asyncio.create_task(co.run())
        co.submit(24, 80)
        await asyncio.sleep(0.05)
        co.submit(24, 46)
        await asyncio.sleep(0.05)
        task.cancel()

    asyncio.run(scenario())
    assert calls == [(24, 80), (24, 46)]


class _FakeProc:
    def __init__(self, exits_after=None):
        self.returncode = None
        self.killed = False
        self._done = asyncio.Event()
        self._exits_after = exits_after

    async def wait(self):
        if self._exits_after is not None:
            await asyncio.sleep(self._exits_after)
            self.returncode = 0
            self._done.set()
        await self._done.wait()
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9
        self._done.set()


def _patch_spawn(monkeypatch, mod, proc, seen):
    async def fake_exec(*argv, **kw):
        seen.update(kw)
        return proc
    monkeypatch.setattr(mod.asyncio, "create_subprocess_exec", fake_exec)


def test_tmux_resize_kills_and_reaps_a_hung_lxc_exec(monkeypatch):
    mod = _load()
    proc, seen = _FakeProc(), {}
    _patch_spawn(monkeypatch, mod, proc, seen)
    asyncio.run(mod._run_tmux_resize("c", "kali", 24, 80, timeout=0.01))
    assert proc.killed and proc.returncode == -9
    assert seen["stdin"] == asyncio.subprocess.DEVNULL


def test_tmux_resize_reaps_when_session_teardown_cancels_it(monkeypatch):
    mod = _load()
    proc, seen = _FakeProc(), {}
    _patch_spawn(monkeypatch, mod, proc, seen)

    async def scenario():
        task = asyncio.create_task(mod._run_tmux_resize("c", "kali", 24, 80))
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert proc.killed


def test_tmux_resize_leaves_a_finished_process_alone(monkeypatch):
    mod = _load()
    proc, seen = _FakeProc(exits_after=0), {}
    _patch_spawn(monkeypatch, mod, proc, seen)
    asyncio.run(mod._run_tmux_resize("c", "kali", 24, 80))
    assert not proc.killed and proc.returncode == 0


class _FakeWs:
    def __init__(self, messages, delay=0.0):
        self._messages = list(messages)
        self._delay = delay

    async def recv(self):
        await asyncio.sleep(self._delay)
        return self._messages.pop(0)


def test_first_client_size_uses_browser_resize():
    mod = _load()
    ws = _FakeWs(['{"type":"resize","cols":46,"rows":24}'])
    assert asyncio.run(mod._first_client_size(ws)) == ((24, 46), [])


def test_first_client_size_falls_back_and_keeps_early_keystrokes():
    mod = _load()
    assert asyncio.run(mod._first_client_size(_FakeWs(["ls\r"]))) == ((24, 80), ["ls\r"])
    slow = _FakeWs(['{"type":"resize","cols":46,"rows":24}'], delay=1.0)
    assert asyncio.run(mod._first_client_size(slow, timeout=0.05)) == ((24, 80), [])


@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux integration requires tmux")
def test_tmux_cold_server_applies_history_limit_before_lab_window(tmp_path):
    tmux = shutil.which("tmux")
    assert tmux is not None
    socket_name = f"bridge-history-{os.getpid()}"
    env = os.environ.copy()
    env["TMUX_TMPDIR"] = str(tmp_path)
    tmux_cmd = [tmux, "-L", socket_name, "-f", "/dev/null"]
    try:
        subprocess.run(
            tmux_cmd + [
                "start-server", ";",
                "set-option", "-g", "history-limit", "10000", ";",
                "new-session", "-d", "-s", "lab",
            ],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        effective = subprocess.run(
            tmux_cmd + ["show-options", "-t", "lab", "-v", "history-limit"],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        assert effective.stdout.strip() == "10000"
    finally:
        subprocess.run(tmux_cmd + ["kill-server"], capture_output=True, env=env)
