"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  RefreshCw, ExternalLink, Clock, AlertCircle, TrendingUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { PayerConfig, PayerFormat } from "@/types";

const FORMAT_LABELS: Record<PayerFormat, string> = {
  uhc_narrative:       "Narrative PDF",
  cigna_narrative:     "Narrative PDF",
  bcbs_nc_multi_drug:  "Multi-drug PDF",
  florida_blue_mcg:    "MCG Table PDF",
  priority_health_mdl: "205-page Table",
  emblemhealth_docx:   "DOCX",
  upmc_narrative:      "Narrative PDF",
};

export function PayerDashboard({ payers: initialPayers }: { payers: PayerConfig[] }) {
  const [payers, setPayers] = useState<PayerConfig[]>(initialPayers);
  const [fetching, setFetching] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  async function handleToggle(id: string, currentActive: boolean) {
    setToggling(id);
    try {
      const res = await fetch(`/api/sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !currentActive }),
      });
      if (!res.ok) throw new Error("Update failed");
      setPayers((prev) =>
        prev.map((p) => p.id === id ? { ...p, active: !currentActive } : p)
      );
      toast.success(currentActive ? "Payer monitoring disabled" : "Payer monitoring enabled");
    } catch {
      toast.error("Failed to update payer status");
    } finally {
      setToggling(null);
    }
  }

  async function handleFetchNow(payer: PayerConfig) {
    setFetching(payer.id);
    try {
      const res = await fetch("/api/fetch-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: payer.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fetch failed");

      if (data.changed) {
        toast.success(`${payer.payer_name}: Policy changed — extraction queued!`);
        setPayers((prev) =>
          prev.map((p) =>
            p.id === payer.id
              ? { ...p, last_fetched_at: new Date().toISOString(), last_changed_at: new Date().toISOString() }
              : p
          )
        );
      } else {
        toast.info(`${payer.payer_name}: No change detected`);
        setPayers((prev) =>
          prev.map((p) =>
            p.id === payer.id ? { ...p, last_fetched_at: new Date().toISOString() } : p
          )
        );
      }
    } catch (e) {
      toast.error(`Fetch failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setFetching(null);
    }
  }

  const active = payers.filter((p) => p.active);
  const totalPolicies = payers.reduce((sum, p) => sum + (p.policy_count ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex gap-6 text-sm px-1">
        <span>
          <strong className="text-slate-900 font-bold">{active.length}</strong>
          <span className="text-slate-500 ml-1.5">payers active</span>
        </span>
        <span>
          <strong className="text-slate-900 font-bold">{totalPolicies}</strong>
          <span className="text-slate-500 ml-1.5">total policies</span>
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Payer</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Format</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Policies</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Last Fetched</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Last Changed</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Source</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
              <th className="px-5 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Active</th>
            </tr>
          </thead>
          <tbody>
            {payers.map((payer) => (
              <tr
                key={payer.id}
                className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${!payer.active ? "opacity-50" : ""}`}
              >
                {/* Payer name */}
                <td className="px-5 py-3.5 font-semibold text-slate-900 whitespace-nowrap">
                  {payer.payer_name}
                </td>

                {/* Format */}
                <td className="px-5 py-3.5">
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium">
                    {FORMAT_LABELS[payer.payer_format] ?? payer.payer_format}
                  </span>
                </td>

                {/* Policy count */}
                <td className="px-5 py-3.5 text-slate-700 font-medium">
                  {payer.policy_count > 0 ? payer.policy_count : <span className="text-slate-400">—</span>}
                </td>

                {/* Last fetched */}
                <td className="px-5 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                  {payer.last_fetched_at ? (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-slate-400" />
                      {formatDistanceToNow(new Date(payer.last_fetched_at), { addSuffix: true })}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-slate-400">
                      <AlertCircle className="h-3 w-3" />
                      Never
                    </span>
                  )}
                </td>

                {/* Last changed */}
                <td className="px-5 py-3.5 text-xs whitespace-nowrap">
                  {payer.last_changed_at ? (
                    <span className="flex items-center gap-1 text-amber-600 font-medium">
                      <TrendingUp className="h-3 w-3" />
                      {formatDistanceToNow(new Date(payer.last_changed_at), { addSuffix: true })}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>

                {/* Source URL */}
                <td className="px-5 py-3.5">
                  <a
                    href={payer.fetch_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-[#00478d] hover:underline font-medium"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View
                  </a>
                </td>

                {/* Fetch Now */}
                <td className="px-5 py-3.5">
                  <button
                    disabled={!payer.active || fetching === payer.id}
                    onClick={() => handleFetchNow(payer)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <RefreshCw className={`h-3 w-3 ${fetching === payer.id ? "animate-spin" : ""}`} />
                    {fetching === payer.id ? "Fetching…" : "Fetch Now"}
                  </button>
                </td>

                {/* Active toggle */}
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={payer.active}
                      disabled={toggling === payer.id}
                      onCheckedChange={() => handleToggle(payer.id, payer.active)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
