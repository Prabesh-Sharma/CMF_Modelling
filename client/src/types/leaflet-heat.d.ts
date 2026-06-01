import "leaflet";

declare module "leaflet" {
  export interface HeatLayerOptions {
    radius?: number;
    blur?: number;
    maxZoom?: number;
    max?: number;
    minOpacity?: number;
    gradient?: Record<number, string>;
  }

  export function heatLayer(
    latlngs: Array<[number, number, number]>,
    options?: HeatLayerOptions,
  ): Layer;
}

declare module "leaflet.heat";
