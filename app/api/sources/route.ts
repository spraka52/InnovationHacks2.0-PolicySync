import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getServiceClient } from "@/lib/supabase";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";

const SourceSchema = z.object({
  name: z.string().min(1),
  plan_type: z.enum(["employer", "medicaid", "marketplace", "medicare", "va_tricare"]),
  state: z.string().nullable(),
  fetch_url: z.string().url(),
  fetch_method: z.enum(["pdf", "html", "csv", "api"]),
  active: z.boolean().default(true),
});

export async function GET() {
  const db = getServiceClient();
  const { data, error } = await db
    .from("sources")
    .select("*")
    .order("plan_type")
    .order("state");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const session = await auth0.getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const body = await req.json();
  const parsed = SourceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getServiceClient();
  const { data, error } = await db.from("sources").insert(parsed.data).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    action: "config_updated",
    userId: session.user.sub,
    userEmail: session.user.email,
    entityType: "source",
    entityId: data.id,
    metadata: { action: "created", name: data.name },
  });

  return NextResponse.json(data, { status: 201 });
}
