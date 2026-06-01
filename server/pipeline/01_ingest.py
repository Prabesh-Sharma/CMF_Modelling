"""
Normalize the Nepali crash records into a compact parquet file.

Input:  data/inputs/01_raw_crash_records.csv
Output: data/raw_crashes.parquet
"""

from pathlib import Path

import pandas as pd


BASE = Path(__file__).resolve().parents[1]
RAW_CSV = BASE / "data" / "inputs" / "01_raw_crash_records.csv"
RAW_OUT = BASE / "data" / "raw_crashes.parquet"

SEVERITY_SCORE = {
    "PDO": 1,
    "Minor Injury": 2,
    "Major Injury": 3,
    "Death": 4,
}

SEVERITY_LEVEL = {
    "PDO": "low",
    "Minor Injury": "moderate",
    "Major Injury": "high",
    "Death": "critical",
}


def run() -> None:
    if not RAW_CSV.exists():
        raise FileNotFoundError(f"Nepali crash records not found: {RAW_CSV}")

    df = pd.read_csv(RAW_CSV)
    required = {
        "crash_id",
        "date",
        "time",
        "latitude",
        "longitude",
        "severity",
        "cause",
        "collision_type",
        "vehicle_type",
        "road_class",
        "corridor",
        "year",
    }
    missing = sorted(required - set(df.columns))
    if missing:
        raise ValueError(f"Missing required crash columns: {missing}")

    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    df = df.dropna(subset=["latitude", "longitude"])
    df = df[df["latitude"].between(26.0, 29.5) & df["longitude"].between(80.0, 89.0)]

    dt = pd.to_datetime(df["date"].astype(str) + " " + df["time"].astype(str), errors="coerce")
    df["timestamp"] = dt
    df["hour_of_day"] = dt.dt.hour.fillna(12).astype(int)
    df["day_of_week"] = (dt.dt.dayofweek.fillna(0).astype(int) + 1).clip(1, 7)
    df["month"] = dt.dt.month.fillna(1).astype(int)
    df["is_night"] = df["hour_of_day"].between(20, 23) | df["hour_of_day"].between(0, 5)
    df["is_peak_hour"] = df["hour_of_day"].between(7, 10) | df["hour_of_day"].between(16, 19)
    df["severity_score"] = df["severity"].map(SEVERITY_SCORE).fillna(1).astype(int)
    df["severity_level"] = df["severity"].map(SEVERITY_LEVEL).fillna("low")

    text_cols = ["cause", "collision_type", "vehicle_type", "road_class", "corridor"]
    for col in text_cols:
        df[col] = df[col].fillna("Unknown").astype(str).str.strip()

    keep = [
        "crash_id",
        "timestamp",
        "date",
        "time",
        "year",
        "month",
        "day_of_week",
        "hour_of_day",
        "is_night",
        "is_peak_hour",
        "latitude",
        "longitude",
        "severity",
        "severity_score",
        "severity_level",
        "cause",
        "collision_type",
        "vehicle_type",
        "road_class",
        "corridor",
    ]
    out = df[keep].sort_values(["year", "crash_id"]).reset_index(drop=True)

    RAW_OUT.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(RAW_OUT, index=False)
    print(f"[ingest] Saved {len(out):,} Nepali crash records -> {RAW_OUT}")
    print("[ingest] Severity distribution:")
    print(out["severity"].value_counts().to_string())


if __name__ == "__main__":
    run()
