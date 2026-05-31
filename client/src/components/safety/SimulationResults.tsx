import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import type { AppliedIntervention } from "@/lib/interventions";
import type { RoadSegment } from "@/lib/road-data";

export function SimulationResults({
  interventions,
  roads,
}: {
  interventions: AppliedIntervention[];
  roads: RoadSegment[];
}) {
  const baselineTotal = roads.reduce((s, r) => s + r.predictedAnnualCrashes, 0);

  // Aggregate: per road, multiply CMFs of interventions associated (by proximity to road points)
  const roadCmf = new Map<string, number>();
  for (const iv of interventions) {
    if (iv.roadId) {
      const cur = roadCmf.get(iv.roadId) ?? 1;
      roadCmf.set(iv.roadId, cur * iv.cmf);
    }
  }

  let projectedTotal = 0;
  for (const r of roads) {
    const cmf = roadCmf.get(r.id) ?? 1;
    projectedTotal += r.predictedAnnualCrashes * cmf;
  }
  projectedTotal = Math.round(projectedTotal * 10) / 10;

  const totalCost = interventions.reduce((s, i) => s + i.cost, 0);
  const reduction = Math.max(0, baselineTotal - projectedTotal);
  const reductionPct = baselineTotal ? Math.round((reduction / baselineTotal) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart3 className="h-4 w-4" /> Network Simulation
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 pt-0">
        <Stat label="Baseline" value={baselineTotal.toString()} suffix="crashes/yr" />
        <Stat label="Projected" value={projectedTotal.toString()} suffix="crashes/yr" />
        <Stat label="Reduction" value={`${reductionPct}%`} highlight />
        <Stat label="Total Cost" value={`$${(totalCost / 1000).toFixed(1)}k`} />
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  suffix,
  highlight,
}: {
  label: string;
  value: string;
  suffix?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-2 ${highlight ? "bg-risk-low/10 border-risk-low/40" : "bg-muted/40"}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-base font-semibold tabular-nums ${highlight ? "text-risk-low" : ""}`}
      >
        {value}
      </div>
      {suffix && <div className="text-[10px] text-muted-foreground">{suffix}</div>}
    </div>
  );
}
