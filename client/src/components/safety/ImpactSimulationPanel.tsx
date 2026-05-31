import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingDown } from "lucide-react";
import type { AppliedIntervention } from "@/lib/interventions";
import type { RoadSegment } from "@/lib/road-data";

interface Props {
  intervention: AppliedIntervention | null;
  road: RoadSegment | null;
}

export function ImpactSimulationPanel({ intervention, road }: Props) {
  if (!intervention) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-xs text-muted-foreground">
          Select an applied intervention to view impact simulation.
        </CardContent>
      </Card>
    );
  }

  // Use selected road's crash count if available, else default baseline 25
  const baseline = road?.predictedAnnualCrashes ?? 25;
  const predicted = Math.round(baseline * intervention.cmf * 10) / 10;
  const reduction = Math.max(0, Math.round((1 - intervention.cmf) * 100));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingDown className="h-4 w-4 text-risk-low" />
          Impact Simulation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="text-xs text-muted-foreground">{intervention.interventionType}</div>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Current Crashes" value={baseline.toString()} />
          <Stat label="CMF" value={intervention.cmf.toFixed(2)} />
          <Stat label="Predicted After" value={predicted.toString()} />
          <Stat label="Reduction" value={`${reduction}%`} highlight />
        </div>

        <div className="rounded-md border bg-muted/40 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost</div>
          <div className="mt-0.5 flex items-center justify-between">
            <span className="text-sm font-semibold tabular-nums">
              ${intervention.cost.toLocaleString()}
            </span>
            <Badge variant="outline" className="text-[10px]">
              $
              {Math.round(intervention.cost / Math.max(baseline - predicted, 0.1)).toLocaleString()}{" "}
              / crash avoided
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-md border p-2 ${highlight ? "bg-risk-low/10 border-risk-low/40" : "bg-muted/40"}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${highlight ? "text-risk-low" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
