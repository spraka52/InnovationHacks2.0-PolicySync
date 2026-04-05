"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, Info, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { ChangelogEntry } from "@/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFieldName(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Hcpcs", "HCPCS")
    .replace("Pa ", "PA ")
    .replace("Ragas", "RAGAS");
}

function parseChangeText(text: string): { field: string; before: string; after: string } | null {
  // Matches: "field_name changed from <old> to <new>"
  const m = text.match(/^(.+?)\s+changed from\s+([\s\S]+?)\s+to\s+([\s\S]+)$/);
  if (!m) return null;
  return { field: m[1].trim(), before: m[2].trim(), after: m[3].trim() };
}

function cleanValue(val: string): string {
  // Trim JSON array brackets and quotes for readability
  return val
    .replace(/^\["|"\]$|^\["?|"?\]$/g, "")
    .replace(/^"|"$/g, "")
    .replace(/",\s*"/g, ", ")
    .replace(/\\"/g, '"');
}

function groupByPayer(entries: ChangelogEntry[]): Map<string, ChangelogEntry[]> {
  const map = new Map<string, ChangelogEntry[]>();
  for (const e of entries) {
    const key = e.payer_name ?? "Unknown Payer";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return map;
}

// ── Side-by-side diff table for one entry ───────────────────────────────────

function DiffTable({ entry }: { entry: ChangelogEntry }) {
  const [expanded, setExpanded] = useState(true);

  const rows: Array<{ field: string; before: string; after: string; type: "clinical" | "cosmetic" }> = [];

  for (const c of entry.clinical_changes) {
    const parsed = parseChangeText(c.replace(/^CLINICAL:\s*/i, ""));
    if (parsed) rows.push({ ...parsed, type: "clinical" });
    else rows.push({ field: "Change", before: "—", after: c, type: "clinical" });
  }
  for (const c of entry.cosmetic_changes) {
    const parsed = parseChangeText(c.replace(/^COSMETIC:\s*/i, ""));
    if (parsed) rows.push({ ...parsed, type: "cosmetic" });
    else rows.push({ field: "Change", before: "—", after: c, type: "cosmetic" });
  }

  const isClinical = entry.clinical_count > 0;

  return (
    <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
      {/* Entry header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <span className="font-semibold text-sm text-slate-900">{entry.drug_name}</span>
            {entry.policy_number && (
              <span className="ml-2 text-xs font-mono text-slate-400">{entry.policy_number}</span>
            )}
          </div>
          {isClinical ? (
            <span className="flex-shrink-0 flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              <AlertTriangle className="h-3 w-3" /> Clinical
            </span>
          ) : (
            <span className="flex-shrink-0 flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
              <Info className="h-3 w-3" /> Cosmetic
            </span>
          )}
          <span className="text-xs text-slate-400 flex-shrink-0">
            {format(parseISO(entry.detected_at), "MMM d, h:mm a")}
          </span>
        </div>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-slate-400 flex-shrink-0" />
          : <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
        }
      </button>

      {/* Side-by-side diff table */}
      {expanded && rows.length > 0 && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider w-[22%]">Field</th>
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider w-[39%]">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-300 inline-block" />
                    Before
                  </span>
                </th>
                <th className="px-4 py-2 text-left text-xs font-bold text-slate-500 uppercase tracking-wider w-[39%]">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                    After
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className={`border-b border-slate-50 last:border-0 ${
                    row.type === "clinical" ? "bg-amber-50/40" : ""
                  }`}
                >
                  <td className="px-4 py-2.5 align-top">
                    <div className="flex items-center gap-1.5">
                      {row.type === "clinical"
                        ? (
                          <span title="Clinical change — affects coverage criteria, PA requirements, or formulary tier. May trigger rebate renegotiation." className="inline-flex">
                            <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0 cursor-help" />
                          </span>
                        )
                        : (
                          <span title="Cosmetic change — formatting, effective date, or wording update only. No impact on coverage criteria." className="inline-flex">
                            <Info className="h-3 w-3 text-blue-400 flex-shrink-0 cursor-help" />
                          </span>
                        )}
                      <span className="text-xs font-semibold text-slate-700">
                        {formatFieldName(row.field)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <span className="text-xs text-slate-500 break-words">
                      {cleanValue(row.before) || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <span className="text-xs text-slate-900 font-medium break-words">
                      {cleanValue(row.after) || "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChangeDiff({ compact = false }: { compact?: boolean }) {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [onlyClinical, setOnlyClinical] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ limit: compact ? "5" : "50" });
      if (onlyClinical) params.set("only_clinical", "true");
      const res = await fetch(`/api/changelog?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setEntries([]);
        setLoadError(typeof data.error === "string" ? data.error : "Could not load changes");
        return;
      }
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
      setLoadError("Network error loading changes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [onlyClinical]); // eslint-disable-line

  // ── Compact strip (Search > Recent updates tab) ───────────────────────────
  if (compact) {
    if (loading) return <div className="text-sm text-slate-400 py-2">Loading changes...</div>;
    if (loadError)
      return <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{loadError}</div>;
    if (entries.length === 0)
      return <div className="text-sm text-slate-400 py-2">No recent changes detected</div>;
    return (
      <div className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 text-sm py-1.5 border-b border-slate-100 last:border-0"
          >
            <div className="flex gap-1.5 flex-shrink-0">
              {entry.clinical_count > 0 && (
                <span
                  title="Clinical change — affects coverage criteria, PA requirements, or formulary tier. May trigger rebate renegotiation."
                  className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 font-medium bg-amber-100 text-amber-800 cursor-help"
                >
                  <AlertTriangle className="h-3 w-3" />{entry.clinical_count}
                </span>
              )}
              {entry.cosmetic_count > 0 && (
                <span
                  title="Cosmetic change — formatting, effective date, or wording update only. No impact on coverage criteria."
                  className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 font-medium bg-blue-50 text-blue-700 cursor-help"
                >
                  <Info className="h-3 w-3" />{entry.cosmetic_count}
                </span>
              )}
            </div>
            <span className="font-medium text-slate-900 flex-shrink-0">{entry.payer_name}</span>
            <span className="text-slate-600 truncate">{entry.drug_name}</span>
            <span className="text-slate-400 text-xs flex-shrink-0 ml-auto">
              {format(parseISO(entry.detected_at), "MMM d")}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // ── Full page mode (/changelog) ───────────────────────────────────────────
  const grouped = groupByPayer(entries);
  const payers = Array.from(grouped.keys()).sort();

  return (
    <div className="space-y-5">
      {/* Controls + legend */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setOnlyClinical(v => !v)}
          className="text-sm px-3 py-1.5 rounded-lg border transition-colors"
          style={
            onlyClinical
              ? { backgroundColor: "#ffdfa0", borderColor: "#ffbf00", color: "#261a00" }
              : { backgroundColor: "white", borderColor: "#e5e9eb", color: "#424752" }
          }
        >
          <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5" />
          Clinical changes only
        </button>

        <button
          onClick={load}
          className="ml-auto flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors hover:bg-slate-50"
          style={{ borderColor: "#e5e9eb", color: "#424752" }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading changelog...</div>
      ) : loadError ? (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 max-w-xl">
          {loadError}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p>No policy changes detected yet.</p>
          <p className="text-xs mt-1">Changes appear automatically when payers update their policies.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {payers.map((payer) => {
            const payerEntries = grouped.get(payer)!;
            const clinicalCount = payerEntries.filter(e => e.clinical_count > 0).length;
            return (
              <section key={payer}>
                {/* Payer header */}
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-base font-extrabold text-slate-800" style={{ fontFamily: "Manrope, sans-serif" }}>
                    {payer}
                  </h2>
                  <span className="text-xs text-slate-400">
                    {payerEntries.length} change{payerEntries.length !== 1 ? "s" : ""}
                    {clinicalCount > 0 && (
                      <span className="ml-1.5 text-amber-600 font-medium">
                        · {clinicalCount} clinical
                      </span>
                    )}
                  </span>
                </div>

                {/* Entries for this payer */}
                <div className="space-y-3">
                  {payerEntries.map(entry => (
                    <DiffTable key={entry.id} entry={entry} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
