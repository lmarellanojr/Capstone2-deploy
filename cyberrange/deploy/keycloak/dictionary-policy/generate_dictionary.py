"""Reproduce scowl-en-v1 from the pinned upstream SCOWL checkout/archive.

Usage: python generate_dictionary.py /path/to/wordlist-source
Run combine.py create-db scowl.db in that source directory first.
"""
import hashlib
from pathlib import Path
import re
import subprocess
import sys

EXPECTED_SHA256 = "981da5c06d01da21cdf6f37def0661ffb028266d21ce8f572510a5022e0a238d"


def main():
    source = Path(sys.argv[1]).resolve()
    command = [sys.executable, "-X", "utf8", "-m", "libscowl", "word-list", "60", "A,B,Z,C", "1",
               "--deaccent", "--wo-poses=abbr",
               "--wo-pos-classes=abbr,abbr?,person,surname,place,name,name?,upper,upper?,trademark,demonym",
               "--categories=", "--apostrophe=False"]
    result = subprocess.run(command, cwd=source, check=True, capture_output=True, text=True, encoding="utf-8")
    lines = result.stdout.splitlines()
    words = {word for word in lines if re.fullmatch("[a-z]+", word)}
    if "I" in lines:
        words.add("i")
    data = ("\n".join(sorted(words)) + "\n").encode("ascii")
    if hashlib.sha256(data).hexdigest() != EXPECTED_SHA256:
        raise SystemExit("Dictionary differs from pinned scowl-en-v1; refusing to replace it")
    target = Path(__file__).resolve().parent / "src/main/resources/dictionary"
    target.mkdir(parents=True, exist_ok=True)
    (target / "scowl-en-v1.txt").write_bytes(data)
    (target / "Copyright").write_bytes((source / "Copyright").read_bytes())
    print(f"Generated scowl-en-v1: {len(words)} entries, SHA256 {EXPECTED_SHA256}")


if __name__ == "__main__":
    main()
