import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const API_BASE = process.env["HOTSPOTS_API_URL"] ?? "http://localhost:8000";

const ChatHotspotSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    riskLevel: z.string(),
    riskScore: z.number(),
    predictedCrashes: z.number().optional(),
    source: z.string().optional(),
    riskFactors: z
      .array(
        z.object({
          name: z.string(),
          impact: z.number(),
          description: z.string(),
        }),
      )
      .optional(),
    recommendedInterventions: z.array(z.string()).optional(),
    accidentReports: z.record(z.string(), z.number()).optional(),
    roadAnchorLat: z.number().optional(),
    roadAnchorLon: z.number().optional(),
    roadName: z.string().optional(),
  })
  .passthrough()
  .nullable();

const ChatInterventionSchema = z
  .object({
    id: z.string(),
    interventionType: z.string(),
    interventionId: z.string(),
    cmf: z.number(),
    cost: z.number(),
    latitude: z.number(),
    longitude: z.number(),
    timestamp: z.number().int(),
    roadId: z.string().optional(),
    roadContext: z
      .object({
        roadClass: z.string().optional(),
        corridor: z.string().optional(),
        roadName: z.string().optional(),
        hotspotName: z.string().optional(),
        riskLevel: z.string().optional(),
        dominantCauses: z.array(z.string()).optional(),
        nearbyCrashCause: z.string().optional(),
        nearbyCollisionType: z.string().optional(),
        nearbyVehicleType: z.string().optional(),
      })
      .optional(),
    origin: z.enum(["planner", "llm"]).optional(),
    rationale: z.string().optional(),
  })
  .passthrough();

const ChatContextSchema = z
  .object({
    hotspot: ChatHotspotSchema,
    interventions: z.array(ChatInterventionSchema),
    selectedIntervention: ChatInterventionSchema.nullable(),
    nearbyInterventions: z.array(ChatInterventionSchema).optional(),
  })
  .passthrough();

const ChatRequestSchema = z.object({
  message: z.string().min(1),
  context: ChatContextSchema,
});

export interface ChatResponse {
  reply: string;
  combinedCmf?: number | null;
  postCrashes?: number | null;
  sources?: { source?: string | null; score?: number | null }[];
  recommendations?: ModelRecommendation[];
  impactModel?: {
    cmfDefinition: string;
    baselineCrashes?: number | null;
    combinedCmf?: number | null;
    projectedCrashes?: number | null;
    crashReduction?: number | null;
  } | null;
}

export interface ModelRecommendation {
  interventionId: string;
  interventionType: string;
  cmf: number;
  cost: number;
  rationale: string;
  matchedModel?: string | null;
  baselineCrashes?: number;
  projectedCrashes?: number;
  crashReduction?: number;
  reductionPct?: number;
}

export const submitChat = createServerFn({ method: "POST" })
  .inputValidator(ChatRequestSchema)
  .handler(async ({ data }) => {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Chat API failed: ${res.status} ${detail}`);
    }

    return (await res.json()) as ChatResponse;
  });

export const evaluateIntervention = createServerFn({ method: "POST" })
  .inputValidator(z.object({ name: z.string().min(2) }))
  .handler(async ({ data }): Promise<ModelRecommendation> => {
    const res = await fetch(`${API_BASE}/api/evaluate-intervention`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`CMF evaluation failed: ${res.status}`);
    return (await res.json()) as ModelRecommendation;
  });
