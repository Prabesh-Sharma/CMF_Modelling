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
        console.warn(
          `Fetch from ${API_BASE}/api/hotspots failed with status ${res.status}. Falling back to local JSON data.`,
        );
      } catch (error) {
        console.warn(
          `Failed to fetch from ${API_BASE}/api/hotspots. Falling back to local JSON data.`,
          error,
        );
      }
    }

    // 2. Default/Fallback: Load data from client/data/kathmandu_hotspots.json
    // Using dynamic imports for server-only built-in modules ensures that
    // Vite completely ignores them when bundling for the browser.
    const fs = await import("fs");
    const path = await import("path");

    const jsonPath = path.resolve(
      process.cwd(),
      "..",
      "server",
      "data",
      "shap_hotspots.json",
    );
    const rawData = fs.readFileSync(jsonPath, "utf-8");
    const json: unknown = JSON.parse(rawData);

    // Validate using Zod to guarantee runtime type safety
    return HotspotApiResponseSchema.parse(json);
  },
);
