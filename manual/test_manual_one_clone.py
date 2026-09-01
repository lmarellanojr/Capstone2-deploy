from pathlib import Path

ROOT = Path(__file__).resolve().parent
# The Manual is read from its own repo (C:\Capstone2-Manual) and also ships inside
# the deploy kit as C:\Capstone2-Deploy\manual. Pin the content, not the folder
# name -- an earlier version asserted "Capstone2-Manual" and errored at collection
# in the kit.
assert ROOT.name in {"Capstone2-Manual", "manual"}, (
    f"unexpected Manual root: {ROOT.name}"
)
assert (ROOT / "00-prerequisites.md").is_file(), "not a Manual directory"
BANNED = (
    "clone both",
    "LLMS_CyberRange_LXD",
    "LLMS-OCI-Cyber-Range",
    "~/cyber-range-oci",
    "two remotes",
    "C:\\\\Capstone2Implementation\\\\docs\\\\manual",
)
SCAN = list(ROOT.glob("*.md"))

def test_no_two_clone_instructions():
    hits = []
    for p in SCAN:
        text = p.read_text(encoding="utf-8", errors="replace")
        low = text.lower()
        for ban in BANNED:
            if ban.lower() in low:
                hits.append(f"{p.name}: {ban}")
    assert hits == [], "two-clone or mixed-tree language:\n" + "\n".join(hits)
