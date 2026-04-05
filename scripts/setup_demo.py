"""
Demo Setup Script
=================
Creates 2 demo payer sources for the hackathon demo:

  Demo Payer 1 — "Humana - Bevacizumab" (No Change scenario)
    • Same URL as Florida Blue (mcgs.bcbsfl.com)
    • Pre-stores the CURRENT hash so "Fetch Now" always returns "No change detected"

  Demo Payer 2 — "Aetna - Rituximab" (Change Detected scenario)
    • Same URL as Cigna (cigna.com drug policies)
    • NO stored artifact_version → "Fetch Now" always triggers change + pipeline

Usage:
  cd /Users/shreyaprakash/Documents/HackathonAI/PolicySync
  python scripts/setup_demo.py

After this, run "Fetch Now" on "Aetna - Rituximab" from the Admin UI
(or run reset_demo.py then fetch again to repeat the demo).
"""

import hashlib
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

project_root = Path(__file__).parent.parent
load_dotenv(project_root / ".env.local")

from supabase import create_client  # noqa: E402

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
db = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── IDs of the real seeded sources we're mirroring ────────────────────────────
FLORIDA_BLUE_ID = "aaad40a7-e10f-4fa8-824e-1731b0ffab49"
CIGNA_ID        = "381f5cd1-431d-4f5e-b838-44ea3a44a3ea"

DEMO_PAYER_1_NAME = "Humana - Bevacizumab"   # No change scenario
DEMO_PAYER_2_NAME = "Aetna - Rituximab"       # Change detected scenario


def get_source(source_id: str) -> dict:
    result = db.from_("sources").select("*").eq("id", source_id).single().execute()
    if not result.data:
        raise RuntimeError(f"Source {source_id} not found in DB")
    return result.data


def get_latest_version(source_id: str) -> dict | None:
    result = (
        db.from_("artifact_versions")
        .select("content_hash, storage_path")
        .eq("source_id", source_id)
        .order("fetched_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def demo_source_exists(name: str) -> str | None:
    """Returns the id if demo source already exists, else None."""
    result = db.from_("sources").select("id").eq("payer_name", name).execute()
    return result.data[0]["id"] if result.data else None


def create_source(name: str, real_source: dict) -> str:
    """Insert a demo source row mirroring a real source's URL and format."""
    result = (
        db.from_("sources")
        .insert({
            "name": name,
            "payer_name": name,
            "payer_format": real_source["payer_format"],
            "plan_type": real_source.get("plan_type", "commercial"),
            "fetch_url": real_source["fetch_url"],
            "fetch_method": real_source["fetch_method"],
            "active": True,
            "policy_count": 0,
        })
        .execute()
    )
    # fetch the newly created row by name
    row = db.from_("sources").select("id").eq("payer_name", name).single().execute()
    return row.data["id"]


def insert_artifact_version(source_id: str, content_hash: str, storage_path: str):
    """Pre-store an artifact_version so fetcher sees 'no change'."""
    db.from_("artifact_versions").insert({
        "source_id": source_id,
        "content_hash": content_hash,
        "storage_path": storage_path,
    }).execute()


def main():
    print("=== PolicySync Demo Setup ===\n")

    # ── Demo Payer 1: No Change ────────────────────────────────────────────────
    print(f"Setting up '{DEMO_PAYER_1_NAME}'...")
    existing_id = demo_source_exists(DEMO_PAYER_1_NAME)
    if existing_id:
        print(f"  ✓ Already exists (id={existing_id[:8]}), skipping.")
        payer1_id = existing_id
    else:
        florida_blue = get_source(FLORIDA_BLUE_ID)
        payer1_id = create_source(DEMO_PAYER_1_NAME, florida_blue)
        print(f"  ✓ Created source (id={payer1_id[:8]})")

        # Pre-store the current Florida Blue hash so this payer looks "already fetched"
        latest = get_latest_version(FLORIDA_BLUE_ID)
        if latest:
            insert_artifact_version(payer1_id, latest["content_hash"], latest["storage_path"])
            print(f"  ✓ Pre-stored artifact_version (hash={latest['content_hash'][:12]}...)")
            print(f"    → 'Fetch Now' will return: No change detected ✓")
        else:
            print("  ⚠ No existing artifact_version found for Florida Blue — payer 1 may trigger pipeline on first fetch")

    # ── Demo Payer 2: Change Detected ─────────────────────────────────────────
    print(f"\nSetting up '{DEMO_PAYER_2_NAME}'...")
    existing_id = demo_source_exists(DEMO_PAYER_2_NAME)
    if existing_id:
        # Check if it already has an artifact_version (would mean it was already fetched)
        version = get_latest_version(existing_id)
        if version:
            print(f"  ⚠ Already exists AND has artifact_version — run reset_demo.py first!")
            print(f"    id={existing_id[:8]}, hash={version['content_hash'][:12]}")
        else:
            print(f"  ✓ Already exists, no artifact_version (ready to detect change). id={existing_id[:8]}")
        payer2_id = existing_id
    else:
        cigna = get_source(CIGNA_ID)
        payer2_id = create_source(DEMO_PAYER_2_NAME, cigna)
        print(f"  ✓ Created source (id={payer2_id[:8]})")
        print(f"    → 'Fetch Now' will trigger: Change detected → Pipeline runs ✓")

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "="*50)
    print("DEMO SETUP COMPLETE")
    print("="*50)
    print(f"\nDemo Payer 1 (No Change):     {DEMO_PAYER_1_NAME}")
    print(f"Demo Payer 2 (Change+Pipeline): {DEMO_PAYER_2_NAME}")
    print("""
DEMO SCRIPT:
  1. Go to Admin page → you'll see both demo payers
  2. Click "Fetch Now" on Humana - Bevacizumab
     → Toast: "No change detected" ✓
  3. Click "Fetch Now" on Aetna - Rituximab
     → Toast: "Policy changed — extraction queued!"
     → Wait ~2-3 min for pipeline to complete
  4. Go to Review queue → draft appears with eval score
  5. Approve → rule is live in Published Rules
  6. Ask Q&A: "Does Aetna require step therapy for rituximab?"

TO RESET (repeat demo):
  python scripts/reset_demo.py
""")


if __name__ == "__main__":
    main()
