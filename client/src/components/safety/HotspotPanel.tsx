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

export function HotspotPanel({ hotspot, hotspots = [] }: { hotspot: Hotspot | null; hotspots?: Hotspot[] }) {
  if (hotspots.length > 0) {
    const totalCrashes = hotspots.reduce((sum, item) => sum + item.predictedCrashes, 0);
    const reports = hotspots.reduce(
      (sum, item) => ({
        fatal: sum.fatal + item.accidentReports.fatal,
        major_injury: sum.major_injury + item.accidentReports.major_injury,
        pedestrian_related: sum.pedestrian_related + item.accidentReports.pedestrian_related,
        turning_related: sum.turning_related + item.accidentReports.turning_related,
      }),
      { fatal: 0, major_injury: 0, pedestrian_related: 0, turning_related: 0 },
    );
    const riskScore =
      hotspots.reduce((sum, item) => sum + item.riskScore, 0) / Math.max(hotspots.length, 1);
    const factors = Object.values(
      hotspots.flatMap((item) => item.riskFactors).reduce<Record<string, { name: string; impact: number; description: string; count: number }>>(
        (acc, factor) => {
          const current = acc[factor.name] ?? {
            name: factor.name,
            impact: 0,
            description: factor.description,
            count: 0,
          };
          current.impact += factor.impact;
          current.count += 1;
          acc[factor.name] = current;
          return acc;
        },
        {},
      ),
    )
      .map((factor) => ({
        ...factor,
        impact: factor.impact / factor.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return (
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base leading-tight">Kathmandu Valley Hotspots</CardTitle>
              <Badge className={RISK_VARIANT.critical}>ALL CLUSTERS</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border bg-muted/40 p-2">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Activity className="h-3 w-3" /> Avg Risk Score
                </div>
                <div className="mt-1 text-2xl font-semibold">{(riskScore * 100).toFixed(0)}</div>
              </div>
              <div className="rounded-md border bg-muted/40 p-2">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <TrendingUp className="h-3 w-3" /> Valley Crashes
                </div>
                <div className="mt-1 text-2xl font-semibold">{totalCrashes}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">All Cluster Accident Reports</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 pt-0 text-xs">
            <Report label="Fatal" value={reports.fatal} />
            <Report label="Major injury" value={reports.major_injury} />
            <Report label="Pedestrian" value={reports.pedestrian_related} />
            <Report label="Turning" value={reports.turning_related} />
            <div className="col-span-2 text-[11px] text-muted-foreground">
              Showing aggregate crash reports for all mapped Kathmandu Valley clusters.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-risk-high" />
              Common Risk Factors
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {factors.map((f) => (
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

        <div className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
          <Database className="h-3 w-3 shrink-0" />
          <span>Static demo aggregate from {hotspots.length} hotspot clusters</span>
        </div>
      </div>
    );
  }

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
          <CardTitle className="text-sm">Cluster Accident Reports</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 pt-0 text-xs">
          <Report label="Fatal" value={hotspot.accidentReports.fatal} />
          <Report label="Major injury" value={hotspot.accidentReports.major_injury} />
          <Report label="Pedestrian" value={hotspot.accidentReports.pedestrian_related} />
          <Report label="Turning" value={hotspot.accidentReports.turning_related} />
          <div className="col-span-2 text-[11px] text-muted-foreground">
            Nearby road: {hotspot.roadName}
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
          {hotspot.riskFactors.map((f) => (
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

function Report({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-muted/40 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
