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


def _has_table(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return bool(row)


def _upgrade_review_cases_schema(conn: sqlite3.Connection) -> None:
    if not _has_table(conn, "review_cases"):
        return
    cols = {r[1]: r for r in conn.execute("PRAGMA table_info(review_cases)").fetchall()}
    report_text_col = cols.get("report_text")
    # table_info: (cid, name, type, notnull, dflt_value, pk) -> r[3] is notnull
    needs_rebuild = bool(report_text_col and report_text_col[3] == 1)

    if needs_rebuild:
        old_cols = set(cols.keys())
        milestone_expr = "milestone_id" if "milestone_id" in old_cols else "NULL"
        case_type_expr = "case_type" if "case_type" in old_cols else "'WRITTEN_REPORT'"
        conflict_expr = "conflict_reason" if "conflict_reason" in old_cols else "NULL"
        evidence_expr = "evidence_data" if "evidence_data" in old_cols else "NULL"
        score_expr = "CASE WHEN status = 'PENDING' AND graded_by IS NULL THEN NULL ELSE score END" if "score" in old_cols else "NULL"
        status_expr = "status" if "status" in old_cols else "'PENDING'"
        feedback_expr = "feedback" if "feedback" in old_cols else "NULL"
        graded_by_expr = "graded_by" if "graded_by" in old_cols else "NULL"
        created_at_expr = "created_at" if "created_at" in old_cols else "CURRENT_TIMESTAMP"
        updated_at_expr = "updated_at" if "updated_at" in old_cols else "CURRENT_TIMESTAMP"

        with conn:
            conn.execute("ALTER TABLE review_cases RENAME TO _review_cases_old")
            # Shared source: use v4.sql directly for table definition and indexes
            v4_path = os.path.join(_schema_dir(), "v4.sql")
            _run_sql_file(conn, v4_path)
            conn.execute(f"""
                INSERT INTO review_cases (
                    review_id, student_id, scenario_id, milestone_id, case_type,
                    report_text, conflict_reason, evidence_data, score, status,
                    feedback, graded_by, created_at, updated_at
                )
                SELECT
                    review_id, student_id, scenario_id, {milestone_expr}, {case_type_expr},
                    report_text, {conflict_expr}, {evidence_expr}, {score_expr}, {status_expr},
                    {feedback_expr}, {graded_by_expr}, {created_at_expr}, {updated_at_expr}
                FROM _review_cases_old
            """)
            conn.execute("DROP TABLE _review_cases_old")
    else:
        # Additive migration: add missing columns using ALTER TABLE ... ADD COLUMN
        with conn:
            if "case_type" not in cols:
                conn.execute(
                    "ALTER TABLE review_cases ADD COLUMN case_type TEXT "
                    "CHECK(case_type IN ('WRITTEN_REPORT','SCORING_CONFLICT','MANUAL_REVIEW')) DEFAULT 'WRITTEN_REPORT'"
                )
            if "conflict_reason" not in cols:
                conn.execute("ALTER TABLE review_cases ADD COLUMN conflict_reason TEXT")
            if "evidence_data" not in cols:
                conn.execute("ALTER TABLE review_cases ADD COLUMN evidence_data TEXT")
            if "score" not in cols:
                conn.execute(
                    "ALTER TABLE review_cases ADD COLUMN score INTEGER "
                    "CHECK(score IS NULL OR (score >= 0 AND score <= 100))"
                )
            if "feedback" not in cols:
                conn.execute("ALTER TABLE review_cases ADD COLUMN feedback TEXT")
            if "graded_by" not in cols:
                conn.execute("ALTER TABLE review_cases ADD COLUMN graded_by TEXT")
            if "created_at" not in cols:
                conn.execute("ALTER TABLE review_cases ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
            if "updated_at" not in cols:
                conn.execute("ALTER TABLE review_cases ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
            # Ungraded pending reviews return score: null
            conn.execute("UPDATE review_cases SET score = NULL WHERE status = 'PENDING' AND graded_by IS NULL AND score = 0")
            # Ensure indexes exist
            conn.execute("CREATE INDEX IF NOT EXISTS idx_review_cases_student ON review_cases(student_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_review_cases_status ON review_cases(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_review_cases_case_type ON review_cases(case_type)")


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
                if version == 4:
                    _upgrade_review_cases_schema(conn)
                _run_sql_file(conn, sql_path)
                conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?)",
                    (version,),
                )
        _upgrade_review_cases_schema(conn)
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