"""Reproduce scowl-en-v1 from the pinned upstream SCOWL checkout/archive.

Usage: python generate_dictionary.py /path/to/wordlist-source
Run combine.py create-db scowl.db in that source directory first.
"""
import hashlib
from pathlib import Path
import re
import subprocess
import sys

EXPECTED_SHA256 = "83f553bafcd8fc9fb32561fc69af2cb48778f056c7748aa2308d7adfd36510b7"


def main():
    source = Path(sys.argv[1]).resolve()
    command = [sys.executable, "-X", "utf8", "-m", "libscowl", "word-list", "60", "A,B,Z,C", "1",
               "--deaccent", "--wo-poses=abbr",
               "--wo-pos-classes=abbr,abbr?,person,surname,place,name,name?,upper,upper?,trademark,demonym",
               "--categories=", "--apostrophe=False"]
    result = subprocess.run(command, cwd=source, check=True, capture_output=True, text=True, encoding="utf-8")
    lines = result.stdout.splitlines()
    # SCOWL includes the names of all 26 alphabet letters. Discard all
    # single-letter entries so ordinary passwords can contain a, i, or o.
    # Keep every lowercase English word of two or more letters.
    words = {word for word in lines if re.fullmatch("[a-z]+", word) and len(word) >= 2}
    data = ("\n".join(sorted(words)) + "\n").encode("ascii")
    if EXPECTED_SHA256 and hashlib.sha256(data).hexdigest() != EXPECTED_SHA256:
        raise SystemExit("Dictionary differs from pinned scowl-en-v1; refusing to replace it")
    target = Path(__file__).resolve().parent / "src/main/resources/dictionary"
    target.mkdir(parents=True, exist_ok=True)
    (target / "scowl-en-v1.txt").write_bytes(data)
    (target / "Copyright").write_bytes((source / "Copyright").read_bytes())
    print(f"Generated scowl-en-v1: {len(words)} entries, SHA256 {EXPECTED_SHA256}")


if __name__ == "__main__":
    main()
