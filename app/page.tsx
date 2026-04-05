import Link from "next/link";
import { ArrowRight, ShieldCheck, TrendingUp, LogIn, BarChart2, Search } from "lucide-react";
import { getServiceClient } from "@/lib/supabase";
import { auth0, AUTH0_ROLES_CLAIM } from "@/lib/auth0";
import type { UserRole } from "@/types";

async function getStats() {
  try {
    const db = getServiceClient();
    const [rulesResult, sourcesResult, draftsResult] = await Promise.all([
      db.from("published_rules").select("id", { count: "exact", head: true }),
      db.from("sources").select("id", { count: "exact", head: true }).eq("active", true).gt("policy_count", 0),
      db.from("draft_extractions").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
    ]);
    return {
      rules: rulesResult.count ?? 0,
      sources: sourcesResult.count ?? 0,
      pending: draftsResult.count ?? 0,
    };
  } catch {
    return { rules: 0, sources: 0, pending: 0 };
  }
}


export default async function HomePage() {
  let isAuthenticated = false;
  let roles: UserRole[] = [];

  try {
    const session = await auth0.getSession();
    if (session?.user) {
      isAuthenticated = true;
      roles = (session.user[AUTH0_ROLES_CLAIM] as UserRole[]) ?? [];
    }
  } catch {
    // not authenticated
  }

  // ── Landing page for unauthenticated visitors ──────────────────────────
  if (!isAuthenticated) {
    return (
      <div
        className="min-h-[calc(100vh-72px)] flex items-center justify-center px-8"
        style={{ backgroundColor: "#f7fafc" }}
      >
        <div className="max-w-2xl w-full text-center space-y-8">
          {/* Wordmark */}
          <div className="space-y-3">
            <h1
              className="text-5xl font-extrabold tracking-tight"
              style={{ fontFamily: "Manrope, sans-serif", color: "#181c1e" }}
            >
              PolicySync
            </h1>
            <p className="text-xl font-semibold" style={{ color: "#00478d" }}>
              Clinical Policy Intelligence
            </p>
            <p className="text-base leading-relaxed max-w-lg mx-auto" style={{ color: "#424752" }}>
              AI-powered monitoring for medical benefit drug policies. Track payer coverage changes, extract prior auth criteria, and govern rebate decisions — in real time.
            </p>
          </div>

          {/* Login button */}
          <Link
            href="/api/auth/login"
            className="inline-flex items-center gap-3 px-8 py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg, #00478d, #005eb8)" }}
          >
            <LogIn className="h-5 w-5" />
            Sign In with Auth0
          </Link>

          {/* Trust signals */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            {[
              { icon: ShieldCheck, label: "HIPAA Compliant", sub: "Encrypted by design" },
              { icon: TrendingUp, label: "Real-time Monitoring", sub: "Immediate change detection" },
              { icon: BarChart2, label: "35 Published Rules", sub: "Across 5 payers" },
            ].map(({ icon: Icon, label, sub }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-2 p-4 rounded-xl"
                style={{ backgroundColor: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
              >
                <Icon className="h-6 w-6" style={{ color: "#00478d" }} />
                <span className="text-sm font-bold" style={{ color: "#181c1e" }}>{label}</span>
                <span className="text-xs" style={{ color: "#727783" }}>{sub}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard for authenticated users ──────────────────────────────────
  const stats = await getStats();
  const isAdmin = roles.includes("admin");

  return (
    <div className="px-8 py-10 max-w-[1440px] mx-auto">
      <div className="space-y-8">

        {/* Stats Strip */}
        <section className={`grid grid-cols-1 gap-6 ${isAdmin ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          <div className="bg-white rounded-xl p-6 shadow-sm border-l-4 border-[#00478d]">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Published Rules</p>
            <div className="flex items-baseline gap-2">
              <h2 className="text-4xl font-extrabold text-[#00478d]" style={{ fontFamily: "Manrope, sans-serif" }}>
                {stats.rules.toLocaleString()}
              </h2>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm border-l-4 border-slate-300">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Payers Monitored</p>
            <div className="flex items-baseline gap-2">
              <h2 className="text-4xl font-extrabold text-slate-800" style={{ fontFamily: "Manrope, sans-serif" }}>
                {stats.sources}
              </h2>
            </div>
          </div>
          {isAdmin && (
            <div className="bg-white rounded-xl p-6 shadow-sm border-l-4 border-[#ffbf00]">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Pending Reviews</p>
              <div className="flex items-baseline gap-2">
                <h2 className="text-4xl font-extrabold text-[#795900]" style={{ fontFamily: "Manrope, sans-serif" }}>
                  {stats.pending}
                </h2>
                <Link href="/review" className="text-sm font-semibold text-[#795900] hover:underline flex items-center gap-1">
                  Review queue <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          )}
        </section>

        {/* Quick nav cards */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link href="/search" className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow border border-slate-100 group">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-lg bg-[#e8f0fe] flex items-center justify-center">
                <Search className="h-4 w-4 text-[#00478d]" />
              </div>
              <span className="font-bold text-slate-800 text-sm group-hover:text-[#00478d] transition-colors">Q&amp;A</span>
            </div>
            <p className="text-xs text-slate-500">Ask about any drug policy — get direct answers with citations from extracted data.</p>
          </Link>
          <Link href="/search?tab=compare" className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow border border-slate-100 group">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-lg bg-[#e8f0fe] flex items-center justify-center">
                <BarChart2 className="h-4 w-4 text-[#00478d]" />
              </div>
              <span className="font-bold text-slate-800 text-sm group-hover:text-[#00478d] transition-colors">Compare</span>
            </div>
            <p className="text-xs text-slate-500">Compare how different payers cover the same drug side by side.</p>
          </Link>
          <Link href="/changelog" className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow border border-slate-100 group">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-lg bg-[#fff3cd] flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-[#795900]" />
              </div>
              <span className="font-bold text-slate-800 text-sm group-hover:text-[#795900] transition-colors">Policy Changes</span>
            </div>
            <p className="text-xs text-slate-500">Track recent coverage changes across all monitored payers.</p>
          </Link>
        </section>
      </div>
    </div>
  );
}
