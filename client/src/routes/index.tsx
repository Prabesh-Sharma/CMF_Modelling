import { ClientOnly, createFileRoute } from "@tanstack/react-router";
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
  Satellite,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { rawHotspotsToHotspots, type Hotspot, type RoadSegment } from "@/lib/road-data";
import type { CrashPoint } from "@/lib/hotspot-schema";
import type {
  AppliedIntervention,
  GeneratedIntervention,
  InterventionRoadContext,
  InterventionType,
} from "@/lib/interventions";
import { InterventionToolbox } from "@/components/safety/InterventionToolbox";
import { ImpactSimulationPanel } from "@/components/safety/ImpactSimulationPanel";
import { InterventionHistory } from "@/components/safety/InterventionHistory";
import { SimulationResults } from "@/components/safety/SimulationResults";
import { useHotspots, hotspotsQueryOptions } from "@/hooks/use-hotspots";
import { MapAssistant } from "@/components/safety/MapAssistant";
import type { ModelRecommendation } from "@/lib/api/chat.functions";

const Landing = lazy(() =>
  import("@/components/Landing").then((m) => ({ default: m.Landing })),
);

const MapView = lazy(() =>
  import("@/components/safety/MapView").then((m) => ({ default: m.MapView })),
);

const landingFallback = (
  <div className="flex h-screen w-full items-center justify-center bg-[#030509] text-sm text-slate-400">
    Loading...
  </div>
);

const mapFallback = (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
    Loading mapâ€¦
  </div>
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CMF modelling â€” Road Safety Decision Support Platform" },
      {
        name: "description",
        content:
          "Geospatial decision-support for transportation planners: predict accident hotspots, explain risk drivers, and simulate safety interventions on an interactive map.",
      },
      { property: "og:title", content: "CMF modelling â€” Road Safety Decision Support" },
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

function hotspotsToRoadSegments(hotspots: Hotspot[]): RoadSegment[] {
  return hotspots.map((h) => ({
    id: h.id,
    name: h.name,
    coordinates: [[h.latitude, h.longitude]],
    riskScore: Math.round(h.riskScore * 100),
    riskLevel: h.riskLevel,
    predictedAnnualCrashes: h.predictedCrashes,
    riskFactors: h.riskFactors,
  }));
}

function pickRoadCrash(candidates: CrashPoint[], clusterId: string | undefined, index: number) {
  if (!candidates.length) return null;
  const seed = [...(clusterId ?? "cluster")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return candidates[(seed + index * 17) % candidates.length];
}

function nearestCrash(lat: number, lng: number, crashes: CrashPoint[]) {
  let best: { crash: CrashPoint; d: number } | null = null;
  for (const crash of crashes) {
    const d = distSq([lat, lng], [crash.lat, crash.lon]);
    if (!best || d < best.d) best = { crash, d };
  }
  return best?.crash ?? null;
}

function roadContextForLocation(
  lat: number,
  lng: number,
  roadId: string | undefined,
  hotspots: Hotspot[],
  crashes: CrashPoint[],
): InterventionRoadContext | undefined {
  const hotspot = hotspots.find((item) => item.id === roadId);
  const crash = nearestCrash(lat, lng, crashes);
  if (!hotspot && !crash) return undefined;
  return {
    roadClass: crash?.roadClass,
    corridor: crash?.corridor,
    roadName: crash?.roadName ?? hotspot?.roadName,
    hotspotName: hotspot?.name,
    riskLevel: hotspot?.riskLevel ?? crash?.severityLevel,
    dominantCauses: hotspot?.riskFactors.map((factor) => factor.name),
    nearbyCrashCause: crash?.cause,
    nearbyCollisionType: crash?.collisionType,
    nearbyVehicleType: crash?.vehicleType,
  };
}

// CHANGE 3 - intervention generation
function generateInterventions(clusterData: {
  id?: string;
  name: string;
  latitude?: number;
  longitude?: number;
  cause: string;
  fatal: number;
  majorInjury: number;
  pedestrian: number;
  turning: number;
  riskScore: number;
}): GeneratedIntervention[] {
  const templates = [
    {
      interventionId: "speed-camera",
      cmf: 0.65,
      icon: "CAM",
      title: "Automated Speed and Behavior Cameras",
      action: "Install average-speed enforcement cameras across the corridor",
      reduction: "12-18%",
      evidence: "Triggered by repeated driver behavior and speed-related crash patterns",
    },
    {
      interventionId: "traffic-signal",
      cmf: 0.65,
      icon: "SIG",
      title: "Adaptive Signal Timing",
      action: "Deploy adaptive traffic signals to reduce conflict points",
      reduction: "8-12%",
      evidence: "Triggered by multi-movement conflict exposure in this hotspot",
    },
    {
      interventionId: "protected-left",
      cmf: 0.7,
      icon: "TURN",
      title: "Intersection Geometry Redesign",
      action: "Add dedicated turning lanes, raised medians, and blind-turn mirrors",
      reduction: "15-22%",
      evidence: `Triggered by ${clusterData.turning} turning collision crash records`,
    },
    {
      interventionId: "pedestrian-bridge",
      cmf: 0.3,
      icon: "PED",
      title: "Grade-Separated Pedestrian Crossing",
      action: "Construct overhead footbridge or underpass with countdown signals",
      reduction: "20-30%",
      evidence: `Triggered by ${clusterData.pedestrian} pedestrian crash records`,
    },
    {
      interventionId: "led-lighting",
      cmf: 0.72,
      icon: "LED",
      title: "High-Visibility Pedestrian Lighting",
      action: "Install dedicated LED crossing lighting at hotspot approaches",
      reduction: "8-14%",
      evidence: "Triggered by high exposure and visibility risk at the cluster",
    },
    {
      interventionId: "median-barrier",
      cmf: 0.55,
      icon: "BAR",
      title: "Crash Barrier Installation",
      action: "Install W-beam guardrails and energy-absorbing barriers",
      reduction: "25-35%",
      evidence: `Triggered by ${clusterData.fatal} fatal crash records and severe-injury risk`,
    },
    {
      interventionId: "reflective-signage",
      cmf: 0.88,
      icon: "MSG",
      title: "Dynamic Warning Signage",
      action: "Install crash-activated LED variable message signs before hotspot zones",
      reduction: "6-10%",
      evidence: "Standard intervention for ranked Gi* hotspot locations",
    },
    {
      interventionId: "lane-narrowing",
      cmf: 0.8,
      icon: "AUD",
      title: "Lane Discipline and Traffic Calming",
      action: "Apply lane narrowing, edge guidance, and a recurring corridor safety review",
      reduction: "Ongoing",
      evidence: "Baseline corridor treatment for speed moderation and disciplined lane use",
    },
  ];

  const prioritized = templates.filter((item) => {
    if (item.interventionId === "protected-left") return clusterData.turning > 0 || clusterData.cause.includes("Bad Turning");
    if (item.interventionId === "pedestrian-bridge") return clusterData.pedestrian > 0 || clusterData.cause.includes("Pedestrian");
    if (item.interventionId === "median-barrier") return clusterData.fatal > 0 || clusterData.majorInjury > 0;
    return true;
  });
  const selected = [...prioritized, ...templates].filter(
    (item, index, all) => all.findIndex((candidate) => candidate.title === item.title) === index,
  );

  return selected.slice(0, Math.min(8, Math.max(5, selected.length))).map((item, index) => ({
    ...item,
    clusterId: clusterData.id,
    clusterName: clusterData.name,
    latitude: (clusterData.latitude ?? 27.7172) + (index - 3) * 0.00035,
    longitude: (clusterData.longitude ?? 85.324) + ((index % 3) - 1) * 0.00035,
  }));
}
function Dashboard() {
  const { data: crashMap, isLoading, isError, error } = useHotspots();
  const hotspots = useMemo(
    () => (crashMap ? rawHotspotsToHotspots(crashMap.hotspots) : []),
    [crashMap],
  );
  const mapSegments = useMemo(() => hotspotsToRoadSegments(hotspots), [hotspots]);
  const clusterReports = useMemo(
    () =>
      Object.fromEntries(
        hotspots.map((hotspot) => [
          hotspot.id,
          {
            crashCount: hotspot.predictedCrashes,
            fatal: hotspot.accidentReports.fatal,
            majorInjury: hotspot.accidentReports.major_injury,
            pedestrian: hotspot.accidentReports.pedestrian_related,
            turning: hotspot.accidentReports.turning_related,
          },
        ]),
      ),
    [hotspots],
  );
  // CHANGE 1 â€” crash point halving
  const filteredCrashCount = useMemo(
    () => (crashMap?.crashes ?? []).filter((crash) => Number(crash.id) % 2 === 0).length,
    [crashMap],
  );

  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<AppliedIntervention[]>([]);
  const [pending, setPending] = useState<InterventionType | null>(null);
  const [selectedInterventionId, setSelectedInterventionId] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [showLanding, setShowLanding] = useState(true);

  const selectedHotspot = useMemo(
    () => hotspots.find((h) => h.id === selectedHotspotId) ?? null,
    [hotspots, selectedHotspotId],
  );

  const selectedRoad = useMemo(
    () => mapSegments[0] ?? null,
    [mapSegments],
  );

  // CHANGE 3 - intervention generation
  const generatedInterventions = useMemo(() => {
    return hotspots.flatMap((hotspot) =>
      generateInterventions({
        id: hotspot.id,
        name: hotspot.name,
        latitude: hotspot.roadAnchorLat,
        longitude: hotspot.roadAnchorLon,
        cause: hotspot.riskFactors.map((factor) => factor.name).join(", "),
        fatal: hotspot.accidentReports.fatal,
        majorInjury: hotspot.accidentReports.major_injury,
        pedestrian: hotspot.accidentReports.pedestrian_related,
        turning: hotspot.accidentReports.turning_related,
        riskScore: hotspot.riskScore,
      }).map((intervention, index) => {
        const candidates = (crashMap?.crashes ?? []).filter(
          (crash) => crash.hotspotId === hotspot.id && Number(crash.id) % 2 === 0,
        );
        const crash = pickRoadCrash(candidates, hotspot.id, index);
        return {
          ...intervention,
          crashId: crash?.id,
          crashCause: crash?.cause,
          roadClass: crash?.roadClass,
          corridor: crash?.corridor,
          roadName: crash?.roadName,
          latitude: crash?.lat ?? intervention.latitude,
          longitude: crash?.lon ?? intervention.longitude,
        };
      }),
    );
  }, [crashMap, hotspots]);

  const staticAppliedInterventions = useMemo<AppliedIntervention[]>(
    () =>
      generatedInterventions.map((item, index) => ({
        id: `static-${item.clusterId ?? "cluster"}-${index}`,
        interventionType: item.title,
        interventionId: item.interventionId ?? "reflective-signage",
        cmf: item.cmf ?? 0.85,
        cost: 0,
        latitude: item.latitude ?? 27.7172,
        longitude: item.longitude ?? 85.324,
        timestamp: index,
        roadId: item.clusterId,
        origin: "llm",
        rationale: item.evidence,
        crashId: item.crashId,
        crashCause: item.crashCause,
        reduction: item.reduction,
        roadContext: {
          roadClass: item.roadClass,
          corridor: item.corridor,
          roadName: item.roadName,
          hotspotName: item.clusterName,
          nearbyCrashCause: item.crashCause,
        },
      })),
    [generatedInterventions],
  );

  const mapInterventions = useMemo(
    () => [...staticAppliedInterventions, ...interventions],
    [staticAppliedInterventions, interventions],
  );

  const valleyHotspot = useMemo<Hotspot | null>(() => {
    if (!hotspots.length) return null;
    const totalCrashes = hotspots.reduce((sum, hotspot) => sum + hotspot.predictedCrashes, 0);
    return {
      ...hotspots[0],
      id: "all-kathmandu-valley",
      name: "Kathmandu Valley - All Hotspot Clusters",
      predictedCrashes: totalCrashes,
      riskScore: hotspots.reduce((sum, hotspot) => sum + hotspot.riskScore, 0) / hotspots.length,
      riskLevel: "critical",
      riskFactors: hotspots.flatMap((hotspot) => hotspot.riskFactors).slice(0, 12),
      recommendedInterventions: generatedInterventions
        .slice(0, 12)
        .map((intervention) => `${intervention.clusterName}: ${intervention.title}`),
      accidentReports: {
        fatal: hotspots.reduce((sum, hotspot) => sum + hotspot.accidentReports.fatal, 0),
        major_injury: hotspots.reduce((sum, hotspot) => sum + hotspot.accidentReports.major_injury, 0),
        minor_injury: hotspots.reduce((sum, hotspot) => sum + hotspot.accidentReports.minor_injury, 0),
        property_damage_only: hotspots.reduce((sum, hotspot) => sum + hotspot.accidentReports.property_damage_only, 0),
        pedestrian_related: hotspots.reduce((sum, hotspot) => sum + hotspot.accidentReports.pedestrian_related, 0),
        speed_related: hotspots.reduce((sum, hotspot) => sum + hotspot.accidentReports.speed_related, 0),
        turning_related: hotspots.reduce((sum, hotspot) => sum + hotspot.accidentReports.turning_related, 0),
        head_on: hotspots.reduce((sum, hotspot) => sum + hotspot.accidentReports.head_on, 0),
      },
      roadName: "Kathmandu Valley road network",
    };
  }, [generatedInterventions, hotspots]);
  const selectedIntervention = useMemo(
    () => mapInterventions.find((i) => i.id === selectedInterventionId) ?? null,
    [mapInterventions, selectedInterventionId],
  );

  const interventionRoad = useMemo(() => {
    if (!selectedIntervention?.roadId) return selectedRoad;
    return mapSegments.find((r) => r.id === selectedIntervention.roadId) ?? selectedRoad;
  }, [mapSegments, selectedIntervention, selectedRoad]);

  const handleDrop = (lat: number, lng: number) => {
    if (!pending) return;
    const roadId = nearestRoadId(lat, lng, mapSegments);
    const roadContext = roadContextForLocation(
      lat,
      lng,
      roadId,
      hotspots,
      crashMap?.crashes ?? [],
    );
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
      roadContext,
      origin: "planner",
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

  const addEvaluatedRecommendation = (
    recommendation: ModelRecommendation,
    origin: "planner" | "llm",
  ) => {
    const clusterCrash = crashMap?.crashes.find(
      (crash) => crash.hotspotId === selectedHotspot?.id,
    );
    const latitude =
      clusterCrash?.lat ?? selectedHotspot?.roadAnchorLat ?? selectedHotspot?.latitude ?? 27.7172;
    const longitude =
      clusterCrash?.lon ?? selectedHotspot?.roadAnchorLon ?? selectedHotspot?.longitude ?? 85.324;
    const iv: AppliedIntervention = {
      id: `${origin}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      interventionType: recommendation.interventionType,
      interventionId: recommendation.interventionId,
      cmf: recommendation.cmf,
      cost: recommendation.cost,
      rationale: recommendation.rationale,
      latitude,
      longitude,
      timestamp: Date.now(),
      roadId: nearestRoadId(latitude, longitude, mapSegments),
      roadContext: roadContextForLocation(
        latitude,
        longitude,
        nearestRoadId(latitude, longitude, mapSegments),
        hotspots,
        crashMap?.crashes ?? [],
      ),
      origin,
    };
    setInterventions((prev) => [...prev, iv]);
    setSelectedInterventionId(iv.id);
  };

  const handleMoveIntervention = (id: string, lat: number, lng: number) => {
    setInterventions((prev) => {
      const next = prev.map((iv) =>
        iv.id === id
          ? {
              ...iv,
              latitude: lat,
              longitude: lng,
              roadId: nearestRoadId(lat, lng, mapSegments),
              roadContext: roadContextForLocation(
                lat,
                lng,
                nearestRoadId(lat, lng, mapSegments),
                hotspots,
                crashMap?.crashes ?? [],
              ),
            }
          : iv,
      );
      return next;
    });
  };

  const toggleDark = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  };

  // â”€â”€ Loading / error states â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (showLanding) {
    return (
      <ClientOnly fallback={landingFallback}>
        <Suspense fallback={landingFallback}>
          <Landing onStart={() => setShowLanding(false)} />
        </Suspense>
      </ClientOnly>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading hotspot dataâ€¦
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
      <header className="mx-3 mt-3 flex h-14 shrink-0 items-center justify-between rounded-2xl border border-sidebar-border/80 bg-sidebar/85 px-4 shadow-[0_16px_45px_-32px_rgba(15,23,42,0.65)] backdrop-blur supports-[backdrop-filter]:bg-sidebar/75">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 text-white shadow-lg shadow-sky-500/20">
            <Shield className="h-4.5 w-4.5" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">
              CMF modelling
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Road Safety Decision Support
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden items-center gap-1.5 rounded-full border border-sidebar-border/80 bg-background/70 px-2.5 py-1 shadow-sm md:flex">
            <MapIcon className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />{" "}
            {hotspots.length} clusters
          </span>
          <span className="hidden items-center gap-1.5 rounded-full border border-sidebar-border/80 bg-background/70 px-2.5 py-1 shadow-sm md:flex">
            <Activity className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />{" "}
            <span data-count="crashes">{filteredCrashCount} crashes</span>
          </span>
          <span className="hidden items-center gap-1.5 rounded-full border border-sidebar-border/80 bg-background/70 px-2.5 py-1 shadow-sm md:flex">
            <Activity className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />{" "}
            {mapInterventions.length} interventions
          </span>
          <Button
            size="sm"
            variant={satellite ? "secondary" : "ghost"}
            className="h-9 gap-1.5 rounded-full border border-sidebar-border/70 px-3 text-xs shadow-sm"
            onClick={() => setSatellite((value) => !value)}
            aria-pressed={satellite}
          >
            <Satellite className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Satellite</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 rounded-full border border-sidebar-border/70 shadow-sm"
            onClick={toggleDark}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left sidebar */}
        <aside className="flex w-[320px] shrink-0 flex-col border-r bg-sidebar">
          <ScrollArea className="flex-1">
            <div className="space-y-4 p-3">
              <Section icon={<Wrench className="h-3.5 w-3.5" />} title="Intervention Toolbox">
                <InterventionToolbox
                  onDragStart={setPending}
                  onDragEnd={() => setPending(null)}
                  onAddCustom={(recommendation) =>
                    addEvaluatedRecommendation(recommendation, "planner")
                  }
                />
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
          <ClientOnly fallback={mapFallback}>
            <Suspense fallback={mapFallback}>
              <MapView
                crashes={crashMap?.crashes ?? []}
                clusterReports={clusterReports}
                heatmap={crashMap?.heatmap ?? []}
                selectedHotspotId={selectedHotspotId}
                onSelectHotspot={setSelectedHotspotId}
                interventions={mapInterventions}
                pendingIntervention={pending}
                onDropIntervention={handleDrop}
                onMoveIntervention={handleMoveIntervention}
                selectedInterventionId={selectedInterventionId}
                onSelectIntervention={setSelectedInterventionId}
                isSatellite={satellite}
              />
            </Suspense>
          </ClientOnly>
          <MapAssistant
            hotspot={valleyHotspot}
            interventions={mapInterventions}
            selectedIntervention={selectedIntervention}
            onAddRecommendation={(recommendation) =>
              addEvaluatedRecommendation(recommendation, "llm")
            }
          />
        </main>

        {/* Right sidebar */}
        <aside className="flex w-[320px] shrink-0 flex-col border-l bg-sidebar">
          <ScrollArea className="flex-1">
            <div className="space-y-4 p-3">
              <InterventionHistory interventions={interventions} />
              <SimulationResults
                interventions={interventions}
                roads={mapSegments}
                selectedRoad={selectedRoad}
                generatedInterventions={generatedInterventions}
              />
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
