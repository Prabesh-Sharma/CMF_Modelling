"""
pipeline/02_features.py
────────────────────────
Builds the feature matrix from raw_training.parquet.
Uses direct mappings only; optional OSM road type enrichment.

Input:   data/raw_training.parquet
Output:  data/features.parquet
"""

import hashlib
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(__file__).parent.parent / "data" / "raw_training.parquet"
FEAT_OUT = Path(__file__).parent.parent / "data" / "features.parquet"

ENABLE_OSM_ROAD_TYPE = True
OSM_NETWORK_TYPE = "drive"
OSM_BUFFER_DEG = 0.02
OSM_MAX_POINTS = 50000
OSM_MAX_DEG_RANGE = 1.0
OSM_CACHE_DIR = Path(__file__).parent.parent / "data" / "osm_cache"
OSM_BBOX_CACHE = OSM_CACHE_DIR / "bbox.json"
OSM_FIXED_BBOX_ENV = "OSM_FIXED_BBOX"


def _osm_bbox_from_points(lat: np.ndarray, lon: np.ndarray) -> tuple[float, float, float, float]:
    north = float(lat.max()) + OSM_BUFFER_DEG
    south = float(lat.min()) - OSM_BUFFER_DEG
    east = float(lon.max()) + OSM_BUFFER_DEG
    west = float(lon.min()) - OSM_BUFFER_DEG
    return (west, south, east, north)


def _parse_fixed_bbox(value: str) -> tuple[float, float, float, float]:
    parts = [p.strip() for p in value.split(",")]
    if len(parts) != 4:
        raise ValueError("OSM_FIXED_BBOX must be 'west,south,east,north'")
    return tuple(float(p) for p in parts)


def _get_osm_bbox(lat: np.ndarray, lon: np.ndarray) -> tuple[float, float, float, float]:
    fixed = os.getenv(OSM_FIXED_BBOX_ENV)
    if fixed:
        return _parse_fixed_bbox(fixed)
    if OSM_BBOX_CACHE.exists():
        try:
            return tuple(json.loads(OSM_BBOX_CACHE.read_text(encoding="utf-8")))
        except Exception:
            pass
    bbox = _osm_bbox_from_points(lat, lon)
    try:
        OSM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        OSM_BBOX_CACHE.write_text(json.dumps(list(bbox)), encoding="utf-8")
    except Exception:
        pass
    return bbox


def _osm_cache_path(bbox: tuple[float, float, float, float]) -> Path:
    key = f"{bbox}-{OSM_NETWORK_TYPE}"
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return OSM_CACHE_DIR / f"osm_{digest}.graphml"


def _build_osm_graph_from_bbox(bbox: tuple[float, float, float, float]):
    import osmnx as ox

    ox.settings.use_cache = True
    ox.settings.log_console = False
    return ox.graph_from_bbox(bbox, network_type=OSM_NETWORK_TYPE, simplify=True)


def _load_or_build_graph(lat: np.ndarray, lon: np.ndarray):
    import osmnx as ox

    bbox = _get_osm_bbox(lat, lon)
    cache_path = _osm_cache_path(bbox)
    if cache_path.exists():
        try:
            return ox.load_graphml(cache_path)
        except Exception:
            pass

    G = _build_osm_graph_from_bbox(bbox)
    try:
        OSM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        ox.save_graphml(G, cache_path)
    except Exception:
        pass
    return G


def _road_type_from_osm(df: pd.DataFrame) -> pd.DataFrame:
    if not ENABLE_OSM_ROAD_TYPE:
        return df
    if len(df) > OSM_MAX_POINTS:
        print(f"[features] OSM road type skipped (too many rows: {len(df):,})")
        return df
    lat_span = float(df["latitude"].max() - df["latitude"].min())
    lon_span = float(df["longitude"].max() - df["longitude"].min())
    if lat_span > OSM_MAX_DEG_RANGE or lon_span > OSM_MAX_DEG_RANGE:
        print(
            "[features] OSM road type skipped (bounds too large: "
            f"lat_span={lat_span:.2f}, lon_span={lon_span:.2f})"
        )
        return df
    try:
        import osmnx as ox
    except Exception as exc:
        print(f"[features] OSM road type skipped (missing osmnx): {exc}")
        return df

    try:
        print("[features] Resolving road type from OSM...")
        G = _load_or_build_graph(df["latitude"].values, df["longitude"].values)
        try:
            u, v, k = ox.distance.nearest_edges(G, df["longitude"].values, df["latitude"].values)
        except Exception:
            u, v, k = [], [], []
            for x, y in zip(df["longitude"].values, df["latitude"].values):
                eu, ev, ek = ox.distance.nearest_edges(G, x, y)
                u.append(eu)
                v.append(ev)
                k.append(ek)

        road_types = []
        for eu, ev, ek in zip(u, v, k):
            data = G.get_edge_data(eu, ev, ek) or {}
            highway = data.get("highway")
            if isinstance(highway, list):
                highway = highway[0]
            road_types.append(highway)
        df = df.copy()
        df["road_type"] = road_types
        return df
    except Exception as exc:
        print(f"[features] OSM road type skipped (error): {exc}")
        return df

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    feat = pd.DataFrame(index=df.index)

    def to_numeric(series: pd.Series) -> pd.Series:
        return pd.to_numeric(series, errors="coerce")

    def require_col(col: str) -> pd.Series:
        if col not in df.columns:
            raise ValueError(f"Missing required column for features: {col}")
        return df[col]

    feat["visibility_mi"] = to_numeric(require_col("visibility"))
    feat["temperature_f"] = to_numeric(require_col("temperature"))
    feat["wind_speed_mph"] = to_numeric(require_col("wind_speed"))
    feat["precipitation_in"] = to_numeric(require_col("precipitation"))
    feat["humidity_pct"] = to_numeric(require_col("humidity"))
    feat["pressure_in"] = to_numeric(require_col("pressure"))
    feat["traffic_signal"] = to_numeric(require_col("traffic_signal")).astype(int)
    feat["junction_detail"] = to_numeric(require_col("junction_detail")).astype(int)
    if "road_type" in df.columns:
        feat["road_type"] = df["road_type"].astype(str)

    feat["hour_of_day"] = to_numeric(require_col("hour_of_day"))
    feat["day_of_week"] = to_numeric(require_col("day_of_week"))

    lat = require_col("latitude").values
    lon = require_col("longitude").values
    feat["lat_bin"] = np.round(lat * 20) / 20
    feat["lon_bin"] = np.round(lon * 20) / 20

    feat["severity"] = df["severity"].astype(int)
    feat["latitude"] = df["latitude"]
    feat["longitude"] = df["longitude"]
    feat["source"] = df.get("source", "unknown")

    return feat


def run():
    print("[features] Loading raw data...")
    df = pd.read_parquet(RAW)
    print(f"[features] {len(df):,} rows")
    df = _road_type_from_osm(df)
    feat = build_features(df)

    FEAT_OUT.parent.mkdir(parents=True, exist_ok=True)
    feat.to_parquet(FEAT_OUT, index=False)
    print(f"[features] Feature matrix: {feat.shape}")
    print(f"[features] Saved → {FEAT_OUT}")

if __name__ == "__main__":
    run()
