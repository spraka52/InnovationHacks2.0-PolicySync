import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getServiceClient } from "@/lib/supabase";
import { writeAudit } from "@/lib/audit";
import { embedText } from "@/lib/embeddings";
import { classifyChanges } from "@/app/api/changelog/route";
import { z } from "zod";
import type { ExtractedRule } from "@/types";

const PublishSchema = z.object({
  draft_id: z.string().uuid(),
  action: z.enum(["approve", "reject", "delete"]),
  rejection_reason: z.string().optional(),
  // Reviewer may optionally override the extracted JSON before publishing
  overridden_json: z.array(z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth0.getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const body = await req.json();
  const parsed = PublishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { draft_id, action, rejection_reason, overridden_json } = parsed.data;
  const db = getServiceClient();
  const userId = session.user.sub as string;
  const userEmail = session.user.email as string;

  // Load draft
  const { data: draft, error: draftErr } = await db
    .from("draft_extractions")
    .select("*")
    .eq("id", draft_id)
    .single();

  if (draftErr || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  // DELETE: hard-delete eval_failed drafts to clear the review table
  if (action === "delete") {
    const { error } = await db
      .from("draft_extractions")
      .delete()
      .eq("id", draft_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAudit({
      action: "draft_deleted",
      userId,
      userEmail,
      entityType: "draft_extraction",
      entityId: draft_id,
      metadata: { reason: "Manually cleared from review table" },
    });

    return NextResponse.json({ status: "deleted", draft_id });
  }

  if (draft.status !== "pending_review") {
    return NextResponse.json(
      { error: `Draft is not pending review (current status: ${draft.status})` },
      { status: 409 }
    );
  }

  if (action === "reject") {
    const { error } = await db
      .from("draft_extractions")
      .update({
        status: "rejected",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: rejection_reason ?? "Rejected by reviewer",
      })
      .eq("id", draft_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAudit({
      action: "rule_rejected",
      userId,
      userEmail,
      entityType: "draft_extraction",
      entityId: draft_id,
      metadata: { reason: rejection_reason },
    });

    return NextResponse.json({ status: "rejected", draft_id });
  }

  // APPROVE: publish each rule in extracted_json
  const rules: unknown[] = overridden_json ?? draft.extracted_json;
  const publishedIds: string[] = [];

  for (const rule of rules) {
    const typedRule = rule as unknown as ExtractedRule;

    // Generate embedding for semantic search (HyDE search will query against this)
    const ruleText = JSON.stringify(rule);
    let embedding: number[] | null = null;
    try {
      embedding = await embedText(ruleText.slice(0, 2000));
    } catch {
      // Non-fatal: publish without embedding, rule won't appear in semantic search
    }

    // Check for previous version of this rule (same drug + payer) to compute change_summary
    let changeSummary = null;
    try {
      const sourceId = typedRule.source_id;
      const drugName = typedRule.drug_name;
      if (sourceId && drugName) {
        const { data: prevRules } = await db
          .from("published_rules")
          .select("id, rule_json")
          .eq("rule_json->>source_id", sourceId)
          .ilike("rule_json->>drug_name", drugName)
          .order("published_at", { ascending: false })
          .limit(1);

        if (prevRules && prevRules.length > 0) {
          const prevRule = prevRules[0].rule_json as ExtractedRule;
          const prevRuleId = prevRules[0].id as string;
          changeSummary = await classifyChanges(typedRule, prevRule, prevRuleId);
        }
      }
    } catch {
      // Non-fatal: publish without change_summary
    }

    const { data: published, error: pubErr } = await db
      .from("published_rules")
      .insert({
        draft_extraction_id: draft_id,
        rule_json: rule,
        embedding,
        published_by: userId,
        change_summary: changeSummary,
      })
      .select("id")
      .single();

    if (pubErr) {
      return NextResponse.json({ error: pubErr.message }, { status: 500 });
    }

    publishedIds.push(published.id);

    await writeAudit({
      action: "rule_published",
      userId,
      userEmail,
      entityType: "published_rule",
      entityId: published.id,
      metadata: {
        draft_id,
        drug_name: typedRule.drug_name,
        payer_name: typedRule.payer_name,
        coverage_tier: typedRule.coverage_tier,
        clinical_changes: changeSummary?.clinical_changes?.length ?? 0,
      },
    });
  }

  // Mark draft as approved
  await db
    .from("draft_extractions")
    .update({
      status: "approved",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", draft_id);

  return NextResponse.json({
    status: "published",
    draft_id,
    published_rule_ids: publishedIds,
    count: publishedIds.length,
  });
}
