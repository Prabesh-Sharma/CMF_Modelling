import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, TrendingUp, Activity, Database } from "lucide-react";
import type { Hotspot, RiskLevel } from "@/lib/road-data";

const RISK_VARIANT: Record<RiskLevel, string> = {
  critical: "bg-risk-critical text-white",
  high: "bg-risk-high text-white",
  medium: "bg-risk-medium text-foreground",
  low: "bg-risk-low text-white",
};

export function HotspotPanel({ hotspot }: { hotspot: Hotspot | null }) {
  if (!hotspot) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Click any hotspot marker on the map to inspect its details.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-tight">{hotspot.name}</CardTitle>
            <Badge className={RISK_VARIANT[hotspot.riskLevel]}>
              {hotspot.riskLevel.toUpperCase()}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border bg-muted/40 p-2">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <Activity className="h-3 w-3" /> Risk Score
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {(hotspot.riskScore * 100).toFixed(0)}
              </div>
            </div>
            <div className="rounded-md border bg-muted/40 p-2">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <TrendingUp className="h-3 w-3" /> Annual Crashes
              </div>
              <div className="mt-1 text-2xl font-semibold">{hotspot.predictedCrashes}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-risk-high" />
            Risk Factors
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {hotspot.shapFactors.map((f) => (
            <div key={f.name}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{f.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  +{(f.impact * 100).toFixed(0)}%
                </span>
              </div>
              <Progress value={f.impact * 100} className="mt-1 h-1.5" />
              <div className="mt-1 text-[11px] text-muted-foreground">{f.description}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Source attribution */}
      <div className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
        <Database className="h-3 w-3 shrink-0" />
        <span>{hotspot.source}</span>
      </div>
    </div>
  );
}
