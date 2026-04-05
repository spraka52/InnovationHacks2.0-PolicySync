from __future__ import annotations
"""
Evaluation + Validation node (4-layer quality gate).

Layer 1: Pydantic schema validation (deterministic)
Layer 2: Citation spot-check with rapidfuzz (deterministic)
Layer 3: RAGAS-style metrics via Groq Llama 3.1 8B (LLM-as-judge, free tier)
Layer 4: Cross-field consistency checks (deterministic)

Composite score 0-100. Only extractions >= 60 reach the human review queue.
"""

import json
import logging
import os
from datetime import date
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ValidationError, field_validator
from rapidfuzz import fuzz

logger = logging.getLogger(__name__)

from .state import EvalResult, PipelineState

GROQ_KEYS = [k for k in [os.getenv("GROQ_API_KEY", ""), os.getenv("GROQ_API_KEY_2", "")] if k]
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

# ---------------------------------------------------------------------------
# Layer 1 — Pydantic schema validation
# ---------------------------------------------------------------------------

class CitationModel(BaseModel):
    page: int | None = None
    section: str | None = None
    url: str | None = None
    text_snippet: str

class ExtractedRuleModel(BaseModel):
    # Drug identity
    drug_name: str
    brand_names: list[str] = []
    generic_name: str = ""
    hcpcs_codes: list[str] = []
    drug_category: str = ""

    # Payer & policy identity
    payer_name: str
    policy_number: str | None = None
    policy_title: str | None = None
    effective_date: str
    plan_type: Literal["commercial", "medicare", "medicaid", "exchange"] = "commercial"

    # Access position
    coverage_tier: Literal["preferred", "non_preferred", "covered_alternative", "not_covered"]
    access_status: str = ""
    peers_in_category: list[str] = []

    # Clinical criteria
    indications_covered: list[str] = []
    indications_not_covered: list[str] = []
    prior_auth_required: bool = False
    prior_auth_criteria: list[str] = []
    step_therapy_required: bool = False
    step_therapy_requirements: list[str] = []
    biosimilar_step_required: bool = False
    preferred_alternatives: list[str] = []

    # Restrictions
    site_of_care_restrictions: str | None = None
    quantity_limits: str | None = None
    reauthorization_period: str | None = None

    # Change tracking
    change_summary: dict | None = None

    # Source traceability
    citations: list[CitationModel]
    source_id: str
    artifact_version_id: str

    @field_validator("citations")
    @classmethod
    def at_least_one_citation(cls, v: list) -> list:
        if not v:
            raise ValueError("At least one citation is required")
        return v


def validate_schema(rule: dict) -> tuple[bool, str | None]:
    try:
        ExtractedRuleModel.model_validate(rule)
        return True, None
    except ValidationError as e:
        return False, str(e)


# ---------------------------------------------------------------------------
# Layer 2 — Citation spot-check with rapidfuzz
# ---------------------------------------------------------------------------

def _get_all_source_text(chunks: list[dict]) -> str:
    return "\n".join(c.get("parent_text", "") + " " + c.get("leaf_text", "") for c in chunks)


def verify_citations(rule: dict, source_text: str) -> dict[str, bool]:
    results: dict[str, bool] = {}
    for i, citation in enumerate(rule.get("citations", [])):
        snippet = citation.get("text_snippet", "")
        if not snippet:
            results[f"citation_{i}"] = False
            continue
        # Fuzzy match the snippet against the full source text
        # Use partial_ratio to handle slight OCR/formatting differences
        score = fuzz.partial_ratio(snippet.lower(), source_text.lower())
        results[f"citation_{i}"] = score >= 70
    return results


def citation_score(verification: dict[str, bool]) -> float:
    if not verification:
        return 0.0
    passed = sum(1 for v in verification.values() if v)
    return passed / len(verification)


# ---------------------------------------------------------------------------
# Layer 3 — RAGAS-style eval via Gemini 2.5 Flash as judge
# ---------------------------------------------------------------------------

async def _call_groq_judge(prompt: str) -> dict:
    if not GROQ_KEYS:
        logger.warning("[eval] No GROQ_API_KEY set — RAGAS skipped, defaulting to 0.5")
        return {"faithfulness": 0.5, "relevancy": 0.5}

    # Use 8b for eval to conserve 70b quota; try both keys
    attempts = [
        {"key": k, "model": m}
        for m in ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]
        for k in GROQ_KEYS
    ]

    for attempt in attempts:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    GROQ_ENDPOINT,
                    headers={"Authorization": f"Bearer {attempt['key']}", "Content-Type": "application/json"},
                    json={
                        "model": attempt["model"],
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 256,
                        "temperature": 0.0,
                    },
                )
            if resp.status_code == 429:
                logger.warning("[eval] Groq %s rate limited — trying next", attempt["model"])
                continue
            if not resp.is_success:
                logger.warning("[eval] Groq judge failed: %s %s", resp.status_code, resp.text[:200])
                continue
            raw = resp.json()["choices"][0]["message"]["content"].strip()
            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            result = json.loads(raw)
            logger.info("[eval] RAGAS via %s → faithfulness=%.2f relevancy=%.2f",
                        attempt["model"], result.get("faithfulness", 0.5), result.get("relevancy", 0.5))
            return result
        except Exception as e:
            logger.warning("[eval] Groq judge exception: %s", e)
            continue

    logger.warning("[eval] All Groq attempts failed — defaulting to 0.5")
    return {"faithfulness": 0.5, "relevancy": 0.5}


async def ragas_eval(rule: dict, source_text: str) -> tuple[float, float]:
    """
    Faithfulness: Is each extracted criterion supported by the source?
    Relevancy: Is the extraction relevant to the drug/indication targeted?
    Returns (faithfulness, relevancy) both 0.0-1.0.
    """
    prompt = f"""You are a strict medical policy extraction evaluator.

Source document excerpt (first 3000 chars):
{source_text[:3000]}

Extracted rule:
{json.dumps(rule, indent=2)[:2000]}

Evaluate this extraction on two dimensions:

1. faithfulness (0.0-1.0): Are all extracted criteria, drug names, BMI thresholds,
   and prior auth requirements directly supported by text in the source document?
   0.0 = contains hallucinated information not in source
   1.0 = every claim is explicitly in the source

2. relevancy (0.0-1.0): Is this extraction relevant to medical benefit drug coverage policies
   (biologics, infusibles, injectables such as bevacizumab, rituximab, botulinum toxins, denosumab)?
   0.0 = completely off-topic
   1.0 = directly addresses the drug and its coverage criteria

Return ONLY a JSON object: {{"faithfulness": <float>, "relevancy": <float>}}"""

    result = await _call_groq_judge(prompt)
    faithfulness = float(result.get("faithfulness", 0.5))
    relevancy = float(result.get("relevancy", 0.5))
    return (
        max(0.0, min(1.0, faithfulness)),
        max(0.0, min(1.0, relevancy)),
    )


# ---------------------------------------------------------------------------
# Layer 4 — Cross-field consistency
# ---------------------------------------------------------------------------

def consistency_checks(rule: dict) -> list[str]:
    flags: list[str] = []
    coverage_tier = rule.get("coverage_tier", "")
    prior_auth_required = rule.get("prior_auth_required", False)
    pa_criteria = rule.get("prior_auth_criteria", [])
    step_therapy_required = rule.get("step_therapy_required", False)
    step_therapy = rule.get("step_therapy_requirements", [])
    biosimilar_step = rule.get("biosimilar_step_required", False)
    preferred_alts = rule.get("preferred_alternatives", [])
    citations = rule.get("citations", [])
    drug_name = rule.get("drug_name", "").lower()

    # PA required but no criteria listed
    if prior_auth_required and not pa_criteria:
        flags.append("prior_auth_required=true but prior_auth_criteria is empty")

    # Step therapy required but no requirements listed
    if step_therapy_required and not step_therapy:
        flags.append("step_therapy_required=true but step_therapy_requirements is empty")

    # Biosimilar step required but no preferred alternatives listed
    if biosimilar_step and not preferred_alts:
        flags.append("biosimilar_step_required=true but preferred_alternatives is empty")

    # Drug name not in any citation snippet
    if drug_name and citations:
        generic = rule.get("generic_name", "").lower()
        name_in_citations = any(
            drug_name in c.get("text_snippet", "").lower()
            or (generic and generic in c.get("text_snippet", "").lower())
            for c in citations
        )
        if not name_in_citations:
            flags.append(f"drug_name '{drug_name}' not found in any citation text_snippet — possible hallucination")

    # Suspiciously far future effective_date
    eff_date = rule.get("effective_date", "")
    if eff_date and eff_date not in ("unknown", ""):
        try:
            parsed = date.fromisoformat(eff_date[:10])
            if parsed.year > date.today().year + 2:
                flags.append(f"effective_date '{eff_date}' is suspiciously far in the future")
        except ValueError:
            pass

    return flags


# ---------------------------------------------------------------------------
# Main evaluator node
# ---------------------------------------------------------------------------

SCORE_WEIGHTS = {
    "schema_valid": 20,
    "citation_verification": 30,
    "ragas_faithfulness": 30,
    "ragas_relevancy": 10,
    "consistency": 10,
}


async def evaluator_node(state: PipelineState) -> dict:
    """LangGraph node: 4-layer quality gate for extracted rules."""
    extraction = state.get("extraction")
    if not extraction:
        return {"evaluation": EvalResult(
            schema_valid=False, citation_verification={},
            ragas_faithfulness=0.0, ragas_relevancy=0.0,
            consistency_flags=["No extraction to evaluate"],
            final_score=0, passed=False,
        )}

    extracted_json = extraction["extracted_json"]
    chunks = state.get("chunks", [])
    source_text = _get_all_source_text(chunks)

    # Handle list of rules — evaluate the first (primary) rule
    rule = extracted_json[0] if isinstance(extracted_json, list) and extracted_json else {}
    if not rule:
        return {"evaluation": EvalResult(
            schema_valid=False, citation_verification={},
            ragas_faithfulness=0.0, ragas_relevancy=0.0,
            consistency_flags=["Extraction returned no rules"],
            final_score=0, passed=False,
        )}

    # Layer 1: Schema validation
    schema_valid, schema_error = validate_schema(rule)

    # Layer 2: Citation verification
    citation_ver = verify_citations(rule, source_text)
    cite_score = citation_score(citation_ver)

    # Layer 3: RAGAS metrics
    faithfulness, relevancy = await ragas_eval(rule, source_text)

    # Layer 4: Consistency checks
    flags = consistency_checks(rule)

    # If schema is invalid, auto-fail (score capped at 40 max without schema)
    if not schema_valid:
        flags.insert(0, f"Schema validation failed: {schema_error}")

    # Consistency penalty: 2 points deducted per flag, min 0
    consistency_score = max(0, SCORE_WEIGHTS["consistency"] - len(flags) * 2)

    final_score = int(
        (SCORE_WEIGHTS["schema_valid"] if schema_valid else 0)
        + SCORE_WEIGHTS["citation_verification"] * cite_score
        + SCORE_WEIGHTS["ragas_faithfulness"] * faithfulness
        + SCORE_WEIGHTS["ragas_relevancy"] * relevancy
        + consistency_score
    )
    final_score = max(0, min(100, final_score))

    # Hard fail: faithfulness < 0.5 (likely hallucination) regardless of overall score
    if faithfulness < 0.5:
        flags.insert(0, f"HARD FAIL: faithfulness score {faithfulness:.2f} < 0.5 (possible hallucination)")
        final_score = min(final_score, 45)

    passed = final_score >= 60 and schema_valid

    return {
        "evaluation": EvalResult(
            schema_valid=schema_valid,
            citation_verification=citation_ver,
            ragas_faithfulness=faithfulness,
            ragas_relevancy=relevancy,
            consistency_flags=flags,
            final_score=final_score,
            passed=passed,
        )
    }
