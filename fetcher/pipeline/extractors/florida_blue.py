from __future__ import annotations
"""
Florida Blue (MCG portal) payer-specific extractor.

Document format: florida_blue_mcg
- Table 1 = "Indication | Criteria" rows — each row is an oncology indication +
  full clinical criteria. This IS the structured data, nearly pre-extracted.
- Position Statement (narrative) = global PA requirements:
  dosage limits (e.g., 10mg/kg q2w or 15mg/kg q3w), biosimilar step requirements
- Policy number in header: e.g., "09-J0000-66"
- Usually covers one drug class per document

Strategy:
- Table 1 rows: each row → an indication in indications_covered + its criteria in prior_auth_criteria
- Position Statement: extract global criteria (dosage limits, biosimilar step)
- Consolidate into one rule per drug entity (or one per indication if criteria differ significantly)
- The table format means minimal LLM processing needed — mostly normalization
"""

from .base import build_document_text, call_gemini, inject_metadata


async def extract(
    chunks: list[dict],
    source_id: str,
    artifact_version_id: str,
    payer_name: str = "Florida Blue",
    raw_text: str = "",
) -> list[dict]:
    doc_text = build_document_text(chunks) or raw_text

    prompt = f"""The following is a Florida Blue (MCG Coverage Guideline) document.

DOCUMENT STRUCTURE GUIDE:
1. This document has a highly structured Table 1 format:
   - Column 1: Indication (cancer type, e.g., "Colorectal Cancer")
   - Column 2: Criteria (clinical criteria for that indication)
   This table IS the core data. Extract indications_covered from all rows.

2. "Position Statement" section contains GLOBAL requirements that apply to ALL indications:
   - Dosage limits (e.g., "10mg/kg every 2 weeks OR 15mg/kg every 3 weeks") → quantity_limits
   - Biosimilar step requirements (e.g., "must fail Mvasi or Zirabev before Avastin") →
     biosimilar_step_required=true, preferred_alternatives=[preferred biosimilars]
   - PA requirements → prior_auth_required=true

3. Policy number is in the header (e.g., "09-J0000-66") → policy_number
4. Effective date is in the header → effective_date
5. The drug J-code (e.g., J9035 for bevacizumab) may appear in a coding section → hcpcs_codes
6. All Table 1 indication rows → prior_auth_criteria (consolidate all criteria)
7. Florida Blue often requires step therapy through biosimilars:
   - If "Mvasi or Zirabev must be tried first" → biosimilar_step_required=true
   - preferred_alternatives = ["Mvasi (bevacizumab-awwb)", "Zirabev (bevacizumab-bvzr)"]
   - The reference biologic (Avastin) would then be non_preferred

payer_name for all rules: "{payer_name}"
plan_type for all rules: "commercial"

DOCUMENT TEXT:
{doc_text[:950000]}

Extract all drug rules. The Table 1 rows give you the indications.
The Position Statement gives you the global criteria and dosage limits.
Return a JSON array — one rule per drug entity (consolidate all indications into
indications_covered array on one rule, with all criteria in prior_auth_criteria).
"""

    rules, raw = await call_gemini(prompt)
    return inject_metadata(rules, source_id, artifact_version_id)
