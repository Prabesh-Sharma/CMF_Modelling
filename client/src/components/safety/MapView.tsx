import { MapContainer, TileLayer, CircleMarker, Popup, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import type { Hotspot } from "@/lib/road-data";
import { RISK_COLORS, SELECTED_COLOR, INTERVENTION_COLOR, hotspotRadius } from "@/lib/road-data";
import { getInterventionIcon } from "@/lib/interventions";
import type { AppliedIntervention, InterventionType } from "@/lib/interventions";

// Default Leaflet icon fix
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function buildInterventionIcon(interventionId: string, selected: boolean): L.DivIcon {
  const IconComp = getInterventionIcon(interventionId);
  const svg = renderToStaticMarkup(
    createElement(IconComp, { size: 16, color: "white", strokeWidth: 2.5 }),
  );
  const size = selected ? 34 : 28;
  const border = selected ? "3px solid white" : "2px solid white";
  const shadow = selected ? "0 4px 14px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.4)";
  return L.divIcon({
    className: "intervention-divicon",
    html: `<div style="width:${size}px;height:${size}px;background:${INTERVENTION_COLOR};border:${border};border-radius:50%;box-shadow:${shadow};display:flex;align-items:center;justify-content:center">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

interface MapViewProps {
  hotspots: Hotspot[];
  selectedHotspotId: string | null;
  onSelectHotspot: (id: string) => void;
  interventions: AppliedIntervention[];
  pendingIntervention: InterventionType | null;
  onDropIntervention: (lat: number, lng: number) => void;
  onMoveIntervention: (id: string, lat: number, lng: number) => void;
  hotspotsWithInterventions: Set<string>;
  selectedInterventionId: string | null;
  onSelectIntervention: (id: string) => void;
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
    hotspots,
    selectedHotspotId,
    onSelectHotspot,
    interventions,
    pendingIntervention,
    onDropIntervention,
    onMoveIntervention,
    hotspotsWithInterventions,
    selectedInterventionId,
    onSelectIntervention,
  } = props;

  const center: [number, number] = [27.7172, 85.324];
  const mapRef = useRef<L.Map | null>(null);

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={14}
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

        {hotspots.map((h) => {
          const isSelected = h.id === selectedHotspotId;
          const treated = hotspotsWithInterventions.has(h.id);
          const fill = treated ? INTERVENTION_COLOR : RISK_COLORS[h.riskLevel];
          const radius = hotspotRadius(h.riskScore);
          return (
            <CircleMarker
              key={h.id}
              center={[h.latitude, h.longitude]}
              radius={radius}
              pathOptions={{
                color: isSelected ? SELECTED_COLOR : "white",
                weight: isSelected ? 4 : 2,
                opacity: 1,
                fillColor: fill,
                fillOpacity: 0.7,
              }}
              eventHandlers={{ click: () => onSelectHotspot(h.id) }}
            >
              <Popup>
                <div className="min-w-[240px] space-y-2 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm">{h.name}</div>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white"
                      style={{ background: RISK_COLORS[h.riskLevel] }}
                    >
                      {h.riskLevel}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 rounded bg-slate-50 p-2">
                    <div>
                      <div className="text-[10px] uppercase text-slate-500">Risk Score</div>
                      <div className="font-semibold">{h.riskScore.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-slate-500">Predicted Crashes</div>
                      <div className="font-semibold">{h.predictedCrashes}/yr</div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                      SHAP Factors
                    </div>
                    <ul className="space-y-0.5">
                      {h.shapFactors.slice(0, 4).map((f) => (
                        <li key={f.name} className="flex justify-between gap-2">
                          <span>{f.name}</span>
                          <span className="font-mono text-slate-600">
                            +{Math.round(f.impact * 100)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                      Recommended Interventions
                    </div>
                    <ul className="list-disc pl-4">
                      {h.recommendedInterventions.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
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
              icon={buildInterventionIcon(iv.interventionId, isSelected)}
              draggable
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
                    <span className="tabular-nums">${iv.cost.toLocaleString()}</span>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {pendingIntervention && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg">
          Drop “{pendingIntervention.name}” anywhere on the map
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
          <span>Treated</span>
        </div>
      </div>
    </div>
  );
}
