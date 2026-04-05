from __future__ import annotations
"""
Contextual Retrieval Chunker node (Small-to-Big RAG pattern).

For each section from the fetcher:
1. Split into ~256-token leaf chunks
2. Call Cerebras Llama 3.3 70B to generate a contextual summary
   (prepended to leaf before embedding for better retrieval accuracy)
3. Parent section text is stored alongside for LLM extraction context

Cerebras is used here because:
- 60K tokens/min throughput (vs Groq's 6K) — critical for parallel chunking
- Wafer-scale chips give 1500+ tok/sec per request
- Free tier with 1M tokens/day
"""

import asyncio
import os
import re

import httpx
from .state import Chunk, PipelineState

CEREBRAS_API_KEY = os.getenv("CEREBRAS_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
TARGET_LEAF_TOKENS = 256
CHARS_PER_TOKEN = 4  # rough approximation


def _split_into_leaves(text: str, target_chars: int = TARGET_LEAF_TOKENS * CHARS_PER_TOKEN,
                        overlap_chars: int = 30 * CHARS_PER_TOKEN) -> list[str]:
    """Split text into overlapping leaf chunks at sentence boundaries."""
    sentences = re.split(r'(?<=[.!?])\s+', text)
    leaves: list[str] = []
    current = ""

    for sentence in sentences:
        if len(current) + len(sentence) > target_chars and current:
            leaves.append(current.strip())
            # Keep overlap from end of previous chunk
            words = current.split()
            overlap_words = words[max(0, len(words) - overlap_chars // 5):]
            current = " ".join(overlap_words) + " " + sentence
        else:
            current += " " + sentence

    if current.strip():
        leaves.append(current.strip())

    return leaves or [text[:target_chars]]


async def _generate_contextual_summary(
    leaf_text: str,
    parent_text: str,
    plan_type: str,
    source_name: str,
) -> str:
    """
    Call Cerebras (primary) or Groq (fallback) to generate a 1-2 sentence
    context description for this chunk. This is prepended to the leaf text
    before embedding to improve retrieval accuracy (Anthropic's Contextual
    Retrieval technique).
    """
    prompt = (
        f"You are analyzing a {plan_type} health plan policy document from '{source_name}'.\n"
        f"Parent section text:\n{parent_text[:800]}\n\n"
        f"Specific chunk to contextualize:\n{leaf_text[:400]}\n\n"
        "In 1-2 sentences, describe what this specific chunk is about, "
        "including the drug class, policy type, and key criteria it discusses. "
        "Be specific. Output only the description."
    )

    # Try Cerebras first (faster, higher rate limit)
    summary = await _call_cerebras(prompt)
    if not summary:
        summary = await _call_groq(prompt)
    return summary or f"Chunk from {plan_type} policy '{source_name}'."


async def _call_cerebras(prompt: str) -> str | None:
    if not CEREBRAS_API_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.cerebras.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {CEREBRAS_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.3-70b",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 120,
                    "temperature": 0.1,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        return None


async def _call_groq(prompt: str) -> str | None:
    if not GROQ_API_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 120,
                    "temperature": 0.1,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        return None


async def chunker_node(state: PipelineState) -> dict:
    """LangGraph node: chunk artifact sections into Small-to-Big RAG chunks."""
    fetch_result = state["fetch_result"]
    sections = fetch_result.get("sections", [])
    plan_type = fetch_result.get("plan_type", "unknown")
    source_name = fetch_result.get("source_name", "unknown")

    all_chunks: list[Chunk] = []

    # Process sections concurrently (up to 5 at a time to respect rate limits)
    semaphore = asyncio.Semaphore(5)

    async def process_section(section: dict) -> list[Chunk]:
        async with semaphore:
            parent_text = section.get("text", "")
            leaves = _split_into_leaves(parent_text)
            section_chunks: list[Chunk] = []

            for leaf in leaves:
                summary = await _generate_contextual_summary(
                    leaf_text=leaf,
                    parent_text=parent_text,
                    plan_type=plan_type,
                    source_name=source_name,
                )
                section_chunks.append(Chunk(
                    section_title=section.get("section_title"),
                    page_number=section.get("page_number"),
                    leaf_text=leaf,
                    parent_text=parent_text,
                    contextual_summary=summary,
                    embedding=None,  # filled in embedder node
                ))
            return section_chunks

    results = await asyncio.gather(*[process_section(s) for s in sections])
    for r in results:
        all_chunks.extend(r)

    return {"chunks": all_chunks}
