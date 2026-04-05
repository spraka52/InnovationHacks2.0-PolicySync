/**
 * Search API — Semantic search over published drug coverage rules.
 *
 * GET /api/search?q=bevacizumab&payer_name=Florida+Blue&drug_name=&limit=20&mode=compare
 *
 * Modes:
 *   default  — semantic search (HyDE embed → pgvector cosine similarity)
 *   compare  — drug-centric cross-payer table (groups all payers for a drug)
 *   versions — same-payer version history for a drug
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { hydeEmbed } from "@/lib/embeddings";
import type { DrugComparison, SearchResult, ExtractedRule } from "@/types";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const query     = searchParams.get("q") ?? "";
  const payerName = searchParams.get("payer_name") ?? null;
  const drugName  = searchParams.get("drug_name") ?? null;
  const mode      = searchParams.get("mode") ?? "default";    // default | compare | versions
  const sourcePayer = searchParams.get("source_payer") ?? null; // for versions mode
  const limit     = Math.min(Number(searchParams.get("limit") ?? "20"), 50);

  const db = getServiceClient();

  // ── Cross-payer drug comparison mode ──────────────────────────────────────
  if (mode === "compare" && (query || drugName)) {
    const drugQuery = drugName || query;
    const { data, error } = await db.rpc("get_drug_comparison", {
      drug_query: drugQuery,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results = data ?? [];
    if (results.length === 0) {
      return NextResponse.json({ comparison: null, query: drugQuery });
    }

    // Build DrugComparison structure
    const first = results[0].rule_json as ExtractedRule;
    const comparison: DrugComparison = {
      drug_name: first.drug_name,
      generic_name: first.generic_name,
      hcpcs_codes: first.hcpcs_codes ?? [],
      drug_category: first.drug_category ?? "",
      payer_results: results.map((r: { id: string; rule_json: ExtractedRule; published_at: string }) => ({
        payer_name: r.rule_json.payer_name,
        coverage_tier: r.rule_json.coverage_tier,
        access_status: r.rule_json.access_status,
        prior_auth_required: r.rule_json.prior_auth_required,
        biosimilar_step_required: r.rule_json.biosimilar_step_required,
        step_therapy_requirements: r.rule_json.step_therapy_requirements ?? [],
        quantity_limits: r.rule_json.quantity_limits ?? null,
        site_of_care_restrictions: r.rule_json.site_of_care_restrictions ?? null,
        published_at: r.published_at,
        rule_id: r.id,
        rule_json: r.rule_json,
      })),
    };

    return NextResponse.json({ comparison, query: drugQuery });
  }

  // ── Version history mode (same payer, same drug, different dates) ─────────
  if (mode === "versions" && sourcePayer && (query || drugName)) {
    const drugQuery = drugName || query;
    const { data, error } = await db
      .from("published_rules")
      .select("id, rule_json, published_at, change_summary")
      .ilike("rule_json->>drug_name", `%${drugQuery}%`)
      .eq("rule_json->>payer_name", sourcePayer)
      .order("published_at", { ascending: false })
      .limit(20);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      versions: data ?? [],
      payer_name: sourcePayer,
      drug_name: drugQuery,
    });
  }

  // ── Default: semantic search ───────────────────────────────────────────────
  if (!query.trim() && !drugName) {
    return NextResponse.json({ results: [], query: "" });
  }

  const searchQuery = query || drugName || "";

  try {
    const queryEmbedding = await hydeEmbed(searchQuery);

    const { data, error } = await db.rpc("search_published_rules", {
      query_embedding: queryEmbedding,
      match_threshold: 0.35,
      match_count: limit,
      filter_payer_name: payerName,
      filter_drug_name: drugName,
      filter_state: null,
      filter_plan_type: null,
    });

    if (error) throw new Error(error.message);

    const results: SearchResult[] = (data ?? []).map((r: {
      id: string;
      rule_json: ExtractedRule;
      published_by: string;
      published_at: string;
      change_summary: SearchResult["change_summary"];
      similarity: number;
    }) => ({
      id: r.id,
      rule_json: r.rule_json,
      published_by: r.published_by,
      published_at: r.published_at,
      change_summary: r.change_summary ?? null,
      similarity: r.similarity,
    }));

    return NextResponse.json({ results, query: searchQuery });
  } catch {
    // Keyword fallback
    let kQuery = db
      .from("published_rules")
      .select("id, rule_json, published_by, published_at, change_summary")
      .order("published_at", { ascending: false })
      .limit(limit);

    if (payerName) {
      kQuery = kQuery.eq("rule_json->>payer_name", payerName);
    }

    const { data: fallback } = await kQuery;

    const filtered = (fallback ?? []).filter((r) => {
      const text = JSON.stringify(r.rule_json).toLowerCase();
      return text.includes(searchQuery.toLowerCase());
    });

    return NextResponse.json({
      results: filtered.map((r) => ({ ...r, similarity: null, change_summary: r.change_summary ?? null })),
      query: searchQuery,
      fallback: true,
    });
  }
}
