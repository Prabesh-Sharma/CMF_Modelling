"""
pipeline/04_shap.py
────────────────────
Runs SHAP on the trained model applied to Kathmandu Valley segments.

Input:   models/xgb_model.json
         models/feature_list.json
         models/train_report.json
         data/kathmandu_hotspots.json
         data/kathmandu_osm_features.parquet (optional)
Output:  data/shap_global.json
         data/shap_hotspots.json
"""

import json
import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from pathlib import Path

MODEL_IN = Path(__file__).parent.parent / "models" / "xgb_model.json"
FEAT_LIST_IN = Path(__file__).parent.parent / "models" / "feature_list.json"
REPORT_IN = Path(__file__).parent.parent / "models" / "train_report.json"
KV_JSON = Path(__file__).parent.parent / "data" / "kathmandu_hotspots.json"
KV_FEAT_PARQ = Path(__file__).parent.parent / "data" / "kathmandu_osm_features.parquet"
SHAP_GLOBAL = Path(__file__).parent.parent / "data" / "shap_global.json"
SHAP_HOTSPOTS = Path(__file__).parent.parent / "data" / "shap_hotspots.json"

INTERVENTION_MAP = {
    "speed_limit": {
        "label": "High speed limit",
        "fix": "Install speed calming (rumble strips / speed humps)",
        "structure": "Speed humps every 50m, advisory signage",
        "risk_delta": -0.25,
    },
    "speed_variance_proxy": {
        "label": "High speed variance",
        "fix": "Speed cameras + variable message signs",
        "structure": "Fixed-point speed camera, VMS board",
        "risk_delta": -0.30,
    },
    "junction_risk": {
        "label": "Dangerous junction",
        "fix": "Redesign junction: dedicated turn lanes + signal phasing",
        "structure": "Channelisation islands, protected left-turn phase",
        "risk_delta": -0.35,
    },
    "junction_light_interact": {
        "label": "Junction + poor lighting",
        "fix": "Install junction lighting and reflective markers",
        "structure": "LED overhead lighting at 15m height, cat's eyes",
        "risk_delta": -0.30,
    },
    "light_risk": {
        "label": "Poor lighting conditions",
        "fix": "Street lighting upgrade",
        "structure": "LED street lights every 30m, solar backup",
        "risk_delta": -0.20,
    },
    "weather_risk": {
        "label": "Adverse weather / monsoon",
        "fix": "Drainage improvement + fog warning system",
        "structure": "Road drainage channels, fog detection sensors",
        "risk_delta": -0.15,
    },
    "weather_speed_interact": {
        "label": "Speed + adverse weather",
        "fix": "Variable speed limits in bad weather",
        "structure": "Dynamic speed limit signs, IoT weather sensor",
        "risk_delta": -0.20,
    },
    "carriageway_hazards": {
        "label": "Carriageway hazards",
        "fix": "Road surface repair + hazard marking",
        "structure": "Pothole repair, raised pavement markers",
        "risk_delta": -0.18,
    },
    "peak_hour": {
        "label": "Peak hour congestion",
        "fix": "Signal coordination + traffic warden deployment",
        "structure": "Coordinated signal timing, peak-hour wardens",
        "risk_delta": -0.15,
    },
    "is_night": {
        "label": "Night-time accident risk",
        "fix": "Night enforcement + reflective road marking",
        "structure": "Thermoplastic road markings, night patrol",
        "risk_delta": -0.18,
    },
    "pop_density_norm": {
        "label": "High pedestrian/population density",
        "fix": "Pedestrian crossing infrastructure",
        "structure": "Overhead bridge or zebra crossing + refuge island",
        "risk_delta": -0.25,
    },
    "steep_grade_flag": {
        "label": "Steep grade",
        "fix": "Truck runaway ramp + grade warning signs",
        "structure": "Runaway ramp 200m below grade, advance warning signs",
        "risk_delta": -0.30,
    },
    "dist_to_signal": {
        "label": "No nearby traffic signal",
        "fix": "Install traffic signal or roundabout",
        "structure": "New signalised junction or mini-roundabout",
        "risk_delta": -0.20,
    },
}


def hotspot_to_features(spot: dict) -> dict:
    reasons = [r.lower() for r in spot.get("reasons", [])]
    sev_map = {"critical": 3, "high": 2, "moderate": 1, "low": 0}
    sev = sev_map.get(spot.get("severity", "moderate"), 1)

    has = lambda *kws: any(k in r for r in reasons for k in kws)

    return {
        "speed_limit": 60 if has("speed", "highway") else 40,
        "number_of_vehicles": 4 if has("volume", "heavy") else 2,
        "visibility_mi": 6.0 if has("fog", "mist", "haze") else 10.0,
        "temperature_f": 60.0,
        "wind_speed_mph": 8.0 if has("wind") else 4.0,
        "precipitation_in": 0.1 if has("rain", "monsoon", "wet") else 0.0,
        "humidity_pct": 70.0 if has("rain", "monsoon", "wet") else 50.0,
        "pressure_in": 29.92,
        "carriageway_hazards": 1 if has("hazard", "construction", "pothole") else 0,
        "road_type_risk": 0.8 if has("highway", "ring road") else 0.5,
        "junction_risk": 0.9 if has("junction", "merging", "intersection") else 0.3,
        "light_risk": 0.8 if has("lighting", "night", "dark") else 0.2,
        "weather_risk": 0.5 if has("wet", "monsoon", "rain") else 0.1,
        "traffic_signal": 1 if has("signal") else 0,
        "junction_detail": 1 if has("junction", "intersection") else 0,
        "hour_sin": np.sin(2 * np.pi * 17 / 24),
        "hour_cos": np.cos(2 * np.pi * 17 / 24),
        "dow_sin": np.sin(2 * np.pi * 5 / 7),
        "dow_cos": np.cos(2 * np.pi * 5 / 7),
        "peak_hour": 1,
        "festival_flag": 0,
        "is_night": 0,
        "speed_variance_proxy": 0.7 if sev >= 2 else 0.3,
        "severity_exposure": (60 / 70.0) * (4 / 5.0) if sev >= 2 else 0.3,
        "junction_light_interact": 0.6 if has("junction") and has("lighting") else 0.2,
        "weather_speed_interact": 0.3,
        "monsoon_flag": 1 if has("monsoon", "flood", "wet") else 0,
        "steep_grade_flag": 1 if has("steep", "grade", "slope", "hill") else 0,
        "dist_to_signal": 50 if has("signal") else 300,
        "overhead_bridge": (
            1 if "overhead bridge" in spot.get("source", "").lower() else 0
        ),
        "pop_density_norm": 0.8 if has("pedestrian", "commercial", "market") else 0.4,
    }


def shap_to_interventions(
    feature_names: list, shap_vals: np.ndarray, critical_idx: int, top_n: int = 3
) -> list:
    class_shap = shap_vals[:, critical_idx] if shap_vals.ndim == 2 else shap_vals
    pairs = list(zip(feature_names, class_shap))
    pairs.sort(key=lambda x: abs(x[1]), reverse=True)

    interventions = []
    for feat_name, shap_val in pairs[:top_n]:
        if feat_name in INTERVENTION_MAP and shap_val > 0:
            info = INTERVENTION_MAP[feat_name]
            interventions.append(
                {
                    "feature": feat_name,
                    "shap_value": round(float(shap_val), 4),
                    "driver_label": info["label"],
                    "fix": info["fix"],
                    "structure": info["structure"],
                    "risk_delta": info["risk_delta"],
                }
            )
    return interventions


def _sample_training_features(feature_cols: list, n_samples: int = 2000) -> pd.DataFrame:
    from pathlib import Path

    feat_path = Path(__file__).parent.parent / "data" / "features.parquet"
    if not feat_path.exists():
        raise FileNotFoundError(f"Missing training features at {feat_path}")
    df = pd.read_parquet(feat_path)
    cols = [c for c in feature_cols if c in df.columns]
    sampled = df[cols].fillna(0).astype(float)
    if len(sampled) > n_samples:
        sampled = sampled.sample(n=n_samples, random_state=42)
    return sampled


def run():
    model = xgb.XGBClassifier()
    model.load_model(str(MODEL_IN))
    print(f"[shap] Model loaded from {MODEL_IN}")

    with open(FEAT_LIST_IN) as f:
        feature_cols = json.load(f)

    with open(REPORT_IN) as f:
        report = json.load(f)
    sev_labels = report.get("class_labels", ["low", "moderate", "high", "critical"])
    critical_idx = len(sev_labels) - 1

    with open(KV_JSON) as f:
        kv_data = json.load(f)

    all_spots = []
    for sev_group in ["critical", "high", "moderate", "low"]:
        all_spots.extend(kv_data["hotspots"].get(sev_group, []))

    print(f"[shap] Processing {len(all_spots)} Kathmandu Valley hotspots")

    rows = [hotspot_to_features(s) for s in all_spots]
    base_df = pd.DataFrame(rows)

    if KV_FEAT_PARQ.exists():
        try:
            kv_feat = pd.read_parquet(KV_FEAT_PARQ).sort_values("_spot_index")
            for col in kv_feat.columns:
                if col in base_df.columns:
                    base_df[col] = kv_feat[col].values
        except Exception as e:
            print(f"[shap] OSM KV features ignored (error): {e}")

    X_kv = base_df[feature_cols].fillna(0).astype(float)

    explainer = shap.TreeExplainer(model)
    shap_vals = explainer.shap_values(X_kv)

    if isinstance(shap_vals, list):
        shap_vals = np.stack(shap_vals, axis=2)

    train_X = _sample_training_features(feature_cols, n_samples=2000)
    train_shap = explainer.shap_values(train_X)
    if isinstance(train_shap, list):
        train_shap = np.stack(train_shap, axis=2)

    global_importance = (
        np.abs(train_shap).mean(axis=(0, 2))
        if train_shap.ndim == 3
        else np.abs(train_shap).mean(axis=0)
    )

    global_ranked = sorted(
        zip(feature_cols, global_importance.tolist()), key=lambda x: x[1], reverse=True
    )

    global_out = {
        "feature_importance": [
            {"feature": f, "mean_abs_shap": round(v, 4)} for f, v in global_ranked
        ],
        "source": "training_sample",
        "n_samples": int(len(train_X)),
    }
    with open(SHAP_GLOBAL, "w") as f:
        json.dump(global_out, f, indent=2)
    print(f"[shap] Global SHAP saved → {SHAP_GLOBAL}")

    model_proba = model.predict_proba(X_kv)

    for i, spot in enumerate(all_spots):
        local_shap = (
            shap_vals[i] if shap_vals.ndim == 3 else shap_vals[i].reshape(-1, 1)
        )
        class_shap = local_shap[:, critical_idx] if local_shap.ndim == 2 else local_shap

        top3 = sorted(
            zip(feature_cols, class_shap.tolist()),
            key=lambda x: abs(x[1]),
            reverse=True,
        )[:3]

        predicted_class = int(np.argmax(model_proba[i]))
        predicted_label = sev_labels[predicted_class]
        risk_score = float(model_proba[i][critical_idx])

        interventions = shap_to_interventions(feature_cols, local_shap, critical_idx)

        total_delta = sum(iv["risk_delta"] for iv in interventions)
        post_risk = max(0.0, risk_score + total_delta)
        post_class = int(
            np.clip(predicted_class + round(total_delta * 3), 0, len(sev_labels) - 1)
        )
        post_label = sev_labels[post_class]

        spot["true_severity"] = spot.get("severity", "unknown")
        spot["predicted_severity"] = predicted_label
        spot["risk_score"] = round(risk_score, 4)
        spot["top3_drivers"] = [{"feature": f, "shap": round(v, 4)} for f, v in top3]
        spot["interventions"] = interventions
        spot["post_intervention"] = {
            "severity": post_label,
            "risk_score": round(post_risk, 4),
            "risk_delta": round(total_delta, 4),
        }

    with open(SHAP_HOTSPOTS, "w") as f:
        json.dump(kv_data, f, indent=2)
    print(f"[shap] Per-hotspot SHAP saved → {SHAP_HOTSPOTS}")

    print("[shap] Done.")


if __name__ == "__main__":
    run()
