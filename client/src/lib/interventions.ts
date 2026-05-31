import {
  Mountain,
  Gauge,
  Camera,
  MonitorSpeaker,
  Footprints,
  Flag,
  TrafficCone,
  Eye,
  CircleDot,
  CornerUpLeft,
  Network,
  Lightbulb,
  Lamp,
  Signpost,
  Minimize2,
  Square,
  StretchHorizontal,
  Bike,
  ShieldCheck,
  Radar,
  Construction,
  type LucideIcon,
} from "lucide-react";

export interface InterventionType {
  id: string;
  name: string;
  category: string;
  cmf: number; // Crash Modification Factor (<1 = reduction)
  cost: number; // USD
  icon: LucideIcon;
}

export const INTERVENTION_CATEGORIES: { category: string; items: InterventionType[] }[] = [
  {
    category: "Speed Management",
    items: [
      {
        id: "speed-hump",
        name: "Speed Hump",
        category: "Speed Management",
        cmf: 0.6,
        cost: 2500,
        icon: Mountain,
      },
      {
        id: "speed-table",
        name: "Speed Table",
        category: "Speed Management",
        cmf: 0.55,
        cost: 8000,
        icon: StretchHorizontal,
      },
      {
        id: "raised-intersection",
        name: "Raised Intersection",
        category: "Speed Management",
        cmf: 0.7,
        cost: 45000,
        icon: Square,
      },
      {
        id: "speed-camera",
        name: "Speed Camera",
        category: "Speed Management",
        cmf: 0.65,
        cost: 35000,
        icon: Camera,
      },
      {
        id: "dynamic-speed-sign",
        name: "Dynamic Speed Display Sign",
        category: "Speed Management",
        cmf: 0.78,
        cost: 12000,
        icon: Gauge,
      },
    ],
  },
  {
    category: "Pedestrian Safety",
    items: [
      {
        id: "raised-crosswalk",
        name: "Raised Crosswalk",
        category: "Pedestrian Safety",
        cmf: 0.55,
        cost: 9000,
        icon: Footprints,
      },
      {
        id: "pedestrian-refuge",
        name: "Pedestrian Refuge Island",
        category: "Pedestrian Safety",
        cmf: 0.68,
        cost: 14000,
        icon: Flag,
      },
      {
        id: "hawk-signal",
        name: "HAWK Signal",
        category: "Pedestrian Safety",
        cmf: 0.45,
        cost: 55000,
        icon: TrafficCone,
      },
      {
        id: "hv-crosswalk",
        name: "High Visibility Crosswalk",
        category: "Pedestrian Safety",
        cmf: 0.82,
        cost: 3500,
        icon: Eye,
      },
      {
        id: "pedestrian-bridge",
        name: "Pedestrian Bridge",
        category: "Pedestrian Safety",
        cmf: 0.3,
        cost: 320000,
        icon: Construction,
      },
    ],
  },
  {
    category: "Intersection Improvements",
    items: [
      {
        id: "traffic-signal",
        name: "Traffic Signal",
        category: "Intersection Improvements",
        cmf: 0.65,
        cost: 80000,
        icon: TrafficCone,
      },
      {
        id: "roundabout",
        name: "Roundabout",
        category: "Intersection Improvements",
        cmf: 0.48,
        cost: 250000,
        icon: CircleDot,
      },
      {
        id: "protected-left",
        name: "Protected Left Turn Phase",
        category: "Intersection Improvements",
        cmf: 0.7,
        cost: 18000,
        icon: CornerUpLeft,
      },
      {
        id: "signal-coordination",
        name: "Signal Coordination",
        category: "Intersection Improvements",
        cmf: 0.85,
        cost: 22000,
        icon: Network,
      },
    ],
  },
  {
    category: "Lighting & Visibility",
    items: [
      {
        id: "led-lighting",
        name: "LED Street Lighting",
        category: "Lighting & Visibility",
        cmf: 0.72,
        cost: 15000,
        icon: Lamp,
      },
      {
        id: "illuminated-crosswalk",
        name: "Illuminated Crosswalk",
        category: "Lighting & Visibility",
        cmf: 0.6,
        cost: 25000,
        icon: Lightbulb,
      },
      {
        id: "reflective-signage",
        name: "Reflective Signage",
        category: "Lighting & Visibility",
        cmf: 0.88,
        cost: 2000,
        icon: Signpost,
      },
    ],
  },
  {
    category: "Road Design",
    items: [
      {
        id: "road-diet",
        name: "Road Diet",
        category: "Road Design",
        cmf: 0.71,
        cost: 40000,
        icon: Minimize2,
      },
      {
        id: "median-barrier",
        name: "Median Barrier",
        category: "Road Design",
        cmf: 0.55,
        cost: 60000,
        icon: ShieldCheck,
      },
      {
        id: "lane-narrowing",
        name: "Lane Narrowing",
        category: "Road Design",
        cmf: 0.8,
        cost: 8000,
        icon: Minimize2,
      },
      {
        id: "shoulder-widening",
        name: "Shoulder Widening",
        category: "Road Design",
        cmf: 0.75,
        cost: 55000,
        icon: StretchHorizontal,
      },
    ],
  },
  {
    category: "Cyclist Safety",
    items: [
      {
        id: "bike-lane",
        name: "Bike Lane",
        category: "Cyclist Safety",
        cmf: 0.78,
        cost: 20000,
        icon: Bike,
      },
      {
        id: "protected-bike-lane",
        name: "Protected Bike Lane",
        category: "Cyclist Safety",
        cmf: 0.6,
        cost: 75000,
        icon: Bike,
      },
      {
        id: "bicycle-signal",
        name: "Bicycle Signal",
        category: "Cyclist Safety",
        cmf: 0.7,
        cost: 15000,
        icon: Bike,
      },
    ],
  },
  {
    category: "Enforcement",
    items: [
      {
        id: "red-light-camera",
        name: "Red Light Camera",
        category: "Enforcement",
        cmf: 0.7,
        cost: 45000,
        icon: Camera,
      },
      {
        id: "avg-speed-camera",
        name: "Average Speed Camera",
        category: "Enforcement",
        cmf: 0.6,
        cost: 60000,
        icon: Radar,
      },
    ],
  },
];

// Helper: find icon by intervention id (used by map markers via applied interventions)
const INTERVENTION_LOOKUP: Record<string, InterventionType> = Object.fromEntries(
  INTERVENTION_CATEGORIES.flatMap((c) => c.items).map((i) => [i.id, i]),
);
export function getInterventionIcon(id: string): LucideIcon {
  return INTERVENTION_LOOKUP[id]?.icon ?? MonitorSpeaker;
}

export interface AppliedIntervention {
  id: string;
  interventionType: string;
  interventionId: string;
  cmf: number;
  cost: number;
  latitude: number;
  longitude: number;
  timestamp: number;
  roadId?: string;
}
