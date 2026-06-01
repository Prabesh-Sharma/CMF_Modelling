"""
Build Nepali crash features and cluster outputs for the UI.

Inputs:
  data/raw_crashes.parquet
  data/inputs/02_road_segments_gi_star.csv

Outputs:
  data/features.parquet
  data/crash_clusters.json
  data/crash_map.json
"""

from collections import Counter
from pathlib import Path
import gzip
import json

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from scipy.spatial import cKDTree


BASE = Path(__file__).resolve().parents[1]
RAW = BASE / "data" / "raw_crashes.parquet"
SEGMENTS_CSV = BASE / "data" / "inputs" / "02_road_segments_gi_star.csv"
FEATURES_OUT = BASE / "data" / "features.parquet"
CLUSTERS_OUT = BASE / "data" / "crash_clusters.json"
CRASH_MAP_OUT = BASE / "data" / "crash_map.json"
OSM_ROADS_OUT = BASE / "data" / "osm_roads.json.gz"

EARTH_RADIUS_M = 6_371_000
CLUSTER_EPS_M = 120
CLUSTER_MIN_SAMPLES = 8
OSM_MAX_CRASH_DISTANCE_M = 35

UI_SEVERITY_BUCKETS = ["critical", "high", "moderate", "low"]
RISK_LEVEL_TO_SCORE = {
    "critical": 0.92,
    "high": 0.74,
    "moderate": 0.52,
    "low": 0.28,
}


def _download_osm_roads(df: pd.DataFrame) -> list[dict]:
    import requests

    south = float(df["latitude"].min()) - 0.005
    north = float(df["latitude"].max()) + 0.005
    west = float(df["longitude"].min()) - 0.005
    east = float(df["longitude"].max()) + 0.005
    query = f"""
    [out:json][timeout:120];
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"]({south},{west},{north},{east});
    out geom;
    """
    print("[features] Downloading road geometry from OpenStreetMap Overpass API...")
    response = requests.get(
        "https://overpass-api.de/api/interpreter",
        params={"data": query},
        headers={"User-Agent": "SafeRoute-Hackathon-Demo/1.0"},
        timeout=180,
    )
    response.raise_for_status()
    payload = response.json()
    roads = []
    for element in payload.get("elements", []):
        geometry = element.get("geometry", [])
        if len(geometry) < 2:
            continue
        roads.append(
            {
                "osm_id": int(element["id"]),
                "name": element.get("tags", {}).get("name", "Unnamed road"),
                "highway": element.get("tags", {}).get("highway", "road"),
                "coordinates": [[float(p["lat"]), float(p["lon"])] for p in geometry],
            }
        )
    if not roads:
        raise RuntimeError("OpenStreetMap returned no road geometry for the crash bounds")
    with gzip.open(OSM_ROADS_OUT, "wt", encoding="utf-8") as f:
        json.dump({"roads": roads}, f, separators=(",", ":"))
    print(f"[features] Cached {len(roads):,} OSM roads -> {OSM_ROADS_OUT}")
    return roads


def _load_osm_roads(df: pd.DataFrame) -> list[dict]:
    if OSM_ROADS_OUT.exists():
        with gzip.open(OSM_ROADS_OUT, "rt", encoding="utf-8") as f:
            return json.load(f)["roads"]
    return _download_osm_roads(df)


def _sample_road_points(roads: list[dict]) -> tuple[np.ndarray, list[dict]]:
    points = []
    metadata = []
    for road in roads:
        coords = road["coordinates"]
        for start, end in zip(coords, coords[1:]):
            lat1, lon1 = start
            lat2, lon2 = end
            distance_m = np.hypot((lat2 - lat1) * 111_000, (lon2 - lon1) * 98_000)
            steps = max(1, int(np.ceil(distance_m / 12)))
            for step in range(steps + 1):
                ratio = step / steps
                points.append([lat1 + (lat2 - lat1) * ratio, lon1 + (lon2 - lon1) * ratio])
                metadata.append(road)
    return np.asarray(points), metadata


def _snap_crashes_to_osm_roads(df: pd.DataFrame) -> pd.DataFrame:
    roads = _load_osm_roads(df)
    road_points, road_metadata = _sample_road_points(roads)
    mean_lat = float(df["latitude"].mean())
    lat_scale = 111_000.0
    lon_scale = 111_000.0 * np.cos(np.radians(mean_lat))
    tree = cKDTree(road_points * np.array([lat_scale, lon_scale]))
    distances, indices = tree.query(
        df[["latitude", "longitude"]].to_numpy() * np.array([lat_scale, lon_scale]),
        k=1,
    )
    snapped = df.copy()
    nearest = road_points[indices]
    snapped["original_latitude"] = snapped["latitude"]
    snapped["original_longitude"] = snapped["longitude"]
    snapped["latitude"] = nearest[:, 0]
    snapped["longitude"] = nearest[:, 1]
    snapped["road_distance_m"] = distances.round(1)
    snapped["osm_road_name"] = [road_metadata[i]["name"] for i in indices]
    snapped["osm_highway"] = [road_metadata[i]["highway"] for i in indices]
    snapped = snapped[snapped["road_distance_m"] <= OSM_MAX_CRASH_DISTANCE_M].copy()
    print(
        f"[features] Kept {len(snapped):,}/{len(df):,} crashes within "
        f"{OSM_MAX_CRASH_DISTANCE_M}m of OSM roads"
    )
    return snapped


def _top_values(series: pd.Series, limit: int = 3) -> list[str]:
    return [str(v) for v in series.dropna().value_counts().head(limit).index.tolist()]


def _risk_level(max_severity: int, severity_index: float, crash_count: int) -> str:
    if max_severity >= 4 or severity_index >= 120 or crash_count >= 45:
        return "critical"
    if max_severity >= 3 or severity_index >= 80 or crash_count >= 25:
        return "high"
    if severity_index >= 35 or crash_count >= 10:
        return "moderate"
    return "low"


def _cluster_name(row: pd.Series, idx: int) -> str:
    corridor = str(row.get("corridor", "Unknown corridor"))
    cause = str(row.get("top_cause", "mixed causes"))
    return f"{corridor} cluster {idx + 1}: {cause}"


def _recommended_interventions(causes: list[str], collisions: list[str]) -> list[str]:
    text = " ".join(causes + collisions).lower()
    recs: list[str] = []
    if any(token in text for token in ["speed", "overtake"]):
        recs.extend(["Speed calming", "Speed enforcement"])
    if any(token in text for token in ["pedestrian", "crossing"]):
        recs.extend(["Raised pedestrian crossing", "Median refuge"])
    if any(token in text for token in ["alcohol"]):
        recs.append("Targeted impaired-driving enforcement")
    if any(token in text for token in ["turning", "lane", "rear end", "side"]):
        recs.extend(["Lane markings", "Intersection channelization"])
    if any(token in text for token in ["road condition", "weather"]):
        recs.extend(["Surface maintenance", "Warning signage"])
    recs.append("Crash investigation and road safety audit")
    return list(dict.fromkeys(recs))[:4]


def _cluster_features(df: pd.DataFrame) -> pd.DataFrame:
    coords_rad = np.radians(df[["latitude", "longitude"]].to_numpy())
    labels = DBSCAN(
        eps=CLUSTER_EPS_M / EARTH_RADIUS_M,
        min_samples=CLUSTER_MIN_SAMPLES,
        metric="haversine",
    ).fit_predict(coords_rad)
    df = df.copy()
    df["cluster_id"] = labels

    grouped_rows = []
    for cluster_id, group in df[df["cluster_id"] >= 0].groupby("cluster_id"):
        crash_count = int(len(group))
        severity_index = float(group["severity_score"].pow(2).sum())
        max_severity = int(group["severity_score"].max())
        top_causes = _top_values(group["cause"])
        top_collisions = _top_values(group["collision_type"])
        top_vehicles = _top_values(group["vehicle_type"])
        top_corridor = str(group["corridor"].mode().iat[0])
        road_anchor = group.sort_values(
            ["severity_score", "road_distance_m"], ascending=[False, True]
        ).iloc[0]
        risk_level = _risk_level(max_severity, severity_index, crash_count)
        grouped_rows.append(
            {
                "cluster_id": int(cluster_id),
                "latitude": float(group["latitude"].mean()),
                "longitude": float(group["longitude"].mean()),
                "crash_count": crash_count,
                "severity_index": round(severity_index, 2),
                "max_severity_score": max_severity,
                "risk_level": risk_level,
                "risk_score": min(1.0, RISK_LEVEL_TO_SCORE[risk_level] + crash_count / 500.0),
                "corridor": top_corridor,
                "road_class": str(group["road_class"].mode().iat[0]),
                "top_cause": top_causes[0] if top_causes else "Unknown",
                "top_causes": top_causes,
                "top_collisions": top_collisions,
                "top_vehicles": top_vehicles,
                "road_anchor_lat": round(float(road_anchor["latitude"]), 6),
                "road_anchor_lon": round(float(road_anchor["longitude"]), 6),
                "road_name": str(road_anchor["osm_road_name"]),
                "accident_reports": {
                    "fatal": int((group["severity"] == "Death").sum()),
                    "major_injury": int((group["severity"] == "Major Injury").sum()),
                    "minor_injury": int((group["severity"] == "Minor Injury").sum()),
                    "property_damage_only": int((group["severity"] == "PDO").sum()),
                    "pedestrian_related": int(
                        group["collision_type"].str.contains("pedestrian", case=False, na=False).sum()
                    ),
                    "speed_related": int(
                        group["cause"].str.contains("speed", case=False, na=False).sum()
                    ),
                    "turning_related": int(
                        group["collision_type"].str.contains("turn", case=False, na=False).sum()
                    ),
                    "head_on": int(
                        group["collision_type"].str.contains("head on", case=False, na=False).sum()
                    ),
                },
                "recommended_interventions": _recommended_interventions(top_causes, top_collisions),
            }
        )

    clusters = pd.DataFrame(grouped_rows).sort_values(
        ["severity_index", "crash_count"], ascending=False
    )
    clusters = clusters.reset_index(drop=True)
    clusters["ui_id"] = [f"cluster-{i + 1}" for i in range(len(clusters))]
    clusters["name"] = [_cluster_name(row, i) for i, row in clusters.iterrows()]
    return df, clusters


def _build_hotspots(clusters: pd.DataFrame) -> dict[str, list[dict]]:
    buckets: dict[str, list[dict]] = {key: [] for key in UI_SEVERITY_BUCKETS}
    for _, row in clusters.head(80).iterrows():
        reasons = list(dict.fromkeys(row["top_causes"] + row["top_collisions"] + row["top_vehicles"]))[:6]
        item = {
            "id": row["ui_id"],
            "name": row["name"],
            "lat": round(float(row["latitude"]), 6),
            "lon": round(float(row["longitude"]), 6),
            "severity": row["risk_level"],
            "reasons": reasons or ["Crash concentration"],
            "source": "Nepali crash records 2019-2021",
            "crash_count": int(row["crash_count"]),
            "severity_index": float(row["severity_index"]),
            "top_cause": row["top_cause"],
            "road_class": row["road_class"],
            "corridor": row["corridor"],
            "road_anchor_lat": float(row["road_anchor_lat"]),
            "road_anchor_lon": float(row["road_anchor_lon"]),
            "road_name": row["road_name"],
            "accident_reports": row["accident_reports"],
            "recommended_interventions": row["recommended_interventions"],
        }
        buckets[row["risk_level"]].append(item)
    return buckets


def _build_crash_points(df: pd.DataFrame, clusters: pd.DataFrame) -> list[dict]:
    hotspot_ids = dict(zip(clusters["cluster_id"], clusters["ui_id"]))
    display_limits = {"critical": 700, "high": 1100, "moderate": 900, "low": 500}
    display_df = pd.concat(
        [
            group.sample(n=min(len(group), display_limits[level]), random_state=42)
            for level, group in df.groupby("severity_level")
        ]
    ).sort_values(["severity_score", "crash_id"], ascending=[False, True])
    records = []
    for row in display_df.itertuples(index=False):
        records.append(
            {
                "id": str(row.crash_id),
                "lat": round(float(row.latitude), 6),
                "lon": round(float(row.longitude), 6),
                "severity": row.severity,
                "severityLevel": row.severity_level,
                "cause": row.cause,
                "collisionType": row.collision_type,
                "vehicleType": row.vehicle_type,
                "roadClass": row.road_class,
                "corridor": row.corridor,
                "roadName": row.osm_road_name,
                "roadDistanceMeters": float(row.road_distance_m),
                "date": str(row.date),
                "time": str(row.time),
                "year": int(row.year),
                "clusterId": int(row.cluster_id) if int(row.cluster_id) >= 0 else None,
                "hotspotId": hotspot_ids.get(int(row.cluster_id)),
            }
        )
    return records


def _segment_summary() -> list[dict]:
    if not SEGMENTS_CSV.exists():
        return []
    seg = pd.read_csv(SEGMENTS_CSV)
    seg = seg.sort_values(["severity_index", "crash_count"], ascending=False).head(80)
    rows = []
    for row in seg.itertuples(index=False):
        rows.append(
            {
                "id": f"segment-{int(row.segment_id)}",
                "name": row.corridor_name,
                "roadClass": row.road_class,
                "start": [float(row.start_lat), float(row.start_lon)],
                "end": [float(row.end_lat), float(row.end_lon)],
                "crashCount": int(row.crash_count),
                "severityIndex": float(row.severity_index),
                "giZScore": float(row.gi_zscore),
                "classification": row.classification,
            }
        )
    return rows


def run() -> None:
    if not RAW.exists():
        raise FileNotFoundError(f"Run 01_ingest.py first: {RAW}")

    df = _snap_crashes_to_osm_roads(pd.read_parquet(RAW))
    df, clusters = _cluster_features(df)

    df.to_parquet(FEATURES_OUT, index=False)

    cluster_json = clusters.to_dict(orient="records")
    CLUSTERS_OUT.write_text(json.dumps({"clusters": cluster_json}, indent=2), encoding="utf-8")

    severity_counts = Counter(df["severity_level"])
    crash_map = {
        "metadata": {
            "title": "Kathmandu Valley crash hotspots from Nepali crash records",
            "sources": [
                "server/data/inputs/01_raw_crash_records.csv",
                "server/data/inputs/02_road_segments_gi_star.csv",
            ],
            "coverage": "Nepal crash records, 2019-2021",
            "total_hotspots": int(len(clusters)),
            "total_crashes": int(len(df)),
            "severity_counts": {key: int(severity_counts.get(key, 0)) for key in UI_SEVERITY_BUCKETS},
        },
        "hotspots": _build_hotspots(clusters),
        "clusters": cluster_json,
        "segments": _segment_summary(),
        "crashes": _build_crash_points(df, clusters),
        "heatmap": [],
    }
    CRASH_MAP_OUT.write_text(json.dumps(crash_map, indent=2), encoding="utf-8")

    print(f"[features] Saved {len(df):,} feature rows -> {FEATURES_OUT}")
    print(f"[features] Saved {len(clusters):,} clusters -> {CLUSTERS_OUT}")
    print(f"[features] Saved crash map payload -> {CRASH_MAP_OUT}")


if __name__ == "__main__":
    run()
