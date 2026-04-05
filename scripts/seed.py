"""
RxMonitor Seed Script

Uploads the 6 provided sample policy PDFs/DOCX to Supabase Storage,
runs each through the full extraction pipeline, auto-approves, and publishes.

Usage:
  cd rxmonitor/
  python scripts/seed.py

Requirements:
  pip install supabase python-dotenv pdfplumber httpx python-docx

Env: reads from .env.local (or .env) in the project root.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
import pdfplumber
from dotenv import load_dotenv
from supabase import create_client

# Load env from project root
project_root = Path(__file__).parent.parent
env_file = project_root / ".env.local"
if not env_file.exists():
    env_file = project_root / ".env"
load_dotenv(env_file)

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
GOOGLE_AI_KEY = os.environ.get("GOOGLE_AI_API_KEY", "")
FETCHER_SERVICE_URL = os.environ.get("FETCHER_SERVICE_URL", "http://localhost:8000")
FETCHER_API_SECRET = os.environ.get("FETCHER_API_SECRET", "")

db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

SEED_DIR = project_root / "seed"

# ─── Seed manifest: (filename, payer_name, payer_format) ─────────────────────

SEED_FILES = [
    ("uhc_botulinum_toxins_2026.pdf",   "UnitedHealthcare",  "uhc_narrative"),
    ("cigna_rituximab_2026.pdf",         "Cigna",             "cigna_narrative"),
    ("bcbs_nc_oncology.pdf",             "BCBS NC",           "bcbs_nc_multi_drug"),
    ("florida_blue_bevacizumab.pdf",     "Florida Blue",      "florida_blue_mcg"),
    ("priority_health_mdl_2026.pdf",     "Priority Health",   "priority_health_mdl"),
    ("emblemhealth_denosumab.pdf",        "EmblemHealth",      "emblemhealth_docx"),
]

# ─── Embedding helper (local sentence-transformers via fetcher /embed) ────────

async def embed_text(text: str) -> list[float] | None:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{FETCHER_SERVICE_URL}/embed",
                json={"text": text[:2000]},
            )
            if resp.status_code != 200:
                return None
            return resp.json().get("embedding")
    except Exception:
        return None


# ─── Main seed logic ──────────────────────────────────────────────────────────

async def seed_file(filepath: Path, payer_name: str, payer_format: str):
    print(f"\n{'='*60}")
    print(f"Seeding: {filepath.name} ({payer_name})")

    if not filepath.exists():
        print(f"  ⚠️  File not found: {filepath} — skipping")
        return

    raw_bytes = filepath.read_bytes()
    content_hash = hashlib.sha256(raw_bytes).hexdigest()
    ext = filepath.suffix.lstrip(".")

    # ── 1. Look up the source record for this payer ───────────────────────────
    source_result = (
        db.table("sources")
        .select("id, payer_name, payer_format")
        .eq("payer_name", payer_name)
        .limit(1)
        .execute()
    )
    if not source_result.data:
        print(f"  ❌ No source record found for payer '{payer_name}' — run migrations first")
        return
    source = source_result.data[0]
    source_id = source["id"]
    print(f"  ✓ Source ID: {source_id}")

    # ── 2. Upload to Supabase Storage ─────────────────────────────────────────
    storage_path = f"artifacts/{source_id}/{content_hash[:16]}.{ext}"
    try:
        db.storage.from_("artifacts").upload(
            storage_path,
            raw_bytes,
            file_options={"content-type": "application/octet-stream", "upsert": "true"},
        )
        print(f"  ✓ Uploaded to Storage: {storage_path}")
    except Exception as e:
        print(f"  ⚠️  Storage upload warning: {e} (may already exist)")

    # ── 3. Insert artifact_version ────────────────────────────────────────────
    ver_result = db.table("artifact_versions").insert({
        "source_id": source_id,
        "content_hash": content_hash,
        "storage_path": storage_path,
        "fetched_at": datetime.utcnow().isoformat(),
    }).execute()
    version_id = ver_result.data[0]["id"]
    print(f"  ✓ artifact_version: {version_id}")

    # ── 4. Call pipeline via fetcher service (if running) OR run inline ───────
    if FETCHER_SERVICE_URL and FETCHER_API_SECRET:
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.post(
                    f"{FETCHER_SERVICE_URL}/pipeline/run",
                    json={
                        "source_id": source_id,
                        "artifact_version_id": version_id,
                        "user_id": "seed_script",
                    },
                    headers={"x-api-secret": FETCHER_API_SECRET},
                )
                resp.raise_for_status()
                pipeline_result = resp.json()
                draft_id = pipeline_result.get("draft_id")
                eval_score = pipeline_result.get("eval_score", 0)
                print(f"  ✓ Pipeline ran: draft_id={draft_id}, eval_score={eval_score}")
        except Exception as e:
            print(f"  ⚠️  Pipeline call failed: {e}")
            print(f"     Falling back to inline extraction...")
            draft_id = await _inline_extract_and_draft(
                filepath, raw_bytes, ext, source_id, version_id, payer_name, payer_format
            )
    else:
        print(f"  ⚠️  FETCHER_SERVICE_URL/FETCHER_API_SECRET not set — using inline extraction")
        draft_id = await _inline_extract_and_draft(
            filepath, raw_bytes, ext, source_id, version_id, payer_name, payer_format
        )

    if not draft_id:
        print(f"  ❌ No draft_id — extraction may have failed")
        return

    # ── 5. Auto-approve and publish the draft ─────────────────────────────────
    draft_result = (
        db.table("draft_extractions")
        .select("*")
        .eq("id", draft_id)
        .single()
        .execute()
    )
    if not draft_result.data:
        print(f"  ❌ Draft {draft_id} not found")
        return

    rules = draft_result.data.get("extracted_json", [])
    if not isinstance(rules, list):
        rules = [rules]

    published_ids = []
    for rule in rules:
        rule_text = str(rule)[:2000]
        embedding = await embed_text(rule_text)

        pub_result = db.table("published_rules").insert({
            "draft_extraction_id": draft_id,
            "rule_json": rule,
            "embedding": embedding,
            "published_by": "seed_script",
        }).execute()
        pub_id = pub_result.data[0]["id"]
        published_ids.append(pub_id)

    # Mark draft approved
    db.table("draft_extractions").update({
        "status": "approved",
        "reviewed_by": "seed_script",
        "reviewed_at": datetime.utcnow().isoformat(),
    }).eq("id", draft_id).execute()

    # Update source policy_count + last_fetched_at
    db.table("sources").update({
        "policy_count": len(published_ids),
        "last_fetched_at": datetime.utcnow().isoformat(),
        "last_changed_at": datetime.utcnow().isoformat(),
        "active": True,
    }).eq("id", source_id).execute()

    print(f"  ✅ Published {len(published_ids)} rules from {filepath.name}")
    for pid in published_ids:
        print(f"     published_rule: {pid}")

    # Audit log
    db.table("audit_events").insert({
        "action": "rule_published",
        "user_id": "seed_script",
        "user_email": "seed@rxmonitor.app",
        "entity_type": "published_rule",
        "entity_id": published_ids[0] if published_ids else version_id,
        "metadata": {
            "source_id": source_id,
            "payer_name": payer_name,
            "rule_count": len(published_ids),
            "seeded": True,
        },
    }).execute()


async def _inline_extract_and_draft(
    filepath: Path,
    raw_bytes: bytes,
    ext: str,
    source_id: str,
    version_id: str,
    payer_name: str,
    payer_format: str,
) -> str | None:
    """
    Inline extraction fallback when fetcher service is not running.
    Uses Gemini directly via the payer extractor modules.
    """
    # Add fetcher to path so we can import pipeline modules
    fetcher_dir = project_root / "fetcher"
    if str(fetcher_dir) not in sys.path:
        sys.path.insert(0, str(fetcher_dir))

    try:
        from pipeline.extractors import EXTRACTOR_REGISTRY

        # Extract text from file
        if ext == "pdf":
            sections = []
            with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
                for page in pdf.pages:
                    text = page.extract_text(x_tolerance=3, y_tolerance=3) or ""
                    if text.strip():
                        sections.append({
                            "section_title": None,
                            "page_number": page.page_number,
                            "leaf_text": text.strip(),
                            "parent_text": text.strip(),
                            "contextual_summary": None,
                            "embedding": None,
                        })
        elif ext == "docx":
            from docx import Document as DocxDocument
            doc = DocxDocument(io.BytesIO(raw_bytes))
            full_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
            sections = [{
                "section_title": None,
                "page_number": None,
                "leaf_text": full_text,
                "parent_text": full_text,
                "contextual_summary": None,
                "embedding": None,
            }]
        else:
            full_text = raw_bytes.decode("utf-8", errors="replace")
            sections = [{
                "section_title": None,
                "page_number": None,
                "leaf_text": full_text[:50000],
                "parent_text": full_text[:50000],
                "contextual_summary": None,
                "embedding": None,
            }]

        extractor_fn = EXTRACTOR_REGISTRY.get(payer_format, EXTRACTOR_REGISTRY["uhc_narrative"])
        raw_text = "\n\n".join(s["parent_text"] for s in sections)

        # For Priority Health, also extract table rows
        table_rows = None
        if payer_format == "priority_health_mdl" and ext == "pdf":
            table_rows = []
            with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
                for page in pdf.pages:
                    for table in page.extract_tables():
                        for row in table:
                            if row and any(cell for cell in row if cell):
                                table_rows.append([str(c or "") for c in row])

        kwargs = {
            "chunks": sections,
            "source_id": source_id,
            "artifact_version_id": version_id,
            "payer_name": payer_name,
            "raw_text": raw_text,
        }
        if table_rows is not None:
            kwargs["table_rows"] = table_rows

        rules = await extractor_fn(**kwargs)

        print(f"  ✓ Inline extraction: {len(rules)} rules")

        if not rules:
            print(f"  ⚠️  No rules extracted — creating empty draft")

        # Insert draft
        draft_result = db.table("draft_extractions").insert({
            "artifact_version_id": version_id,
            "extracted_json": rules,
            "status": "pending_review",
            "eval_score": 75,  # Seed bypass: auto-pass eval
            "eval_flags": ["seed_bypass"],
        }).execute()

        return draft_result.data[0]["id"]

    except Exception as e:
        print(f"  ❌ Inline extraction failed: {e}")
        import traceback
        traceback.print_exc()
        return None


async def main():
    print("RxMonitor Seed Script")
    print(f"Seed directory: {SEED_DIR}")
    print(f"Supabase URL: {SUPABASE_URL[:40]}...")

    if not SEED_DIR.exists():
        print(f"\n❌ Seed directory not found: {SEED_DIR}")
        print("Please copy the 6 sample policy files to rxmonitor/seed/:")
        for fname, payer, fmt in SEED_FILES:
            print(f"  - {fname}")
        sys.exit(1)

    found = [f for f, _, _ in SEED_FILES if (SEED_DIR / f).exists()]
    missing = [f for f, _, _ in SEED_FILES if not (SEED_DIR / f).exists()]

    print(f"\nFound:   {len(found)}/{len(SEED_FILES)} files")
    if missing:
        print(f"Missing: {', '.join(missing)}")

    for filename, payer_name, payer_format in SEED_FILES:
        filepath = SEED_DIR / filename
        await seed_file(filepath, payer_name, payer_format)
        await asyncio.sleep(70)  # wait for Groq TPM window to reset (6k tokens/min)

    print(f"\n{'='*60}")
    print("✅ Seed complete!")
    print("Run the app and search for 'bevacizumab' to verify.")


if __name__ == "__main__":
    asyncio.run(main())
