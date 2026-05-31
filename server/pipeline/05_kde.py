"""
pipeline/05_kde.py
───────────────────
Kernel Density Estimation hotspot baseline.
Runs on Kathmandu Valley coordinates and produces
a GeoJSON heatmap grid that can be overlaid on the map.

Input:   data/kathmandu_hotspots.json
Output:  data/kde_heatmap.json
"""

import json
import numpy as np
from pathlib import Path
from scipy.stats import gaussian_kde

KV_JSON = Path(__file__).parent.parent / "data" / "kathmandu_hotspots.json"
KDE_OUT = Path(__file__).parent.parent / "data" / "kde_heatmap.json"

LAT_MIN, LAT_MAX = 27.60, 27.78
LON_MIN, LON_MAX = 85.17, 85.45
GRID_RES = 60


def severity_weight(sev: str) -> float:
    return {"critical": 4.0, "high": 3.0, "moderate": 2.0, "low": 1.0}.get(sev, 1.0)


def run():
    with open(KV_JSON) as f:
        kv = json.load(f)

    spots = []
    for sev in ["critical", "high", "moderate", "low"]:
        spots.extend(kv["hotspots"].get(sev, []))

    lats = np.array([s["lat"] for s in spots])
    lons = np.array([s["lon"] for s in spots])
    weights = np.array([severity_weight(s["severity"]) for s in spots])

    try:
        kde = gaussian_kde(np.vstack([lats, lons]), weights=weights, bw_method=0.05)
    except TypeError:
        lats_w = np.repeat(lats, weights.astype(int))
        lons_w = np.repeat(lons, weights.astype(int))
        kde = gaussian_kde(np.vstack([lats_w, lons_w]), bw_method=0.05)

    lat_grid = np.linspace(LAT_MIN, LAT_MAX, GRID_RES)
    lon_grid = np.linspace(LON_MIN, LON_MAX, GRID_RES)
    lat_mg, lon_mg = np.meshgrid(lat_grid, lon_grid)

    positions = np.vstack([lat_mg.ravel(), lon_mg.ravel()])
    density = kde(positions).reshape(lat_mg.shape)

    d_min, d_max = density.min(), density.max()
    density_norm = (density - d_min) / (d_max - d_min + 1e-9)

    cells = []
    for j in range(GRID_RES):
        for i in range(GRID_RES):
            intensity = float(density_norm[j, i])
            if intensity > 0.05:
                cells.append(
                    {
                        "lat": round(float(lat_grid[i]), 5),
                        "lon": round(float(lon_grid[j]), 5),
                        "intensity": round(intensity, 4),
                    }
                )

    kde_out = {
        "type": "kde_heatmap",
        "bbox": {
            "lat_min": LAT_MIN,
            "lat_max": LAT_MAX,
            "lon_min": LON_MIN,
            "lon_max": LON_MAX,
        },
        "n_cells": len(cells),
        "cells": cells,
    }

    KDE_OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(KDE_OUT, "w") as f:
        json.dump(kde_out, f, indent=2)

    print(f"[kde] Heatmap: {len(cells)} cells above threshold → {KDE_OUT}")


if __name__ == "__main__":
    run()
