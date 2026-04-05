"""
Demo Reset Script
=================
Resets Demo Payer 2 ("Aetna - Rituximab") back to a clean state
so the demo can be run again:
  - Deletes artifact_versions for Aetna - Rituximab
  - Deletes draft_extractions linked to those versions
  - Deletes published_rules published from those drafts (optional, --full flag)

Usage:
  python scripts/reset_demo.py          # soft reset (keeps published rules)
  python scripts/reset_demo.py --full   # full reset (removes published rules too)
"""

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

DEMO_PAYER_2_NAME = "Aetna - Rituximab"
FULL_RESET = "--full" in sys.argv


def main():
    print(f"=== Demo Reset ({'FULL' if FULL_RESET else 'SOFT'}) ===\n")

    # Find demo payer 2
    source = db.from_("sources").select("id").eq("payer_name", DEMO_PAYER_2_NAME).execute()
    if not source.data:
        print(f"⚠ '{DEMO_PAYER_2_NAME}' not found in sources. Run setup_demo.py first.")
        sys.exit(1)

    source_id = source.data[0]["id"]
    print(f"Found '{DEMO_PAYER_2_NAME}' (id={source_id[:8]})")

    # Get artifact_versions for this source
    versions = (
        db.from_("artifact_versions")
        .select("id")
        .eq("source_id", source_id)
        .execute()
    )
    version_ids = [v["id"] for v in (versions.data or [])]
    print(f"Found {len(version_ids)} artifact_version(s)")

    if not version_ids:
        print("Nothing to reset — already clean.")
        return

    if FULL_RESET and version_ids:
        # Delete published_rules via draft_extractions
        drafts = (
            db.from_("draft_extractions")
            .select("id")
            .in_("artifact_version_id", version_ids)
            .execute()
        )
        draft_ids = [d["id"] for d in (drafts.data or [])]
        if draft_ids:
            deleted_rules = (
                db.from_("published_rules")
                .delete()
                .in_("draft_extraction_id", draft_ids)
                .execute()
            )
            print(f"  Deleted published_rules linked to demo drafts")

    # Delete draft_extractions
    if version_ids:
        db.from_("draft_extractions").delete().in_("artifact_version_id", version_ids).execute()
        print(f"  Deleted draft_extractions")

    # Delete artifact_versions
    db.from_("artifact_versions").delete().eq("source_id", source_id).execute()
    print(f"  Deleted artifact_versions")

    # Update source last_fetched_at to null (shows "Never fetched" in UI)
    db.from_("sources").update({
        "last_fetched_at": None,
        "last_changed_at": None,
        "policy_count": 0,
    }).eq("id", source_id).execute()
    print(f"  Reset source timestamps")

    print(f"\n✓ Reset complete — '{DEMO_PAYER_2_NAME}' is ready for demo.")
    print("  Next 'Fetch Now' will detect a change and trigger the pipeline.")


if __name__ == "__main__":
    main()
