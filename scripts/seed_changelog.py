"""
Seed Changelog Mock Data
========================
Updates published_rules.change_summary with realistic policy change data
so the /changelog page shows meaningful before/after diffs for the demo.

Usage:
  cd /path/to/PolicySync
  python scripts/seed_changelog.py
"""

import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env.local")

from supabase import create_client  # noqa: E402

db = create_client(os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

def ts(days_ago: int = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


# ── Realistic mock change summaries ──────────────────────────────────────────

MOCK_CHANGES = [
    {
        "match": {"payer": "Florida Blue", "drug": "Bevacizumab"},
        "days_ago": 0,
        "summary": {
            "clinical_changes": [
                "coverage_tier changed from preferred to non_preferred",
                "biosimilar_step_required changed from false to true",
                "preferred_alternatives changed from [] to [Mvasi (bevacizumab-awwb), Zirabev (bevacizumab-bvzr)]",
            ],
            "cosmetic_changes": [
                "effective_date changed from 2025-07-01 to 2026-01-01",
            ],
        },
    },
    {
        "match": {"payer": "Cigna", "drug": "Rituximab"},
        "days_ago": 1,
        "summary": {
            "clinical_changes": [
                "coverage_tier changed from preferred to covered_alternative",
                "prior_auth_criteria changed from [Diagnosis of CD20-positive B-cell NHL confirmed, Prior failure of at least one chemotherapy regimen] to [Diagnosis of CD20-positive B-cell NHL confirmed, Prior failure of at least one chemotherapy regimen, Patient must have tried and failed Truxima (rituximab-abbs) or Ruxience (rituximab-pvvr) unless contraindicated]",
                "step_therapy_required changed from false to true",
                "step_therapy_requirements changed from [] to [Must try biosimilar rituximab (Truxima or Ruxience) before branded Rituxan is covered]",
            ],
            "cosmetic_changes": [
                "policy_title changed from Clinical Policy: Rituximab to Clinical Policy: Rituximab and Biosimilars (2026 Update)",
                "effective_date changed from 2025-01-01 to 2026-02-01",
            ],
        },
    },
    {
        "match": {"payer": "BCBS NC", "drug": "Bevacizumab"},
        "days_ago": 2,
        "summary": {
            "clinical_changes": [
                "access_status changed from preferred_1_of_2 to preferred_1_of_3",
                "peers_in_category changed from [Avastin, Mvasi] to [Avastin, Mvasi, Zirabev]",
                "quantity_limits changed from 15 mg/kg every 3 weeks, max 12 cycles to 10 mg/kg every 2 weeks OR 15 mg/kg every 3 weeks, max 8 cycles per calendar year",
            ],
            "cosmetic_changes": [
                "effective_date changed from 2025-04-01 to 2026-04-01",
            ],
        },
    },
    {
        "match": {"payer": "UnitedHealthcare", "drug": "AbobotulinumtoxinA"},
        "days_ago": 3,
        "summary": {
            "clinical_changes": [
                "prior_auth_criteria changed from [Diagnosis confirmed by neurologist, Failed at least 2 oral preventive medications] to [Diagnosis confirmed by neurologist, Failed at least 2 oral preventive medications, Must document frequency of headache days (≥15 days/month for chronic migraine)]",
                "reauthorization_period changed from 12 months to 6 months",
            ],
            "cosmetic_changes": [
                "effective_date changed from 2025-10-01 to 2026-01-01",
                "policy_title changed from UHC Medical Policy: Botulinum Toxin Injections to UHC Medical Policy: Botulinum Toxin Injections (2026D0017AN)",
            ],
        },
    },
    {
        "match": {"payer": "BCBS NC", "drug": "Rituximab"},
        "days_ago": 5,
        "summary": {
            "clinical_changes": [
                "coverage_tier changed from non_preferred to covered_alternative",
                "preferred_alternatives changed from [Truxima (rituximab-abbs)] to [Truxima (rituximab-abbs), Ruxience (rituximab-pvvr), Riabni (rituximab-arrx)]",
                "biosimilar_step_required changed from false to true",
            ],
            "cosmetic_changes": [
                "effective_date changed from 2025-01-01 to 2026-01-01",
            ],
        },
    },
]


def patch_rule(payer: str, drug: str, days_ago: int, summary: dict):
    """Find a published rule matching payer+drug and update its change_summary."""

    # Try exact payer name match first, then partial
    result = (
        db.from_("published_rules")
        .select("id, rule_json")
        .ilike("rule_json->>payer_name", f"%{payer}%")
        .ilike("rule_json->>drug_name", f"%{drug}%")
        .limit(1)
        .execute()
    )

    if not result.data:
        print(f"  ⚠ No rule found for {payer} / {drug} — skipping")
        return

    rule_id = result.data[0]["id"]
    detected = ts(days_ago)

    change_summary = {
        **summary,
        "previous_version_id": None,
        "detected_at": detected,
    }

    db.from_("published_rules").update({"change_summary": change_summary}).eq("id", rule_id).execute()
    print(f"  ✓ Updated {payer} / {drug} (id={rule_id[:8]}) — {len(summary['clinical_changes'])} clinical, {len(summary['cosmetic_changes'])} cosmetic")


def main():
    print("=== Seeding Changelog Mock Data ===\n")
    for item in MOCK_CHANGES:
        patch_rule(
            payer=item["match"]["payer"],
            drug=item["match"]["drug"],
            days_ago=item["days_ago"],
            summary=item["summary"],
        )
    print("\n✓ Done. Refresh /changelog to see realistic change data.")


if __name__ == "__main__":
    main()
