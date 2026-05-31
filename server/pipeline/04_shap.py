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

INTERVENTION_MAP = {}


def hotspot_to_features(spot: dict) -> dict:
    raise RuntimeError("Hotspot feature synthesis is disabled (no placeholders).")


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
    sampled = df[cols].astype(float)
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

    if not KV_FEAT_PARQ.exists():
        print("[shap] Kathmandu hotspot features not found. Skipping SHAP outputs.")
        return
    kv_feat = pd.read_parquet(KV_FEAT_PARQ).sort_values("_spot_index")
    missing = [c for c in feature_cols if c not in kv_feat.columns]
    if missing:
        print(f"[shap] Missing Kathmandu feature columns; skipping SHAP: {missing}")
        return
    X_kv = kv_feat[feature_cols].astype(float)

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
