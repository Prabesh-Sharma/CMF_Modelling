"""
pipeline/01_ingest.py
─────────────────────
Loads training data from one of three sources:
  A) UK STATS19 CSV
  B) US Accidents CSV (Kaggle)
  C) Your own CSV

Outputs:  data/raw_training.parquet
"""

import pandas as pd
import numpy as np
from pathlib import Path

RAW_OUT = Path(__file__).parent.parent / "data" / "raw_training.parquet"

# ─────────────────────────────────────────────
# PLUG YOUR DATA HERE
# ─────────────────────────────────────────────
STATS19_CSV = None
US_ACC_CSV = "data/inputs/us_accidents_sampled.csv"
CUSTOM_CSV = None

CUSTOM_COL_MAP = {
    # "your_column":        "standard_column",
    # "lat":                "latitude",
    # "lon":                "longitude",
    # "severity_label":     "accident_severity",
    # "road_class":         "road_type",
    # "speed_lim":          "speed_limit",
    # "junction":           "junction_detail",
    # "lighting":           "light_conditions",
    # "weather":            "weather_conditions",
    # "weekday":            "day_of_week",
    # "hour":               "hour_of_day",
}
# ─────────────────────────────────────────────

STATS19_COLS = {
    "latitude": "latitude",
    "longitude": "longitude",
    "accident_severity": "accident_severity",
    "speed_limit": "speed_limit",
    "road_type": "road_type",
    "junction_detail": "junction_detail",
    "light_conditions": "light_conditions",
    "weather_conditions": "weather_conditions",
    "day_of_week": "day_of_week",
    "number_of_vehicles": "number_of_vehicles",
    "number_of_casualties": "number_of_casualties",
    "carriageway_hazards": "carriageway_hazards",
    "time": "time",
}

US_COL_MAP = {
    "Start_Lat": "latitude",
    "Start_Lng": "longitude",
    "Severity": "accident_severity",
    "Wind_Speed(mph)": "wind_speed",
    "Visibility(mi)": "visibility",
    "Temperature(F)": "temperature",
    "Precipitation(in)": "precipitation",
    "Humidity(%)": "humidity",
    "Pressure(in)": "pressure",
    "Junction": "junction_detail",
    "Traffic_Signal": "traffic_signal",
    "Sunrise_Sunset": "light_conditions",
    "Weather_Condition": "weather_conditions",
}


def _severity_to_int(series: pd.Series, source: str) -> pd.Series:
    """Normalise severity using only levels present in the dataset."""
    if source == "stats19":
        # STATS19: 1=Fatal 2=Serious 3=Slight
        # Map to 0..2 for 3-class training: slight=0, serious=1, fatal=2
        m = {1: 2, 2: 1, 3: 0, "Fatal": 2, "Serious": 1, "Slight": 0}
        return series.map(m).fillna(1).astype(int)
    elif source == "us":
        # US: 1-4, 4=most severe → map to 0..3
        return (series.clip(1, 4) - 1).astype(int)
    elif source == "custom":
        if series.dtype == object:
            m = {
                "critical": 3,
                "high": 2,
                "moderate": 1,
                "low": 0,
                "fatal": 3,
                "serious": 2,
                "slight": 1,
                "minor": 0,
            }
            return series.str.lower().map(m).fillna(1).astype(int)
        return series.clip(0, 3).astype(int)
    return series


def _normalize_day_of_week(series: pd.Series, source: str) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce").fillna(1).astype(int)
    if source == "stats19":
        # STATS19: 1=Sunday ... 7=Saturday -> normalize to Monday=1..Sunday=7
        mapping = {1: 7, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6}
        return s.map(mapping).fillna(1).astype(int)
    return s.clip(1, 7).astype(int)


def _to_bool_int(series: pd.Series) -> pd.Series:
    if series.dtype == bool:
        return series.astype(int)
    s = series.astype(str).str.strip().str.lower()
    truthy = {"true", "t", "yes", "y", "1"}
    falsy = {"false", "f", "no", "n", "0"}
    return (
        s.map(lambda x: 1 if x in truthy else 0 if x in falsy else np.nan)
        .fillna(0)
        .astype(int)
    )


def _extract_hour(df: pd.DataFrame) -> pd.Series:
    if "hour_of_day" in df.columns:
        return df["hour_of_day"]
    if "time" in df.columns:
        return pd.to_datetime(
            df["time"], format="%H:%M", errors="coerce"
        ).dt.hour.fillna(12)
    return pd.Series(12, index=df.index)


def load_stats19(path: str) -> pd.DataFrame:
    print(f"[ingest] Loading STATS19 from {path}")
    df = pd.read_csv(path, low_memory=False)
    df = df.rename(
        columns={c: STATS19_COLS[c] for c in STATS19_COLS if c in df.columns}
    )
    df["severity"] = _severity_to_int(df["accident_severity"], "stats19")
    df["hour_of_day"] = _extract_hour(df)
    df["day_of_week"] = _normalize_day_of_week(
        df.get("day_of_week", pd.Series(1, index=df.index)), "stats19"
    )
    df["source"] = "stats19"
    return df


def load_us(path: str) -> pd.DataFrame:
    print(f"[ingest] Loading US Accidents from {path}")
    df = pd.read_csv(path, low_memory=False)
    df = df.rename(columns={c: US_COL_MAP[c] for c in US_COL_MAP if c in df.columns})
    df["severity"] = _severity_to_int(df["accident_severity"], "us")

    if "Start_Time" in df.columns:
        start_time = pd.to_datetime(df["Start_Time"], errors="coerce")
        df["hour_of_day"] = start_time.dt.hour.fillna(12).astype(int)
        df["day_of_week"] = _normalize_day_of_week(
            start_time.dt.dayofweek.fillna(0).astype(int) + 1, "us"
        )
    else:
        df["day_of_week"] = _normalize_day_of_week(
            df.get("day_of_week", pd.Series(1, index=df.index)), "us"
        )

    if "light_conditions" in df.columns:
        light = df["light_conditions"].astype(str).str.strip().str.lower()
        df["light_conditions"] = (
            light.map({"day": 1, "night": 6}).fillna(1).astype(int)
        )

    if "weather_conditions" in df.columns:

        def map_weather(w):
            if not isinstance(w, str):
                return 1
            w_lower = w.lower()
            if any(
                x in w_lower
                for x in ["fair", "clear", "cloudy", "overcast", "scattered"]
            ):
                return 1
            if any(x in w_lower for x in ["rain", "drizzle"]):
                return 2
            if any(x in w_lower for x in ["snow", "sleet", "ice", "wintry"]):
                return 3
            if any(x in w_lower for x in ["thunder", "storm", "t-storm"]):
                return 4
            if any(x in w_lower for x in ["hail"]):
                return 5
            if any(x in w_lower for x in ["fog", "mist", "haze"]):
                return 6
            if any(x in w_lower for x in ["wind", "breezy", "gust"]):
                return 8
            if any(x in w_lower for x in ["smoke", "dust", "ash", "sand"]):
                return 9
            return 1

        df["weather_conditions"] = (
            df["weather_conditions"].apply(map_weather).astype(int)
        )

    if "junction_detail" in df.columns:
        df["junction_detail"] = _to_bool_int(df["junction_detail"])
    if "traffic_signal" in df.columns:
        df["traffic_signal"] = _to_bool_int(df["traffic_signal"])

    df["source"] = "us"
    return df


def load_custom(path: str) -> pd.DataFrame:
    print(f"[ingest] Loading custom CSV from {path}")
    df = pd.read_csv(path, low_memory=False)
    df = df.rename(columns=CUSTOM_COL_MAP)
    df["severity"] = _severity_to_int(
        df.get("accident_severity", pd.Series(1, index=df.index)), "custom"
    )
    df["hour_of_day"] = _extract_hour(df)
    df["source"] = "custom"
    return df


def generate_synthetic() -> pd.DataFrame:
    print("[ingest] No external CSV provided — generating synthetic training data")
    rng = np.random.default_rng(42)
    n = 15000

    road_types = [1, 2, 3, 6, 7, 9, 12]
    junction_det = [0, 1, 2, 3, 5, 6]
    light_cond = [1, 4, 5, 6, 7]
    weather_cond = [1, 2, 3, 4, 5, 8]

    df = pd.DataFrame(
        {
            "latitude": rng.uniform(27.60, 27.78, n),
            "longitude": rng.uniform(85.17, 85.45, n),
            "speed_limit": rng.choice(
                [20, 30, 40, 50, 60, 70], n, p=[0.05, 0.25, 0.30, 0.25, 0.10, 0.05]
            ),
            "road_type": rng.choice(road_types, n),
            "junction_detail": rng.choice(junction_det, n),
            "light_conditions": rng.choice(light_cond, n),
            "weather_conditions": rng.choice(weather_cond, n),
            "day_of_week": rng.integers(1, 8, n),
            "hour_of_day": rng.integers(0, 24, n),
            "number_of_vehicles": rng.integers(1, 6, n),
            "number_of_casualties": rng.integers(0, 5, n),
            "carriageway_hazards": rng.choice([0, 1], n, p=[0.85, 0.15]),
            "source": "synthetic",
        }
    )

    score = (
        (df["speed_limit"] > 50).astype(int) * 1.5
        + (df["junction_detail"] > 0).astype(int) * 1.2
        + (df["light_conditions"] > 1).astype(int) * 0.8
        + (df["weather_conditions"] > 1).astype(int) * 0.6
        + (df["carriageway_hazards"] == 1).astype(int) * 1.0
        + rng.normal(0, 0.8, n)
    )
    df["severity"] = pd.cut(
        score, bins=[-99, 0.5, 2.0, 3.5, 99], labels=[0, 1, 2, 3]
    ).astype(int)
    return df


def run():
    if STATS19_CSV:
        df = load_stats19(STATS19_CSV)
    elif US_ACC_CSV:
        df = load_us(US_ACC_CSV)
    elif CUSTOM_CSV:
        df = load_custom(CUSTOM_CSV)
    else:
        df = generate_synthetic()

    required = ["latitude", "longitude", "severity"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns after ingestion: {missing}")

    df = df.dropna(subset=["latitude", "longitude"])
    df = df[df["latitude"].between(-90, 90) & df["longitude"].between(-180, 180)]

    RAW_OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(RAW_OUT, index=False)
    print(f"[ingest] Saved {len(df):,} rows → {RAW_OUT}")
    print(
        f"[ingest] Severity distribution:\n{df['severity'].value_counts().sort_index()}"
    )


if __name__ == "__main__":
    run()
