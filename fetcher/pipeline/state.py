from __future__ import annotations
"""LangGraph state schema for the RxMonitor pipeline."""

from typing import Any, TypedDict


class Chunk(TypedDict):
    section_title: str | None
    page_number: int | None
    leaf_text: str
    parent_text: str
    contextual_summary: str | None
    embedding: list[float] | None


class ExtractionResult(TypedDict):
    extracted_json: dict[str, Any]
    raw_response: str


class EvalResult(TypedDict):
    schema_valid: bool
    citation_verification: dict[str, bool]
    ragas_faithfulness: float
    ragas_relevancy: float
    consistency_flags: list[str]
    final_score: int
    passed: bool


class PipelineState(TypedDict):
    # Input
    source_id: str
    user_id: str | None         # Who triggered the run (for audit log)

    # Payer-specific routing
    payer_format: str           # One of PayerFormat literals (from sources.payer_format)
    payer_name: str             # Human-readable payer name for extraction prompts

    # Fetch result (set by fetch_check API route before calling pipeline)
    artifact_version_id: str
    fetch_result: dict[str, Any]   # FetchResult from FastAPI service

    # Chunks (after chunker node)
    chunks: list[Chunk]

    # Extraction
    extraction: ExtractionResult | None

    # Evaluation
    evaluation: EvalResult | None

    # Draft ID written to DB after eval passes
    draft_id: str | None

    # Error tracking
    errors: list[str]
