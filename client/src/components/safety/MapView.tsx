import { MapContainer, TileLayer, CircleMarker, Popup, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import { useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { RISK_COLORS, INTERVENTION_COLOR } from "@/lib/road-data";
import { getInterventionIcon } from "@/lib/interventions";
import type { AppliedIntervention, InterventionType } from "@/lib/interventions";
import type { CrashPoint } from "@/lib/hotspot-schema";

// Default Leaflet icon fix
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function buildInterventionIcon(
  interventionId: string,
  selected: boolean,
  origin: "planner" | "llm" = "planner",
): L.DivIcon {
  const IconComp = getInterventionIcon(interventionId);
  const svg = renderToStaticMarkup(
    createElement(IconComp, { size: 16, color: "white", strokeWidth: 2.5 }),
  );
  const size = selected ? 34 : 28;
  const border = selected ? "3px solid white" : "2px solid white";
  const shadow = selected ? "0 4px 14px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.4)";
  const color = origin === "llm" ? "#dc2626" : INTERVENTION_COLOR;
  return L.divIcon({
    className: "intervention-divicon",
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:${border};border-radius:50%;box-shadow:${shadow};display:flex;align-items:center;justify-content:center">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

interface MapViewProps {
  crashes: CrashPoint[];
  clusterReports: Record<
    string,
    { crashCount: number; fatal: number; majorInjury: number; pedestrian: number; turning: number }
  >;
  heatmap: Array<[number, number, number]>;
  selectedHotspotId: string | null;
  onSelectHotspot: (id: string) => void;
  interventions: AppliedIntervention[];
  pendingIntervention: InterventionType | null;
  onDropIntervention: (lat: number, lng: number) => void;
  onMoveIntervention: (id: string, lat: number, lng: number) => void;
  selectedInterventionId: string | null;
  onSelectIntervention: (id: string) => void;
}

function HeatmapLayer({ data }: { data: Array<[number, number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (!data.length) return;
    const layer = L.heatLayer(data, {
      radius: 35,
      blur: 25,
      maxZoom: 17,
    }).addTo(map);
    return () => {
      layer.remove();
    };
  }, [data, map]);
  return null;
}

function DropHandler({ onDrop }: { onDrop: (lat: number, lng: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const point = L.point(e.clientX - rect.left, e.clientY - rect.top);
      const latlng = map.containerPointToLatLng(point);
      onDrop(latlng.lat, latlng.lng);
    };
    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);
    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
    };
  }, [map, onDrop]);
  return null;
}

export function MapView(props: MapViewProps) {
  const {
    crashes,
    clusterReports,
    heatmap,
    selectedHotspotId,
    onSelectHotspot,
    interventions,
    pendingIntervention,
    onDropIntervention,
    onMoveIntervention,
    selectedInterventionId,
    onSelectIntervention,
  } = props;

  const center: [number, number] = [27.7172, 85.324];
  const mapRef = useRef<L.Map | null>(null);
  // CHANGE 1 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â crash point halving
  const filteredCrashes = crashes.filter((crash) => Number(crash.id) % 2 === 0);

  const interventionsByCrash = new Map(
    interventions
      .filter((intervention) => intervention.crashId)
      .map((intervention) => [intervention.crashId, intervention]),
  );
  const interventionsByHotspot = interventions.reduce<Record<string, AppliedIntervention[]>>(
    (acc, intervention) => {
      if (!intervention.roadId) return acc;
      acc[intervention.roadId] = [...(acc[intervention.roadId] ?? []), intervention];
      return acc;
    },
    {},
  );
  const interventionForCrash = (crash: CrashPoint) => {
    const exact = interventionsByCrash.get(crash.id);
    if (exact) return exact;
    const clusterInterventions = crash.hotspotId ? interventionsByHotspot[crash.hotspotId] : null;
    if (!clusterInterventions?.length) return null;
    return clusterInterventions[Number(crash.id) % clusterInterventions.length];
  };

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={14}
        preferCanvas
        className="h-full w-full"
        ref={(m) => {
          mapRef.current = m;
        }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <DropHandler onDrop={onDropIntervention} />
        <HeatmapLayer data={heatmap} />

        {filteredCrashes.map((crash) => {
          const appliedIntervention = interventionForCrash(crash);
          return (
          <CircleMarker
            key={crash.id}
            center={[crash.lat, crash.lon]}
            radius={2.5}
            pathOptions={{
              color: RISK_COLORS[crash.severityLevel === "moderate" ? "medium" : crash.severityLevel],
              weight: 1,
              opacity: 0.45,
              fillColor: RISK_COLORS[crash.severityLevel === "moderate" ? "medium" : crash.severityLevel],
              fillOpacity: 0.45,
            }}
            eventHandlers={{
              click: () => crash.hotspotId && onSelectHotspot(crash.hotspotId),
            }}
          >
            {/* CHANGE 2 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â hover tooltip */}
            <Tooltip direction="top" offset={[0, -4]} opacity={1} className="crash-tooltip">
              <div
                style={{
                  background: "#0d1117",
                  border: "1px solid #ff2d55",
                  borderRadius: "6px",
                  padding: "8px 10px",
                  fontFamily: "'Courier New', monospace",
                  fontSize: "11px",
                  color: "#e6edf3",
                  minWidth: "200px",
                  lineHeight: 1.7,
                }}
              >
                <div style={{ color: "#ff2d55", fontWeight: "bold", marginBottom: "4px" }}>
                  ÃƒÂ¢Ã…Â¡Ã‚Â  CRASH RECORD #{crash.id}
                </div>
                <div>
                  <b>Type:</b> {crash.collisionType}
                </div>
                <div>
                  ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â <b>Cause:</b> {crash.cause}
                </div>
                <div>
                  <b>Severity:</b> {crash.severity}
                </div>
                <div>
                  <b>Vehicle:</b> {crash.vehicleType}
                </div>
                <div>
                  <b>Road:</b> {crash.roadClass}
                </div>
                <div>
                  <b>Corridor:</b> {crash.corridor}
                </div>
                <div>
                  <b>Date:</b> {crash.date} &nbsp;{crash.time}
                </div>
                {appliedIntervention ? (
                  <div
                    style={{
                      marginTop: "6px",
                      paddingTop: "6px",
                      borderTop: "1px solid #30363d",
                      color: "#79c0ff",
                    }}
                  >
                    <div>
                      <b>Nearby intervention:</b> {appliedIntervention.interventionType}
                    </div>
                    <div>
                      <b>Crash reason:</b> {appliedIntervention.crashCause ?? crash.cause}
                    </div>
                    <div>
                      <b>CMF effect:</b> 1.00 -&gt; {appliedIntervention.cmf.toFixed(2)} (
                      {Math.round((1 - appliedIntervention.cmf) * 100)}% lower matching crash risk)
                    </div>
                  </div>
                ) : null}
              </div>
            </Tooltip>
            <Popup>
              <div className="min-w-[220px] space-y-1.5 text-[12px]">
                <div className="font-semibold">Crash #{crash.id}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <span className="text-slate-500">Severity</span>
                  <span>{crash.severity}</span>
                  <span className="text-slate-500">Cause</span>
                  <span>{crash.cause}</span>
                  <span className="text-slate-500">Collision</span>
                  <span>{crash.collisionType}</span>
                  <span className="text-slate-500">Vehicle</span>
                  <span>{crash.vehicleType}</span>
                  <span className="text-slate-500">Corridor</span>
                  <span>{crash.corridor}</span>
                  <span className="text-slate-500">OSM Road</span>
                  <span>{crash.roadName}</span>
                  <span className="text-slate-500">Date</span>
                  <span>
                    {crash.date} {crash.time}
                  </span>
                </div>
              </div>
            </Popup>
          </CircleMarker>
          );
        })}

        {interventions.map((iv) => {
          const isSelected = selectedInterventionId === iv.id;
          return (
            <Marker
              key={iv.id}
              position={[iv.latitude, iv.longitude]}
              icon={buildInterventionIcon(iv.interventionId, isSelected, iv.origin)}
              draggable={iv.origin !== "llm"}
              eventHandlers={{
                click: () => onSelectIntervention(iv.id),
                dragend: (e) => {
                  const marker = e.target as L.Marker;
                  const latlng = marker.getLatLng();
                  onMoveIntervention(iv.id, latlng.lat, latlng.lng);
                },
              }}
              opacity={isSelected ? 1 : 0.95}
            >
              <Popup>
                <div className="min-w-[200px] space-y-1.5 text-[12px]">
                  <div className="text-sm font-semibold">{iv.interventionType}</div>
                  <div className={iv.origin === "llm" ? "text-red-600" : "text-blue-600"}>
                    {iv.origin === "llm" ? "LLM recommendation" : "Planner recommendation"}
                  </div>
                  {iv.rationale ? (
                    <div className="rounded border bg-white p-2 text-[11px] leading-snug">
                      {iv.rationale}
                    </div>
                  ) : null}
                  <div className="rounded bg-slate-50 p-2 font-mono text-[11px] leading-relaxed">
                    <div>
                      <span className="text-slate-500">lat: </span>
                      {iv.latitude.toFixed(6)}
                    </div>
                    <div>
                      <span className="text-slate-500">lng: </span>
                      {iv.longitude.toFixed(6)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">CMF {iv.cmf.toFixed(2)}</span>
                  </div>
                  <div className="rounded bg-slate-50 p-2 text-[11px]">
                    CMF means crash multiplier. A CMF of {iv.cmf.toFixed(2)} projects{" "}
                    {Math.round((1 - iv.cmf) * 100)}% fewer matching crashes.
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {pendingIntervention && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg">
          Drop ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ{pendingIntervention.name}ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â anywhere on the map
        </div>
      )}

      <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border bg-card/95 p-3 text-xs shadow-lg backdrop-blur">
        <div className="mb-2 font-semibold">Risk Legend</div>
        {(["critical", "high", "medium", "low"] as const).map((lvl) => (
          <div key={lvl} className="flex items-center gap-2 py-0.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: RISK_COLORS[lvl] }}
            />
            <span className="capitalize">{lvl}</span>
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2 border-t pt-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: INTERVENTION_COLOR }}
          />
          <span>Planner recommendation</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-red-600" />
          <span>LLM recommendation</span>
        </div>
      </div>
    </div>
  );
}
