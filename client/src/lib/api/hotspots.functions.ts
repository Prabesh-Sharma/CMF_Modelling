import { createServerFn } from "@tanstack/react-start";
import { HotspotApiResponseSchema } from "../hotspot-schema";
import type { HotspotApiResponse } from "../hotspot-schema";

const API_BASE = process.env["HOTSPOTS_API_URL"] ?? "http://localhost:8000";

export const fetchHotspots = createServerFn({ method: "GET" }).handler(
  async (): Promise<HotspotApiResponse> => {
    // 1. If HOTSPOTS_API_URL is defined, attempt to fetch from remote API
    if (API_BASE) {
      try {
        const res = await fetch(`${API_BASE}/api/hotspots`, {
          headers: { Accept: "application/json" },
        });

        if (res.ok) {
          const json: unknown = await res.json();
          return HotspotApiResponseSchema.parse(json);
        }
        console.warn(`Fetch from ${API_BASE}/api/hotspots failed with status ${res.status}.`);
      } catch (error) {
        console.warn(`Failed to fetch from ${API_BASE}/api/hotspots.`, error);
      }
    }

    // Fallback for local development when the FastAPI backend is not running.
    const fs = await import("fs");
    const path = await import("path");

    const jsonPath = path.resolve(process.cwd(), "..", "server", "data", "crash_map.json");
    const rawData = fs.readFileSync(jsonPath, "utf-8");
    const json: unknown = JSON.parse(rawData);

    return HotspotApiResponseSchema.parse(json);
  },
);
