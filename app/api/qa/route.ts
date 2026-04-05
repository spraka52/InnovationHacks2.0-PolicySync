/**
 * Q&A API Route — Natural Language Policy Queries
 *
 * POST /api/qa
 * Body: { question: string }
 *
 * Flow:
 *  1. HyDE: generate hypothetical policy excerpt from question (better retrieval)
 *  2. Vector search on published_rules via search_published_rules RPC
 *  3. Retrieved rules + original question → Gemini 2.5 Flash → direct answer + citations
 *  4. Return { answer, citations, rules_used }
 *
 * This is the sponsor's #1 priority feature:
 * "Does Cigna require step therapy for rituximab in RA?"
 * → "Yes. Cigna Policy IP0319 requires prior authorization. Patients must have had an
 *    inadequate response to ≥1 TNF inhibitor. [Cigna IP0319, Section Coverage Criteria]"
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getServiceClient } from "@/lib/supabase";
import { hydeEmbed } from "@/lib/embeddings";
import type { QAResponse, PublishedRule } from "@/types";

const GROQ_KEYS = [
  process.env.GROQ_API_KEY ?? "",
  process.env.GROQ_API_KEY_2 ?? "",
].filter(Boolean);

async function callGroqKey(apiKey: string, model: string, prompt: string): Promise<{ ok: boolean; text?: string; rateLimited?: boolean }> {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.1,
    }),
  });
  if (resp.status === 429) return { ok: false, rateLimited: true };
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Groq error ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  return { ok: true, text: data?.choices?.[0]?.message?.content ?? "" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function synthesizeAnswer(prompt: string): Promise<string> {
  if (GROQ_KEYS.length === 0) throw new Error("No GROQ_API_KEY configured");

  // Try llama-3.3-70b on each key first (best quality), then fall back to 8b
  const attempts = [
    ...GROQ_KEYS.map(k => ({ key: k, model: "llama-3.3-70b-versatile" })),
    ...GROQ_KEYS.map(k => ({ key: k, model: "llama-3.1-8b-instant" })),
  ];

  let retryCount = 0;
  for (const { key, model } of attempts) {
    const result = await callGroqKey(key, model, prompt);
    if (result.rateLimited) {
      // Exponential backoff with jitter before trying next key/model
      const backoffMs = Math.min(1000 * 2 ** retryCount, 8000) + Math.random() * 500;
      console.warn(`[qa] ${model} key=...${key.slice(-6)} rate limited — backing off ${backoffMs.toFixed(0)}ms`);
      await sleep(backoffMs);
      retryCount++;
      continue;
    }
    console.log(`[qa] answered via ${model} key=...${key.slice(-6)}`);
    return result.text!;
  }
  throw new Error("All Groq keys and models rate limited");
}

function buildAnswerPrompt(question: string, rules: PublishedRule[]): string {
  const policyContext = rules
    .map((r, i) => {
      const rule = r.rule_json;
      const criteria = rule.prior_auth_criteria?.length
        ? rule.prior_auth_criteria.map((c, j) => `  ${j + 1}. ${c}`).join("\n")
        : "  None specified";
      const stepReqs = rule.step_therapy_requirements?.length
        ? rule.step_therapy_requirements.join("; ")
        : "None";
      const alts = rule.preferred_alternatives?.length
        ? rule.preferred_alternatives.join(", ")
        : "None";
      return `[Policy ${i + 1}] ${rule.payer_name} — ${rule.drug_name} (${rule.policy_number ?? "no policy #"})
  Coverage tier: ${rule.coverage_tier?.replace(/_/g, " ")}
  Prior auth required: ${rule.prior_auth_required ? "Yes" : "No"}
  Prior auth criteria:
${criteria}
  Step therapy required: ${rule.step_therapy_required ? "Yes" : "No"}
  Step therapy: ${stepReqs}
  Biosimilar step required: ${rule.biosimilar_step_required ? "Yes" : "No"}
  Preferred alternatives (try first): ${alts}
  Quantity limits: ${rule.quantity_limits ?? "None"}
  Effective: ${rule.effective_date}`;
    })
    .join("\n\n");

  return `You are a medical benefits analyst. Answer the question below using ONLY the policy data provided.

RULES FOR YOUR RESPONSE:
- Write 2-4 sentences of clean, natural prose. No bullet points, no lists, no headers.
- Do NOT include any brackets, raw field names, or data labels in your answer.
- Do NOT write things like "[Cigna — IP0319, Step Therapy Required: true]" — that is forbidden.
- Mention the payer name and policy number naturally in a sentence when relevant (e.g. "Cigna policy IP0319 requires...").
- If the answer is not in the provided data, say so in one sentence.

QUESTION: ${question}

POLICY DATA:
${policyContext}

YOUR ANSWER (3-5 complete sentences, clean prose only, no brackets, no raw data, never cut off mid-sentence):`;
}

// ── Keyword extractors ────────────────────────────────────────────────────────

const PAYER_KEYWORDS: Record<string, string> = {
  "cigna": "Cigna",
  "united": "UnitedHealthcare",
  "unitedhealthcare": "UnitedHealthcare",
  "uhc": "UnitedHealthcare",
  "bcbs": "BCBS NC",
  "blue cross": "BCBS NC",
  "bluecross": "BCBS NC",
  "bcbs nc": "BCBS NC",
  "florida blue": "Florida Blue",
  "floridablue": "Florida Blue",
  "priority health": "Priority Health",
  "priority": "Priority Health",
  "emblemhealth": "EmblemHealth",
  "emblem": "EmblemHealth",
};

// Brand name → generic name mappings for drug detection
const DRUG_KEYWORDS: Record<string, string> = {
  "avastin": "bevacizumab",
  "mvasi": "bevacizumab",
  "zirabev": "bevacizumab",
  "bevacizumab": "bevacizumab",
  "rituxan": "rituximab",
  "ruxience": "rituximab",
  "riabni": "rituximab",
  "truxima": "rituximab",
  "rituximab": "rituximab",
  "botox": "botulinum",
  "dysport": "botulinum",
  "xeomin": "botulinum",
  "myobloc": "botulinum",
  "daxxify": "botulinum",
  "botulinum": "botulinum",
  "denosumab": "denosumab",
  "prolia": "denosumab",
  "xgeva": "denosumab",
};

function extractFilters(question: string): { payers: string[]; drug: string | null } {
  const q = question.toLowerCase();

  // Collect ALL payers mentioned (question may reference two for comparison)
  const payersSeen = new Set<string>();
  for (const [keyword, name] of Object.entries(PAYER_KEYWORDS)) {
    if (q.includes(keyword)) payersSeen.add(name);
  }

  let drug: string | null = null;
  for (const [keyword, generic] of Object.entries(DRUG_KEYWORDS)) {
    if (q.includes(keyword)) { drug = generic; break; }
  }

  return { payers: [...payersSeen], drug };
}

// ── Q&A response cache (Supabase qa_cache table) ─────────────────────────────
// Keyed by SHA-256 of the normalized question. TTL: 24h.
// Silently skips if table doesn't exist yet (run migration 004_qa_cache.sql).

function hashQuestion(q: string): string {
  return createHash("sha256").update(q.toLowerCase().trim()).digest("hex");
}

async function getCachedResponse(hash: string): Promise<QAResponse | null> {
  try {
    const db = getServiceClient();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from("qa_cache")
      .select("response")
      .eq("question_hash", hash)
      .gte("created_at", cutoff)
      .single();
    if (error || !data) return null;
    console.log("[qa] cache hit");
    return data.response as QAResponse;
  } catch {
    return null; // table may not exist yet
  }
}

async function setCachedResponse(hash: string, question: string, response: QAResponse) {
  try {
    const db = getServiceClient();
    await db.from("qa_cache").upsert({ question_hash: hash, question, response });
  } catch {
    // non-fatal — cache write failure doesn't break the response
  }
}

export async function POST(req: NextRequest) {
  let body: { question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // ── Cache check — return instantly if we've answered this before ──────────
  const qHash = hashQuestion(question);
  const cached = await getCachedResponse(qHash);
  if (cached) return NextResponse.json(cached);

  const db = getServiceClient();

  // ── Step 1: Extract filters ───────────────────────────────────────────────
  const { payers: filterPayers, drug: filterDrug } = extractFilters(question);
  console.log(`[qa] filters — payers: [${filterPayers.join(", ")}], drug: ${filterDrug}`);

  function toRule(r: {
    id: string; rule_json: PublishedRule["rule_json"];
    published_by: string; published_at: string;
    change_summary: PublishedRule["change_summary"]; similarity?: number;
  }): PublishedRule {
    return { id: r.id, draft_extraction_id: "", rule_json: r.rule_json,
      embedding: null, published_by: r.published_by, published_at: r.published_at,
      change_summary: r.change_summary ?? null };
  }

  const rules: PublishedRule[] = [];
  const seenIds = new Set<string>();
  let topSimilarity: number | null = null;

  // ── Step 2: Try vector search (requires fetcher /embed to be running) ─────
  let vectorSearchSucceeded = false;
  try {
    const queryEmbedding = await hydeEmbed(question);
    vectorSearchSucceeded = true;

    if (filterPayers.length > 1) {
      for (const payer of filterPayers) {
        const { data, error } = await db.rpc("search_published_rules", {
          query_embedding: queryEmbedding,
          match_threshold: 0.25,
          match_count: 4,
          filter_payer_name: payer,
          filter_drug_name: filterDrug,
          filter_state: null,
          filter_plan_type: null,
        });
        if (error) console.warn(`[qa] search error for ${payer}: ${error.message}`);
        for (const r of data ?? []) {
          if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            rules.push(toRule(r));
            if (r.similarity != null && (topSimilarity === null || r.similarity > topSimilarity)) {
              topSimilarity = r.similarity;
            }
          }
        }
      }
    } else {
      const { data, error: searchErr } = await db.rpc("search_published_rules", {
        query_embedding: queryEmbedding,
        match_threshold: 0.3,
        match_count: 8,
        filter_payer_name: filterPayers[0] ?? null,
        filter_drug_name: filterDrug,
        filter_state: null,
        filter_plan_type: null,
      });
      if (searchErr) throw new Error(searchErr.message);
      for (const r of data ?? []) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          rules.push(toRule(r));
          if (r.similarity != null && (topSimilarity === null || r.similarity > topSimilarity)) {
            topSimilarity = r.similarity;
          }
        }
      }
    }
  } catch (embedErr) {
    console.warn(`[qa] Vector search unavailable (fetcher down?): ${embedErr}. Falling back to keyword search.`);
  }

  // ── Step 3: Keyword fallback — only runs when we detected a drug or payer ──
  // Without filters, a fallback would return random unrelated rules.
  if (rules.length === 0 && (filterPayers.length > 0 || filterDrug)) {
    console.log(`[qa] Using keyword fallback (vector: ${vectorSearchSucceeded})`);
    const payersToTry = filterPayers.length > 0 ? filterPayers : [null];
    for (const payer of payersToTry) {
      let kbQuery = db
        .from("published_rules")
        .select("id, rule_json, published_by, published_at, change_summary")
        .limit(payer ? 6 : 4);
      if (payer)      kbQuery = kbQuery.ilike("rule_json->>payer_name", `%${payer}%`);
      if (filterDrug) kbQuery = kbQuery.ilike("rule_json->>drug_name", `%${filterDrug}%`);
      const { data: fallback } = await kbQuery;
      for (const r of fallback ?? []) {
        if (!seenIds.has(r.id)) { seenIds.add(r.id); rules.push(toRule(r)); }
      }
    }
    // Keyword fallback always gets low confidence — no similarity score available
    topSimilarity = null;
  }

  if (rules.length === 0) {
    return NextResponse.json({
      answer: "No relevant policies found for your question. Try asking about a specific drug or payer from the seeded data (e.g. bevacizumab, rituximab, botulinum toxin).",
      citations: [],
      rules_used: [],
      confidence: "low",
      top_similarity: null,
    } satisfies QAResponse);
  }

  // ── Step 3: LLM answer synthesis (Gemini → Groq fallback) ───────────────
  let answer = "";
  try {
    const prompt = buildAnswerPrompt(question, rules);
    answer = await synthesizeAnswer(prompt);
  } catch (err) {
    console.error(`[qa] Both Gemini and Groq failed:`, err);
    return NextResponse.json(
      { error: "Answer synthesis failed", detail: String(err) },
      { status: 502 }
    );
  }

  // ── Step 4: Build structured citations ───────────────────────────────────
  // If no drug or payer was extracted from the question, the vector search may
  // have returned weakly-related results. Suppress citations in that case so
  // an off-topic question (e.g. "capital of France") doesn't show policy pills.
  const isOffTopic = filterDrug === null && filterPayers.length === 0;

  const citations: QAResponse["citations"] = isOffTopic ? [] : rules.slice(0, 5).map((r) => {
    const rule = r.rule_json;
    const firstCitation = rule.citations?.[0];
    return {
      payer_name: rule.payer_name,
      policy_number: rule.policy_number ?? null,
      drug_name: rule.drug_name,
      page: firstCitation?.page ?? null,
      section: firstCitation?.section ?? null,
      text_snippet: firstCitation?.text_snippet ?? `${rule.drug_name} — ${rule.coverage_tier}`,
    };
  });

  const confidence: QAResponse["confidence"] =
    isOffTopic ? "low"
    : topSimilarity === null ? "low"
    : topSimilarity >= 0.6 ? "high"
    : topSimilarity >= 0.4 ? "medium"
    : "low";

  console.log(`[qa] confidence=${confidence} top_similarity=${topSimilarity?.toFixed(3) ?? "n/a"} off_topic=${isOffTopic}`);

  const responsePayload: QAResponse = {
    answer,
    citations,
    rules_used: isOffTopic ? [] : rules,
    confidence,
    top_similarity: topSimilarity,
  };

  // Cache the response for future identical questions (non-blocking)
  void setCachedResponse(qHash, question, responsePayload);

  return NextResponse.json(responsePayload);
}
