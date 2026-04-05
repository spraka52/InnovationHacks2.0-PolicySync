from __future__ import annotations
"""
UHC (UnitedHealthcare) payer-specific extractor.

Document format: uhc_narrative
- Page 4+: HCPCS code table (J-code | Drug name | Route)
- "General Requirements" section: PA criteria that apply to ALL drugs in the policy
- "Diagnosis-Specific Requirements": subsections per drug name with indications + criteria
- "Unproven" section: indications_not_covered list per drug
- Policy number in header: e.g., "2026D0017AN"

Strategy:
- Extract HCPCS table first to build J-code ↔ drug name mapping
- General Requirements → prior_auth_criteria that apply to ALL extracted rules
- Per drug: collect its Diagnosis-Specific section + its Unproven section
- LLM sees: full document + instructions to produce one rule per named drug entity
"""

from .base import build_document_text, call_gemini, inject_metadata


async def extract(
    chunks: list[dict],
    source_id: str,
    artifact_version_id: str,
    payer_name: str = "UnitedHealthcare",
    raw_text: str = "",
) -> list[dict]:
    doc_text = build_document_text(chunks) or raw_text

    prompt = f"""The following is a UnitedHealthcare Commercial Medical Benefit Drug Policy document.

DOCUMENT STRUCTURE GUIDE:
1. The document header contains the Policy Number (e.g., "2026D0017AN") and effective date.
2. Near page 4-6 there is a HCPCS code table listing: J-code | Drug name | Brand(s).
   Use this to populate hcpcs_codes and brand_names for each drug.
3. "General Requirements" section contains PA criteria that apply to ALL drugs — include these
   in prior_auth_criteria for every rule you extract.
4. "Diagnosis-Specific Requirements" has subsections per drug (e.g., "AbobotulinumtoxinA (Dysport)").
   Each subsection lists approved indications. Extract one rule per named drug.
5. "Unproven Uses" or similar section lists indications considered not medically necessary —
   these go in indications_not_covered.
6. If Myobloc or any drug states "must fail [drug X] first", set step_therapy_required=true
   and step_therapy_requirements to that list.
7. For access_status: if only 1 drug in the category is preferred → preferred_exclusive.
   If 2 drugs are preferred in same class → preferred_1_of_2. Etc.
   If a drug has step therapy requirements through others → non_preferred.

payer_name for all rules: "{payer_name}"
plan_type for all rules: "commercial"

DOCUMENT TEXT:
{doc_text[:950000]}

Extract ALL drug rules from this document. Return a JSON array — one object per named drug entity.
If a drug appears in multiple sections, consolidate into one rule.
"""

    rules, raw = await call_gemini(prompt)
    return inject_metadata(rules, source_id, artifact_version_id)
