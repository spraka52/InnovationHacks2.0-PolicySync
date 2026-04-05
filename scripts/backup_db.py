"""
DB Backup Script — exports all key tables to JSON files.
Run after seeding is complete.

Usage:
  python3 scripts/backup_db.py

Output: backup/YYYY-MM-DDTHH-MM-SS/
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

project_root = Path(__file__).parent.parent
load_dotenv(project_root / ".env.local")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

TABLES = [
    "sources",
    "artifact_versions",
    "artifact_chunks",
    "draft_extractions",
    "published_rules",
    "audit_events",
]

def export_table(table: str) -> list[dict]:
    """Export all rows from a table (handles pagination)."""
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        result = (
            db.table(table)
            .select("*")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = result.data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def main():
    timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    backup_dir = project_root / "backup" / timestamp
    backup_dir.mkdir(parents=True, exist_ok=True)

    print(f"Backing up to: {backup_dir}\n")

    summary = {}
    for table in TABLES:
        print(f"  Exporting {table}...", end=" ", flush=True)
        try:
            rows = export_table(table)
            out_file = backup_dir / f"{table}.json"
            out_file.write_text(json.dumps(rows, indent=2, default=str))
            print(f"{len(rows)} rows → {out_file.name}")
            summary[table] = len(rows)
        except Exception as e:
            print(f"ERROR: {e}")
            summary[table] = f"ERROR: {e}"

    # Write summary
    summary_file = backup_dir / "summary.json"
    summary_file.write_text(json.dumps({
        "timestamp": timestamp,
        "supabase_url": SUPABASE_URL,
        "tables": summary,
    }, indent=2))

    print(f"\n✅ Backup complete: {backup_dir}")
    print(f"   Total tables: {len(TABLES)}")
    print(f"   Total rows: {sum(v for v in summary.values() if isinstance(v, int))}")


if __name__ == "__main__":
    main()
