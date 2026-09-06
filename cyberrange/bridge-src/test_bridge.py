"""Regression tests for the web-terminal bridge.

The overlapping-session guard in fba0fc5 shipped with a 7-space indent that
made bridge.py unimportable (IndentationError). pull_release health did not
cover :8765, so Ampere applied the tree, restarted the unit, and the Kali
CLI tab failed at the WebSocket handshake.
"""
from pathlib import Path
import ast
import importlib.util

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
