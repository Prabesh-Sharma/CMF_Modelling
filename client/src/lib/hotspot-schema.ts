/**
 * Zod schema for the /api/hotspots response.
 * Single source of truth — TypeScript types are inferred from here,
 * never written by hand.
 */
import { z } from "zod";

// ── Raw severity as returned by the API ───────────────────────────────────────
export const RawSeveritySchema = z.enum(["critical", "high", "moderate", "low"]);

export const RawHotspotSchema = z.object({
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  severity: RawSeveritySchema,
  reasons: z.array(z.string()).min(1),
  source: z.string(),
});

export const HotspotApiResponseSchema = z.object({
  metadata: z.object({
    title: z.string(),
    sources: z.array(z.string()),
    coverage: z.string(),
    total_hotspots: z.number().int().positive(),
    severity_counts: z.record(RawSeveritySchema, z.number()),
  }),
  // Each severity key maps to an array of hotspots
  hotspots: z.record(RawSeveritySchema, z.array(RawHotspotSchema)),
});

// ── Inferred types — never write these by hand ────────────────────────────────
export type RawSeverity = z.infer<typeof RawSeveritySchema>;
export type RawHotspot = z.infer<typeof RawHotspotSchema>;
export type HotspotApiResponse = z.infer<typeof HotspotApiResponseSchema>;
