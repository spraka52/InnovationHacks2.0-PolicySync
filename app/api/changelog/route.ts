/**
 * Changelog API Route — Policy Change Tracking
 *
 * GET /api/changelog?payer_name=&drug_name=&only_clinical=true&limit=20
 *
 * Returns recent policy changes classified as:
 *   ⚠️ Clinical — changes that affect coverage criteria, step therapy, PA requirements
 *   ℹ️ Cosmetic — formatting, effective date, wording-only changes
 *
 * POST /api/changelog/classify
 * Body: { rule_id: string, prev_rule_id: string }
 * Runs Gemini classification on field diffs, stores in published_rules.change_summary
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import type { ExtractedRule, ChangeSummary, ChangelogEntry } from "@/types";

const GOOGLE_AI_KEY = process.env.GOOGLE_AI_API_KEY ?? "";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/` +
  `gemini-2.5-flash:generateContent?key=${GOOGLE_AI_KEY}`;

// Fields that indicate CLINICAL changes when they differ
const CLINICAL_FIELDS: (keyof ExtractedRule)[] = [
  "coverage_tier",
  "access_status",
  "prior_auth_required",
  "prior_auth_criteria",
  "step_therapy_required",
  "step_therapy_requirements",
  "biosimilar_step_required",
  "preferred_alternatives",
  "indications_covered",
  "indications_not_covered",
  "quantity_limits",
  "site_of_care_restrictions",
];

// Fields that indicate COSMETIC changes
const COSMETIC_FIELDS: (keyof ExtractedRule)[] = [
  "effective_date",
  "policy_title",
  "citations",
  "reauthorization_period",
];

// ─── GET: fetch recent changelog entries ──────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const payerName = searchParams.get("payer_name");
  const drugName = searchParams.get("drug_name");
  const onlyClinical = searchParams.get("only_clinical") === "true";
  const limit = Math.min(Number(searchParams.get("limit") ?? "30"), 100);

  const db = getServiceClient();

  let query = db
    .from("recent_changes")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(limit);

  if (payerName) {
    query = query.eq("payer_name", payerName);
  }
  if (drugName) {
    query = query.ilike("drug_name", `%${drugName}%`);
  }
  if (onlyClinical) {
    query = query.gt("clinical_count", 0);
  }

  const { data, error } = await query;

  if (error) {
    // Fallback: query published_rules directly if view not available
    const fallback = await db
      .from("published_rules")
      .select("id, rule_json, published_at, change_summary")
      .not("change_summary", "is", null)
      .order("published_at", { ascending: false })
      .limit(limit);

    if (fallback.error) {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }

    const entries: ChangelogEntry[] = (fallback.data ?? []).map((r) => ({
      id: r.id,
      current_rule_id: r.id,
      payer_name: (r.rule_json as ExtractedRule).payer_name,
      drug_name: (r.rule_json as ExtractedRule).drug_name,
      policy_number: (r.rule_json as ExtractedRule).policy_number ?? null,
      detected_at: r.published_at,
      clinical_changes: (r.change_summary as ChangeSummary)?.clinical_changes ?? [],
      cosmetic_changes: (r.change_summary as ChangeSummary)?.cosmetic_changes ?? [],
      clinical_count: ((r.change_summary as ChangeSummary)?.clinical_changes ?? []).length,
      cosmetic_count: ((r.change_summary as ChangeSummary)?.cosmetic_changes ?? []).length,
      previous_rule_id: (r.change_summary as ChangeSummary)?.previous_version_id ?? null,
    }));

    return NextResponse.json({ entries, total: entries.length });
  }

  const entries: ChangelogEntry[] = (data ?? []).map((r) => ({
    id: r.rule_id,
    current_rule_id: r.rule_id,
    payer_name: r.payer_name ?? "",
    drug_name: r.drug_name ?? "",
    policy_number: r.policy_number ?? null,
    detected_at: r.detected_at,
    clinical_changes: (r.clinical_changes as string[]) ?? [],
    cosmetic_changes: (r.cosmetic_changes as string[]) ?? [],
    clinical_count: Number(r.clinical_count ?? 0),
    cosmetic_count: Number(r.cosmetic_count ?? 0),
    previous_rule_id: r.previous_rule_id ?? null,
  }));

  return NextResponse.json({ entries, total: entries.length });
}

// ─── POST /api/changelog/classify (called after new version detected) ─────────
// Not in this route — handled by fetch-check flow. See below for the classify helper.

// ─── Utility: compute + store change_summary for a new rule vs previous ───────

export async function classifyChanges(
  newRule: ExtractedRule,
  prevRule: ExtractedRule,
  prevRuleId: string,
): Promise<ChangeSummary> {
  const diffs: Array<{ field: string; old: unknown; new: unknown }> = [];

  // Collect all field diffs
  for (const field of [...CLINICAL_FIELDS, ...COSMETIC_FIELDS]) {
    const oldVal = JSON.stringify(prevRule[field] ?? null);
    const newVal = JSON.stringify(newRule[field] ?? null);
    if (oldVal !== newVal) {
      diffs.push({ field, old: prevRule[field], new: newRule[field] });
    }
  }

  if (diffs.length === 0) {
    return {
      clinical_changes: [],
      cosmetic_changes: [],
      previous_version_id: prevRuleId,
      detected_at: new Date().toISOString(),
    };
  }

  // Use Gemini to classify each diff
  const diffText = diffs
    .map((d) => `Field: ${d.field}\nPrevious: ${JSON.stringify(d.old)}\nNew: ${JSON.stringify(d.new)}`)
    .join("\n---\n");

  const prompt = `You are a medical benefits analyst reviewing policy changes between two versions of a drug coverage rule.

Classify each field change below as either:
- CLINICAL: changes that affect coverage criteria, PA requirements, step therapy, biosimilar requirements, formulary tier, or access status. These directly impact patient access and rebate economics.
- COSMETIC: changes to effective date, formatting, citations, policy title, or wording that don't change clinical criteria.

For each change, write ONE clear sentence describing what changed. Start with "CLINICAL:" or "COSMETIC:".

Changes:
${diffText}

Return a JSON object with exactly two arrays:
{
  "clinical_changes": ["CLINICAL: ...", "CLINICAL: ..."],
  "cosmetic_changes": ["COSMETIC: ...", "COSMETIC: ..."]
}`;

  try {
    const resp = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const parsed = JSON.parse(raw);
      return {
        clinical_changes: parsed.clinical_changes ?? [],
        cosmetic_changes: parsed.cosmetic_changes ?? [],
        previous_version_id: prevRuleId,
        detected_at: new Date().toISOString(),
      };
    }
  } catch {
    // Fallback: deterministic classification
  }

  // Deterministic fallback: classify by field type
  const clinical: string[] = [];
  const cosmetic: string[] = [];

  for (const diff of diffs) {
    const isClinical = CLINICAL_FIELDS.includes(diff.field as keyof ExtractedRule);
    const msg = `${diff.field} changed from ${JSON.stringify(diff.old)} to ${JSON.stringify(diff.new)}`;
    if (isClinical) {
      clinical.push(`CLINICAL: ${msg}`);
    } else {
      cosmetic.push(`COSMETIC: ${msg}`);
    }
  }

  return {
    clinical_changes: clinical,
    cosmetic_changes: cosmetic,
    previous_version_id: prevRuleId,
    detected_at: new Date().toISOString(),
  };
}
