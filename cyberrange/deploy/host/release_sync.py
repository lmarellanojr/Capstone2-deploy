"""Safe extract + SHA compare for Ampere Release pulls. No network."""
from __future__ import annotations

import hashlib
import json
import tarfile
from pathlib import Path

DENY_NAMES = {
    ".env",
    ".env.local",
    ".env.bridge",
    "github-release.token",
    "github-release.env",
}
DENY_DIR_PARTS = {".git", "node_modules", "cyberrange-data"}
# Exact relpath; skip overwrite when present. Keep out of DENY_NAMES (fresh install + snapshots).
PRESERVE_IF_EXISTS = {"certs/wazuh-api.crt"}


class ManifestError(ValueError):
    pass


def _norm(rel: str) -> str:
    # Slash-normalize. Strip a "./" prefix only. Do NOT str.lstrip("./") —
    # that treats the argument as a character set and turns ".env" into "env"
    # and ".next/BUILD_ID" into "next/BUILD_ID".
    rel = rel.replace("\\", "/")
    while rel.startswith("./"):
        rel = rel[2:]
    return rel


def is_denied(rel: str) -> bool:
    rel = _norm(rel)
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if any(p in DENY_DIR_PARTS for p in parts):
        return True
    if parts and parts[-1] in DENY_NAMES:
        return True
    return False


def load_manifest(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(str(exc)) from exc
    sha = data.get("sha")
    lock = data.get("lockfile_sha256")
    if not isinstance(sha, str) or len(sha) != 40:
        raise ManifestError("manifest.sha must be 40-char hex")
    if not isinstance(lock, str) or len(lock) != 64:
        raise ManifestError("manifest.lockfile_sha256 must be 64-char hex")
    return data


def should_apply(manifest_sha: str, deployed_sha: str | None) -> bool:
    if not deployed_sha:
        return True
    return manifest_sha != deployed_sha


def lockfile_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _safe_member_path(dest: Path, name: str) -> Path | None:
    if is_denied(name):
        return None
    dest_abs = dest.resolve()
    target = (dest / _norm(name)).resolve()
    try:
        target.relative_to(dest_abs)
    except ValueError:
        return None
    return target


def extract_tree(tar_path: Path, dest: Path) -> list[str]:
    dest.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    with tarfile.open(tar_path, "r:*") as tf:
        for member in tf.getmembers():
            name = _norm(member.name)
            if member.issym() or member.islnk():
                continue
            target = _safe_member_path(dest, name)
            if target is None:
                continue
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                continue
            # Lexical path: resolved target hides dangling symlinks at the pin path.
            raw = dest / name
            if name in PRESERVE_IF_EXISTS and (raw.is_symlink() or raw.is_file()):
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            src = tf.extractfile(member)
            if src is None:
                continue
            with src, open(target, "wb") as out:
                out.write(src.read())
            written.append(name)
    return written


def snapshot_paths(root: Path, dest_tar: Path) -> None:
    dest_tar.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(dest_tar, "w:gz") as tf:
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            rel = _norm(str(path.relative_to(root)))
            if is_denied(rel):
                continue
            tf.add(path, arcname=rel)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            "usage: release_sync.py --check-apply|--extract|--snapshot|--lock-hash ...",
            flush=True,
        )
        return 1
    cmd = argv[1]
    if cmd == "--check-apply":
        m = load_manifest(Path(argv[2]))
        deployed = Path(argv[3])
        prev = deployed.read_text(encoding="utf-8").strip() if deployed.is_file() else ""
        if should_apply(m["sha"], prev or None):
            print(m["sha"])
            return 0
        print("unchanged")
        return 2
    if cmd == "--extract":
        names = extract_tree(Path(argv[2]), Path(argv[3]))
        print("\n".join(names))
        return 0
    if cmd == "--snapshot":
        snapshot_paths(Path(argv[2]), Path(argv[3]))
        return 0
    if cmd == "--lock-hash":
        print(lockfile_sha256(Path(argv[2])))
        return 0
    print("unknown command", cmd, flush=True)
    return 1


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv))
