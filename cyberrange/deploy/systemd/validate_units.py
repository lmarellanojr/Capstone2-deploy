from __future__ import annotations


def read_env_file_keys(text: str) -> set[str]:
    keys: set[str] = set()
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        keys.add(s.split("=", 1)[0])
    return keys


def validate_unit(
    text: str,
    *,
    require_env_file: str,
    exec_must_contain: list[str],
) -> list[str]:
    errs: list[str] = []
    if (
        f"EnvironmentFile={require_env_file}" not in text
        and f"EnvironmentFile=-{require_env_file}" not in text
    ):
        errs.append(
            f"EnvironmentFile must be {require_env_file} (optional - prefix allowed)"
        )
    exec_lines = [ln for ln in text.splitlines() if ln.startswith("ExecStart=")]
    if not exec_lines:
        errs.append("ExecStart missing")
        return errs
    joined = " ".join(exec_lines)
    for needle in exec_must_contain:
        if needle not in joined:
            errs.append(f"ExecStart must contain {needle!r}")
    return errs
