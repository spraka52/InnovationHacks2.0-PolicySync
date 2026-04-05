import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getServiceClient } from "@/lib/supabase";
import { writeAudit } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth0.getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const db = getServiceClient();

  const { data, error } = await db
    .from("sources")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    action: "config_updated",
    userId: session.user.sub,
    userEmail: session.user.email,
    entityType: "source",
    entityId: id,
    metadata: { changes: body },
  });

  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth0.getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const { id } = await params;
  const db = getServiceClient();

  const { error } = await db.from("sources").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    action: "config_updated",
    userId: session.user.sub,
    userEmail: session.user.email,
    entityType: "source",
    entityId: id,
    metadata: { action: "deleted" },
  });

  return new NextResponse(null, { status: 204 });
}
