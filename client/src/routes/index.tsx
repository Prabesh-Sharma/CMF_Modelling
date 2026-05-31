import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, lazy, Suspense } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Map as MapIcon,
  Shield,
  Wrench,
  Activity,
  Moon,
  Sun,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { ROAD_SEGMENTS, type RoadSegment } from "@/lib/road-data";
import type { AppliedIntervention, InterventionType } from "@/lib/interventions";
import { HotspotPanel } from "@/components/safety/HotspotPanel";
import { InterventionToolbox } from "@/components/safety/InterventionToolbox";
import { AppliedInterventionsPanel } from "@/components/safety/AppliedInterventionsPanel";
import { ImpactSimulationPanel } from "@/components/safety/ImpactSimulationPanel";
import { InterventionHistory } from "@/components/safety/InterventionHistory";
import { SimulationResults } from "@/components/safety/SimulationResults";
import { useHotspots, hotspotsQueryOptions } from "@/hooks/use-hotspots";
import { submitInterventions } from "@/lib/api/interventions.functions";
import { MapAssistant } from "@/components/safety/MapAssistant";

const MapView = lazy(() =>
  import("@/components/safety/MapView").then((m) => ({ default: m.MapView })),
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SafeRoute — Road Safety Decision Support Platform" },
      {
        name: "description",
        content:
          "Geospatial decision-support for transportation planners: predict accident hotspots, explain risk drivers, and simulate safety interventions on an interactive map.",
      },
      { property: "og:title", content: "SafeRoute — Road Safety Decision Support" },
      {
        property: "og:description",
        content:
          "Predict hotspots, understand risk drivers, and simulate interventions on a live GIS map.",
      },
    ],
  }),

  /**
   * Prefetch hotspots server-side (SSR) and during client-side navigation.
   * By the time Dashboard renders, `useHotspots()` already has data in cache
   * so `isLoading` is never true on first paint.
   */
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(hotspotsQueryOptions()),

  component: Dashboard,
});

function distSq(a: [number, number], b: [number, number]) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function nearestRoadId(lat: number, lng: number, roads: RoadSegment[]): string | undefined {
  let best: { id: string; d: number } | null = null;
  for (const r of roads) {
    for (const c of r.coordinates) {
      const d = distSq([lat, lng], c);
      if (!best || d < best.d) best = { id: r.id, d };
    }
  }
  // Only associate if within ~500m (rough)
  return best && best.d < 0.0001 ? best.id : undefined;
}

function Dashboard() {
  // ── Hotspot data from /api/hotspots ──────────────────────────────────────
  const { data: hotspots = [], isLoading, isError, error } = useHotspots();

  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<AppliedIntervention[]>([]);
  const [pending, setPending] = useState<InterventionType | null>(null);
  const [selectedInterventionId, setSelectedInterventionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);

  const selectedHotspot = useMemo(
    () => hotspots.find((h) => h.id === selectedHotspotId) ?? null,
    [hotspots, selectedHotspotId],
  );

  // ImpactSimulationPanel still uses RoadSegment shape; keep ROAD_SEGMENTS for that
  const selectedRoad = useMemo(
    () => ROAD_SEGMENTS.find((r) => r.id === selectedHotspotId) ?? null,
    [selectedHotspotId],
  );

  const selectedIntervention = useMemo(
    () => interventions.find((i) => i.id === selectedInterventionId) ?? null,
    [interventions, selectedInterventionId],
  );

  const interventionRoad = useMemo(() => {
    if (!selectedIntervention?.roadId) return selectedRoad;
    return ROAD_SEGMENTS.find((r) => r.id === selectedIntervention.roadId) ?? selectedRoad;
  }, [selectedIntervention, selectedRoad]);

  const hotspotsWithInterventions = useMemo(() => {
    const s = new Set<string>();
    interventions.forEach((i) => i.roadId && s.add(i.roadId));
    return s;
  }, [interventions]);

  const handleDrop = (lat: number, lng: number) => {
    if (!pending) return;
    const roadId = nearestRoadId(lat, lng, ROAD_SEGMENTS);
    const iv: AppliedIntervention = {
      id: `iv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      interventionType: pending.name,
      interventionId: pending.id,
      cmf: pending.cmf,
      cost: pending.cost,
      latitude: lat,
      longitude: lng,
      timestamp: Date.now(),
      roadId,
    };
    console.log({
      interventionType: iv.interventionType,
      latitude: iv.latitude,
      longitude: iv.longitude,
    });
    setInterventions((prev) => [...prev, iv]);
    setSelectedInterventionId(iv.id);
    setPending(null);
  };

  const handleMoveIntervention = (id: string, lat: number, lng: number) => {
    setInterventions((prev) => {
      const next = prev.map((iv) =>
        iv.id === id
          ? {
              ...iv,
              latitude: lat,
              longitude: lng,
              roadId: nearestRoadId(lat, lng, ROAD_SEGMENTS),
            }
          : iv,
      );
      return next;
    });
  };

  const handleSubmitInterventions = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await submitInterventions({
        data: {
          interventions,
          baselineCrashes: selectedHotspot?.predictedCrashes,
        },
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit interventions");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleDark = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  };

  // ── Loading / error states ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading hotspot data…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-6 w-6" />
        <span>Failed to load hotspot data</span>
        <span className="text-xs text-muted-foreground">
          {error instanceof Error ? error.message : "Unknown error"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-sidebar px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Shield className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">SafeRoute</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Road Safety Decision Support
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="hidden items-center gap-1 md:flex">
            <MapIcon className="h-3.5 w-3.5" /> {hotspots.length} hotspots
          </span>
          <span className="hidden items-center gap-1 md:flex">
            <Activity className="h-3.5 w-3.5" /> {interventions.length} interventions
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="h-8"
            onClick={handleSubmitInterventions}
            disabled={isSubmitting || interventions.length === 0}
          >
            {isSubmitting ? "Submitting…" : "Submit Interventions"}
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={toggleDark}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>
      {submitError ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {submitError}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Left sidebar */}
        <aside className="flex w-[320px] shrink-0 flex-col border-r bg-sidebar">
          <ScrollArea className="flex-1">
            <div className="space-y-4 p-3">
              <Section icon={<MapIcon className="h-3.5 w-3.5" />} title="Hotspot Details">
                {/* HotspotPanel now receives a Hotspot (from /api/hotspots) */}
                <HotspotPanel hotspot={selectedHotspot} />
              </Section>

              <Separator />

              <Section icon={<Wrench className="h-3.5 w-3.5" />} title="Intervention Toolbox">
                <InterventionToolbox onDragStart={setPending} onDragEnd={() => setPending(null)} />
              </Section>

              <Separator />

              <Section icon={<Activity className="h-3.5 w-3.5" />} title="Impact Simulation">
                <ImpactSimulationPanel
                  intervention={selectedIntervention}
                  road={interventionRoad}
                />
              </Section>
            </div>
          </ScrollArea>
        </aside>

        {/* Map */}
        <main className="relative min-w-0 flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading map…
              </div>
            }
          >
            <MapView
              hotspots={hotspots}
              selectedHotspotId={selectedHotspotId}
              onSelectHotspot={setSelectedHotspotId}
              interventions={interventions}
              pendingIntervention={pending}
              onDropIntervention={handleDrop}
              onMoveIntervention={handleMoveIntervention}
              hotspotsWithInterventions={hotspotsWithInterventions}
              selectedInterventionId={selectedInterventionId}
              onSelectIntervention={setSelectedInterventionId}
            />
          </Suspense>
          <MapAssistant
            hotspot={selectedHotspot}
            interventions={interventions}
            selectedIntervention={selectedIntervention}
          />
        </main>

        {/* Right sidebar */}
        <aside className="flex w-[320px] shrink-0 flex-col border-l bg-sidebar">
          <ScrollArea className="flex-1">
            <div className="space-y-4 p-3">
              <AppliedInterventionsPanel
                interventions={interventions}
                selectedId={selectedInterventionId}
                onSelect={setSelectedInterventionId}
                onDelete={(id) => {
                  setInterventions((prev) => prev.filter((i) => i.id !== id));
                  if (selectedInterventionId === id) setSelectedInterventionId(null);
                }}
              />
              <InterventionHistory interventions={interventions} />
              <SimulationResults interventions={interventions} roads={ROAD_SEGMENTS} />
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
