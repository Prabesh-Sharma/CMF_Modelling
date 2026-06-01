"""
Generate Leaflet.heat-ready KDE data from Nepali crash records.

Input:  data/features.parquet
Output: data/kde_heatmap.json

The `heatmap` array is shaped for:
  L.heatLayer(heatData, { radius: 35, blur: 25, maxZoom: 17 }).addTo(map)
"""

from pathlib import Path
import json

import numpy as np
import pandas as pd
from scipy.stats import gaussian_kde


BASE = Path(__file__).resolve().parents[1]
FEATURES = BASE / "data" / "features.parquet"
KDE_OUT = BASE / "data" / "kde_heatmap.json"
CRASH_MAP_OUT = BASE / "data" / "crash_map.json"
GRID_RES = 90
MIN_INTENSITY = 0.04


def run() -> None:
    if not FEATURES.exists():
        raise FileNotFoundError(f"Run 02_features.py first: {FEATURES}")

    df = pd.read_parquet(FEATURES)
    coords = df[["latitude", "longitude"]].dropna()
    weights = df.loc[coords.index, "severity_score"].astype(float).clip(lower=1.0)

    lat_min = float(coords["latitude"].min())
    lat_max = float(coords["latitude"].max())
    lon_min = float(coords["longitude"].min())
    lon_max = float(coords["longitude"].max())
    lat_pad = max((lat_max - lat_min) * 0.08, 0.005)
    lon_pad = max((lon_max - lon_min) * 0.08, 0.005)

    lat_grid = np.linspace(lat_min - lat_pad, lat_max + lat_pad, GRID_RES)
    lon_grid = np.linspace(lon_min - lon_pad, lon_max + lon_pad, GRID_RES)
    lon_mg, lat_mg = np.meshgrid(lon_grid, lat_grid)

    kde = gaussian_kde(
        np.vstack([coords["latitude"].to_numpy(), coords["longitude"].to_numpy()]),
        weights=weights.to_numpy(),
        bw_method=0.08,
    )
    density = kde(np.vstack([lat_mg.ravel(), lon_mg.ravel()])).reshape(lat_mg.shape)
    density = (density - density.min()) / (density.max() - density.min() + 1e-12)

    heatmap = []
    for lat, lon, intensity in zip(lat_mg.ravel(), lon_mg.ravel(), density.ravel()):
        val = float(intensity)
        if val >= MIN_INTENSITY:
            heatmap.append([round(float(lat), 6), round(float(lon), 6), round(val, 4)])

    payload = {
        "type": "leaflet_heatmap",
        "options": {"radius": 35, "blur": 25, "maxZoom": 17},
        "bbox": {
            "lat_min": round(lat_min - lat_pad, 6),
            "lat_max": round(lat_max + lat_pad, 6),
            "lon_min": round(lon_min - lon_pad, 6),
            "lon_max": round(lon_max + lon_pad, 6),
        },
        "n_points": len(heatmap),
        "heatmap": heatmap,
    }
    KDE_OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    if CRASH_MAP_OUT.exists():
        crash_map = json.loads(CRASH_MAP_OUT.read_text(encoding="utf-8"))
        crash_map["heatmap"] = heatmap
        crash_map["heatmapOptions"] = payload["options"]
        CRASH_MAP_OUT.write_text(json.dumps(crash_map, indent=2), encoding="utf-8")

    print(f"[kde] Saved {len(heatmap):,} Leaflet heat points -> {KDE_OUT}")


if __name__ == "__main__":
    run()
