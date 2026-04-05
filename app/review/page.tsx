import { auth0 } from "@/lib/auth0";
import { getServiceClient } from "@/lib/supabase";
import { DraftsTable } from "@/components/review/drafts-table";
import { redirect } from "next/navigation";

const ROLE_NAMESPACE = "https://rxmonitor.app/roles";

export default async function ReviewPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/api/auth/login");

  const roles: string[] = (session.user[ROLE_NAMESPACE] as string[]) ?? [];
  if (!roles.includes("admin")) redirect("/");

  const db = getServiceClient();
  const { data: drafts } = await db
    .from("draft_extractions")
    .select(`*, artifact_versions (id, source_id, fetched_at, sources (id, name, plan_type, state))`)
    .in("status", ["pending_review", "eval_failed"])
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="px-8 py-10 max-w-[1440px] mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1
          className="text-4xl font-extrabold tracking-tight text-slate-900"
          style={{ fontFamily: "Manrope, sans-serif" }}
        >
          AI Extraction Review
        </h1>
        <p className="text-lg mt-1" style={{ color: "#3d485b" }}>
          Validate policy extractions and RAGAS metrics for compliance across enterprise carriers.
        </p>
      </div>

      <DraftsTable drafts={drafts ?? []} />
    </div>
  );
}
