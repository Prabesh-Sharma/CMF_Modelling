import type { RawSeverity, RawHotspot } from "./hotspot-schema";

export type RiskLevel = "critical" | "high" | "medium" | "low";

export interface RiskFactor {
  name: string;
  impact: number;
  description: string;
}

export interface RoadSegment {
  id: string;
  name: string;
  coordinates: [number, number][];
  riskScore: number;
  riskLevel: RiskLevel;
  predictedAnnualCrashes: number;
  riskFactors: RiskFactor[];
}

export interface Hotspot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  riskScore: number;
  riskLevel: RiskLevel;
  predictedCrashes: number;
  riskFactors: RiskFactor[];
  recommendedInterventions: string[];
  source: string;
  roadAnchorLat: number;
  roadAnchorLon: number;
  roadName: string;
  accidentReports: {
    fatal: number;
    major_injury: number;
    minor_injury: number;
    property_damage_only: number;
    pedestrian_related: number;
    speed_related: number;
    turning_related: number;
    head_on: number;
  };
}

const SEVERITY_TO_RISK: Record<RawSeverity, RiskLevel> = {
  critical: "critical",
  high: "high",
  moderate: "medium",
  low: "low",
};

const BASE_SCORE: Record<RawSeverity, number> = {
  critical: 0.88,
  high: 0.7,
  moderate: 0.5,
  low: 0.25,
};

const CRASHES_BY_SEVERITY: Record<RawSeverity, number> = {
  critical: 22,
  high: 14,
  moderate: 7,
  low: 3,
};

const RECOMMENDED_BY_LEVEL: Record<RiskLevel, string[]> = {
  critical: [
    "Install signalized pedestrian crossing",
    "Reduce speed limit and add speed enforcement",
    "Add median refuge islands",
  ],
  high: ["Upgrade lighting", "Add rumble strips", "Install advance warning signage"],
  medium: ["Refresh lane markings", "Add curve warning chevrons", "Improve sightlines"],
  low: ["Routine maintenance", "Monitor with periodic safety audit"],
};

const REASON_LABELS: Record<string, Pick<RiskFactor, "name" | "description">> = {
  "high speed": {
    name: "High Speed",
    description: "Speed-related crashes are common in this cluster",
  },
  "driver carelessness": {
    name: "Driver Carelessness",
    description: "Recorded cause points to unsafe driver behavior",
  },
  "bad turning": {
    name: "Bad Turning",
    description: "Turning maneuvers are a repeated crash cause",
  },
  "alcohol influence": {
    name: "Alcohol Influence",
    description: "Impaired driving is a repeated recorded cause",
  },
  "calling on mobile": {
    name: "Distracted Driving",
    description: "Phone-use related crashes are present in this cluster",
  },
  "lane violation": {
    name: "Lane Violation",
    description: "Lane discipline appears in the recorded causes",
  },
  "pedestrian crossing": {
    name: "Pedestrian Crossing",
    description: "Pedestrian crossing conflicts are present",
  },
  "hit pedestrian": {
    name: "Pedestrian Collision",
    description: "Crashes involving pedestrians are present",
  },
  "rear end/side collision": {
    name: "Rear/Side Collision",
    description: "Rear-end and side-impact collisions are common",
  },
  motorcycle: {
    name: "Motorcycle Exposure",
    description: "Motorcycles are frequently involved",
  },
};

function reasonToRiskFactor(reason: string, totalReasons: number): RiskFactor {
  const label = REASON_LABELS[reason.toLowerCase()] ?? {
    name: reason.charAt(0).toUpperCase() + reason.slice(1),
    description: reason,
  };
  return { ...label, impact: parseFloat((1 / totalReasons).toFixed(2)) };
}

export function rawHotspotsToHotspots(raw: Partial<Record<RawSeverity, RawHotspot[]>>): Hotspot[] {
  return (Object.entries(raw) as [RawSeverity, RawHotspot[]][]).flatMap(([severity, spots]) =>
    spots.map((spot, i): Hotspot => {
      const riskLevel = SEVERITY_TO_RISK[severity];
      const riskScore = Math.min(
        1,
        parseFloat((BASE_SCORE[severity] + spot.reasons.length * 0.01).toFixed(3)),
      );
      return {
        id: spot.id ?? `${severity}-${i}-${spot.name.replace(/\s+/g, "-").toLowerCase()}`,
        name: spot.name,
        latitude: spot.lat,
        longitude: spot.lon,
        riskScore,
        riskLevel,
        predictedCrashes: spot.crash_count ?? CRASHES_BY_SEVERITY[severity],
        riskFactors: spot.reasons.map((r) => reasonToRiskFactor(r, spot.reasons.length)),
        recommendedInterventions: spot.recommended_interventions ?? RECOMMENDED_BY_LEVEL[riskLevel],
        source: spot.source,
        roadAnchorLat: spot.road_anchor_lat ?? spot.lat,
        roadAnchorLon: spot.road_anchor_lon ?? spot.lon,
        roadName: spot.road_name ?? spot.corridor ?? "Nearby OSM road",
        accidentReports: spot.accident_reports ?? {
          fatal: 0,
          major_injury: 0,
          minor_injury: 0,
          property_damage_only: 0,
          pedestrian_related: 0,
          speed_related: 0,
          turning_related: 0,
          head_on: 0,
        },
      };
    }),
  );
}

export function hotspotRadius(score: number): number {
  if (score > 0.8) return 30;
  if (score > 0.6) return 22;
  if (score > 0.4) return 16;
  return 10;
}

export const RISK_COLORS: Record<RiskLevel, string> = {
  critical: "#dc2626",
  high: "#ea7c1d",
  medium: "#eab308",
  low: "#16a34a",
};

export const SELECTED_COLOR = "#06b6d4";
export const INTERVENTION_COLOR = "#2563eb";
