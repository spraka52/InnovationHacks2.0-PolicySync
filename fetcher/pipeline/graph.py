"""
LangGraph StateGraph definition for the PolicySync pipeline.

Graph flow:
  chunker → embedder → [route_by_payer_format] → payer-specific extractor → evaluator
  evaluator → [route_after_eval] → persist_draft | reject_draft

Priority Health bypasses LLM extraction (pure table parse — no chunker/embedder needed).
The graph routes after chunker for Priority Health.

Payer-specific extractor nodes:
  - uhc_extractor         (uhc_narrative, upmc_narrative)
  - cigna_extractor       (cigna_narrative)
  - bcbs_nc_extractor     (bcbs_nc_multi_drug)
  - florida_blue_extractor (florida_blue_mcg)
  - priority_health_extractor (priority_health_mdl — no LLM, pure table parse)
  - emblemhealth_extractor (emblemhealth_docx)
"""

import os

from langgraph.graph import END, StateGraph

from supabase import create_client

from .chunker import chunker_node
from .embedder import embedder_node
from .evaluator import evaluator_node
from .extractors import EXTRACTOR_REGISTRY
from .state import ExtractionResult, PipelineState

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


# ---------------------------------------------------------------------------
# Payer-specific extractor nodes (wrappers that call the extractors registry)
# ---------------------------------------------------------------------------

async def _run_payer_extractor(state: PipelineState, payer_format: str) -> dict:
    """Generic wrapper: call the correct payer extractor based on format."""
    extractor_fn = EXTRACTOR_REGISTRY.get(payer_format)
    if extractor_fn is None:
        # Fallback to UHC narrative extractor for unknown formats
        extractor_fn = EXTRACTOR_REGISTRY["uhc_narrative"]

    rules = await extractor_fn(
        chunks=state["chunks"],
        source_id=state["source_id"],
        artifact_version_id=state["artifact_version_id"],
        payer_name=state.get("payer_name", "Unknown Payer"),
        raw_text=state.get("fetch_result", {}).get("text", ""),
    )

    return {
        "extraction": ExtractionResult(
            extracted_json=rules,
            raw_response="",
        )
    }


async def uhc_extractor_node(state: PipelineState) -> dict:
    return await _run_payer_extractor(state, "uhc_narrative")


async def cigna_extractor_node(state: PipelineState) -> dict:
    return await _run_payer_extractor(state, "cigna_narrative")


async def bcbs_nc_extractor_node(state: PipelineState) -> dict:
    return await _run_payer_extractor(state, "bcbs_nc_multi_drug")


async def florida_blue_extractor_node(state: PipelineState) -> dict:
    return await _run_payer_extractor(state, "florida_blue_mcg")


async def priority_health_extractor_node(state: PipelineState) -> dict:
    """Priority Health: pure table parse, no LLM. Skips chunker/embedder output."""
    extractor_fn = EXTRACTOR_REGISTRY["priority_health_mdl"]

    # Priority Health provides pre-parsed table_rows from main.py fetch result
    table_rows = state.get("fetch_result", {}).get("table_rows")

    rules = await extractor_fn(
        chunks=state["chunks"],
        source_id=state["source_id"],
        artifact_version_id=state["artifact_version_id"],
        payer_name=state.get("payer_name", "Priority Health"),
        raw_text=state.get("fetch_result", {}).get("text", ""),
        table_rows=table_rows,
    )

    return {
        "extraction": ExtractionResult(
            extracted_json=rules,
            raw_response="",
        )
    }


async def emblemhealth_extractor_node(state: PipelineState) -> dict:
    return await _run_payer_extractor(state, "emblemhealth_docx")


# ---------------------------------------------------------------------------
# Routing functions
# ---------------------------------------------------------------------------

def route_by_payer_format(state: PipelineState) -> str:
    """Conditional edge: dispatch to payer-specific extractor after embedder."""
    payer_format = state.get("payer_format", "uhc_narrative")
    route_map = {
        "uhc_narrative":       "uhc_extractor",
        "upmc_narrative":      "uhc_extractor",
        "cigna_narrative":     "cigna_extractor",
        "bcbs_nc_multi_drug":  "bcbs_nc_extractor",
        "florida_blue_mcg":    "florida_blue_extractor",
        "priority_health_mdl": "priority_health_extractor",
        "emblemhealth_docx":   "emblemhealth_extractor",
    }
    return route_map.get(payer_format, "uhc_extractor")


def route_after_eval(state: PipelineState) -> str:
    """Conditional edge: pass or fail based on evaluation result."""
    evaluation = state.get("evaluation")
    if evaluation and evaluation["passed"]:
        return "persist_draft"
    return "reject_draft"


# ---------------------------------------------------------------------------
# Persist nodes
# ---------------------------------------------------------------------------

async def persist_draft_node(state: PipelineState) -> dict:
    """Write passed extraction to draft_extractions with status=pending_review."""
    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    extraction = state["extraction"]
    evaluation = state["evaluation"]

    rule_list = extraction["extracted_json"]
    result = db.table("draft_extractions").insert({
        "artifact_version_id": state["artifact_version_id"],
        "extracted_json": rule_list if isinstance(rule_list, list) else [rule_list],
        "status": "pending_review",
        "eval_score": evaluation["final_score"],
        "eval_flags": evaluation["consistency_flags"],
        "ragas_metrics": {
            "faithfulness": evaluation["ragas_faithfulness"],
            "relevancy": evaluation["ragas_relevancy"],
        },
        "citation_verification": evaluation["citation_verification"],
    }).execute()

    draft_id = result.data[0]["id"] if result.data else None

    db.table("audit_events").insert({
        "action": "draft_created",
        "user_id": state.get("user_id"),
        "entity_type": "draft_extraction",
        "entity_id": draft_id or "unknown",
        "metadata": {
            "source_id": state["source_id"],
            "payer_format": state.get("payer_format"),
            "eval_score": evaluation["final_score"],
            "rule_count": len(rule_list) if isinstance(rule_list, list) else 1,
        },
    }).execute()

    # Update source.policy_count
    db.table("sources").update({
        "policy_count": len(rule_list) if isinstance(rule_list, list) else 1,
        "last_fetched_at": "now()",
    }).eq("id", state["source_id"]).execute()

    return {"draft_id": draft_id}


async def reject_draft_node(state: PipelineState) -> dict:
    """Write failed extraction to draft_extractions with status=eval_failed."""
    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    extraction = state.get("extraction")
    evaluation = state.get("evaluation")

    rule_list = extraction["extracted_json"] if extraction else []

    result = db.table("draft_extractions").insert({
        "artifact_version_id": state["artifact_version_id"],
        "extracted_json": rule_list if isinstance(rule_list, list) else [rule_list],
        "status": "eval_failed",
        "eval_score": evaluation["final_score"] if evaluation else 0,
        "eval_flags": evaluation["consistency_flags"] if evaluation else ["Eval not run"],
        "ragas_metrics": {
            "faithfulness": evaluation["ragas_faithfulness"] if evaluation else 0,
            "relevancy": evaluation["ragas_relevancy"] if evaluation else 0,
        } if evaluation else None,
        "rejection_reason": "Automatic rejection: eval score below threshold",
    }).execute()

    draft_id = result.data[0]["id"] if result.data else None

    db.table("audit_events").insert({
        "action": "eval_failed",
        "user_id": state.get("user_id"),
        "entity_type": "draft_extraction",
        "entity_id": draft_id or "unknown",
        "metadata": {
            "source_id": state["source_id"],
            "payer_format": state.get("payer_format"),
            "eval_score": evaluation["final_score"] if evaluation else 0,
            "flags": evaluation["consistency_flags"] if evaluation else [],
        },
    }).execute()

    return {"draft_id": draft_id, "errors": state.get("errors", []) + ["Eval failed — draft auto-rejected"]}


# ---------------------------------------------------------------------------
# Build the graph
# ---------------------------------------------------------------------------

def build_pipeline() -> StateGraph:
    builder = StateGraph(PipelineState)

    # Processing nodes
    builder.add_node("chunker", chunker_node)
    builder.add_node("embedder", embedder_node)

    # Payer-specific extractor nodes
    builder.add_node("uhc_extractor", uhc_extractor_node)
    builder.add_node("cigna_extractor", cigna_extractor_node)
    builder.add_node("bcbs_nc_extractor", bcbs_nc_extractor_node)
    builder.add_node("florida_blue_extractor", florida_blue_extractor_node)
    builder.add_node("priority_health_extractor", priority_health_extractor_node)
    builder.add_node("emblemhealth_extractor", emblemhealth_extractor_node)

    # Evaluation and persistence nodes
    builder.add_node("evaluator", evaluator_node)
    builder.add_node("persist_draft", persist_draft_node)
    builder.add_node("reject_draft", reject_draft_node)

    # Entry: chunker → embedder → route by payer format
    builder.set_entry_point("chunker")
    builder.add_edge("chunker", "embedder")

    # After embedder: conditional dispatch to payer-specific extractor
    builder.add_conditional_edges(
        "embedder",
        route_by_payer_format,
        {
            "uhc_extractor":          "uhc_extractor",
            "cigna_extractor":        "cigna_extractor",
            "bcbs_nc_extractor":      "bcbs_nc_extractor",
            "florida_blue_extractor": "florida_blue_extractor",
            "priority_health_extractor": "priority_health_extractor",
            "emblemhealth_extractor": "emblemhealth_extractor",
        },
    )

    # All extractors → evaluator
    for extractor_node_name in [
        "uhc_extractor", "cigna_extractor", "bcbs_nc_extractor",
        "florida_blue_extractor", "priority_health_extractor", "emblemhealth_extractor",
    ]:
        builder.add_edge(extractor_node_name, "evaluator")

    # Evaluator → conditional persist or reject
    builder.add_conditional_edges(
        "evaluator",
        route_after_eval,
        {"persist_draft": "persist_draft", "reject_draft": "reject_draft"},
    )
    builder.add_edge("persist_draft", END)
    builder.add_edge("reject_draft", END)

    return builder.compile()


# Singleton graph instance
pipeline_graph = build_pipeline()
