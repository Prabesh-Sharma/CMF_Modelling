import { useQuery } from "@tanstack/react-query";
import { fetchHotspots } from "@/lib/api/hotspots.functions";
import { rawHotspotsToHotspots } from "@/lib/road-data";
import type { Hotspot } from "@/lib/road-data";
import type { HotspotApiResponse } from "@/lib/hotspot-schema";

/**
 * Shareable query options — used both in `useHotspots()` and the route
 * loader so the server prefetch and client hook share the exact same cache key.
 */
export function hotspotsQueryOptions() {
  return {
    queryKey: ["hotspots"] as const,
    queryFn: (): Promise<HotspotApiResponse> => fetchHotspots(),
    staleTime: 5 * 60 * 1000, // 5 min — hotspot data changes slowly

    // Runs client-side after the server fn returns; transforms raw → Hotspot[]
    // so all consumers always receive the internal shape — no casting needed.
    select: (data: HotspotApiResponse): Hotspot[] => rawHotspotsToHotspots(data.hotspots),
  } as const;
}

/**
 * Fetches and caches hotspot data from `/api/hotspots`.
 *
 * Returns `{ data: Hotspot[] | undefined, isLoading, isError, error }`.
 * The route loader (`ensureQueryData`) ensures data is pre-populated on
 * first render so `isLoading` is almost never `true` in practice.
 */
export function useHotspots() {
  return useQuery(hotspotsQueryOptions());
}
