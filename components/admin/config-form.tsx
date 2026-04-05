"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Play, Save, MapPin } from "lucide-react";
import type { LegacyPlanType, AdminConfig } from "@/types";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

const PLAN_TYPES: Array<{ id: LegacyPlanType; label: string; description: string; national: boolean }> = [
  { id: "employer", label: "Employer", description: "Commercial payer medical policies", national: false },
  { id: "medicaid", label: "Medicaid", description: "State Medicaid PDLs (checks UPDL first)", national: false },
  { id: "marketplace", label: "Marketplace", description: "ACA exchange formularies (CMS QHP data)", national: false },
  { id: "medicare", label: "Medicare", description: "CMS NCD/LCD (national, state-agnostic)", national: true },
  { id: "va_tricare", label: "VA / TRICARE", description: "VA National Formulary + TRICARE", national: true },
];

interface Props {
  initialConfig: AdminConfig | null;
}

export function AdminConfigForm({ initialConfig }: Props) {
  const [selectedStates, setSelectedStates] = useState<string[]>(
    initialConfig?.selected_states ?? ["TX", "CA"]
  );
  const [enabledPlanTypes, setEnabledPlanTypes] = useState<LegacyPlanType[]>(
    (initialConfig?.enabled_plan_types ?? ["employer", "medicare"]) as LegacyPlanType[]
  );
  const [isPending, startTransition] = useTransition();
  const [isRunning, setIsRunning] = useState(false);

  function toggleState(state: string) {
    setSelectedStates((prev) =>
      prev.includes(state) ? prev.filter((s) => s !== state) : [...prev, state]
    );
  }

  function togglePlanType(pt: LegacyPlanType) {
    setEnabledPlanTypes((prev) =>
      prev.includes(pt) ? prev.filter((p) => p !== pt) : [...prev, pt]
    );
  }

  async function handleSave() {
    startTransition(async () => {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_states: selectedStates,
          enabled_plan_types: enabledPlanTypes,
        }),
      });
      if (res.ok) {
        toast.success("Configuration saved");
      } else {
        toast.error("Failed to save configuration");
      }
    });
  }

  async function handleRunNow() {
    setIsRunning(true);
    toast.info("Triggering fetch for all active sources…");
    try {
      const res = await fetch("/api/fetch-check", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          `Fetch complete: ${data.changed} changed, ${data.unchanged} unchanged, ${data.errors} errors`
        );
      } else {
        toast.error("Fetch failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* State Selection */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-600" />
            <CardTitle className="text-base">Jurisdictions</CardTitle>
          </div>
          <CardDescription>
            Select the states to monitor for state-scoped plan types (Employer, Medicaid, Marketplace).
            Medicare and VA/TRICARE are national — state selection doesn&apos;t affect them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {US_STATES.map((state) => (
              <button
                key={state}
                onClick={() => toggleState(state)}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  selectedStates.includes(state)
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                }`}
              >
                {state}
              </button>
            ))}
          </div>
          <div className="mt-3 text-sm text-gray-500">
            {selectedStates.length > 0 ? (
              <span>{selectedStates.length} state{selectedStates.length > 1 ? "s" : ""} selected: {selectedStates.join(", ")}</span>
            ) : (
              <span className="text-amber-600">No states selected — state-scoped sources won&apos;t be fetched</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Plan Type Toggles */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan Types</CardTitle>
          <CardDescription>
            Enable the plan types you want to monitor. National types (Medicare, VA/TRICARE)
            don&apos;t require state configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {PLAN_TYPES.map(({ id, label, description, national }) => (
            <div key={id} className="flex items-start gap-3">
              <Checkbox
                id={`pt-${id}`}
                checked={enabledPlanTypes.includes(id)}
                onCheckedChange={() => togglePlanType(id)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <label htmlFor={`pt-${id}`} className="flex items-center gap-2 cursor-pointer">
                  <span className="text-sm font-medium text-gray-900">{label}</span>
                  {national && (
                    <Badge variant="secondary" className="text-xs">National</Badge>
                  )}
                </label>
                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Separator />

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="h-4 w-4 mr-2" />
          {isPending ? "Saving…" : "Save Configuration"}
        </Button>
        <Button variant="outline" onClick={handleRunNow} disabled={isRunning}>
          <Play className="h-4 w-4 mr-2" />
          {isRunning ? "Running…" : "Run Now"}
        </Button>
      </div>
    </div>
  );
}
