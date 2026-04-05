"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { DraftExtraction } from "@/types";

interface Props {
  drafts: DraftExtraction[];
  initialTab?: "pending" | "failed";
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-400 text-sm">—</span>;
  const color =
    score >= 80 ? "text-green-700 bg-green-50 border-green-200"
    : score >= 60 ? "text-amber-700 bg-amber-50 border-amber-200"
    : "text-red-700 bg-red-50 border-red-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${color}`}>
      {score}/100
    </span>
  );
}

function FlagsCell({ flags }: { flags: string[] }) {
  const [open, setOpen] = useState(false);
  if (!flags?.length) return <span className="text-slate-400 text-xs">None</span>;
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-amber-600 text-xs font-medium hover:text-amber-800"
      >
        <AlertTriangle className="h-3 w-3" />
        {flags.length} flag{flags.length !== 1 ? "s" : ""}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 max-w-xs">
          {flags.map((f, i) => (
            <li key={i} className="text-xs text-slate-600 bg-amber-50 border border-amber-100 rounded px-2 py-1 leading-snug">
              {f.length > 120 ? f.slice(0, 120) + "…" : f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MetricCell({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-slate-400 text-xs">—</span>;
  const color = value >= 0.7 ? "text-green-600" : value >= 0.5 ? "text-amber-600" : "text-red-600";
  return <span className={`text-xs font-semibold ${color}`}>{value.toFixed(2)}</span>;
}

function DraftRow({
  draft,
  onApprove,
  onReject,
  onDelete,
  processing,
}: {
  draft: DraftExtraction;
  onApprove: (d: DraftExtraction) => void;
  onReject: (d: DraftExtraction) => void;
  onDelete: (d: DraftExtraction) => void;
  processing: string | null;
}) {
  const rules = Array.isArray(draft.extracted_json) ? draft.extracted_json : [draft.extracted_json];
  const firstRule = rules[0] as Record<string, unknown> | undefined;
  const src = draft.artifact_versions?.sources;
  const metrics = draft.ragas_metrics as Record<string, number> | null;
  const isProcessing = processing === draft.id;

  const drugName = String(firstRule?.drug_name ?? firstRule?.generic_name ?? "Unknown Drug");
  const payerName = (firstRule?.payer_name as string) ?? src?.name ?? "Unknown Payer";
  const policyNum = (firstRule?.policy_number as string) ?? null;
  const coverageTier = (firstRule?.coverage_tier as string) ?? null;
  const drugCount = rules.length;

  const tierColor =
    coverageTier === "preferred" ? "text-green-700 bg-green-50"
    : coverageTier === "not_covered" ? "text-red-700 bg-red-50"
    : "text-slate-600 bg-slate-100";

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors align-top">
      {/* Drug / Payer */}
      <td className="px-4 py-3">
        <div className="font-semibold text-sm text-slate-900">{drugName}</div>
        {drugCount > 1 && (
          <div className="text-xs text-slate-400 mt-0.5">+{drugCount - 1} more rule{drugCount > 2 ? "s" : ""}</div>
        )}
        <div className="text-xs text-slate-500 mt-0.5">{payerName}</div>
        {policyNum && <div className="text-xs text-slate-400">{policyNum}</div>}
      </td>

      {/* Coverage tier */}
      <td className="px-4 py-3">
        {coverageTier ? (
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${tierColor}`}>
            {coverageTier.replace(/_/g, " ")}
          </span>
        ) : <span className="text-slate-400 text-xs">—</span>}
      </td>

      {/* Eval score */}
      <td className="px-4 py-3">
        <ScoreBadge score={draft.eval_score} />
      </td>

      {/* RAGAS metrics */}
      <td className="px-4 py-3">
        <div className="space-y-0.5 text-xs">
          <div className="flex gap-2 items-center">
            <span className="text-slate-400 w-20">Faithful.</span>
            <MetricCell value={metrics?.faithfulness} />
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-slate-400 w-20">Relevancy</span>
            <MetricCell value={metrics?.relevancy ?? metrics?.answer_relevancy} />
          </div>
        </div>
      </td>

      {/* Flags */}
      <td className="px-4 py-3">
        <FlagsCell flags={draft.eval_flags ?? []} />
      </td>

      {/* Created */}
      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
        {new Date(draft.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        {draft.status === "pending_review" ? (
          <div className="flex gap-2">
            <button
              onClick={() => onApprove(draft)}
              disabled={isProcessing}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#00478d] hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Approve
            </button>
            <button
              onClick={() => onReject(draft)}
              disabled={isProcessing}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        ) : (
          <button
            onClick={() => onDelete(draft)}
            disabled={isProcessing}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </td>
    </tr>
  );
}

export function DraftsTable({ drafts: initialDrafts, initialTab = "pending" }: Props) {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [activeTab, setActiveTab] = useState<"pending" | "failed">(initialTab);
  const [processing, setProcessing] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const pending = drafts.filter((d) => d.status === "pending_review");
  const failed = drafts.filter((d) => d.status === "eval_failed");
  const displayed = activeTab === "pending" ? pending : failed;

  async function handleApprove(draft: DraftExtraction) {
    setProcessing(draft.id);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_id: draft.id, action: "approve" }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Published ${data.count} rule${data.count > 1 ? "s" : ""}`);
        setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      } else {
        toast.error(data.error ?? "Publish failed");
      }
    } finally {
      setProcessing(null);
    }
  }

  async function handleDelete(draft: DraftExtraction) {
    setProcessing(draft.id);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_id: draft.id, action: "delete" }),
      });
      if (res.ok) {
        toast.success("Draft cleared");
        setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Clear failed");
      }
    } finally {
      setProcessing(null);
    }
  }

  async function handleClearAll() {
    const failedIds = failed.map((d) => d.id);
    if (!failedIds.length) return;
    setClearingAll(true);
    try {
      await Promise.all(
        failedIds.map((id) =>
          fetch("/api/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draft_id: id, action: "delete" }),
          })
        )
      );
      toast.success(`Cleared ${failedIds.length} failed draft${failedIds.length > 1 ? "s" : ""}`);
      setDrafts((prev) => prev.filter((d) => d.status !== "eval_failed"));
    } finally {
      setClearingAll(false);
    }
  }

  async function handleReject(draft: DraftExtraction) {
    setProcessing(draft.id);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_id: draft.id, action: "reject", rejection_reason: "Rejected by reviewer" }),
      });
      if (res.ok) {
        toast.success("Draft rejected");
        setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      } else {
        toast.error("Rejection failed");
      }
    } finally {
      setProcessing(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Tabs + Clear All */}
      <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 p-1 rounded-xl w-fit" style={{ backgroundColor: "#f1f4f6" }}>
        {[
          { key: "pending" as const, label: "Pending Review", count: pending.length, activeColor: "#00478d", activeBg: "#d6e3ff" },
          { key: "failed" as const, label: "Eval Failed", count: failed.length, activeColor: "#93000a", activeBg: "#ffdad6" },
        ].map(({ key, label, count, activeColor, activeBg }) => (
          <button
            key={key}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
            style={
              activeTab === key
                ? { backgroundColor: "white", color: activeColor, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                : { backgroundColor: "transparent", color: "#3d485b" }
            }
            onClick={() => setActiveTab(key)}
          >
            {label}
            <span
              className="text-xs px-2 py-0.5 rounded-full font-extrabold"
              style={
                activeTab === key
                  ? { backgroundColor: activeBg, color: activeColor }
                  : { backgroundColor: "#e5e9eb", color: "#424752" }
              }
            >
              {count}
            </span>
          </button>
        ))}
      </div>
      {activeTab === "failed" && failed.length > 1 && (
        <button
          onClick={handleClearAll}
          disabled={clearingAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {clearingAll ? "Clearing…" : `Clear All (${failed.length})`}
        </button>
      )}
      </div>

      {/* Table */}
      {displayed.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-xl border border-slate-100">
          <p className="text-base font-medium">
            {activeTab === "pending" ? "No drafts pending review" : "No failed extractions"}
          </p>
          <p className="text-sm mt-1">
            {activeTab === "pending"
              ? "Extractions appear here after the pipeline runs and passes the quality gate."
              : "Failed extractions appear here when the AI evaluator flags issues."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Drug / Payer</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Coverage</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Score</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">RAGAS</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Flags</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((draft) => (
                <DraftRow
                  key={draft.id}
                  draft={draft}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onDelete={handleDelete}
                  processing={processing}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
