import os
import re
import json
import shutil
from pathlib import Path
import pandas as pd
# pyrefly: ignore [missing-import]
import opendatasets as od

def main():
    # 1. Parse .env file for Kaggle credentials
    env_path = Path(__file__).parent.parent / ".env"
    if not env_path.exists():
        raise FileNotFoundError(f"Could not find .env file at {env_path}")
        
    content = env_path.read_text()
    token_match = re.search(r"Kaggle_token\s*=\s*([^\s]+)", content, re.IGNORECASE)
    username_match = re.search(r"kaggle_username\s*=\s*([^\s]+)", content, re.IGNORECASE)

    if not token_match or not username_match:
        raise ValueError("Could not find Kaggle_token or kaggle_username in .env")

    token = token_match.group(1).strip()
    username = username_match.group(1).strip()
    print(f"Parsed credentials for Kaggle user: {username}")

    # 2. Write temporary kaggle.json so opendatasets doesn't prompt for input
    kaggle_json = {"username": username, "key": token}
    with open("kaggle.json", "w") as f:
        json.dump(kaggle_json, f)
    print("Created temporary kaggle.json")

    # 3. Download the US Accidents dataset
    download_url = 'https://www.kaggle.com/datasets/sobhanmoosavi/us-accidents'
    print(f"Downloading from {download_url}...")
    od.download(download_url)

    # 4. Find the downloaded CSV
    download_dir = Path("us-accidents")
    if not download_dir.exists():
        raise FileNotFoundError("Download folder 'us-accidents' was not found.")
        
    csv_paths = list(download_dir.glob("*.csv"))
    if not csv_paths:
        raise FileNotFoundError("Could not find any CSV files in the downloaded directory.")
    csv_path = csv_paths[0]
    print(f"Found downloaded raw CSV at: {csv_path}")

    # 5. Stream and chunk-sample to ensure memory safety
    print("Starting chunk-based downsampling to ensure memory safety...")
    chunksize = 100000
    chunks = []
    sampling_frac = 0.043 # targeting roughly 150k out of 3.5 million rows (update if dataset size changes)

    for chunk in pd.read_csv(csv_path, chunksize=chunksize, low_memory=False):
        sampled_chunk = chunk.sample(frac=sampling_frac, random_state=42)
        chunks.append(sampled_chunk)

    df_sampled = pd.concat(chunks, ignore_index=True)
    print(f"Successfully downsampled to {len(df_sampled):,} rows.")

    # 6. Save sampled dataset under data/inputs
    out_dir = Path(__file__).parent.parent / "data" / "inputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "us_accidents_sampled.csv"
    
    df_sampled.to_csv(out_path, index=False)
    print(f"Saved sampled dataset to: {out_path}")

    # 7. Cleanup raw multi-gigabyte folder and temporary json
    print("Cleaning up raw multi-gigabyte zip/CSV files and credentials...")
    if download_dir.exists():
        shutil.rmtree(download_dir)
    if Path("kaggle.json").exists():
        Path("kaggle.json").unlink()
    print("Cleanup complete! System disk space preserved.")

if __name__ == "__main__":
    main()
