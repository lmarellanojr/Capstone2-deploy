"""SQLite schema migrations for pod_mgmt.db."""
from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys

from config import DB_PATH

_SCHEMA_DIR = os.path.join(os.path.dirname(__file__), "schema")
_VERSION_RE = re.compile(r"^v(\d+)\.sql$")


def _schema_dir() -> str:
    return _SCHEMA_DIR


def _migration_files() -> list[tuple[int, str]]:
    files: list[tuple[int, str]] = []
    for name in os.listdir(_schema_dir()):
        m = _VERSION_RE.match(name)
        if m:
            files.append((int(m.group(1)), os.path.join(_schema_dir(), name)))
    return sorted(files)


def latest_version() -> int:
    files = _migration_files()
    return files[-1][0] if files else 0


def current_version(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).fetchone()
    if not row:
        return 0
    ver = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    return int(ver) if ver is not None else 0


def _run_sql_file(conn: sqlite3.Connection, path: str) -> None:
    with open(path, encoding="utf-8") as f:
        sql = f.read()
    conn.executescript(sql)


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    # table_info: cid, name, type, notnull, dflt_value, pk — name is r[1]
    return any(r[1] == column for r in conn.execute(f"PRAGMA table_info({table})"))


def apply(db_path: str | None = None) -> int:
    path = db_path or DB_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        start = current_version(conn)
        for version, sql_path in _migration_files():
            if version <= start:
                continue
            with conn:
                if version == 3 and not _has_column(
                    conn, "milestone_verification", "student_id"
                ):
                    conn.execute(
                        "ALTER TABLE milestone_verification ADD COLUMN student_id TEXT"
                    )
                _run_sql_file(conn, sql_path)
                conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?)",
                    (version,),
                )
        return current_version(conn)
    finally:
        conn.close()


def check(db_path: str | None = None) -> bool:
    path = db_path or DB_PATH
    if not os.path.exists(path):
        return latest_version() == 0
    conn = sqlite3.connect(path)
    try:
        return current_version(conn) == latest_version()
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply or check pod_mgmt.db migrations")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--apply", action="store_true", help="Apply pending migrations")
    group.add_argument("--check", action="store_true", help="Exit 0 if schema is current")
    parser.add_argument("--db", dest="db_path", help="Override DB_PATH")
    args = parser.parse_args(argv)

    if args.check:
        return 0 if check(args.db_path) else 1
    apply(args.db_path)
    return 0 if check(args.db_path) else 1


if __name__ == "__main__":
    sys.exit(main())