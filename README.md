# CMF Modelling (Hackathon)

Crash Modification Factor (CMF) modelling toolkit with a map-focused client UI. The server trains on a sampled US accidents dataset, generates hotspot explanations, and exposes APIs for hotspot data, interventions, and a CMF-aware chat assistant.

## Repo layout
- `server/`: Python data pipeline (ingest → features → train → SHAP → KDE) + FastAPI backend
- `client/`: Vite + TanStack Start UI with map-anchored assistant

## What trains on what
- **Training + validation**: `server/data/inputs/us_accidents_sampled.csv` (or STATS19/custom if configured)
- **Kathmandu Valley**: used only for **inference/explainability** and KDE heatmap generation

## Server pipeline
Run all stages with:
```bash
python server/run_pipeline.py
```

Stages:
1. **Ingest** (`server/pipeline/01_ingest.py`)
   - Standardizes columns, normalizes severity, parses time, maps weather/light/junction flags.
   - Output: `server/data/raw_training.parquet`

2. **Feature engineering** (`server/pipeline/02_features.py`)
   - Builds model features (weather, time cyclics, junction/road risk, interactions).
   - Optional OSM enrichment via OSMnx (disabled for large datasets).
   - Output: `server/data/features.parquet`

3. **Training + validation** (`server/pipeline/03_train.py`)
   - Spatial CV + spatial holdout on the **training dataset**.
   - Output: `server/models/xgb_model.json`, `server/models/train_report.json`

4. **SHAP explainability** (`server/pipeline/04_shap.py`)
   - Local explanations for Kathmandu hotspots.
   - Global SHAP computed on a sample of training features.
   - Output: `server/data/shap_global.json`, `server/data/shap_hotspots.json`

5. **KDE heatmap** (`server/pipeline/05_kde.py`)
   - Output: `server/data/kde_heatmap.json`

## OSM enrichment (what was used in your run)
- OSM enrichment for the **training data** was **skipped** because the US dataset is too large.
- Kathmandu OSM features **were generated** for the hotspot showcase.

To enable OSM enrichment for training, either:
- use a much smaller regional dataset, or
- lower `OSM_MAX_POINTS` / tighten `OSM_MAX_DEG_RANGE` in `server/pipeline/02_features.py`.

## APIs
- `GET /api/hotspots` → serves `server/data/shap_hotspots.json`
- `POST /api/interventions` → logs interventions, returns combined CMF + post-crash estimate
- `POST /api/chat` → CMF RAG + Qwen (Ollama) responses with context

## Setup
### Server
```bash
python -m venv server/.venv
source server/.venv/bin/activate
pip install -r server/requirements.txt
```

Run the API:
```bash
uvicorn server.api.main:app --reload --port 8000
```

Optional OSM dependencies (if not already installed):
```bash
pip install osmnx geopandas shapely
```

### Client
```bash
cd client
npm install
npm run dev
```

### CMF RAG (optional, for /api/chat)
Add CMF PDFs/text files to `server/RAG/cmf_rag/docs` and build embeddings:
```bash
python server/RAG/cmf_rag/cmf_rag.py build \
  --input-dir server/RAG/cmf_rag/docs \
  --output server/RAG/cmf_rag/data/cmf_embeddings.parquet
```

Ensure Ollama is running and Qwen is available:
```bash
ollama pull qwen2.5:7b-instruct-q4_K_M
```

## Data inputs
- `server/data/inputs/us_accidents_sampled.csv`
- `server/data/kathmandu_hotspots.json`

Optional: `server/scratch/download_and_sample.py` downloads a Kaggle dataset if you provide credentials in `server/.env`.

## Outputs
- `server/data/*.parquet` (features)
- `server/data/shap_*.json` (explainability)
- `server/data/kde_heatmap.json`
- `server/models/*.json` (model + report)

## Environment variables
- `HOTSPOTS_API_URL` (client) — defaults to `http://localhost:8000`
- `RAG_EMBEDDINGS_PATH` (server) — optional override for CMF embeddings file
- `OLLAMA_MODEL` (server) — defaults to `qwen2.5:7b-instruct-q4_K_M`

## Hackathon notes
- The Kathmandu results are **transfer estimates** from a model trained on US data.
- Use them as relative risk indicators, not calibrated probabilities.
- For a more robust demo, add a small local labeled dataset or calibrate on Kathmandu data.
