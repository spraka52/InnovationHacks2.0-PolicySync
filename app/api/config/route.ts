import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getServiceClient } from "@/lib/supabase";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";

const ConfigSchema = z.object({
  selected_states: z.array(z.string()),
  enabled_plan_types: z.array(
    z.enum(["employer", "medicaid", "marketplace", "medicare", "va_tricare"])
  ),
});

export async function GET() {
  const db = getServiceClient();
  const { data } = await db
    .from("admin_config")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json(data ?? { selected_states: [], enabled_plan_types: [] });
}

export async function PUT(req: NextRequest) {
  const session = await auth0.getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const body = await req.json();
  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getServiceClient();
  const userId = session.user.sub as string;

  // Upsert: delete old config and insert new (single-row pattern)
  await db.from("admin_config").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  const { data, error } = await db
    .from("admin_config")
    .insert({ ...parsed.data, updated_by: userId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    action: "config_updated",
    userId,
    userEmail: session.user.email,
    entityType: "admin_config",
    entityId: data.id,
    metadata: parsed.data,
  });

  return NextResponse.json(data);
}
