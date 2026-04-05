from __future__ import annotations
"""
Shared base utilities for all payer-specific extractors.

Provides:
- ExtractedRule JSON schema (payer-centric, medical benefit drugs)
- LLM call via Groq (Llama 3.3 70B) with Gemini as fallback
- Schema validation / normalization
"""

import json
import os
from typing import Any

import httpx

GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"


def _groq_key() -> str:
    return os.getenv("GROQ_API_KEY", "")


def _gemini_endpoint() -> str:
    key = os.getenv("GOOGLE_AI_API_KEY", "")
    return (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={key}"
    )

VALID_COVERAGE_TIERS = {"preferred", "non_preferred", "covered_alternative", "not_covered"}
VALID_ACCESS_STATUSES = {
    "preferred_exclusive", "preferred_1_of_2", "preferred_1_of_3",
    "preferred_1_of_4_plus", "non_preferred", "covered_alternative", "not_covered"
}
VALID_PLAN_TYPES = {"commercial", "medicare", "medicaid", "exchange"}

SYSTEM_INSTRUCTION = """You are a medical benefits analyst specializing in commercial payer policies
for medical benefit drugs (biologics, infusibles, injectables administered in clinical settings).
These are J-code drugs covered under the MEDICAL benefit (not pharmacy benefit).

Your job is to extract structured coverage rules from payer policy documents.
For each distinct DRUG ENTITY found in the document, produce one rule object.
One policy document often covers multiple drugs or multiple indications for the same drug.

Key domain concepts:
- HCPCS J-codes (e.g., J9035 for bevacizumab) identify drugs for billing
- Step therapy: patient must fail drug A before payer covers drug B
- Biosimilar step: branded biologic requires trying biosimilar first
- PA = Prior Authorization required before dispensing
- Coverage tier: preferred vs non_preferred vs covered_alternative vs not_covered
- Access status drives rebate economics: preferred_exclusive > preferred_1_of_2 > preferred_1_of_3

CITATION RULES (critical — violations cause automatic rejection):
- Every text_snippet MUST contain the drug name (brand OR generic) somewhere in the text.
- Copy the sentence verbatim from the document — do NOT paraphrase.
- If the only relevant sentence mentions the drug by J-code (e.g., J9035), include the J-code in the snippet.
- Provide at least one citation per rule. Prefer sentences that include both the drug name and a clinical criterion.
- Do NOT cite generic policy boilerplate (e.g., "Prior authorization is required") unless the drug name appears in the same sentence.

You MUST respond with a JSON array of rule objects. Each object must have these exact fields:
{
  "drug_name": string,
  "brand_names": string[],
  "generic_name": string,
  "hcpcs_codes": string[],
  "drug_category": string,
  "payer_name": string,
  "policy_number": string or null,
  "policy_title": string or null,
  "effective_date": string,
  "plan_type": "commercial" | "medicare" | "medicaid" | "exchange",
  "coverage_tier": "preferred" | "non_preferred" | "covered_alternative" | "not_covered",
  "access_status": "preferred_exclusive" | "preferred_1_of_2" | "preferred_1_of_3" | "preferred_1_of_4_plus" | "non_preferred" | "covered_alternative" | "not_covered",
  "peers_in_category": string[],
  "indications_covered": string[],
  "indications_not_covered": string[],
  "prior_auth_required": boolean,
  "prior_auth_criteria": string[],
  "step_therapy_required": boolean,
  "step_therapy_requirements": string[],
  "biosimilar_step_required": boolean,
  "preferred_alternatives": string[],
  "site_of_care_restrictions": string or null,
  "quantity_limits": string or null,
  "reauthorization_period": string or null,
  "citations": [{"page": int or null, "section": string or null, "url": null, "text_snippet": string}]
}"""


async def call_llm(prompt: str, system: str = SYSTEM_INSTRUCTION) -> tuple[list[dict], str]:
    """Call Groq (primary) with Gemini as fallback. Returns (parsed_rules_list, raw_response)."""
    groq_key = _groq_key()
    if groq_key:
        try:
            return await _call_groq(prompt, system)
        except Exception as e:
            print(f"    Groq failed ({e}), trying Gemini fallback...")

    if os.getenv("GOOGLE_AI_API_KEY"):
        return await _call_gemini(prompt, system)

    raise RuntimeError("No LLM API keys configured (GROQ_API_KEY or GOOGLE_AI_API_KEY)")


async def _call_groq(prompt: str, system: str) -> tuple[list[dict], str]:
    """Call Groq Llama 3.3 70B with JSON mode.
    Groq free tier: 6,000 TPM. Keep total tokens under ~5,000.
    System (~400) + doc (~3,000) + response (~1,500) = ~4,900 tokens.
    Retries once after 65s on 429 (TPM window resets each minute).
    """
    import asyncio as _asyncio
    # ~3,000 tokens for the document text (4 chars/token approx)
    MAX_CHARS = 12_000
    if len(prompt) > MAX_CHARS:
        prompt = prompt[:MAX_CHARS] + "\n\n[Document truncated. Extract rules from the text shown above.]"

    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "max_tokens": 2048,
    }

    for attempt in range(3):
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                GROQ_ENDPOINT,
                headers={"Authorization": f"Bearer {_groq_key()}"},
                json=payload,
            )
        if resp.status_code == 429:
            wait = 65 * (attempt + 1)
            print(f"    Groq 429 — waiting {wait}s for TPM window to reset...")
            await _asyncio.sleep(wait)
            continue
        resp.raise_for_status()
        break
    else:
        raise RuntimeError("Groq 429 after 3 retries")

    raw = resp.json()["choices"][0]["message"]["content"]
    parsed = _parse_llm_json(raw)
    return parsed, raw


async def _call_gemini(prompt: str, system: str) -> tuple[list[dict], str]:
    """Call Gemini 2.0 Flash with JSON mode (fallback). Retries up to 3x on 429."""
    import asyncio as _asyncio

    MAX_CHARS = 400_000
    if len(prompt) > MAX_CHARS:
        prompt = prompt[:MAX_CHARS] + "\n\n[Document truncated. Extract rules from the text above.]"

    for attempt in range(3):
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                _gemini_endpoint(),
                json={
                    "system_instruction": {"parts": [{"text": system}]},
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "responseSchema": RULES_ARRAY_SCHEMA,
                        "temperature": 0.1,
                        "maxOutputTokens": 8192,
                    },
                },
            )
        if resp.status_code == 429:
            wait = 65 * (attempt + 1)
            print(f"    Gemini 429 — waiting {wait}s before retry {attempt + 1}/3...")
            await _asyncio.sleep(wait)
            continue
        resp.raise_for_status()
        break
    else:
        raise RuntimeError("Gemini 429 after 3 retries")

    data = resp.json()
    raw = data["candidates"][0]["content"]["parts"][0]["text"]
    parsed = _parse_llm_json(raw)
    return parsed, raw


def _parse_llm_json(raw: str) -> list[dict]:
    """Parse LLM JSON output — handles array or {rules: [...]} wrapper."""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Try to extract JSON array from markdown code block
        import re
        match = re.search(r'\[.*\]', raw, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
            except Exception:
                return []
        else:
            return []

    # Groq with json_object mode may wrap in {"rules": [...]} or similar
    if isinstance(parsed, dict):
        for key in ("rules", "results", "data", "policies", "extractions"):
            if key in parsed and isinstance(parsed[key], list):
                return parsed[key]
        # Single rule object
        return [parsed]

    if isinstance(parsed, list):
        return parsed

    return []


# Keep backward-compatible alias
async def call_gemini(prompt: str, system: str = SYSTEM_INSTRUCTION) -> tuple[list[dict], str]:
    return await call_llm(prompt, system)


def validate_rule(rule: dict) -> dict:
    """Enforce enum constraints and fill defaults so DB insert never fails."""
    if rule.get("coverage_tier") not in VALID_COVERAGE_TIERS:
        rule["coverage_tier"] = "non_preferred"
    if rule.get("access_status") not in VALID_ACCESS_STATUSES:
        # Derive from coverage_tier
        tier = rule.get("coverage_tier", "non_preferred")
        rule["access_status"] = {
            "preferred": "preferred_1_of_2",
            "non_preferred": "non_preferred",
            "covered_alternative": "covered_alternative",
            "not_covered": "not_covered",
        }.get(tier, "non_preferred")
    if rule.get("plan_type") not in VALID_PLAN_TYPES:
        rule["plan_type"] = "commercial"
    if not rule.get("effective_date"):
        rule["effective_date"] = "2026-01-01"
    if not rule.get("drug_name"):
        rule["drug_name"] = "Unknown"
    if not rule.get("generic_name"):
        rule["generic_name"] = rule.get("drug_name", "Unknown").lower()
    return rule


def build_document_text(chunks: list[dict]) -> str:
    """Reconstruct readable document from pipeline chunks (deduped by section)."""
    seen: set[str] = set()
    parts: list[str] = []
    for chunk in chunks:
        key = (chunk.get("section_title") or "") + (chunk.get("parent_text", "")[:50])
        if key not in seen:
            seen.add(key)
            title = chunk.get("section_title") or "Section"
            page = f" (p.{chunk['page_number']})" if chunk.get("page_number") else ""
            parts.append(f"## {title}{page}\n{chunk.get('parent_text', chunk.get('leaf_text', ''))}")
    return "\n\n".join(parts)


def _filter_citations(rule: dict) -> dict:
    """Drop citation snippets that don't mention the drug name — prevents faithfulness failures."""
    drug = rule.get("drug_name", "").lower()
    generic = rule.get("generic_name", "").lower()
    brands = [b.lower() for b in rule.get("brand_names", [])]
    hcpcs = [h.lower() for h in rule.get("hcpcs_codes", [])]

    all_names = [n for n in [drug, generic] + brands + hcpcs if n]
    if not all_names:
        return rule  # can't filter without a name to check

    kept = []
    dropped = 0
    for citation in rule.get("citations", []):
        snippet = citation.get("text_snippet", "").lower()
        if any(name in snippet for name in all_names):
            kept.append(citation)
        else:
            dropped += 1

    if dropped:
        print(f"    [inject_metadata] Dropped {dropped} citation(s) for '{drug}' — drug name not in snippet")

    # If all citations were dropped, keep the original set (better than empty citations failing schema)
    rule["citations"] = kept if kept else rule.get("citations", [])
    return rule


def inject_metadata(rules: list[dict], source_id: str, artifact_version_id: str) -> list[dict]:
    """Validate schema and inject source metadata on every rule."""
    result = []
    for rule in rules:
        rule = validate_rule(rule)
        rule["source_id"] = source_id
        rule["artifact_version_id"] = artifact_version_id
        for field in ["brand_names", "hcpcs_codes", "peers_in_category",
                      "indications_covered", "indications_not_covered",
                      "prior_auth_criteria", "step_therapy_requirements",
                      "preferred_alternatives", "citations"]:
            if not isinstance(rule.get(field), list):
                rule[field] = []
        for field in ["prior_auth_required", "step_therapy_required", "biosimilar_step_required"]:
            if not isinstance(rule.get(field), bool):
                rule[field] = False
        for field in ["policy_number", "policy_title", "site_of_care_restrictions",
                      "quantity_limits", "reauthorization_period"]:
            if field not in rule:
                rule[field] = None
        rule["change_summary"] = None
        # Filter out citations whose snippets don't mention the drug name
        rule = _filter_citations(rule)
        result.append(rule)
    return result


# Full schema for Gemini responseSchema enforcement
EXTRACTED_RULE_SCHEMA = {
    "type": "object",
    "properties": {
        "drug_name":                 {"type": "string"},
        "brand_names":               {"type": "array", "items": {"type": "string"}},
        "generic_name":              {"type": "string"},
        "hcpcs_codes":               {"type": "array", "items": {"type": "string"}},
        "drug_category":             {"type": "string"},
        "payer_name":                {"type": "string"},
        "policy_number":             {"type": "string", "nullable": True},
        "policy_title":              {"type": "string", "nullable": True},
        "effective_date":            {"type": "string"},
        "plan_type":                 {"type": "string", "enum": ["commercial", "medicare", "medicaid", "exchange"]},
        "coverage_tier":             {"type": "string", "enum": ["preferred", "non_preferred", "covered_alternative", "not_covered"]},
        "access_status":             {"type": "string", "enum": ["preferred_exclusive", "preferred_1_of_2", "preferred_1_of_3", "preferred_1_of_4_plus", "non_preferred", "covered_alternative", "not_covered"]},
        "peers_in_category":         {"type": "array", "items": {"type": "string"}},
        "indications_covered":       {"type": "array", "items": {"type": "string"}},
        "indications_not_covered":   {"type": "array", "items": {"type": "string"}},
        "prior_auth_required":       {"type": "boolean"},
        "prior_auth_criteria":       {"type": "array", "items": {"type": "string"}},
        "step_therapy_required":     {"type": "boolean"},
        "step_therapy_requirements": {"type": "array", "items": {"type": "string"}},
        "biosimilar_step_required":  {"type": "boolean"},
        "preferred_alternatives":    {"type": "array", "items": {"type": "string"}},
        "site_of_care_restrictions": {"type": "string", "nullable": True},
        "quantity_limits":           {"type": "string", "nullable": True},
        "reauthorization_period":    {"type": "string", "nullable": True},
        "citations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "page":         {"type": "integer", "nullable": True},
                    "section":      {"type": "string", "nullable": True},
                    "url":          {"type": "string", "nullable": True},
                    "text_snippet": {"type": "string"},
                },
                "required": ["text_snippet"],
            },
        },
        "source_id":           {"type": "string"},
        "artifact_version_id": {"type": "string"},
    },
}
RULES_ARRAY_SCHEMA = {"type": "array", "items": EXTRACTED_RULE_SCHEMA}
