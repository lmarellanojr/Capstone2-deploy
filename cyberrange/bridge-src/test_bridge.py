"""Regression tests for the web-terminal bridge.

The overlapping-session guard in fba0fc5 shipped with a 7-space indent that
made bridge.py unimportable (IndentationError). pull_release health did not
cover :8765, so Ampere applied the tree, restarted the unit, and the Kali
CLI tab failed at the WebSocket handshake.
"""
from pathlib import Path
import ast
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


@pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux integration requires tmux")
def test_tmux_cold_server_applies_history_limit_before_lab_window(tmp_path):
    tmux = shutil.which("tmux")
    assert tmux is not None
    socket_name = f"codex-history-{os.getpid()}"
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
