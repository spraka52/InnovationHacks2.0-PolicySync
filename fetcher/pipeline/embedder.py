from __future__ import annotations
"""
Embedder node: generates 768-dim vectors using local sentence-transformers.
Model: all-mpnet-base-v2 (768-dim, free, offline, no rate limits).
"""

import asyncio
import os
from functools import lru_cache

from supabase import create_client

from .state import Chunk, PipelineState


@lru_cache(maxsize=1)
def _get_model():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer("all-mpnet-base-v2")


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    embeddings = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    return [e.tolist() for e in embeddings]


def _supabase():
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    return create_client(url, key)


async def embedder_node(state: PipelineState) -> dict:
    """LangGraph node: embed all chunks and persist to artifact_chunks."""
    chunks = state["chunks"]
    artifact_version_id = state["artifact_version_id"]

    db = _supabase()

    # Batch embed all chunks at once (much faster than one-by-one)
    inputs = [
        f"{c['contextual_summary'] or ''}\n{c['leaf_text']}"
        for c in chunks
    ]

    loop = asyncio.get_event_loop()
    vectors = await loop.run_in_executor(None, embed_texts, inputs)

    embedded: list[Chunk] = []
    rows_to_insert = []

    for chunk, vec in zip(chunks, vectors):
        updated = dict(chunk)
        updated["embedding"] = vec
        embedded.append(Chunk(**updated))
        rows_to_insert.append({
            "artifact_version_id": artifact_version_id,
            "section_title": chunk["section_title"],
            "page_number": chunk["page_number"],
            "leaf_text": chunk["leaf_text"],
            "parent_text": chunk["parent_text"][:10000],
            "contextual_summary": chunk["contextual_summary"],
            "embedding": vec,
        })

    if rows_to_insert:
        db.table("artifact_chunks").insert(rows_to_insert).execute()

    return {"chunks": embedded}
