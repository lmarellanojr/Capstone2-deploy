#!/usr/bin/env python3
"""Scan the product repo or deploy kit for secrets that must not be committed."""
from __future__ import print_function

import os
import sys

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
    "private",
    ".pytest_cache",
    ".mypy_cache",
}

SKIP_SUFFIXES = (".woff", ".woff2", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".pyc")


def fail(msg):
    sys.stderr.write("audit_secrets FAIL: %s\n" % msg)
    sys.exit(1)


def allowed(rel):
    rel = rel.replace("\\", "/")
    base = os.path.basename(rel)
    if base in ("audit_secrets.sh", "audit_secrets.py"):
        return True
    if "OPERATOR-RECORD.example.md" in rel:
        return True
    if ".example" in base:
        return True
    return False


def needles():
    return [
        ("".join(("super", "secretportal")), "portal test secret"),
        ("BEGIN OPENSSH PRIVATE KEY", "private key material"),
        (".".join(("140", "245", "109", "189")), "Ampere-1 public IP"),
        (".".join(("hanzi-super", "pw")), "Ampere-1 student hostname/zone"),
        ("-".join(("0761ea0e", "f0e4", "43a7", "a193", "05d7a6610cf3")), "Ampere-1 tunnel UUID"),
        ("".join(("St0d!", "6cc7522fa2f75af1")), "Ampere-1 student password"),
        ("amsjoqgmpa", "Ampere-1 instance OCID"),
    ]


def scan_root_from_script(script_dir):
    cyber = os.path.abspath(os.path.join(script_dir, "..", ".."))
    parent = os.path.abspath(os.path.join(cyber, ".."))
    if os.path.isdir(os.path.join(parent, "manual")) and os.path.isfile(
        os.path.join(parent, "README.md")
    ):
        return parent
    return cyber


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root = scan_root_from_script(script_dir)
    hits = needles()
    n = 0
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in files:
            if name.endswith(SKIP_SUFFIXES):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root)
            if allowed(rel):
                continue
            n += 1
            try:
                with open(path, "rb") as fh:
                    blob = fh.read()
            except OSError:
                continue
            text = blob.decode("utf-8", "replace")
            for needle, label in hits:
                if needle in text:
                    fail("%s found in: %s" % (label, rel.replace("\\", "/")))
    print("audit_secrets: OK (scan root %s, files %d)" % (root, n))
    return 0


if __name__ == "__main__":
    sys.exit(main())
