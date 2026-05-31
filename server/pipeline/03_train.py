"""
pipeline/03_train.py
─────────────────────
Trains XGBoost severity classifier with:
  - Spatial cross-validation (leave-grid-out)
  - Class balancing
  - Hyperparameter tuning
  - Saves model + feature list + label mapping

Input:   data/features.parquet
Output:  models/xgb_model.json
         models/feature_list.json
         models/train_report.json
"""

import json
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.preprocessing import label_binarize
import xgboost as xgb

FEAT_IN = Path(__file__).parent.parent / "data" / "features.parquet"
MODEL_OUT = Path(__file__).parent.parent / "models" / "xgb_model.json"
FEAT_LIST = Path(__file__).parent.parent / "models" / "feature_list.json"
REPORT_OUT = Path(__file__).parent.parent / "models" / "train_report.json"

FEATURE_COLS = [
    "speed_limit",
    "visibility_mi",
    "temperature_f",
    "wind_speed_mph",
    "precipitation_in",
    "humidity_pct",
    "pressure_in",
    "number_of_vehicles",
    "carriageway_hazards",
    "road_type_risk",
    "junction_risk",
    "light_risk",
    "weather_risk",
    "traffic_signal",
    "junction_detail",
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
    "peak_hour",
    "festival_flag",
    "is_night",
    "speed_variance_proxy",
    "severity_exposure",
    "junction_light_interact",
    "weather_speed_interact",
    "monsoon_flag",
    "steep_grade_flag",
    "dist_to_signal",
    "overhead_bridge",
    "pop_density_norm",
]

TARGET = "severity"
BASE_LABELS = ["low", "moderate", "high", "critical"]


def spatial_cv_split(df: pd.DataFrame, n_splits: int = 5):
    grid_id = df["lat_bin"].astype(str) + "_" + df["lon_bin"].astype(str)
    unique_cells = grid_id.unique()
    np.random.shuffle(unique_cells)
    cell_folds = np.array_split(unique_cells, n_splits)

    for fold_cells in cell_folds:
        test_mask = grid_id.isin(fold_cells)
        train_mask = ~test_mask
        yield np.where(train_mask)[0], np.where(test_mask)[0]


def precision_at_k(y_true, y_proba, k: int = 20, positive_class_idx: int = -1) -> float:
    top_k_idx = np.argsort(y_proba[:, positive_class_idx])[-k:]
    true_topk = y_true.iloc[top_k_idx] if hasattr(y_true, "iloc") else y_true[top_k_idx]
    return (true_topk == positive_class_idx).mean()


def run():
    print("[train] Loading feature matrix...")
    df = pd.read_parquet(FEAT_IN)

    missing = [c for c in FEATURE_COLS if c not in df.columns]
    if missing:
        print(f"[train] WARNING: missing features (will use zeros): {missing}")
        for c in missing:
            df[c] = 0.0

    X = df[FEATURE_COLS].fillna(0).astype(float)
    y_raw = df[TARGET].astype(int)

    # remap to contiguous labels based on existing classes
    unique_classes = sorted(y_raw.unique())
    class_map = {orig: idx for idx, orig in enumerate(unique_classes)}
    y = y_raw.map(class_map).astype(int)
    num_class = len(unique_classes)
    class_labels = [BASE_LABELS[c] for c in unique_classes if c < len(BASE_LABELS)]

    print(f"[train] Dataset: {X.shape}  |  Classes: {y_raw.value_counts().to_dict()}")

    class_counts = y.value_counts().sort_index()
    total = len(y)
    class_weights = {
        c: total / (len(class_counts) * cnt) for c, cnt in class_counts.items()
    }
    sample_weights = y.map(class_weights).values
    print(f"[train] Class weights: {class_weights}")

    params = {
        "objective": "multi:softprob",
        "num_class": num_class,
        "n_estimators": 400,
        "max_depth": 6,
        "learning_rate": 0.05,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 5,
        "gamma": 0.1,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "tree_method": "hist",
        "eval_metric": "mlogloss",
        "random_state": 42,
        "n_jobs": -1,
        "verbosity": 0,
    }

    print("[train] Running spatial cross-validation (5 folds)...")
    cv_aucs, cv_p20s = [], []

    for fold_i, (train_idx, test_idx) in enumerate(spatial_cv_split(df, n_splits=5)):
        X_tr, X_te = X.iloc[train_idx], X.iloc[test_idx]
        y_tr, y_te = y.iloc[train_idx], y.iloc[test_idx]
        sw_tr = sample_weights[train_idx]

        model = xgb.XGBClassifier(**params)
        model.fit(
            X_tr, y_tr, sample_weight=sw_tr, eval_set=[(X_te, y_te)], verbose=False
        )

        proba = model.predict_proba(X_te)
        y_bin = label_binarize(y_te, classes=list(range(num_class)))
        auc = roc_auc_score(y_bin, proba, multi_class="ovr", average="macro")
        p20 = precision_at_k(
            y_te, proba, k=min(20, len(y_te)), positive_class_idx=num_class - 1
        )

        cv_aucs.append(auc)
        cv_p20s.append(p20)
        print(f"  fold {fold_i+1}: AUC={auc:.3f}  precision@20={p20:.3f}")

    print(f"[train] CV AUC:          {np.mean(cv_aucs):.3f} ± {np.std(cv_aucs):.3f}")
    print(f"[train] CV precision@20: {np.mean(cv_p20s):.3f} ± {np.std(cv_p20s):.3f}")

    print("[train] Training final model with spatial holdout...")
    rng = np.random.default_rng(42)
    grid_id = df["lat_bin"].astype(str) + "_" + df["lon_bin"].astype(str)
    unique_cells = grid_id.unique()
    rng.shuffle(unique_cells)
    holdout_cells = set(unique_cells[: max(1, int(0.2 * len(unique_cells)))])
    holdout_mask = grid_id.isin(holdout_cells)

    X_tr, X_ho = X.loc[~holdout_mask], X.loc[holdout_mask]
    y_tr, y_ho = y.loc[~holdout_mask], y.loc[holdout_mask]
    sw_tr = sample_weights[~holdout_mask]

    final_params = {**params, "early_stopping_rounds": 30}
    final_model = xgb.XGBClassifier(**final_params)
    final_model.fit(
        X_tr,
        y_tr,
        sample_weight=sw_tr,
        eval_set=[(X_ho, y_ho)],
        verbose=False,
    )

    y_pred = final_model.predict(X_ho)
    y_proba = final_model.predict_proba(X_ho)
    y_bin = label_binarize(y_ho, classes=list(range(num_class)))

    report = classification_report(
        y_ho,
        y_pred,
        labels=list(range(num_class)),
        target_names=class_labels,
        output_dict=True,
    )
    final_auc = roc_auc_score(y_bin, y_proba, multi_class="ovr", average="macro")
    final_p20 = precision_at_k(
        y_ho, y_proba, k=min(20, len(y_ho)), positive_class_idx=num_class - 1
    )

    print(f"[train] Final AUC:          {final_auc:.3f}")
    print(f"[train] Final precision@20: {final_p20:.3f}")
    print(
        classification_report(
            y_ho, y_pred, labels=list(range(num_class)), target_names=class_labels
        )
    )

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    final_model.save_model(str(MODEL_OUT))
    print(f"[train] Model saved → {MODEL_OUT}")

    with open(FEAT_LIST, "w") as f:
        json.dump(FEATURE_COLS, f, indent=2)
    print(f"[train] Feature list saved → {FEAT_LIST}")

    train_report = {
        "cv_auc_mean": float(np.mean(cv_aucs)),
        "cv_auc_std": float(np.std(cv_aucs)),
        "cv_precision_at_20": float(np.mean(cv_p20s)),
        "final_auc": float(final_auc),
        "final_precision_at20": float(final_p20),
        "n_samples": int(len(df)),
        "holdout_samples": int(len(y_ho)),
        "feature_cols": FEATURE_COLS,
        "class_weights": {str(k): float(v) for k, v in class_weights.items()},
        "classification_report": report,
        "class_labels": class_labels,
        "class_mapping": {str(k): int(v) for k, v in class_map.items()},
        "num_class": int(num_class),
    }
    with open(REPORT_OUT, "w") as f:
        json.dump(train_report, f, indent=2)
    print(f"[train] Report saved → {REPORT_OUT}")


if __name__ == "__main__":
    run()
