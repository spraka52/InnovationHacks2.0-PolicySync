from __future__ import annotations
"""
EmblemHealth payer-specific extractor.

Document format: emblemhealth_docx
- Policy delivered as .docx (python-docx required)
- Structure: paragraphs + tables similar to UHC narrative
- GatewayPA third-party portal format

Strategy:
- python-docx extracts paragraphs and tables from .docx
- The main.py pre-processing step converts .docx → plain text sections
- This extractor receives the already-converted text in chunks
- Uses Gemini for extraction with DOCX-specific instructions
"""

from .base import build_document_text, call_gemini, inject_metadata


async def extract(
    chunks: list[dict],
    source_id: str,
    artifact_version_id: str,
    payer_name: str = "EmblemHealth",
    raw_text: str = "",
) -> list[dict]:
    doc_text = build_document_text(chunks) or raw_text

    prompt = f"""The following is an EmblemHealth prior authorization policy document
(originally in DOCX format, converted to text).

DOCUMENT STRUCTURE GUIDE:
1. The document has a header with policy number and effective date.
2. Structure is similar to commercial payer narrative policies:
   - Drug identification section: drug name, brand names, J-codes/HCPCS codes
   - Criteria section: conditions required for prior authorization
   - Indications section: approved clinical uses
3. Extract all drug coverage rules present in the document.
4. For each drug:
   - drug_name, generic_name, brand_names from drug identification
   - hcpcs_codes from the coding section (J-codes)
   - indications_covered from approved uses
   - prior_auth_criteria from all listed criteria
   - If "must fail [drug X] first": step_therapy_required=true
   - If biosimilar must be tried first: biosimilar_step_required=true

payer_name for all rules: "{payer_name}"
plan_type for all rules: "commercial"

DOCUMENT TEXT:
{doc_text[:950000]}

Extract all drug rules. Return a JSON array — one object per named drug entity.
"""

    rules, raw = await call_gemini(prompt)
    return inject_metadata(rules, source_id, artifact_version_id)
