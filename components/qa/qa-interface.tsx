"use client";

import { useState, useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, BookOpen, ChevronDown, ChevronUp, Bot, ExternalLink, AlertTriangle, Info } from "lucide-react";
import type { QAResponse } from "@/types";

const PAYER_URLS: Record<string, string> = {
  "Cigna": "https://www.cigna.com/healthcare-professionals/coverage-and-claims/coverage-policies/drug-coverage-policies",
  "BCBS NC": "https://www.bluecrossnc.com/providers/policies-and-guidelines/medical-policies",
  "Florida Blue": "https://mcgs.bcbsfl.com/",
  "UnitedHealthcare": "https://www.uhcprovider.com/en/policies-protocols/commercial-policies/commercial-medical-drug-policies.html",
  "Priority Health": "https://www.priorityhealth.com/provider/medical-policies",
};

const EXAMPLE_QUESTIONS = [
  "Does Cigna require step therapy for rituximab in RA?",
  "What biosimilar must be tried before Avastin at Florida Blue?",
  "What are the prior auth criteria for botulinum toxins at UHC?",
  "Does BCBS NC prefer biosimilars over Avastin for oncology?",
];

type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; response: QAResponse }
  | { role: "error"; text: string };

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] bg-[#00478d] text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed shadow-sm">
        {text}
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence, topSimilarity }: { confidence: QAResponse["confidence"]; topSimilarity: number | null }) {
  if (confidence === "high") return null;

  if (confidence === "low") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 w-fit">
        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
        <span>Low confidence — verify with source</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-blue-500 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 w-fit">
      <Info className="h-3 w-3 flex-shrink-0" />
      <span>Moderate confidence{topSimilarity != null ? ` (${Math.round(topSimilarity * 100)}% match)` : ""}</span>
    </div>
  );
}

function AssistantBubble({ text, response }: { text: string; response: QAResponse }) {
  const [showSources, setShowSources] = useState(false);

  return (
    <div className="flex gap-3 items-start">
      {/* Avatar */}
      <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-[#00478d] to-[#005eb8] flex items-center justify-center shadow-sm mt-0.5">
        <Bot className="h-4 w-4 text-white" />
      </div>

      <div className="flex-1 min-w-0 space-y-2.5">
        {/* Answer */}
        <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{text}</p>
        </div>

        {/* Confidence badge — only shown for medium/low */}
        <ConfidenceBadge confidence={response.confidence} topSimilarity={response.top_similarity} />

        {/* Citations — compact chips */}
        {response.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {response.citations.map((c, i) => {
              const url = PAYER_URLS[c.payer_name];
              return (
                <div key={i} className="group relative">
                  <div className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-full px-2.5 py-1 transition-colors">
                    <span className="h-4 w-4 rounded-full bg-[#00478d] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-xs text-gray-700 font-medium">{c.payer_name}</span>
                    {c.drug_name && <span className="text-xs text-gray-400">· {c.drug_name}</span>}
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-gray-400 hover:text-[#00478d] transition-colors"
                        title={`Open ${c.payer_name} policy page`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {/* Tooltip on hover */}
                  {c.text_snippet && (
                    <div className="absolute bottom-full left-0 mb-1.5 w-72 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      {c.policy_number && <p className="font-semibold mb-1">{c.policy_number}{c.page ? ` · p.${c.page}` : ""}</p>}
                      <p className="italic opacity-80 leading-relaxed">&ldquo;{c.text_snippet}&rdquo;</p>
                      {url && <p className="mt-2 text-blue-300 not-italic">↗ Click the link icon to open policy page</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Toggle full policy data */}
        {response.rules_used.length > 0 && (
          <>
            <button
              onClick={() => setShowSources((s) => !s)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors px-1"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {showSources ? "Hide" : "Show"} full policy data ({response.rules_used.length} rule{response.rules_used.length > 1 ? "s" : ""})
              {showSources ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showSources && (
              <div className="space-y-1.5">
                {response.rules_used.map((rule, i) => {
                  const r = rule.rule_json;
                  return (
                    <div key={rule.id ?? i} className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-xs space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{r.payer_name}</span>
                        <Badge variant="outline">{r.drug_name}</Badge>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          r.coverage_tier === "preferred" ? "bg-green-100 text-green-700"
                          : r.coverage_tier === "not_covered" ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                        }`}>
                          {r.coverage_tier?.replace(/_/g, " ")}
                        </span>
                      </div>
                      {r.prior_auth_criteria?.slice(0, 2).map((c: string, j: number) => (
                        <p key={j} className="text-gray-600">• {c}</p>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-[#00478d] to-[#005eb8] flex items-center justify-center shadow-sm">
        <Bot className="h-4 w-4 text-white" />
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1.5 items-center h-4">
          <span className="h-2 w-2 rounded-full bg-gray-300 animate-bounce [animation-delay:0ms]" />
          <span className="h-2 w-2 rounded-full bg-gray-300 animate-bounce [animation-delay:150ms]" />
          <span className="h-2 w-2 rounded-full bg-gray-300 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

export function QAInterface() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleAsk(q?: string) {
    const text = (q ?? input).trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data: QAResponse = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", text: data.answer, response: data }]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "error", text: e instanceof Error ? e.message : "Something went wrong." },
      ]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  const isEmpty = messages.length === 0 && !loading;

  return (
    <div className="flex flex-col" style={{ height: "480px" }}>
      {/* ── Messages area ── */}
      <div className="flex-1 overflow-y-auto px-1 py-2 space-y-4 min-h-0">
        {isEmpty && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-4">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#00478d] to-[#005eb8] flex items-center justify-center shadow">
              <Bot className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">Ask about any drug or payer policy</p>
              <p className="text-xs text-gray-400 mt-1">Get direct answers with citations from extracted policy data</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleAsk(q)}
                  className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full px-3 py-1.5 transition-colors text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === "user") return <UserBubble key={i} text={msg.text} />;
          if (msg.role === "assistant") return <AssistantBubble key={i} text={msg.text} response={msg.response} />;
          return (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
                <Bot className="h-4 w-4 text-red-500" />
              </div>
              <div className="bg-red-50 border border-red-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-red-700">
                {msg.text}
              </div>
            </div>
          );
        })}

        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div className="border-t border-gray-100 pt-3 mt-2 space-y-2">
        {/* Example chips inline — show after first message as quick follow-ups */}
        {messages.length > 0 && !loading && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_QUESTIONS.filter((q) => !messages.some((m) => m.role === "user" && m.text === q))
              .slice(0, 2)
              .map((q) => (
                <button
                  key={q}
                  onClick={() => handleAsk(q)}
                  className="text-xs text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-full px-3 py-1 transition-colors"
                >
                  {q}
                </button>
              ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            placeholder="Ask about any drug or policy..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAsk();
              }
            }}
            rows={1}
            className="flex-1 resize-none text-sm min-h-[42px] max-h-[120px] py-2.5 leading-relaxed"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <Button
            onClick={() => handleAsk()}
            disabled={loading || !input.trim()}
            className="h-[42px] w-[42px] p-0 flex-shrink-0"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-gray-400 text-center">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
