"""CLI tool to export sanitized Section D.5 / PAPER-16 scoring metrics."""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Optional

import config
from knowledge_gain import (
    TelemetrySaltConfigError,
    compute_knowledge_gain_summary,
    extract_knowledge_gain_records,
    format_records_csv,
)


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _validate_db_path(db_path: str) -> Path:
    resolved = Path(db_path).expanduser().resolve()
    allowed = {Path(config.DB_PATH).expanduser().resolve()}
    data_dir = os.getenv("TELEMETRY_EXPORT_DATA_DIR", "").strip()
    if data_dir:
        allowed_root = Path(data_dir).expanduser().resolve()
        if _is_relative_to(resolved, allowed_root) or resolved == allowed_root:
            return resolved
    if resolved in allowed:
        return resolved
    raise ValueError(
        f"Refusing --db path outside configured DB_PATH / TELEMETRY_EXPORT_DATA_DIR: {resolved}"
    )


def _validate_output_path(output_file: str) -> Path:
    resolved = Path(output_file).expanduser().resolve()
    roots: list[Path] = [Path.cwd().resolve()]
    out_dir = os.getenv("TELEMETRY_EXPORT_OUTPUT_DIR", "").strip()
    if out_dir:
        roots.append(Path(out_dir).expanduser().resolve())
    try:
        roots.append(Path(config.DB_PATH).expanduser().resolve().parent)
    except Exception:
        pass
    for root in roots:
        if _is_relative_to(resolved, root) or resolved == root:
            return resolved
    raise ValueError(
        f"Refusing --output path outside cwd / TELEMETRY_EXPORT_OUTPUT_DIR / DB parent: {resolved}"
    )


def export_knowledge_gain_cli(
    db_path: str | None = None,
    export_format: str = "csv",
    output_file: Optional[str] = None,
    scenario_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    anonymize: bool = True,
) -> int:
    """Execute knowledge-gain export and output to file or stdout."""
    fmt = (export_format or "csv").strip().lower()
    if fmt not in ("json", "csv"):
        print(
            f"Error: Unsupported format '{export_format}'. Must be 'json' or 'csv'.",
            file=sys.stderr,
        )
        return 1

    status = status_filter.strip().upper() if status_filter else None
    if status and status not in ("PASS", "FAIL", "ERROR", "UNKNOWN"):
        print(
            f"Error: Invalid status filter '{status_filter}'. "
            "Must be PASS, FAIL, ERROR, or UNKNOWN.",
            file=sys.stderr,
        )
        return 1

    raw_db = db_path if db_path is not None else config.DB_PATH
    try:
        resolved_db = _validate_db_path(raw_db)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    resolved_out: Path | None = None
    if output_file:
        try:
            resolved_out = _validate_output_path(output_file)
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1

    try:
        conn = sqlite3.connect(str(resolved_db))
    except Exception as exc:
        print(f"Error connecting to database '{resolved_db}': {exc}", file=sys.stderr)
        return 1

    try:
        try:
            records = extract_knowledge_gain_records(
                conn,
                scenario_id=scenario_id,
                status_filter=status,
                anonymize=anonymize,
            )
        except TelemetrySaltConfigError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
    finally:
        conn.close()

    if fmt == "csv":
        content = format_records_csv(records)
    else:
        summary = compute_knowledge_gain_summary(records)
        content = json.dumps({"summary": summary, "records": records}, indent=2)

    if resolved_out is not None:
        try:
            resolved_out.parent.mkdir(parents=True, exist_ok=True)
            with open(resolved_out, "w", encoding="utf-8", newline="") as f:
                f.write(content)
            print(
                f"Successfully exported {len(records)} record(s) to '{resolved_out}'.",
                file=sys.stderr,
            )
        except Exception as exc:
            print(f"Error writing to output file '{resolved_out}': {exc}", file=sys.stderr)
            return 1
    else:
        sys.stdout.write(content)

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Export Section D.5 / PAPER-16 scoring metrics from Cyber Range SQLite. "
            "Student IDs are anonymized by default (requires TELEMETRY_ANONYMIZATION_SALT)."
        )
    )
    parser.add_argument(
        "--db",
        dest="db_path",
        default=None,
        help="Path to pod_mgmt.db (defaults to configured DB_PATH; must be allowlisted)",
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
        help="Output file path under cwd / TELEMETRY_EXPORT_OUTPUT_DIR / DB parent",
    )
    parser.add_argument(
        "--anonymize",
        default=True,
        action=argparse.BooleanOptionalAction,
        help="Anonymize student IDs (default: true). Use --no-anonymize for cleartext.",
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
