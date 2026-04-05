"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "../ui/switch";
import type { Source } from "@/types";

const PLAN_TYPE_COLORS: Record<string, string> = {
  employer: "bg-purple-100 text-purple-700",
  medicaid: "bg-green-100 text-green-700",
  marketplace: "bg-orange-100 text-orange-700",
  medicare: "bg-blue-100 text-blue-700",
  va_tricare: "bg-red-100 text-red-700",
};

interface Props {
  sources: Source[];
}

export function SourcesTable({ sources: initialSources }: Props) {
  const [sources, setSources] = useState(initialSources);

  async function toggleActive(source: Source) {
    const res = await fetch(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !source.active }),
    });

    if (res.ok) {
      setSources((prev) =>
        prev.map((s) => s.id === source.id ? { ...s, active: !s.active } : s)
      );
      toast.success(`${source.name} ${source.active ? "disabled" : "enabled"}`);
    } else {
      toast.error("Failed to update source");
    }
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead>Source Name</TableHead>
            <TableHead>Plan Type</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((source) => (
            <TableRow key={source.id}>
              <TableCell className="font-medium text-sm">{source.name}</TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    PLAN_TYPE_COLORS[source.plan_type] ?? "bg-gray-100 text-gray-700"
                  }`}
                >
                  {source.plan_type.replace("_", "/")}
                </span>
              </TableCell>
              <TableCell className="text-sm text-gray-600">
                {source.state ?? <span className="text-gray-400 italic">National</span>}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs uppercase">
                  {source.fetch_method}
                </Badge>
              </TableCell>
              <TableCell>
                <Switch
                  checked={source.active}
                  onCheckedChange={() => toggleActive(source)}
                />
              </TableCell>
            </TableRow>
          ))}
          {sources.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-gray-400 py-8">
                No sources configured. Run the seed migration to add default sources.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
