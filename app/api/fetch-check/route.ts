/**
 * POST /api/fetch-check
 * Called by Vercel Cron (GET with x-cron-secret) or Admin "Run Now" button (POST with session).
 * Triggers the FastAPI fetcher + LangGraph pipeline for all active sources.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getServiceClient } from "@/lib/supabase";
import { writeAudit } from "@/lib/audit";

const FETCHER_URL = process.env.FETCHER_SERVICE_URL!;
const FETCHER_SECRET = process.env.FETCHER_API_SECRET!;

async function triggerPipeline(
  sourceId: string,
  artifactVersionId: string,
  userId: string | null
) {
  const res = await fetch(`${FETCHER_URL}/pipeline/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-secret": FETCHER_SECRET,
    },
    body: JSON.stringify({
      source_id: sourceId,
      artifact_version_id: artifactVersionId,
      user_id: userId,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pipeline failed for ${sourceId}: ${err}`);
  }

  return res.json();
}

async function fetchAndVersion(sourceId: string): Promise<{ versionId: string; changed: boolean }> {
  const fetchRes = await fetch(`${FETCHER_URL}/fetch/${sourceId}`, {
    headers: { "x-api-secret": FETCHER_SECRET },
  });

  if (!fetchRes.ok) {
    throw new Error(`Fetch failed for ${sourceId}: ${fetchRes.status}`);
  }

  const result = await fetchRes.json();

  if (!result.changed) {
    return { versionId: "", changed: false };
  }

  // Write version record to DB
  const db = getServiceClient();
  const { data, error } = await db
    .from("artifact_versions")
    .insert({
      source_id: sourceId,
      content_hash: result.content_hash,
      storage_path: result.storage_path,
    })
    .select("id")
    .single();

  if (error) throw new Error(`DB insert failed: ${error.message}`);
  return { versionId: data.id, changed: true };
}

export async function GET(_req: NextRequest) {
  // Cron invocation — validated in middleware, fetches all active sources
  return handleFetchCheck(null, null);
}

export async function POST(req: NextRequest) {
  // Clone before reading body — auth0.getSession also needs to read the request
  let singleSourceId: string | null = null;
  try {
    const body = await req.clone().json();
    singleSourceId = body?.source_id ?? null;
  } catch { /* no body or not JSON */ }

  const session = await auth0.getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  return handleFetchCheck(singleSourceId, session.user.sub as string);
}

async function handleFetchCheck(singleSourceId: string | null, userId: string | null) {
  const db = getServiceClient();

  let filteredSources: Array<{ id: string; name: string; plan_type: string; state: string | null }> = [];

  if (singleSourceId) {
    // "Fetch Now" button — only process this specific source
    const { data, error } = await db
      .from("sources")
      .select("id, name, plan_type, state")
      .eq("id", singleSourceId)
      .single();
    if (error || !data) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    filteredSources = [data];
  } else {
    // Cron: fetch all active sources
    const { data: sources, error } = await db
      .from("sources")
      .select("id, name, plan_type, state")
      .eq("active", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    filteredSources = sources ?? [];
  }

  const results: Array<{ sourceId: string; status: string; draftId?: string; error?: string }> = [];

  // Process sources sequentially to avoid overwhelming free tier APIs
  for (const source of filteredSources) {
    try {
      await writeAudit({
        action: "fetch_triggered",
        userId: userId ?? undefined,
        entityType: "source",
        entityId: source.id,
        metadata: { source_name: source.name },
      });

      const { versionId, changed } = await fetchAndVersion(source.id);

      if (!changed) {
        await writeAudit({
          action: "artifact_unchanged",
          userId: userId ?? undefined,
          entityType: "source",
          entityId: source.id,
        });
        results.push({ sourceId: source.id, status: "unchanged" });
        continue;
      }

      await writeAudit({
        action: "artifact_changed",
        userId: userId ?? undefined,
        entityType: "artifact_versions",
        entityId: versionId,
        metadata: { source_id: source.id },
      });

      const pipelineResult = await triggerPipeline(source.id, versionId, userId);
      results.push({
        sourceId: source.id,
        status: "processed",
        draftId: pipelineResult.draft_id,
      });
    } catch (err) {
      results.push({
        sourceId: source.id,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    processed: results.length,
    changed: results.filter((r) => r.status === "processed").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  });
}
