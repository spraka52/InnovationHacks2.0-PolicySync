"""
Re-publish all approved drafts with real embeddings.

- Clears existing published_rules
- Publishes all approved draft rules with embeddings via fetcher /embed
- Skips Priority Health rules with drug_name == "N/A"
- Focuses on oncology/immunology drugs for Priority Health

Usage:
  python3 scripts/republish.py
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv
from supabase import create_client

project_root = Path(__file__).parent.parent
load_dotenv(project_root / ".env.local")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
FETCHER_URL = os.environ.get("FETCHER_SERVICE_URL", "http://localhost:8000")

db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Oncology/immunology keywords for filtering Priority Health
ONCOLOGY_KEYWORDS = {
    "bevacizumab", "rituximab", "trastuzumab", "pertuzumab", "cetuximab",
    "panitumumab", "nivolumab", "pembrolizumab", "atezolizumab", "durvalumab",
    "ipilimumab", "blinatumomab", "obinutuzumab", "ofatumumab", "ibritumomab",
    "daratumumab", "elotuzumab", "isatuximab", "ramucirumab", "necitumumab",
    "ado-trastuzumab", "fam-trastuzumab", "enfortumab", "sacituzumab",
    "brentuximab", "polatuzumab", "gemtuzumab", "inotuzumab", "loncastuximab",
    "denosumab", "zoledronic", "pamidronate", "leucovorin", "levoleucovorin",
    "filgrastim", "pegfilgrastim", "sargramostim", "epoetin", "darbepoetin",
    "ondansetron", "granisetron", "palonosetron", "fosaprepitant", "aprepitant",
    "dexamethasone", "mesna", "dexrazoxane", "amifostine",
    "abobotulinumtoxin", "onabotulinumtoxin", "incobotulinumtoxin", "daxibotulinumtoxin",
    "botulinum",
}


async def embed_text(text: str) -> list[float] | None:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{FETCHER_URL}/embed",
                json={"text": text[:2000]},
            )
            if resp.status_code == 200:
                return resp.json().get("embedding")
    except Exception as e:
        print(f"    embed error: {e}")
    return None


def is_oncology_relevant(rule: dict, payer_name: str) -> bool:
    """For Priority Health, only publish oncology/immunology rules."""
    if payer_name != "Priority Health":
        return True

    drug_name = (rule.get("drug_name") or "").lower()
    generic = (rule.get("generic_name") or "").lower()
    category = (rule.get("drug_category") or "").lower()
    brands = " ".join(rule.get("brand_names") or []).lower()

    if drug_name in ("n/a", "", "unknown"):
        return False

    combined = f"{drug_name} {generic} {category} {brands}"
    return any(kw in combined for kw in ONCOLOGY_KEYWORDS)


async def main():
    # ── 1. Clear existing published_rules ────────────────────────────────────
    print("Clearing existing published_rules...")
    db.table("published_rules").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("  ✓ Cleared")

    # ── 2. Get all approved drafts — latest one per artifact_version only ────
    all_drafts = db.table("draft_extractions").select("*").eq("status", "approved").order("created_at", desc=True).execute()

    # Deduplicate: keep only the latest draft per artifact_version_id
    seen_versions: set[str] = set()
    drafts_data = []
    for d in all_drafts.data:
        av = d.get("artifact_version_id", d["id"])
        if av not in seen_versions:
            seen_versions.add(av)
            drafts_data.append(d)

    # Further: keep only latest draft per payer (dedup across multiple seed runs)
    seen_payers: set[str] = set()
    deduped = []
    for d in drafts_data:
        rules = d.get("extracted_json") or []
        if not isinstance(rules, list): rules = [rules]
        payer = rules[0].get("payer_name", d["id"]) if rules else d["id"]
        if payer not in seen_payers:
            seen_payers.add(payer)
            deduped.append(d)

    print(f"\nFound {len(all_drafts.data)} approved drafts → {len(deduped)} after dedup\n")
    drafts_data = deduped

    total_published = 0

    for draft in drafts_data:
        draft_id = draft["id"]
        rules = draft.get("extracted_json") or []
        if not isinstance(rules, list):
            rules = [rules]

        # Get payer name from first rule
        payer_name = rules[0].get("payer_name", "Unknown") if rules else "Unknown"
        print(f"Draft {draft_id[:8]} — {payer_name} — {len(rules)} rules")

        published_count = 0
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            if not is_oncology_relevant(rule, payer_name):
                continue

            drug = rule.get("drug_name", "?")
            rule_text = f"{rule.get('drug_name','')} {rule.get('generic_name','')} {rule.get('drug_category','')} {' '.join(rule.get('indications_covered') or [])} {' '.join(rule.get('prior_auth_criteria') or [])}"
            embedding = await embed_text(rule_text)

            try:
                db.table("published_rules").insert({
                    "draft_extraction_id": draft_id,
                    "rule_json": rule,
                    "embedding": embedding,
                    "published_by": "republish_script",
                }).execute()
                published_count += 1
            except Exception as e:
                print(f"    ❌ Insert failed for {drug}: {e}")

        print(f"  ✓ Published {published_count} rules")
        total_published += published_count

    print(f"\n{'='*50}")
    print(f"✅ Done — {total_published} rules published total")

    # ── 3. Update source policy counts ───────────────────────────────────────
    pub_all = db.table("published_rules").select("rule_json->payer_name").execute()
    from collections import Counter
    counts = Counter(r.get("payer_name") for r in pub_all.data)
    print("\nRules by payer:")
    for payer, count in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {payer}: {count}")


if __name__ == "__main__":
    asyncio.run(main())
