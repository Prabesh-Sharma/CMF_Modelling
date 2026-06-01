import { useQuery } from "@tanstack/react-query";
import { fetchHotspots } from "@/lib/api/hotspots.functions";
import type { HotspotApiResponse } from "@/lib/hotspot-schema";

export function hotspotsQueryOptions() {
  return {
    queryKey: ["hotspots"] as const,
    queryFn: (): Promise<HotspotApiResponse> => fetchHotspots(),
    staleTime: 5 * 60 * 1000,
  } as const;
}

export function useHotspots() {
  return useQuery(hotspotsQueryOptions());
}
