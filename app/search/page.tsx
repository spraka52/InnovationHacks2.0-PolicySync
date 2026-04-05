import { QAInterface } from "@/components/qa/qa-interface";
import { SearchInterface } from "@/components/viewer/search-interface";
import { ChangeDiff } from "@/components/changelog/change-diff";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Info, ArrowRight } from "lucide-react";
import Link from "next/link";

export default function SearchPage() {
  return (
    <div className="max-w-[1440px] mx-auto">
      <Tabs defaultValue="qa">
        {/* Page header + tab bar — sits above the content card */}
        <div className="px-8 pt-2 pb-0 space-y-3">
          <div>
            <h1
              className="text-3xl font-extrabold tracking-tight text-slate-900"
              style={{ fontFamily: "Manrope, sans-serif" }}
            >
              Search &amp; Intelligence
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Ask questions, compare payer policies side by side, or track recent coverage changes.
            </p>
          </div>

          <TabsList className="bg-transparent p-0 border-b border-slate-200 w-full justify-start rounded-none gap-0 h-auto">
            {[
              { value: "qa", label: "Ask a Question" },
              { value: "compare", label: "Compare Policies" },
              { value: "changes", label: "Policy Changes" },
            ].map(({ value, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="rounded-none px-5 pb-3 pt-1 text-sm font-semibold text-slate-500 border-b-2 border-transparent
                  data-[state=active]:text-[#00478d] data-[state=active]:border-[#00478d]
                  data-[state=active]:bg-transparent hover:text-slate-800 transition-colors"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Tab content — each tab is its own card */}
        <div className="px-8 py-4">
          <TabsContent value="qa" className="mt-0">
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <QAInterface />
            </div>
          </TabsContent>

          <TabsContent value="compare" className="mt-0">
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <SearchInterface />
            </div>
          </TabsContent>

          <TabsContent value="changes" className="mt-0">
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <div className="flex items-center gap-4 text-xs text-slate-400 mb-4 pb-3 border-b border-slate-100">
                <span className="flex items-center gap-1 text-amber-600 font-medium">
                  <AlertTriangle className="h-3 w-3" /> Clinical = affects coverage criteria &amp; rebates
                </span>
                <span className="flex items-center gap-1 text-blue-500 font-medium">
                  <Info className="h-3 w-3" /> Cosmetic = formatting or date update only
                </span>
                <Link
                  href="/changelog"
                  className="ml-auto text-xs font-semibold text-[#00478d] hover:underline flex items-center gap-1"
                >
                  Full history <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <ChangeDiff compact />
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
