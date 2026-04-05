import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const entityType = searchParams.get("entity_type");
  const entityId = searchParams.get("entity_id");
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

  const db = getServiceClient();
  let query = db
    .from("audit_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (entityType) query = query.eq("entity_type", entityType);
  if (entityId) query = query.eq("entity_id", entityId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
