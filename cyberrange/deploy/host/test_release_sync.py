import hashlib
import json
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

HOST = Path(__file__).resolve().parent
if str(HOST) not in sys.path:
    sys.path.insert(0, str(HOST))

from release_sync import (  # noqa: E402
    ManifestError,
    extract_tree,
    is_denied,
    load_manifest,
    lockfile_sha256,
    should_apply,
    snapshot_paths,
)


def test_is_denied_env_and_data():
    assert is_denied(".env")
    assert is_denied("portal/.env.local")
    assert is_denied("bridge-src/.env.bridge")
    assert is_denied("env/.env")
    assert is_denied("portal/node_modules/foo/index.js")
    assert is_denied(".git/config")
    assert not is_denied("src/provisioning/pods_router.py")
    assert not is_denied("portal/package-lock.json")
    assert not is_denied("portal/.next/BUILD_ID")


def test_should_apply_skips_same_sha():
    sha = "a" * 40
    assert should_apply(sha, None) is True
    assert should_apply(sha, sha) is False
    assert should_apply("b" * 40, sha) is True


def test_load_manifest_requires_sha(tmp_path: Path):
    p = tmp_path / "manifest.json"
    p.write_text("{}", encoding="utf-8")
    with pytest.raises(ManifestError):
        load_manifest(p)
    p.write_text(json.dumps({"sha": "c" * 40, "lockfile_sha256": "d" * 64}), encoding="utf-8")
    m = load_manifest(p)
    assert m["sha"] == "c" * 40


def test_extract_tree_skips_env_and_does_not_clobber(tmp_path: Path):
    src = tmp_path / "src"
    (src / "portal").mkdir(parents=True)
    (src / "src").mkdir()
    (src / "portal" / "package.json").write_text('{"name":"portal"}', encoding="utf-8")
    (src / "portal" / ".env.local").write_text("SECRET=from-tarball", encoding="utf-8")
    (src / "src" / "pods_router.py").write_text("new\n", encoding="utf-8")
    tar_path = tmp_path / "tree.tgz"
    with tarfile.open(tar_path, "w:gz") as tf:
        tf.add(src / "portal" / "package.json", arcname="portal/package.json")
        tf.add(src / "portal" / ".env.local", arcname="portal/.env.local")
        tf.add(src / "src" / "pods_router.py", arcname="src/pods_router.py")

    dest = tmp_path / "dest"
    (dest / "portal").mkdir(parents=True)
    (dest / "portal" / ".env.local").write_text("SECRET=live", encoding="utf-8")
    written = extract_tree(tar_path, dest)
    assert (dest / "portal" / "package.json").read_text(encoding="utf-8") == '{"name":"portal"}'
    assert (dest / "portal" / ".env.local").read_text(encoding="utf-8") == "SECRET=live"
    assert (dest / "src" / "pods_router.py").read_text(encoding="utf-8") == "new\n"
    assert "portal/.env.local" not in written


def test_extract_rejects_path_escape(tmp_path: Path):
    tar_path = tmp_path / "evil.tgz"
    dest = tmp_path / "dest"
    dest.mkdir()
    outside = tmp_path / "outside.txt"
    info = tarfile.TarInfo(name="../outside.txt")
    data = b"pwn"
    info.size = len(data)
    import io

    with tarfile.open(tar_path, "w:gz") as tf:
        tf.addfile(info, io.BytesIO(data))
    extract_tree(tar_path, dest)
    assert not outside.exists()


def test_lockfile_and_snapshot(tmp_path: Path):
    lock = tmp_path / "package-lock.json"
    lock.write_text('{"lockfileVersion": 3}', encoding="utf-8")
    h = lockfile_sha256(lock)
    assert h == hashlib.sha256(b'{"lockfileVersion": 3}').hexdigest()
    root = tmp_path / "tree"
    (root / "src").mkdir(parents=True)
    (root / "src" / "a.py").write_text("x", encoding="utf-8")
    (root / ".env").write_text("nope", encoding="utf-8")
    snap = tmp_path / "snap.tgz"
    snapshot_paths(root, snap)
    with tarfile.open(snap, "r:gz") as tf:
        names = tf.getnames()
    assert "src/a.py" in names
    assert ".env" not in names


def test_cli_check_apply(tmp_path: Path):
    man = tmp_path / "manifest.json"
    man.write_text(json.dumps({"sha": "e" * 40, "lockfile_sha256": "f" * 64}), encoding="utf-8")
    deployed = tmp_path / "DEPLOYED_SHA"
    script = Path(__file__).resolve().parent / "release_sync.py"
    r = subprocess.run(
        [sys.executable, str(script), "--check-apply", str(man), str(deployed)],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0
    assert ("e" * 40) in r.stdout
    deployed.write_text("e" * 40, encoding="utf-8")
    r2 = subprocess.run(
        [sys.executable, str(script), "--check-apply", str(man), str(deployed)],
        capture_output=True,
        text=True,
    )
    assert r2.returncode == 2
