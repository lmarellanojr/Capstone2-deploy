"""check_runtime_deps.py: the CI guard against undeclared provision-api dependencies."""
from __future__ import annotations

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("check_runtime_deps", HERE / "check_runtime_deps.py")
crd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(crd)


def _tree(tmp_path: Path, deps: list[str], files: dict[str, str]) -> Path:
    quoted = ", ".join(f'"{d}"' for d in deps)
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "pyproject.toml").write_text(f'[project]\nname = "x"\ndependencies = [{quoted}]\n')
    src = tmp_path / "src" / "provisioning"
    src.mkdir(parents=True)
    for name, body in files.items():
        (src / name).write_text(body)
    return tmp_path


def test_real_repo_declares_everything_it_imports():
    assert crd.check(HERE.parents[1]) == []


def test_undeclared_third_party_import_fails(tmp_path):
    root = _tree(tmp_path, ["fastapi"], {"app.py": "import fastapi\nimport requests\n"})
    problems = crd.check(root)
    assert len(problems) == 1 and problems[0].startswith("requests is needed by app.py")


def test_form_upload_route_requires_python_multipart(tmp_path):
    # The PR #139 incident: an UploadFile route with python-multipart not installed.
    body = "from fastapi import File, UploadFile\ndef f(file: UploadFile = File(...)):\n    pass\n"
    root = _tree(tmp_path, ["fastapi"], {"router.py": body})
    assert any(p.startswith("python-multipart") for p in crd.check(root))
    root2 = _tree(tmp_path / "ok", ["fastapi", "python-multipart>=0.0.9"], {"router.py": body})
    assert crd.check(root2) == []


def test_import_name_maps_to_distribution_name(tmp_path):
    root = _tree(tmp_path, ["Pillow"], {"img.py": "from PIL import Image\n"})
    assert crd.check(root) == []
    bad = _tree(tmp_path / "bad", [], {"img.py": "from PIL import Image\n"})
    assert any(p.startswith("pillow") for p in crd.check(bad))


def test_stdlib_local_and_test_modules_are_ignored(tmp_path):
    root = _tree(tmp_path, [], {
        "a.py": "import os, json\nfrom pathlib import Path\nimport b\n",
        "b.py": "from __future__ import annotations\n",
        "test_a.py": "import pytest\n",
        "conftest.py": "import pytest\n",
    })
    assert crd.check(root) == []


def test_main_exit_codes(tmp_path, capsys):
    good = _tree(tmp_path / "g", ["fastapi"], {"a.py": "import fastapi\n"})
    assert crd.main(["x", str(good)]) == 0
    bad = _tree(tmp_path / "b", [], {"a.py": "import fastapi\n"})
    assert crd.main(["x", str(bad)]) == 1
    assert "Undeclared" in capsys.readouterr().err
