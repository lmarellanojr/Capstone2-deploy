#!/usr/bin/env python3
"""Fail the release build if the provision API needs a package pyproject.toml does not declare.

pull_release.sh installs exactly the ``[project].dependencies`` from pyproject.toml into the
host venv. If code imports a third-party package that is missing from that list, the host
never installs it: provision-api crash-loops on import, the health check fails, the apply
rolls back and the release SHA is marked bad -- while the GitHub Action stays green. This
check runs in CI (ampere-release.yml) before the tree is packed, so that mistake fails the
build instead of freezing the live site.

Two rules:
  * every top-level third-party import in src/provisioning (tests excluded) maps to a
    declared distribution;
  * FastAPI form / file parameters (UploadFile, File(...), Form(...)) require
    python-multipart, which FastAPI imports lazily but checks at route registration.

Stdlib only (ast + tomllib), so it needs no install step. Usage:
    python3 deploy/host/check_runtime_deps.py [CYBERRANGE_ROOT]
"""
from __future__ import annotations

import ast
import re
import sys
import tomllib
from pathlib import Path

# Import name -> PyPI distribution name, where they differ.
IMPORT_TO_DIST = {
    "PIL": "pillow",
    "yaml": "pyyaml",
    "jwt": "pyjwt",
    "dateutil": "python-dateutil",
    "multipart": "python-multipart",
    "dotenv": "python-dotenv",
}
FORM_MARKERS = re.compile(r"\bUploadFile\b|\bFile\(|\bForm\(")


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def declared_dists(pyproject: Path) -> set[str]:
    deps = tomllib.loads(pyproject.read_text(encoding="utf-8")).get("project", {}).get("dependencies", [])
    names = set()
    for spec in deps:
        match = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", spec)
        if match:
            names.add(_norm(match.group(1)))
    return names


def required_dists(src: Path) -> dict[str, set[str]]:
    """Map each required distribution to the source files that need it."""
    local = {p.stem for p in src.glob("*.py")} | {p.name for p in src.iterdir() if p.is_dir()}
    needed: dict[str, set[str]] = {}
    for path in sorted(src.glob("*.py")):
        if path.name.startswith("test_") or path.name == "conftest.py":
            continue
        text = path.read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(text, filename=str(path))):
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                modules = [node.module]
            else:
                continue
            for module in modules:
                top = module.split(".")[0]
                if top in sys.stdlib_module_names or top in local or top == "__future__":
                    continue
                needed.setdefault(_norm(IMPORT_TO_DIST.get(top, top)), set()).add(path.name)
        if FORM_MARKERS.search(text) and "fastapi" in text:
            needed.setdefault("python-multipart", set()).add(path.name)
    return needed


def check(root: Path) -> list[str]:
    declared = declared_dists(root / "pyproject.toml")
    problems = []
    for dist, files in sorted(required_dists(root / "src" / "provisioning").items()):
        if dist not in declared:
            problems.append(f"{dist} is needed by {', '.join(sorted(files))} but is not in pyproject.toml "
                            f"[project].dependencies")
    return problems


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parents[2]
    problems = check(root)
    if problems:
        print("Undeclared provision-api runtime dependencies:", file=sys.stderr)
        for line in problems:
            print(f"  - {line}", file=sys.stderr)
        print("Hosts install only declared dependencies; add these to pyproject.toml.", file=sys.stderr)
        return 1
    print("provision-api runtime dependencies: all declared in pyproject.toml")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
