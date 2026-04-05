"""
Re-seed just the Cigna rituximab policy.
Deletes stale published rules + drafts for Cigna, then re-extracts with the fixed extractor.

Usage:
  cd /Users/shreyaprakash/Documents/HackathonAI/PolicySync
  python scripts/reseed_cigna.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Reuse everything from seed.py
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root / "scripts"))
sys.path.insert(0, str(project_root / "fetcher"))

from seed import db, SEED_DIR, seed_file  # noqa: E402


async def main():
    payer_name = "Cigna"
    payer_format = "cigna_narrative"
    filepath = SEED_DIR / "cigna_rituximab_2026.pdf"

    print(f"=== Re-seeding {payer_name} ===")
    print(f"File: {filepath}")

    # ── 1. Find the source record ─────────────────────────────────────────────
    source_result = (
        db.table("sources")
        .select("id")
        .eq("payer_name", payer_name)
        .limit(1)
        .execute()
    )
    if not source_result.data:
        print(f"❌ No source record found for '{payer_name}' — run migrations first")
        sys.exit(1)
    source_id = source_result.data[0]["id"]
    print(f"Source ID: {source_id}")

    # ── 2. Remove stale published rules for this payer ────────────────────────
    # draft_extractions links via artifact_version_id → artifact_versions → source_id
    stale_versions = (
        db.table("artifact_versions")
        .select("id")
        .eq("source_id", source_id)
        .execute()
    )
    version_ids = [r["id"] for r in (stale_versions.data or [])]
    if version_ids:
        stale_drafts = (
            db.table("draft_extractions")
            .select("id")
            .in_("artifact_version_id", version_ids)
            .execute()
        )
        draft_ids = [r["id"] for r in (stale_drafts.data or [])]
        if draft_ids:
            for did in draft_ids:
                db.table("published_rules").delete().eq("draft_extraction_id", did).execute()
            db.table("draft_extractions").delete().in_("id", draft_ids).execute()
            print(f"Deleted {len(draft_ids)} stale draft(s) + their published rules")
        else:
            print("No stale drafts found — nothing to delete")
        # Clean up old artifact_versions so seed creates a fresh one
        db.table("artifact_versions").delete().in_("id", version_ids).execute()
        print(f"Deleted {len(version_ids)} stale artifact_version(s)")
    else:
        print("No existing artifact versions found — clean slate")

    # ── 3. Re-run seed for just this file ─────────────────────────────────────
    await seed_file(filepath, payer_name, payer_format)

    print("\n✅ Cigna reseed complete!")
    print("Search 'rituximab' or ask 'Does Cigna require prior auth for rituximab in RA?' to verify.")


if __name__ == "__main__":
    asyncio.run(main())
