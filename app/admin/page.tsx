import type { Metadata } from "next";
import { auth0, AUTH0_ROLES_CLAIM } from "@/lib/auth0";
import { getServiceClient } from "@/lib/supabase";
import { PayerDashboard } from "@/components/admin/payer-dashboard";
import { redirect } from "next/navigation";
import type { PayerConfig } from "@/types";

export const metadata: Metadata = {
  title: "Payer Monitoring | PolicySync",
  description: "Manage payer sources, trigger policy fetches, and monitor extraction status.",
};

export default async function AdminPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/api/auth/login");

  const roles: string[] = (session.user[AUTH0_ROLES_CLAIM] as string[]) ?? [];
  if (!roles.includes("admin")) redirect("/");

  const db = getServiceClient();
  const { data: sources } = await db.from("sources").select("*").order("payer_name");

  const payers: PayerConfig[] = (sources ?? []).map((s) => ({
    id: s.id,
    payer_name: s.payer_name ?? s.name,
    payer_format: s.payer_format,
    fetch_url: s.fetch_url,
    active: s.active,
    last_fetched_at: s.last_fetched_at ?? null,
    last_changed_at: s.last_changed_at ?? null,
    policy_count: s.policy_count ?? 0,
  }));

  return (
    <div className="max-w-[1440px] mx-auto px-8 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900" style={{ fontFamily: "Manrope, sans-serif" }}>
          Payer Monitoring Dashboard
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-xl">
          Manage payer sources, trigger policy fetches, and monitor extraction status. Toggle a payer on/off or run a manual fetch below.
        </p>
      </div>

        {/* Payer Table */}
        <PayerDashboard payers={payers} />
    </div>
  );
}
