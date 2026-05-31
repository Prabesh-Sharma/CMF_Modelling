import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AppliedIntervention } from "../interventions";

const API_BASE = process.env["HOTSPOTS_API_URL"] ?? "http://localhost:8000";

export interface InterventionResponse {
  interventions: AppliedIntervention[];
  totalCost: number;
  combinedCmf: number;
  baselineCrashes?: number | null;
  postCrashes?: number | null;
}

const InterventionSchema = z.object({
  id: z.string(),
  interventionType: z.string(),
  interventionId: z.string(),
  cmf: z.number(),
  cost: z.number(),
  latitude: z.number(),
  longitude: z.number(),
  timestamp: z.number().int(),
  roadId: z.string().optional(),
});

const SubmitInterventionsSchema = z.object({
  interventions: z.array(InterventionSchema),
  baselineCrashes: z.number().optional(),
});

export const submitInterventions = createServerFn({ method: "POST" })
  .inputValidator(SubmitInterventionsSchema)
  .handler(async ({ data }) => {
    const res = await fetch(`${API_BASE}/api/interventions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Interventions API failed: ${res.status} ${detail}`);
    }

    return (await res.json()) as InterventionResponse;
  });
