"""CLI tool to export sanitized Section D.5 / PAPER-16 scoring metrics."""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from typing import Optional

from config import DB_PATH
from knowledge_gain import (
    compute_knowledge_gain_summary,
    extract_knowledge_gain_records,
    format_records_csv,
)


def export_knowledge_gain_cli(
    db_path: str = DB_PATH,
    export_format: str = "csv",
    output_file: Optional[str] = None,
    scenario_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    anonymize: bool = False,
) -> int:
    """Execute knowledge-gain export and output to file or stdout."""
    fmt = (export_format or "csv").strip().lower()
    if fmt not in ("json", "csv"):
        print(f"Error: Unsupported format '{export_format}'. Must be 'json' or 'csv'.", file=sys.stderr)
        return 1

    status = status_filter.strip().upper() if status_filter else None
    if status and status not in ("PASS", "FAIL", "ERROR", "UNKNOWN"):
        print(f"Error: Invalid status filter '{status_filter}'. Must be PASS, FAIL, ERROR, or UNKNOWN.", file=sys.stderr)
        return 1

    try:
        conn = sqlite3.connect(db_path)
    except Exception as exc:
        print(f"Error connecting to database '{db_path}': {exc}", file=sys.stderr)
        return 1

    try:
        records = extract_knowledge_gain_records(
            conn,
            scenario_id=scenario_id,
            status_filter=status,
            anonymize=anonymize,
        )
    finally:
        conn.close()

    if fmt == "csv":
        content = format_records_csv(records)
    else:
        summary = compute_knowledge_gain_summary(records)
        content = json.dumps({"summary": summary, "records": records}, indent=2)

    if output_file:
        try:
            with open(output_file, "w", encoding="utf-8", newline="") as f:
                f.write(content)
            print(f"Successfully exported {len(records)} record(s) to '{output_file}'.", file=sys.stderr)
        except Exception as exc:
            print(f"Error writing to output file '{output_file}': {exc}", file=sys.stderr)
            return 1
    else:
        sys.stdout.write(content)

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Export sanitized Section D.5 / PAPER-16 scoring metrics from Cyber Range SQLite database."
    )
    parser.add_argument(
        "--db",
        dest="db_path",
        default=DB_PATH,
        help="Path to pod_mgmt.db (defaults to configured DB_PATH)",
    )
    parser.add_argument(
        "--format",
        choices=["json", "csv", "JSON", "CSV"],
        default="csv",
        help="Export format: 'csv' (default) or 'json'",
    )
    parser.add_argument(
        "--output",
        "-o",
        dest="output_file",
        help="Output file path (prints to stdout if omitted)",
    )
    parser.add_argument(
        "--anonymize",
        action="store_true",
        help="Anonymize student IDs using deterministic salted HMAC-SHA256",
    )
    parser.add_argument(
        "--scenario",
        type=int,
        dest="scenario_id",
        help="Filter metrics by scenario ID",
    )
    parser.add_argument(
        "--status",
        dest="status_filter",
        help="Filter by verification status (PASS, FAIL, etc.)",
    )

    args = parser.parse_args(argv)
    return export_knowledge_gain_cli(
        db_path=args.db_path,
        export_format=args.format,
        output_file=args.output_file,
        scenario_id=args.scenario_id,
        status_filter=args.status_filter,
        anonymize=args.anonymize,
    )


if __name__ == "__main__":
    sys.exit(main())
