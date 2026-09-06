from pathlib import Path

HERE = Path(__file__).resolve().parent


def test_pack_script_has_chapter01_excludes():
    text = (HERE / "pack_tree.sh").read_text(encoding="utf-8")
    for token in (
        ".git",
        "node_modules",
        ".next",
        ".env",
        ".env.local",
        ".env.bridge",
        "__pycache__",
        ".venv",
    ):
        assert f"--exclude='{token}'" in text or f'--exclude="{token}"' in text
    assert "tar" in text
    assert '"$OUT"' in text or "$OUT" in text
