"""
pipeline/02_features.py
────────────────────────
Builds the feature matrix from raw_training.parquet.
Uses heuristic + encoded features, with optional OSM enrichment.

Input:   data/raw_training.parquet
Output:  data/features.parquet
Optional: data/kathmandu_osm_features.parquet
"""

import pandas as pd
import numpy as np
from pathlib import Path
import json

RAW = Path(__file__).parent.parent / "data" / "raw_training.parquet"
FEAT_OUT = Path(__file__).parent.parent / "data" / "features.parquet"
KV_JSON = Path(__file__).parent.parent / "data" / "kathmandu_hotspots.json"
KV_OUT = Path(__file__).parent.parent / "data" / "kathmandu_osm_features.parquet"

ENABLE_OSM = True
OSM_NETWORK_TYPE = "drive"
OSM_BUFFER_DEG = 0.02  # ~2km buffer (approx)
OSM_MAX_POINTS = 50000
OSM_MAX_DEG_RANGE = 1.0

ROAD_TYPE_RISK = {
    1: 0.3,
    2: 0.5,
    3: 0.4,
    6: 0.8,
    7: 0.6,
    9: 0.2,
    12: 0.7,
}

JUNCTION_RISK = {
    0: 0.1,
    1: 0.9,
    2: 0.7,
    3: 0.8,
    5: 0.6,
    6: 0.5,
    7: 0.4,
    8: 0.3,
    9: 0.2,
}

LIGHT_RISK = {
    1: 0.2,
    4: 0.8,
    5: 1.0,
    6: 0.9,
    7: 0.7,
}

WEATHER_RISK = {
    1: 0.1,
    2: 0.5,
    3: 0.7,
    4: 0.6,
    5: 0.8,
    6: 0.4,
    7: 0.3,
    8: 0.2,
    9: 0.9,
}


def cyclic_encode(series: pd.Series, period: int):
    angle = 2 * np.pi * series / period
    return np.sin(angle), np.cos(angle)


def peak_hour_flag(hour: pd.Series) -> pd.Series:
    return ((hour.between(7, 10)) | (hour.between(16, 20))).astype(int)


def festival_risk_flag(day_of_week: pd.Series) -> pd.Series:
    return day_of_week.isin([6, 7]).astype(int)


def speed_variance_proxy(df: pd.DataFrame) -> pd.Series:
    return (
        (df.get("speed_limit", 30) / 70.0) * 0.4
        + df.get("junction_risk", 0.0) * 0.3
        + df.get("light_risk", 0.0) * 0.3
    )


def _parse_maxspeed(val, default_kph=50):
    if val is None:
        return default_kph
    if isinstance(val, list):
        val = val[0]
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).lower()
    is_mph = "mph" in s or "miles" in s
    is_kph = "kph" in s or "km/h" in s or "kmh" in s
    nums = "".join(ch if (ch.isdigit() or ch == ".") else " " for ch in s).split()
    if not nums:
        return default_kph
    speed = float(nums[0])
    if is_mph and not is_kph:
        return speed * 1.60934
    return speed


def _highway_to_risk(highway):
    if isinstance(highway, list):
        highway = highway[0]
    if not highway:
        return 0.5
    h = str(highway).lower()
    if h in ["motorway", "trunk"]:
        return 0.9
    if h in ["primary"]:
        return 0.8
    if h in ["secondary"]:
        return 0.7
    if h in ["tertiary"]:
        return 0.6
    if h in ["residential", "service"]:
        return 0.4
    if h in ["unclassified", "track"]:
        return 0.3
    return 0.5


def _build_osm_graph_from_points(lat: np.ndarray, lon: np.ndarray):
    import osmnx as ox

    north = float(lat.max()) + OSM_BUFFER_DEG
    south = float(lat.min()) - OSM_BUFFER_DEG
    east = float(lon.max()) + OSM_BUFFER_DEG
    west = float(lon.min()) - OSM_BUFFER_DEG

    ox.settings.use_cache = True
    ox.settings.log_console = False

    bbox = (west, south, east, north)
    G = ox.graph_from_bbox(bbox, network_type=OSM_NETWORK_TYPE, simplify=True)
    G = ox.add_edge_speeds(G)
    return G


def _osm_features_for_points(G, lat: np.ndarray, lon: np.ndarray):
    import osmnx as ox
    from scipy.spatial import cKDTree

    try:
        u, v, k = ox.distance.nearest_edges(G, lon, lat)
    except Exception:
        u, v, k = [], [], []
        for x, y in zip(lon, lat):
            eu, ev, ek = ox.distance.nearest_edges(G, x, y)
            u.append(eu)
            v.append(ev)
            k.append(ek)

    speed_kph = []
    road_risk = []
    overhead_bridge = []

    for eu, ev, ek in zip(u, v, k):
        data = G.get_edge_data(eu, ev, ek) or {}
        speed = data.get("speed_kph", data.get("maxspeed", None))
        speed_kph.append(_parse_maxspeed(speed))
        road_risk.append(_highway_to_risk(data.get("highway", None)))
        overhead_bridge.append(
            1 if str(data.get("bridge", "")).lower() in ["yes", "true"] else 0
        )

    street_counts = ox.stats.count_streets_per_node(G)
    for n, c in street_counts.items():
        G.nodes[n]["street_count"] = c

    try:
        nearest_nodes = ox.distance.nearest_nodes(G, lon, lat)
    except Exception:
        nearest_nodes = [ox.distance.nearest_nodes(G, x, y) for x, y in zip(lon, lat)]

    junction_risk = []
    for n in nearest_nodes:
        sc = G.nodes[n].get("street_count", 1)
        junction_risk.append(0.9 if sc >= 3 else 0.2)

    nodes = ox.graph_to_gdfs(G, nodes=True, edges=False)
    signal_nodes = nodes[nodes.get("highway") == "traffic_signals"]
    if len(signal_nodes) > 0:
        tree = cKDTree(signal_nodes[["x", "y"]].values)
        dist_deg, _ = tree.query(np.vstack([lon, lat]).T, k=1)
        dist_to_signal = (dist_deg * 111_000.0).tolist()
    else:
        dist_to_signal = [500.0] * len(lat)

    return {
        "speed_limit": speed_kph,
        "road_type_risk": road_risk,
        "junction_risk": junction_risk,
        "dist_to_signal": dist_to_signal,
        "overhead_bridge": overhead_bridge,
    }


def _maybe_osm_enrich(df: pd.DataFrame):
    if not ENABLE_OSM:
        return df
    if len(df) > OSM_MAX_POINTS:
        print(f"[features] OSM enrichment skipped (too many rows: {len(df):,})")
        return df
    lat_span = float(df["latitude"].max() - df["latitude"].min())
    lon_span = float(df["longitude"].max() - df["longitude"].min())
    if lat_span > OSM_MAX_DEG_RANGE or lon_span > OSM_MAX_DEG_RANGE:
        print(
            "[features] OSM enrichment skipped (bounds too large: "
            f"lat_span={lat_span:.2f}, lon_span={lon_span:.2f})"
        )
        return df
    try:
        import osmnx  # noqa: F401
    except Exception as e:
        print(f"[features] OSM enrichment skipped (missing osmnx): {e}")
        return df
    try:
        print("[features] Enriching with OSM (training bounds)...")
        G = _build_osm_graph_from_points(df["latitude"].values, df["longitude"].values)
        osm_feat = _osm_features_for_points(
            G, df["latitude"].values, df["longitude"].values
        )

        # Fill only where missing
        for k, v in osm_feat.items():
            if k in df.columns:
                df[k] = df[k].fillna(pd.Series(v, index=df.index))
            else:
                df[k] = v
        return df
    except Exception as e:
        print(f"[features] OSM enrichment skipped (error): {e}")
        return df


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    feat = pd.DataFrame(index=df.index)

    def to_numeric(series, default):
        return pd.to_numeric(series, errors="coerce").fillna(default)

    feat["speed_limit"] = df.get("speed_limit", pd.Series(30, index=df.index)).fillna(
        30
    )
    feat["visibility_mi"] = to_numeric(
        df.get("visibility", pd.Series(10.0, index=df.index)), 10.0
    )
    feat["temperature_f"] = to_numeric(
        df.get("temperature", pd.Series(60.0, index=df.index)), 60.0
    )
    feat["wind_speed_mph"] = to_numeric(
        df.get("wind_speed", pd.Series(5.0, index=df.index)), 5.0
    )
    feat["precipitation_in"] = to_numeric(
        df.get("precipitation", pd.Series(0.0, index=df.index)), 0.0
    )
    feat["humidity_pct"] = to_numeric(
        df.get("humidity", pd.Series(50.0, index=df.index)), 50.0
    )
    feat["pressure_in"] = to_numeric(
        df.get("pressure", pd.Series(29.92, index=df.index)), 29.92
    )
    feat["traffic_signal"] = (
        df.get("traffic_signal", pd.Series(0, index=df.index))
        .fillna(0)
        .astype(int)
    )
    feat["junction_detail"] = (
        df.get("junction_detail", pd.Series(0, index=df.index))
        .fillna(0)
        .astype(int)
    )
    feat["number_of_vehicles"] = df.get(
        "number_of_vehicles", pd.Series(2, index=df.index)
    ).fillna(2)
    feat["carriageway_hazards"] = df.get(
        "carriageway_hazards", pd.Series(0, index=df.index)
    ).fillna(0)

    if "road_type_risk" in df.columns:
        feat["road_type_risk"] = df["road_type_risk"].fillna(0.5)
    else:
        feat["road_type_risk"] = (
            df.get("road_type", pd.Series(6, index=df.index))
            .map(ROAD_TYPE_RISK)
            .fillna(0.5)
        )

    if "junction_risk" in df.columns:
        feat["junction_risk"] = df["junction_risk"].fillna(0.3)
    else:
        feat["junction_risk"] = (
            df.get("junction_detail", pd.Series(0, index=df.index))
            .map(JUNCTION_RISK)
            .fillna(0.3)
        )

    feat["light_risk"] = (
        df.get("light_conditions", pd.Series(1, index=df.index))
        .map(LIGHT_RISK)
        .fillna(0.2)
    )
    feat["weather_risk"] = (
        df.get("weather_conditions", pd.Series(1, index=df.index))
        .map(WEATHER_RISK)
        .fillna(0.2)
    )

    hour = df.get("hour_of_day", pd.Series(12, index=df.index)).fillna(12)
    dow = df.get("day_of_week", pd.Series(1, index=df.index)).fillna(1)

    feat["hour_sin"], feat["hour_cos"] = cyclic_encode(hour, 24)
    feat["dow_sin"], feat["dow_cos"] = cyclic_encode(dow, 7)
    feat["peak_hour"] = peak_hour_flag(hour)
    feat["festival_flag"] = festival_risk_flag(dow)
    feat["is_night"] = (hour.between(20, 24) | hour.between(0, 6)).astype(int)

    feat["speed_variance_proxy"] = speed_variance_proxy(feat)
    feat["severity_exposure"] = (
        feat["speed_limit"] / 70.0 * feat["number_of_vehicles"] / 5.0
    )
    feat["junction_light_interact"] = feat["junction_risk"] * feat["light_risk"]
    feat["weather_speed_interact"] = feat["weather_risk"] * (feat["speed_limit"] / 70.0)

    lat = df["latitude"].values
    lon = df["longitude"].values
    feat["lat_bin"] = np.round(lat * 20) / 20
    feat["lon_bin"] = np.round(lon * 20) / 20

    feat["monsoon_flag"] = df.get("monsoon_flag", pd.Series(0, index=df.index)).fillna(
        0
    )
    feat["steep_grade_flag"] = df.get(
        "steep_grade_flag", pd.Series(0, index=df.index)
    ).fillna(0)
    feat["dist_to_signal"] = df.get(
        "dist_to_signal", pd.Series(500, index=df.index)
    ).fillna(500)
    feat["overhead_bridge"] = df.get(
        "overhead_bridge", pd.Series(0, index=df.index)
    ).fillna(0)
    feat["pop_density_norm"] = df.get(
        "pop_density_norm", pd.Series(0.5, index=df.index)
    ).fillna(0.5)

    feat["severity"] = df["severity"].astype(int)
    feat["latitude"] = df["latitude"]
    feat["longitude"] = df["longitude"]
    feat["source"] = df.get("source", "unknown")

    return feat


def run():
    print("[features] Loading raw data...")
    df = pd.read_parquet(RAW)
    print(f"[features] {len(df):,} rows")

    df = _maybe_osm_enrich(df)
    feat = build_features(df)

    FEAT_OUT.parent.mkdir(parents=True, exist_ok=True)
    feat.to_parquet(FEAT_OUT, index=False)
    print(f"[features] Feature matrix: {feat.shape}")
    print(f"[features] Saved → {FEAT_OUT}")

    if ENABLE_OSM and KV_JSON.exists():
        try:
            print("[features] Building Kathmandu OSM features for showcase...")
            kv = json.loads(KV_JSON.read_text())
            spots = []
            for sev in ["critical", "high", "moderate", "low"]:
                spots.extend(kv["hotspots"].get(sev, []))
            kv_df = pd.DataFrame(spots)
            kv_df["_spot_index"] = range(len(kv_df))

            G_kv = _build_osm_graph_from_points(
                kv_df["lat"].values, kv_df["lon"].values
            )
            kv_feat = _osm_features_for_points(
                G_kv, kv_df["lat"].values, kv_df["lon"].values
            )

            kv_df["speed_limit"] = kv_feat["speed_limit"]
            kv_df["road_type_risk"] = kv_feat["road_type_risk"]
            kv_df["junction_risk"] = kv_feat["junction_risk"]
            kv_df["dist_to_signal"] = kv_feat["dist_to_signal"]
            kv_df["overhead_bridge"] = kv_feat["overhead_bridge"]

            KV_OUT.parent.mkdir(parents=True, exist_ok=True)
            kv_df.to_parquet(KV_OUT, index=False)
            print(f"[features] Kathmandu OSM features saved → {KV_OUT}")
        except Exception as e:
            print(f"[features] Kathmandu showcase skipped (error): {e}")


if __name__ == "__main__":
    run()
