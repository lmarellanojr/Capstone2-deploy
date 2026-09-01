"""Load scoring modules by file path — no sys.path mutation (P1 T-006)."""
from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Optional, Tuple

_SCRIPTS = Path(__file__).resolve().parent
# Was _SCRIPTS.parent.parent / "Phase 4" / "scripts", which does not exist in
# this tree -- detection scoring silently stayed disabled even with Wazuh up
# (branch-review Issue 7). Both modules are co-located with this one in the
# flat src/provisioning/ import root: wazuh_rule_map.py was already there;
# score_verifier.py is imported alongside it for the same reason.


def _load(name: str, path: Path) -> Optional[ModuleType]:
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception:
        # A declared runtime dependency missing on this host (pylxd,
        # requests) must degrade the same way a missing file does --
        # detection scoring off, not the whole API failing at startup import
        # time. This is a safety net, not a substitute for declaring the
        # real dependencies in pyproject.toml -- see
        # test_scoring_imports.py::test_score_verifier_and_wazuh_map_load,
        # which fails the suite (and therefore CI) if this net is ever
        # silently catching a real dependency gap.
        return None
    return mod


def load_scoring_modules() -> Tuple[Optional[ModuleType], Optional[ModuleType], Optional[ModuleType]]:
    """Returns (ssh_verifier, score_verifier, wazuh_rule_map) — any may be None."""
    ssh = _load("ssh_verifier", _SCRIPTS / "ssh_verifier.py")
    score = _load("score_verifier", _SCRIPTS / "score_verifier.py")
    wazuh_map = _load("wazuh_rule_map", _SCRIPTS / "wazuh_rule_map.py")
    return ssh, score, wazuh_map