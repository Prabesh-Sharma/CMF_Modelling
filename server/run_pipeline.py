"""
run_pipeline.py
────────────────
Runs all pipeline stages in order.
Usage:
    python run_pipeline.py              # full pipeline
    python run_pipeline.py --from 3     # start from stage 3 (train)
    python run_pipeline.py --only 4     # run only stage 4 (shap)
"""

import argparse
import importlib.util
from pathlib import Path
import traceback

STAGES = [
    (1, "pipeline/01_ingest.py", "Data ingestion"),
    (2, "pipeline/02_features.py", "Feature engineering"),
    (3, "pipeline/03_train.py", "Model training"),
    (4, "pipeline/04_shap.py", "SHAP explainability"),
    (5, "pipeline/05_kde.py", "KDE heatmap"),
]

BASE = Path(__file__).parent


def run_stage(path: str, label: str) -> bool:
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    try:
        spec = importlib.util.spec_from_file_location("stage", BASE / path)
        if spec is None or spec.loader is None:
            print(f"[pipeline] ERROR: cannot load {path}")
            return False
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if not hasattr(module, "run"):
            print(f"[pipeline] ERROR: {path} has no run()")
            return False
        module.run()
        return True
    except Exception:
        print(f"[pipeline] ERROR running {path}")
        traceback.print_exc()
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="from_stage", type=int, default=1)
    parser.add_argument("--only", dest="only_stage", type=int, default=None)
    args = parser.parse_args()

    for num, path, label in STAGES:
        if args.only_stage and num != args.only_stage:
            continue
        if not args.only_stage and num < args.from_stage:
            continue
        ok = run_stage(path, f"Stage {num}: {label}")
        if not ok:
            raise SystemExit(1)

    print(f"\n{'='*60}")
    print("  Pipeline complete.")
    print(f"{'='*60}")
    print("\nOutputs:")
    for f in (
        sorted((BASE / "data").glob("*.parquet"))
        + sorted((BASE / "data").glob("*.json"))
        + sorted((BASE / "models").glob("*"))
    ):
        print(f"  {f.relative_to(BASE)}  ({f.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
