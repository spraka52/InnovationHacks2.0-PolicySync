from __future__ import annotations
"""
Extractor node: structured JSON extraction using Gemini 2.5 Flash.

Uses:
- 1M token context window (entire document fits without chunking in most cases)
- Native JSON output mode (response_mime_type: application/json)
- Per-plan-type extraction prompts for precise schema adherence
- Falls back to RAG-retrieved parent sections for very long documents
"""

import json
import os
from typing import Any

import httpx

from .state import ExtractionResult, PipelineState

GOOGLE_AI_KEY = os.getenv("GOOGLE_AI_API_KEY", "")
GEMINI_ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"gemini-2.5-flash:generateContent?key={GOOGLE_AI_KEY}"
)

EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "drug_name": {"type": "string"},
        "drug_class": {"type": "string"},
        "indication": {"type": "string"},
        "coverage_status": {
            "type": "string",
            "enum": ["covered", "not_covered", "pa_required", "step_therapy"]
        },
        "prior_auth_criteria": {"type": "array", "items": {"type": "string"}},
        "quantity_limits": {"type": ["string", "null"]},
        "step_therapy_requirements": {"type": "array", "items": {"type": "string"}},
        "effective_date": {"type": "string"},
        "citations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "page": {"type": ["integer", "null"]},
                    "section": {"type": ["string", "null"]},
                    "url": {"type": ["string", "null"]},
                    "text_snippet": {"type": "string"}
                },
                "required": ["text_snippet"]
            }
        },
        "plan_type": {
            "type": "string",
            "enum": ["employer", "medicaid", "marketplace", "medicare", "va_tricare"]
        },
        "state": {"type": ["string", "null"]},
        "source_id": {"type": "string"},
        "artifact_version_id": {"type": "string"}
    },
    "required": [
        "drug_name", "drug_class", "indication", "coverage_status",
        "prior_auth_criteria", "effective_date", "citations",
        "plan_type", "source_id", "artifact_version_id"
    ]
}

PLAN_TYPE_CONTEXT = {
    "medicare": (
        "This is a CMS Medicare Coverage Database document (NCD or LCD). "
        "Focus on: coverage indications, medical necessity criteria, "
        "beneficiary qualifications, and ICD-10 codes required."
    ),
    "medicaid": (
        "This is a state Medicaid Preferred Drug List (PDL) or formulary. "
        "Focus on: formulary tier, preferred/non-preferred status, "
        "prior authorization requirements, step therapy, and quantity limits."
    ),
    "employer": (
        "This is a commercial/employer health plan medical policy document. "
        "Focus on: medical necessity criteria, clinical criteria for approval, "
        "documentation requirements, and PA criteria."
    ),
    "marketplace": (
        "This is an ACA Marketplace (exchange) plan formulary. "
        "Focus on: formulary tier placement, cost-sharing requirements, "
        "PA requirements, and step therapy protocols."
    ),
    "va_tricare": (
        "This is a VA National Formulary or TRICARE formulary document. "
        "Focus on: formulary status, restriction codes, PA requirements, "
        "and special authorization criteria."
    ),
}


def _build_prompt(
    document_text: str,
    plan_type: str,
    state: str | None,
    source_id: str,
    artifact_version_id: str,
    drug_focus: str = "GLP-1 agonists (semaglutide, tirzepatide, liraglutide) for obesity/weight management",
) -> str:
    plan_context = PLAN_TYPE_CONTEXT.get(plan_type, "")
    state_str = f"State: {state}" if state else "National source"

    return f"""You are a medical benefits analyst extracting structured drug coverage rules from health plan policy documents.

Source context: {plan_context}
{state_str}
Drug focus: {drug_focus}

Document text:
{document_text[:900000]}

Extract ALL coverage rules related to "{drug_focus}" from this document.
For each distinct drug/indication combination found, extract one complete rule object.
If multiple drugs are covered, return an array of rules.

IMPORTANT:
- For every extracted criterion, provide a citation with the exact text_snippet from the document
- If a page number is mentioned or inferable, include it
- If a section heading is present, include it
- coverage_status must be one of: covered, not_covered, pa_required, step_therapy
- effective_date: use the document's effective/revision date if found, else use "unknown"
- state: use "{state or 'null'}" (null for national sources)
- source_id: "{source_id}"
- artifact_version_id: "{artifact_version_id}"

Return a JSON array of rule objects, each matching the schema exactly.
If no relevant rules found, return an empty array [].
"""


async def extractor_node(state: PipelineState) -> dict:
    """LangGraph node: extract structured rules from artifact using Gemini 2.5 Flash."""
    fetch_result = state["fetch_result"]
    chunks = state["chunks"]
    artifact_version_id = state["artifact_version_id"]
    source_id = state["source_id"]

    plan_type = fetch_result.get("plan_type", "employer")
    source_state = fetch_result.get("state")

    # Build full document text from parent sections (deduplicated)
    seen_parents: set[str] = set()
    doc_parts: list[str] = []
    for chunk in chunks:
        key = chunk["section_title"] or chunk["parent_text"][:50]
        if key not in seen_parents:
            seen_parents.add(key)
            title = chunk["section_title"] or ""
            page = f" (p.{chunk['page_number']})" if chunk["page_number"] else ""
            doc_parts.append(f"## {title}{page}\n{chunk['parent_text']}")

    document_text = "\n\n".join(doc_parts)

    prompt = _build_prompt(
        document_text=document_text,
        plan_type=plan_type,
        state=source_state,
        source_id=source_id,
        artifact_version_id=artifact_version_id,
    )

    extracted_json, raw_response = await _call_gemini(prompt)

    return {
        "extraction": ExtractionResult(
            extracted_json=extracted_json,
            raw_response=raw_response,
        )
    }


async def _call_gemini(prompt: str) -> tuple[Any, str]:
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            GEMINI_ENDPOINT,
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": 0.1,
                    "maxOutputTokens": 8192,
                },
            },
        )
        resp.raise_for_status()
        data = resp.json()

    raw = data["candidates"][0]["content"]["parts"][0]["text"]

    try:
        parsed = json.loads(raw)
        # Normalize: always return a list
        if isinstance(parsed, dict):
            parsed = [parsed]
        return parsed, raw
    except json.JSONDecodeError:
        return [], raw
