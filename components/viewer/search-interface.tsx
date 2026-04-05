"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, GitCompare, X, CheckCircle, AlertCircle, Clock,
} from "lucide-react";
import type { DrugComparison, PayerResult, CoverageTier, ExtractedRule } from "@/types";

const TIER_COLORS: Record<CoverageTier, string> = {
  preferred:           "bg-green-100 text-green-700 border-green-200",
  non_preferred:       "bg-yellow-100 text-yellow-700 border-yellow-200",
  covered_alternative: "bg-blue-100 text-blue-700 border-blue-200",
  not_covered:         "bg-red-100 text-red-700 border-red-200",
};

const TIER_ICONS: Record<CoverageTier, React.ReactNode> = {
  preferred:           <CheckCircle className="h-3.5 w-3.5" />,
  non_preferred:       <AlertCircle className="h-3.5 w-3.5" />,
  covered_alternative: <Clock className="h-3.5 w-3.5" />,
  not_covered:         <AlertCircle className="h-3.5 w-3.5" />,
};

// ─── Single result card ───────────────────────────────────────────────────────

// ─── Payer summary table with checkboxes ──────────────────────────────────────

const COL_COLORS = ["text-blue-700", "text-purple-700", "text-emerald-700"];

function PayerTable({
  comparison,
  selected,
  onToggle,
}: {
  comparison: DrugComparison;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { drug_name, generic_name, hcpcs_codes, drug_category, payer_results } = comparison;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-gray-900 text-lg">
            {drug_name}
            {generic_name && generic_name !== drug_name && (
              <span className="text-base text-gray-500 font-normal ml-2">({generic_name})</span>
            )}
          </h3>
          <div className="flex gap-2 mt-1 flex-wrap">
            {drug_category && <Badge variant="outline">{drug_category}</Badge>}
            {hcpcs_codes.map((c) => (
              <Badge key={c} variant="outline" className="font-mono text-xs">{c}</Badge>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-400 self-end">
          Select 2–3 payers below, then click Compare.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-10 px-3 py-2.5" />
              <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Payer</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Coverage</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">PA Required</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Biosimilar Step</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Step Therapy</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">Qty Limits</th>
            </tr>
          </thead>
          <tbody>
            {payer_results.map((pr) => {
              const tier = pr.coverage_tier as CoverageTier;
              const isChecked = selected.includes(pr.rule_id);
              const isDisabled = !isChecked && selected.length >= 3;
              return (
                <tr
                  key={pr.rule_id}
                  onClick={() => !isDisabled && onToggle(pr.rule_id)}
                  className={`border-b border-gray-100 transition-colors cursor-pointer
                    ${isChecked ? "bg-blue-50" : isDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-gray-50"}`}
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isChecked}
                      disabled={isDisabled}
                      onCheckedChange={() => !isDisabled && onToggle(pr.rule_id)}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-gray-900">{pr.payer_name}</div>
                    {/* Show disambiguating info when same payer has multiple rules */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      {tier && (
                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${TIER_COLORS[tier] ?? ""}`}>
                          {tier.replace(/_/g, " ")}
                        </span>
                      )}
                      {pr.rule_json?.policy_number && (
                        <span className="text-xs font-mono text-gray-400">{pr.rule_json.policy_number}</span>
                      )}
                      {pr.rule_json?.plan_type && (
                        <span className="text-xs text-gray-400 capitalize">{pr.rule_json.plan_type}</span>
                      )}
                    </div>
                    {pr.rule_json?.effective_date && (
                      <div className="text-xs text-gray-400 mt-0.5">Eff. {pr.rule_json.effective_date}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${TIER_COLORS[tier] ?? ""}`}>
                      {tier?.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {pr.prior_auth_required
                      ? <span className="text-orange-700 font-medium">Yes</span>
                      : <span className="text-green-700">No</span>}
                  </td>
                  <td className="px-3 py-3">
                    {pr.biosimilar_step_required
                      ? <span className="text-purple-700 font-medium">Yes</span>
                      : <span className="text-gray-400">No</span>}
                  </td>
                  <td className="px-3 py-3 text-gray-600 text-xs max-w-[160px] truncate">
                    {pr.step_therapy_requirements?.slice(0, 1).join("") || "—"}
                  </td>
                  <td className="px-3 py-3 text-gray-600 text-xs">{pr.quantity_limits ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Derive a plain-language context label when the same payer appears >1x ────

function getPolicyContextLabel(r: ExtractedRule): string | null {
  const parts: string[] = [];

  if (r.biosimilar_step_required) {
    parts.push("Biosimilar step required");
  } else if (r.preferred_alternatives && r.preferred_alternatives.length > 0) {
    parts.push("Preferred alternatives available");
  } else if (r.coverage_tier === "preferred") {
    parts.push("Direct access");
  }

  if (r.step_therapy_requirements && r.step_therapy_requirements.length > 0) {
    parts.push("step therapy applies");
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

// ─── Multi-payer side-by-side (2 or 3 columns) ────────────────────────────────

function MultiPayerComparison({
  rules,
  onClose,
}: {
  rules: ExtractedRule[];
  onClose: () => void;
}) {
  function safeStr(a: unknown): string {
    try { return JSON.stringify(a); } catch { return ""; }
  }

  function cellClass(idx: number, vals: unknown[]) {
    const allSame = vals.every((v) => safeStr(v) === safeStr(vals[0]));
    return allSame ? "py-2.5 px-3 text-sm text-gray-800 align-top" : "py-2.5 px-3 text-sm text-gray-800 align-top bg-yellow-50";
  }

  const headerColors = COL_COLORS;

  // Detect which payer names appear more than once so we can show context labels
  const payerNameCounts = rules.reduce<Record<string, number>>((acc, r) => {
    acc[r.payer_name] = (acc[r.payer_name] ?? 0) + 1;
    return acc;
  }, {});

  function Row({ label, values }: { label: string; values: React.ReactNode[] }) {
    const rawVals = values.map((v) => (typeof v === "string" || v == null ? v : safeStr(v)));
    return (
      <tr className="border-b border-gray-100">
        <td className="py-2.5 px-3 text-xs font-medium text-gray-500 w-36 align-top whitespace-nowrap">{label}</td>
        {values.map((v, i) => (
          <td key={i} className={cellClass(i, rawVals)}>{v ?? <span className="text-gray-300">—</span>}</td>
        ))}
      </tr>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
        <h2 className="font-semibold text-gray-900 text-sm">Side-by-side Comparison</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-yellow-600">Yellow = differs across payers</span>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="w-36 pb-3" />
              {rules.map((r, i) => {
                const isDupe = (payerNameCounts[r.payer_name] ?? 0) > 1;
                const contextLabel = isDupe ? getPolicyContextLabel(r) : null;
                return (
                  <th key={i} className={`pb-3 text-left pr-3 ${headerColors[i]}`}>
                    <div className="text-sm font-bold">{r.payer_name}</div>
                    <div className="text-xs font-semibold text-gray-700 mt-0.5">{r.drug_name}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {r.policy_number && (
                        <span className="text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                          {r.policy_number}
                        </span>
                      )}
                      {r.plan_type && (
                        <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded capitalize">
                          {r.plan_type}
                        </span>
                      )}
                      {r.effective_date && (
                        <span className="text-xs text-gray-400">
                          Eff. {r.effective_date}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${TIER_COLORS[r.coverage_tier as CoverageTier] ?? ""}`}>
                        {r.coverage_tier?.replace(/_/g, " ")}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <Row label="Coverage Tier" values={rules.map((r) => {
              const contextLabel = getPolicyContextLabel(r);
              return (
                <div className="flex flex-col gap-0.5">
                  <span className={`inline-flex w-fit text-xs px-1.5 py-0.5 rounded ${TIER_COLORS[r.coverage_tier as CoverageTier] ?? ""}`}>
                    {r.coverage_tier?.replace(/_/g, " ")}
                  </span>
                  {contextLabel && (
                    <span className="text-xs text-gray-500">{contextLabel}</span>
                  )}
                </div>
              );
            })} />
            <Row label="PA Required" values={rules.map((r) => r.prior_auth_required ? "Yes" : "No")} />
            <Row label="Biosimilar Step" values={rules.map((r) => r.biosimilar_step_required ? "Yes" : "No")} />
            <Row label="PA Criteria" values={rules.map((r) =>
              r.prior_auth_criteria?.length
                ? <ul className="list-disc pl-3 space-y-0.5 text-xs">{r.prior_auth_criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>
                : <span className="text-gray-400 text-xs">None specified</span>
            )} />
            <Row label="Step Therapy" values={rules.map((r) => r.step_therapy_requirements?.join("; ") || "None")} />
            <Row label="Preferred Alts" values={rules.map((r) => r.preferred_alternatives?.join(", ") || "None")} />
            <Row label="Qty Limits" values={rules.map((r) => r.quantity_limits ?? "None")} />
            <Row label="Site of Care" values={rules.map((r) => r.site_of_care_restrictions ?? "None")} />
            <Row label="Effective" values={rules.map((r) => r.effective_date)} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Search Interface ─────────────────────────────────────────────────────

export function SearchInterface() {
  const [query, setQuery] = useState("");
  const [comparison, setComparison] = useState<DrugComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    setSelectedIds([]);
    setShowComparison(false);
    setComparison(null);
    try {
      const params = new URLSearchParams({ q: query, mode: "compare" });
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : "Search failed";
        toast.error(msg, { duration: 8000 });
        setComparison(null);
        return;
      }
      setComparison(data.comparison ?? null);
    } finally {
      setLoading(false);
    }
  }

  // Don't touch showComparison on checkbox change — table stays open
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }

  const selectedResults: ExtractedRule[] = (comparison?.payer_results ?? [])
    .filter((pr) => selectedIds.includes(pr.rule_id))
    .map((pr) => pr.rule_json);

  const canCompare = selectedIds.length >= 2;

  return (
    <div className="space-y-5">
      {/* Search bar + always-visible Compare button */}
      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            placeholder="Drug name — e.g. bevacizumab, rituximab, botulinum toxin..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="h-11"
          />
        </div>
        <Button className="h-11 px-6" onClick={handleSearch} disabled={loading || !query.trim()}>
          <Search className="h-4 w-4 mr-2" />
          {loading ? "Searching…" : "Search"}
        </Button>
        {/* Compare button always visible once results are loaded */}
        {comparison && (
          <Button
            className="h-11 px-5 font-semibold"
            variant={canCompare ? "default" : "outline"}
            disabled={!canCompare}
            onClick={() => setShowComparison(true)}
            title={!canCompare ? "Select 2–3 payers from the table below" : undefined}
          >
            <GitCompare className="h-4 w-4 mr-2" />
            Compare
            {canCompare && <span className="ml-1.5 bg-white/20 rounded px-1.5 text-xs">{selectedIds.length}</span>}
          </Button>
        )}
      </div>

      {/* Hint when results loaded but nothing selected */}
      {comparison && selectedIds.length === 0 && (
        <p className="text-xs text-gray-400">
          Select 2–3 payers from the table below, then click <strong>Compare</strong>.
        </p>
      )}
      {comparison && selectedIds.length === 1 && (
        <p className="text-xs text-blue-500">
          1 payer selected — select 1 more to enable Compare.
        </p>
      )}

      {/* Example chips (pre-search only) */}
      {!searched && (
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs text-gray-400">Try:</span>
          {["bevacizumab", "rituximab", "botulinum toxin"].map((ex) => (
            <button
              key={ex}
              onClick={() => setQuery(ex)}
              className="text-xs px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {/* Multi-payer comparison — stays visible, updates live as selection changes */}
      {showComparison && selectedResults.length >= 2 && (
        <MultiPayerComparison rules={selectedResults} onClose={() => setShowComparison(false)} />
      )}

      {/* Payer results table */}
      {searched && !loading && !comparison && (
        <div className="text-center text-gray-400 py-16">
          No results found for &ldquo;{query}&rdquo;. Try &ldquo;bevacizumab&rdquo; or &ldquo;rituximab&rdquo;.
        </div>
      )}

      {comparison && (
        <PayerTable
          comparison={comparison}
          selected={selectedIds}
          onToggle={toggleSelect}
        />
      )}
    </div>
  );
}
