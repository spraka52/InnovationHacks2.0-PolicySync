from __future__ import annotations
"""
Cigna payer-specific extractor.

Document format: cigna_narrative
- Pure narrative text — ZERO tables in the main policy body
- Section headers: "POLICY STATEMENT", "FDA-Approved Indications",
  "COVERAGE CRITERIA", "DOCUMENTATION REQUIREMENTS",
  "CODING INFORMATION" (contains J-codes at the end)
- Policy number in header: e.g., "IP0319"

Strategy:
- Pre-extract only the key sections so the prompt fits within Groq's token limit.
- Target sections: POLICY STATEMENT, FDA-Approved Indications, COVERAGE CRITERIA,
  CRITERIA FOR INITIAL/CONTINUED AUTHORIZATION, DOCUMENTATION REQUIREMENTS, CODING INFORMATION.
"""

import re

from .base import build_document_text, call_llm, inject_metadata


# Section headers that delimit meaningful content blocks in Cigna documents
_SECTION_PATTERNS = [
    r"POLICY\s+STATEMENT",
    r"FDA[- ]Approved\s+Indications",
    r"COVERAGE\s+CRITERIA",
    r"CRITERIA\s+FOR\s+INITIAL\s+AUTHORIZATION",
    r"CRITERIA\s+FOR\s+CONTINUED\s+AUTHORIZATION",
    r"DOCUMENTATION\s+REQUIREMENTS",
    r"CODING\s+INFORMATION",
    r"CODING\s+GUIDELINES",
    r"BACKGROUND",
]

_SECTION_RE = re.compile(
    r"(" + "|".join(_SECTION_PATTERNS) + r")",
    re.IGNORECASE,
)

# Sections we want to keep — everything EXCEPT background/references
_KEEP_SECTIONS = {
    "POLICY STATEMENT", "FDA-APPROVED INDICATIONS", "FDA APPROVED INDICATIONS",
    "COVERAGE CRITERIA", "CRITERIA FOR INITIAL AUTHORIZATION",
    "CRITERIA FOR CONTINUED AUTHORIZATION", "DOCUMENTATION REQUIREMENTS",
    "CODING INFORMATION", "CODING GUIDELINES",
}


def _extract_key_sections(text: str, max_chars: int = 9_000) -> str:
    """
    Split the full document on section headers and return only the sections
    relevant to extraction (drops background/references). Capped at max_chars.
    """
    splits = _SECTION_RE.split(text)
    # splits alternates: [pre-header-text, header, content, header, content, ...]
    sections: list[tuple[str, str]] = []
    i = 0
    # First element is text before any header — treat as preamble (keep it short)
    preamble = splits[0][:500]
    i = 1
    while i < len(splits) - 1:
        header = splits[i].strip().upper()
        content = splits[i + 1]
        normalized = re.sub(r"\s+", " ", header)
        for keep in _KEEP_SECTIONS:
            if keep in normalized:
                sections.append((splits[i].strip(), content))
                break
        i += 2

    if not sections:
        # Fallback: no headers found — just send the raw text truncated
        return text[:max_chars]

    result_parts = [preamble]
    total = len(preamble)
    for header, content in sections:
        block = f"\n\n--- {header} ---\n{content.strip()}"
        if total + len(block) > max_chars:
            # Include as much of the last section as fits
            remaining = max_chars - total
            if remaining > 200:
                result_parts.append(block[:remaining])
            break
        result_parts.append(block)
        total += len(block)

    return "".join(result_parts)


async def extract(
    chunks: list[dict],
    source_id: str,
    artifact_version_id: str,
    payer_name: str = "Cigna",
    raw_text: str = "",
) -> list[dict]:
    doc_text = build_document_text(chunks) or raw_text

    # Extract only the key sections — keeps prompt well under Groq's 12K char limit
    key_sections = _extract_key_sections(doc_text, max_chars=9_000)

    prompt = f"""The following are the key sections extracted from a Cigna Drug Coverage Policy.

DOCUMENT STRUCTURE:
- POLICY STATEMENT: lists drug products covered (brand_names)
- FDA-APPROVED INDICATIONS: indications_covered[]
- COVERAGE CRITERIA / CRITERIA FOR INITIAL AUTHORIZATION: numbered PA criteria list
- CRITERIA FOR CONTINUED AUTHORIZATION: additional PA criteria
- CODING INFORMATION: HCPCS J-codes → hcpcs_codes[]

EXTRACTION RULES:
1. prior_auth_criteria[] = EVERY numbered item from COVERAGE CRITERIA verbatim. NEVER leave empty.
2. Coverage tier for Cigna biosimilar policies:
   - Biosimilars (e.g. Ruxience, Riabni, Truxima) → coverage_tier="preferred"
   - Reference biologic (e.g. Rituxan) → coverage_tier="non_preferred", biosimilar_step_required=true
   - ALL products → prior_auth_required=true
   - Do NOT use coverage_tier="covered_alternative"
3. Step therapy: if criteria mention "inadequate response to" or "must fail" → step_therapy_required=true
4. Extract policy_number from header (e.g. "IP0319")
5. payer_name="{payer_name}", plan_type="commercial"

KEY SECTIONS:
{key_sections}

Return a JSON array of rules. One rule per drug product if PA criteria differ; else one rule for the class.
prior_auth_criteria[] MUST be populated — extracting it is the entire point of this call.
"""

    rules, raw = await call_llm(prompt)
    return inject_metadata(rules, source_id, artifact_version_id)
