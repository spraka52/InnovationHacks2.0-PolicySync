/**
 * GET /api/health
 *
 * Live system status check — demo this to judges to show the $0 stack is
 * fully monitored. Checks all service dependencies and returns latencies.
 */

import { NextResponse } from "next/server";
import { getServiceClient, isSupabaseConfigured } from "@/lib/supabase";

const GROQ_KEYS = [
  { label: "groq_key_1", key: process.env.GROQ_API_KEY ?? "" },
  { label: "groq_key_2", key: process.env.GROQ_API_KEY_2 ?? "" },
].filter((k) => k.key);

const FETCHER_URL = process.env.FETCHER_SERVICE_URL || "http://localhost:8000";

async function checkSupabase(): Promise<{ status: "ok" | "error"; latency_ms: number; error?: string }> {
  const start = Date.now();
  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      latency_ms: 0,
      error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (add in Vercel → Settings → Environment Variables)",
    };
  }
  try {
    const db = getServiceClient();
    const { error } = await db.from("sources").select("id").limit(1);
    if (error) return { status: "error", latency_ms: Date.now() - start, error: error.message };
    return { status: "ok", latency_ms: Date.now() - start };
  } catch (e) {
    return { status: "error", latency_ms: Date.now() - start, error: String(e) };
  }
}

function abortAfterMs(ms: number): AbortSignal {
  const AS = AbortSignal as unknown as { timeout?: (n: number) => AbortSignal };
  if (typeof AS.timeout === "function") return AS.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function checkGroqKey(label: string, apiKey: string): Promise<{ status: "ok" | "error" | "rate_limited"; label: string }> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: abortAfterMs(5000),
    });
    if (res.status === 429) return { status: "rate_limited", label };
    if (!res.ok) return { status: "error", label };
    return { status: "ok", label };
  } catch {
    return { status: "error", label };
  }
}

async function checkFetcher(): Promise<{ status: "ok" | "error" | "offline"; latency_ms: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${FETCHER_URL}/health`, {
      signal: abortAfterMs(4000),
    });
    if (!res.ok) return { status: "error", latency_ms: Date.now() - start };
    return { status: "ok", latency_ms: Date.now() - start };
  } catch {
    return { status: "offline", latency_ms: Date.now() - start };
  }
}

async function getQACacheStats(): Promise<{ hits_today: number; entries_total: number } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const db = getServiceClient();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: hitsToday } = await db
      .from("qa_cache")
      .select("*", { count: "exact", head: true })
      .gte("created_at", cutoff);
    const { count: total } = await db
      .from("qa_cache")
      .select("*", { count: "exact", head: true });
    return { hits_today: hitsToday ?? 0, entries_total: total ?? 0 };
  } catch {
    return null; // table may not exist yet
  }
}

export async function GET() {
  // Run all checks in parallel
  const [supabase, fetcher, groqResults, cacheStats] = await Promise.all([
    checkSupabase(),
    checkFetcher(),
    Promise.all(GROQ_KEYS.map(({ label, key }) => checkGroqKey(label, key))),
    getQACacheStats(),
  ]);

  const groqServices = Object.fromEntries(groqResults.map((r) => [r.label, { status: r.status }]));

  const allOk =
    supabase.status === "ok" &&
    groqResults.some((r) => r.status === "ok"); // at least one Groq key working

  return NextResponse.json({
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    services: {
      supabase,
      fetcher,
      ...groqServices,
    },
    cache: cacheStats ?? { note: "run migration 004_qa_cache.sql to enable" },
    stack: {
      frontend: "Vercel Hobby — $0/mo, auto-scales to 0",
      database: "Supabase Free — $0/mo, 500MB, 2M reads/mo",
      llm: `Groq Free — ${GROQ_KEYS.length} key(s) × 100K TPD = ${GROQ_KEYS.length * 100}K tokens/day`,
      embeddings: "local sentence-transformers / HuggingFace fallback — $0",
      total_cost: "$0/month",
    },
  });
}
