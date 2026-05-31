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
    shapFactors: z
      .array(
        z.object({
          name: z.string(),
          impact: z.number(),
          description: z.string(),
        }),
      )
      .optional(),
    recommendedInterventions: z.array(z.string()).optional(),
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
  })
  .passthrough();

const ChatContextSchema = z
  .object({
    hotspot: ChatHotspotSchema,
    interventions: z.array(ChatInterventionSchema),
    selectedIntervention: ChatInterventionSchema.nullable(),
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
