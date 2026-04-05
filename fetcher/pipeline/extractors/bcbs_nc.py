from __future__ import annotations
"""
BCBS NC (Blue Cross Blue Shield of North Carolina) payer-specific extractor.

Document format: bcbs_nc_multi_drug
- Pages 1-2: preferred/non-preferred biosimilar TABLES (critical for biosimilar step logic)
  - Table format: Drug Name | Preferred Status | Notes
  - Preferred drugs: Mvasi, Zirabev (bevacizumab biosimilars) → preferred
  - Non-preferred: Avastin (reference biologic) → non_preferred, biosimilar_step_required=true
- Multi-drug policy: covers bevacizumab, trastuzumab, rituximab in one document
- "Criteria for Medical Necessity" section: clinical criteria (Initial + Continuation)
- Corporate medical policy number in header

Strategy:
- Tables on pages 1-2 define the preferred/non_preferred tier structure
- preferred_alternatives = drugs listed in the Preferred column
- For non-preferred brands, biosimilar_step_required = true
- "Criteria for Medical Necessity" → prior_auth_criteria
- Produce one rule per drug entity (e.g., Bevacizumab-preferred, Bevacizumab-branded)
  OR one rule per drug with coverage_tier indicating the preferred vs non-preferred split
"""

from .base import build_document_text, call_gemini, inject_metadata


async def extract(
    chunks: list[dict],
    source_id: str,
    artifact_version_id: str,
    payer_name: str = "BCBS NC",
    raw_text: str = "",
) -> list[dict]:
    doc_text = build_document_text(chunks) or raw_text

    prompt = f"""The following is a Blue Cross Blue Shield of North Carolina (BCBS NC)
Corporate Medical Policy document covering oncology and specialty biologics.

DOCUMENT STRUCTURE GUIDE:
1. Pages 1-2 contain preferred/non-preferred BIOSIMILAR TABLES. This is critical:
   - Drugs listed under "Preferred" → coverage_tier="preferred", biosimilar_step_required=false
   - Reference biologics (e.g., Avastin) listed as non-preferred → coverage_tier="non_preferred",
     biosimilar_step_required=true, preferred_alternatives=[list of preferred biosimilars]
   - Example: Mvasi and Zirabev are PREFERRED; Avastin is NON-PREFERRED (requires failing Mvasi/Zirabev)
2. The policy covers MULTIPLE drugs (e.g., bevacizumab products, trastuzumab products, rituximab).
   Extract a SEPARATE rule for each drug entity.
3. "Criteria for Medical Necessity" section applies to ALL drugs:
   - "Initial Authorization Criteria": prior_auth_criteria for initial PA
   - "Continuation of Therapy Criteria": reauthorization criteria
4. For each drug:
   - indications_covered = oncology indications listed in the tables or policy
   - hcpcs_codes = J-codes associated with that drug (look in coding tables or appendix)
5. biosimilar_step_required=true means: the brand/reference biologic requires prior trial
   of the preferred biosimilar. preferred_alternatives lists those biosimilars.
6. For access_status: preferred biosimilars → "preferred_1_of_2" or similar (count preferred agents).
   Non-preferred brands → "non_preferred".

payer_name for all rules: "{payer_name}"
plan_type for all rules: "commercial"

DOCUMENT TEXT:
{doc_text[:950000]}

Extract all drug rules. Return a JSON array — one rule per named drug entity.
Pay special attention to the preferred/non-preferred tables and the biosimilar step therapy logic.
"""

    rules, raw = await call_gemini(prompt)
    return inject_metadata(rules, source_id, artifact_version_id)
