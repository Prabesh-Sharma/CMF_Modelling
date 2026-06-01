/**
 * Zod schema for the /api/hotspots response.
 * Single source of truth — TypeScript types are inferred from here,
 * never written by hand.
 */
import { z } from "zod";

// ── Raw severity as returned by the API ───────────────────────────────────────
export const RawSeveritySchema = z.enum(["critical", "high", "moderate", "low"]);

export const RawHotspotSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  severity: RawSeveritySchema,
  reasons: z.array(z.string()).min(1),
  source: z.string(),
  crash_count: z.number().int().optional(),
  severity_index: z.number().optional(),
  top_cause: z.string().optional(),
  road_class: z.string().optional(),
  corridor: z.string().optional(),
  recommended_interventions: z.array(z.string()).optional(),
  road_anchor_lat: z.number().optional(),
  road_anchor_lon: z.number().optional(),
  road_name: z.string().optional(),
  accident_reports: z
    .object({
      fatal: z.number().int(),
      major_injury: z.number().int(),
      minor_injury: z.number().int(),
      property_damage_only: z.number().int(),
      pedestrian_related: z.number().int(),
      speed_related: z.number().int(),
      turning_related: z.number().int(),
      head_on: z.number().int(),
    })
    .optional(),
});

export const CrashPointSchema = z.object({
  id: z.string(),
  lat: z.number(),
  lon: z.number(),
  severity: z.string(),
  severityLevel: RawSeveritySchema,
  cause: z.string(),
  collisionType: z.string(),
  vehicleType: z.string(),
  roadClass: z.string(),
  corridor: z.string(),
  roadName: z.string(),
  roadDistanceMeters: z.number(),
  date: z.string(),
  time: z.string(),
  year: z.number().int(),
  clusterId: z.number().nullable(),
  hotspotId: z.string().nullable(),
});

export const CrashClusterSchema = z.object({
  cluster_id: z.number().int(),
  ui_id: z.string(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  crash_count: z.number().int(),
  severity_index: z.number(),
  risk_level: RawSeveritySchema,
  risk_score: z.number(),
  corridor: z.string(),
  road_class: z.string(),
  top_cause: z.string(),
  top_causes: z.array(z.string()),
  top_collisions: z.array(z.string()),
  top_vehicles: z.array(z.string()),
  recommended_interventions: z.array(z.string()),
  road_anchor_lat: z.number(),
  road_anchor_lon: z.number(),
  road_name: z.string(),
  accident_reports: z.object({
    fatal: z.number().int(),
    major_injury: z.number().int(),
    minor_injury: z.number().int(),
    property_damage_only: z.number().int(),
    pedestrian_related: z.number().int(),
    speed_related: z.number().int(),
    turning_related: z.number().int(),
    head_on: z.number().int(),
  }),
});

export const HotspotApiResponseSchema = z.object({
  metadata: z.object({
    title: z.string(),
    sources: z.array(z.string()),
    coverage: z.string(),
    total_hotspots: z.number().int().nonnegative(),
    total_crashes: z.number().int().optional(),
    severity_counts: z.record(RawSeveritySchema, z.number()),
  }),
  // Each severity key maps to an array of hotspots
  hotspots: z.record(RawSeveritySchema, z.array(RawHotspotSchema)),
  crashes: z.array(CrashPointSchema).optional().default([]),
  clusters: z.array(CrashClusterSchema).optional().default([]),
  heatmap: z.array(z.tuple([z.number(), z.number(), z.number()])).optional().default([]),
  heatmapOptions: z
    .object({
      radius: z.number(),
      blur: z.number(),
      maxZoom: z.number(),
    })
    .optional(),
});

// ── Inferred types — never write these by hand ────────────────────────────────
export type RawSeverity = z.infer<typeof RawSeveritySchema>;
export type RawHotspot = z.infer<typeof RawHotspotSchema>;
export type CrashPoint = z.infer<typeof CrashPointSchema>;
export type CrashCluster = z.infer<typeof CrashClusterSchema>;
export type HotspotApiResponse = z.infer<typeof HotspotApiResponseSchema>;
