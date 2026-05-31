import type { RawSeverity, RawHotspot } from "./hotspot-schema";

export type RiskLevel = "critical" | "high" | "medium" | "low";

export interface ShapFactor {
  name: string;
  impact: number; // 0-1
  description: string;
}

export interface RoadSegment {
  id: string;
  name: string;
  coordinates: [number, number][];
  riskScore: number; // 0-100
  riskLevel: RiskLevel;
  predictedAnnualCrashes: number;
  shapFactors: ShapFactor[];
}

export interface Hotspot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  riskScore: number; // 0-1
  riskLevel: RiskLevel;
  predictedCrashes: number;
  shapFactors: ShapFactor[];
  recommendedInterventions: string[];
  /** Data source attribution (e.g. Nepal Traffic Police / IOE/BMC research) */
  source: string;
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score > 0.8) return "critical";
  if (score > 0.6) return "high";
  if (score > 0.4) return "medium";
  return "low";
}

// ── Raw → Hotspot transformer ─────────────────────────────────────────────────

/** Maps API severity string to internal RiskLevel ("moderate" → "medium"). */
const SEVERITY_TO_RISK: Record<RawSeverity, RiskLevel> = {
  critical: "critical",
  high: "high",
  moderate: "medium",
  low: "low",
};

/** Base risk score (0-1) per severity; reasons push it slightly higher. */
const BASE_SCORE: Record<RawSeverity, number> = {
  critical: 0.88,
  high: 0.7,
  moderate: 0.5,
  low: 0.25,
};

/** Estimated annual crashes per severity tier. */
const CRASHES_BY_SEVERITY: Record<RawSeverity, number> = {
  critical: 22,
  high: 14,
  moderate: 7,
  low: 3,
};

/**
 * Human-readable labels for common reason tokens from the API.
 * Keys are lowercase reason strings; extend as new reasons appear.
 */
const REASON_LABELS: Record<string, Pick<ShapFactor, "name" | "description">> = {
  "high speed": {
    name: "High Speed",
    description: "Vehicles frequently exceed posted speed limit",
  },
  "pedestrian crossing": {
    name: "Pedestrian Activity",
    description: "High foot traffic / unprotected crossings",
  },
  "poor lighting": { name: "Poor Lighting", description: "Insufficient luminance after dark" },
  "poor signage": { name: "Poor Signage", description: "Missing or unclear road signs" },
  "merging traffic": {
    name: "Merging Traffic",
    description: "Unsignaled lane merges increase conflict points",
  },
  "high volume": {
    name: "Traffic Density",
    description: "Peak-hour saturation causes stop-and-go",
  },
  "signal timing": {
    name: "Signal Timing",
    description: "Suboptimal phase lengths increase violations",
  },
  "bus stops": { name: "Bus Stop Conflict", description: "Passenger boarding obstructs lane flow" },
  speeding: { name: "Speeding", description: "Excessive speed observed beyond limit" },
  "steep grade": { name: "Gradient", description: "Downhill grade increases stopping distance" },
  "overloaded trucks": {
    name: "Heavy Vehicles",
    description: "Overloaded freight reduces braking performance",
  },
  "sharp bends": { name: "Curvature", description: "Sight-distance limited by horizontal curves" },
  "lane merging": {
    name: "Lane Merging",
    description: "Unmanaged lane merges increase side-swipe risk",
  },
  "narrow lanes": {
    name: "Lane Width",
    description: "Sub-standard lane widths reduce lateral clearance",
  },
  "truck traffic": {
    name: "Heavy Vehicles",
    description: "High freight share elevates severity of crashes",
  },
  "airport traffic": {
    name: "Airport Traffic",
    description: "High mixed vehicle volume near terminal",
  },
  "commercial congestion": {
    name: "Commercial Congestion",
    description: "Retail density generates pedestrian-vehicle conflicts",
  },
};

function reasonToShapFactor(reason: string, totalReasons: number): ShapFactor {
  const label = REASON_LABELS[reason.toLowerCase()] ?? {
    name: reason.charAt(0).toUpperCase() + reason.slice(1),
    description: reason,
  };
  // Equal-weight split across reasons; swap for real SHAP values from model
  const impact = parseFloat((1 / totalReasons).toFixed(2));
  return { ...label, impact };
}

/**
 * Converts the raw `/api/hotspots` payload into the `Hotspot[]` shape
 * consumed by MapView and HotspotPanel.
 *
 * Accepts `Partial<Record<...>>` because `z.record()` with an enum key
 * produces optional values — missing severity buckets default to [].
 */
export function rawHotspotsToHotspots(raw: Partial<Record<RawSeverity, RawHotspot[]>>): Hotspot[] {
  return (Object.entries(raw) as [RawSeverity, RawHotspot[]][]).flatMap(([severity, spots]) =>
    spots.map((spot, i): Hotspot => {
      const riskLevel = SEVERITY_TO_RISK[severity];
      const riskScore = parseFloat((BASE_SCORE[severity] + spot.reasons.length * 0.01).toFixed(3));
      return {
        id: `${severity}-${i}-${spot.name.replace(/\s+/g, "-").toLowerCase()}`,
        name: spot.name,
        latitude: spot.lat,
        longitude: spot.lon,
        riskScore,
        riskLevel,
        predictedCrashes: CRASHES_BY_SEVERITY[severity],
        shapFactors: spot.reasons.map((r) => reasonToShapFactor(r, spot.reasons.length)),
        recommendedInterventions: RECOMMENDED_BY_LEVEL[riskLevel],
        source: spot.source,
      } satisfies Hotspot;
    }),
  );
}

export function hotspotRadius(score: number): number {
  if (score > 0.8) return 30;
  if (score > 0.6) return 22;
  if (score > 0.4) return 16;
  return 10;
}

const RECOMMENDED_BY_LEVEL: Record<RiskLevel, string[]> = {
  critical: [
    "Install signalized pedestrian crossing",
    "Reduce speed limit & add speed cameras",
    "Add raised median refuge islands",
  ],
  high: [
    "Upgrade street lighting",
    "Add rumble strips on approach",
    "Install advance warning signage",
  ],
  medium: [
    "Refresh lane markings & reflectors",
    "Add curve warning chevrons",
    "Improve sightlines (vegetation trim)",
  ],
  low: ["Routine pavement maintenance", "Monitor with periodic safety audit"],
};

// Centered on Kathmandu for realistic feel
const KTM: [number, number] = [27.7172, 85.324];

function offset(lat: number, lng: number, dLat: number, dLng: number): [number, number] {
  return [lat + dLat, lng + dLng];
}

export const ROAD_SEGMENTS: RoadSegment[] = [
  {
    id: "r1",
    name: "Durbar Marg",
    coordinates: [
      offset(KTM[0], KTM[1], 0.002, -0.001),
      offset(KTM[0], KTM[1], 0.006, -0.001),
      offset(KTM[0], KTM[1], 0.009, 0.0005),
    ],
    riskScore: 88,
    riskLevel: "critical",
    predictedAnnualCrashes: 25,
    shapFactors: [
      { name: "High Speed", impact: 0.34, description: "Avg speed 62 km/h exceeds limit" },
      { name: "Pedestrian Activity", impact: 0.28, description: "High foot traffic near retail" },
      { name: "Poor Lighting", impact: 0.21, description: "Low luminance after 8pm" },
      { name: "Traffic Density", impact: 0.17, description: "Peak-hour congestion" },
    ],
  },
  {
    id: "r2",
    name: "Ring Road – Kalanki",
    coordinates: [
      offset(KTM[0], KTM[1], -0.004, -0.012),
      offset(KTM[0], KTM[1], -0.002, -0.008),
      offset(KTM[0], KTM[1], 0.001, -0.004),
    ],
    riskScore: 76,
    riskLevel: "high",
    predictedAnnualCrashes: 18,
    shapFactors: [
      { name: "High Speed", impact: 0.41, description: "Highway-grade traffic" },
      { name: "Lane Width", impact: 0.22, description: "Narrow shoulder" },
      { name: "Heavy Vehicles", impact: 0.19, description: "Freight share 28%" },
      { name: "Intersection Density", impact: 0.18, description: "Multiple unsignaled merges" },
    ],
  },
  {
    id: "r3",
    name: "New Road",
    coordinates: [
      offset(KTM[0], KTM[1], -0.001, 0.001),
      offset(KTM[0], KTM[1], -0.003, 0.004),
      offset(KTM[0], KTM[1], -0.005, 0.007),
    ],
    riskScore: 71,
    riskLevel: "high",
    predictedAnnualCrashes: 15,
    shapFactors: [
      { name: "Pedestrian Activity", impact: 0.45, description: "Major commercial district" },
      { name: "Sidewalk Quality", impact: 0.23, description: "Encroached walkways" },
      { name: "Signal Timing", impact: 0.18, description: "Long crossing wait" },
      { name: "Traffic Density", impact: 0.14, description: "Saturated mid-day" },
    ],
  },
  {
    id: "r4",
    name: "Maharajgunj Road",
    coordinates: [
      offset(KTM[0], KTM[1], 0.012, 0.002),
      offset(KTM[0], KTM[1], 0.016, 0.003),
      offset(KTM[0], KTM[1], 0.02, 0.005),
    ],
    riskScore: 54,
    riskLevel: "medium",
    predictedAnnualCrashes: 9,
    shapFactors: [
      { name: "Curvature", impact: 0.31, description: "Sharp bend at km 2.1" },
      { name: "Poor Lighting", impact: 0.27, description: "Sparse street lights" },
      { name: "Traffic Density", impact: 0.22, description: "Moderate volume" },
      { name: "Pavement Condition", impact: 0.2, description: "Surface deterioration" },
    ],
  },
  {
    id: "r5",
    name: "Lazimpat",
    coordinates: [
      offset(KTM[0], KTM[1], 0.004, 0.003),
      offset(KTM[0], KTM[1], 0.008, 0.004),
      offset(KTM[0], KTM[1], 0.012, 0.004),
    ],
    riskScore: 48,
    riskLevel: "medium",
    predictedAnnualCrashes: 7,
    shapFactors: [
      { name: "Pedestrian Activity", impact: 0.33, description: "Embassy & hotel zone" },
      { name: "On-street Parking", impact: 0.25, description: "Reduces visibility" },
      { name: "Traffic Density", impact: 0.22, description: "Mixed-use traffic" },
      { name: "Lighting", impact: 0.2, description: "Adequate but inconsistent" },
    ],
  },
  {
    id: "r6",
    name: "Sanepa Bridge Approach",
    coordinates: [
      offset(KTM[0], KTM[1], -0.008, -0.002),
      offset(KTM[0], KTM[1], -0.011, -0.003),
      offset(KTM[0], KTM[1], -0.014, -0.003),
    ],
    riskScore: 32,
    riskLevel: "low",
    predictedAnnualCrashes: 4,
    shapFactors: [
      { name: "Traffic Density", impact: 0.4, description: "Light off-peak" },
      { name: "Lane Width", impact: 0.25, description: "Generous lanes" },
      { name: "Lighting", impact: 0.2, description: "Recently upgraded" },
      { name: "Speed", impact: 0.15, description: "Compliant" },
    ],
  },
  {
    id: "r7",
    name: "Patan Industrial Estate Rd",
    coordinates: [
      offset(KTM[0], KTM[1], -0.013, 0.006),
      offset(KTM[0], KTM[1], -0.016, 0.009),
      offset(KTM[0], KTM[1], -0.018, 0.013),
    ],
    riskScore: 28,
    riskLevel: "low",
    predictedAnnualCrashes: 3,
    shapFactors: [
      { name: "Traffic Density", impact: 0.38, description: "Industrial low-traffic" },
      { name: "Lighting", impact: 0.25, description: "Well-lit" },
      { name: "Speed", impact: 0.2, description: "Enforced 40 km/h" },
      { name: "Pedestrian Activity", impact: 0.17, description: "Minimal" },
    ],
  },
];

export const RISK_COLORS: Record<RiskLevel, string> = {
  critical: "#dc2626",
  high: "#ea7c1d",
  medium: "#eab308",
  low: "#16a34a",
};

export const SELECTED_COLOR = "#06b6d4";
export const INTERVENTION_COLOR = "#2563eb";

/** Static fallback used until /api/hotspots is available. */
export const HOTSPOTS: Hotspot[] = ROAD_SEGMENTS.map((r) => {
  const mid = r.coordinates[Math.floor(r.coordinates.length / 2)];
  const score = r.riskScore / 100;
  const level = riskLevelFromScore(score);
  return {
    id: r.id,
    name: r.name,
    latitude: mid[0],
    longitude: mid[1],
    riskScore: score,
    riskLevel: level,
    predictedCrashes: r.predictedAnnualCrashes,
    shapFactors: r.shapFactors,
    recommendedInterventions: RECOMMENDED_BY_LEVEL[level],
    source: "static fallback",
  } satisfies Hotspot;
});
