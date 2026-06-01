# CMF Modelling

Road-safety dashboard for Nepali crash records. The server now extracts features from
the local Nepali crash CSVs, creates crash clusters, generates a KDE heatmap, and
serves those outputs to the Leaflet client.

## Repo Layout
- `server/`: Nepali crash feature extraction, clustering, KDE generation, FastAPI, CMF RAG
- `client/`: TanStack Start + Leaflet UI with crash points, clusters, heatmap, and chatbot

## Data Inputs
- `server/data/inputs/01_raw_crash_records.csv`
- `server/data/inputs/02_road_segments_gi_star.csv`
- `server/data/inputs/03_local_level_summary.csv`
- `server/data/inputs/05_crash_cause_severity.csv`
- `server/data/inputs/06_collision_type_severity.csv`

The old US traffic dataset and model-training scaffold are no longer used.

## Crash Pipeline
Run all stages:

```powershell
server\venv\Scripts\python.exe server\run_pipeline.py
```

Stages:
1. `server/pipeline/01_ingest.py` normalizes Nepali crash records into `server/data/raw_crashes.parquet`.
2. `server/pipeline/02_features.py` downloads and caches OSM roads, keeps crashes within 35 m of a detected road, snaps visible points to roads, builds clusters, and writes `server/data/crash_map.json`.
3. `server/pipeline/05_kde.py` generates `server/data/kde_heatmap.json` and injects Leaflet heat data into `crash_map.json`.

Key outputs:
- `server/data/features.parquet`
- `server/data/crash_clusters.json`
- `server/data/kde_heatmap.json`
- `server/data/crash_map.json`
- `server/data/osm_roads.json.gz`

The heatmap is emitted as `[lat, lon, intensity]` rows for:

```ts
L.heatLayer(heatData, {
  radius: 35,
  blur: 25,
  maxZoom: 17,
}).addTo(map);
```

## APIs
- `GET /api/health`
- `GET /api/hotspots` serves `server/data/crash_map.json`
- `POST /api/chat` uses CMF RAG context and Groq for generated responses
- `POST /api/evaluate-intervention` maps a planner recommendation to a stable CMF model

## Demo CMF Model
The board uses a fixed intervention catalog so repeated demo prompts remain consistent.
CMFs multiply when multiple actions are added to the same road context:

```text
projected crashes = baseline crashes * CMF_1 * CMF_2 * ...
```

Examples:
- pedestrian collisions -> pedestrian bridge, CMF `0.30`
- pedestrian crossing risk -> raised crosswalk, CMF `0.55`
- speeding -> speed camera, CMF `0.65`
- head-on collisions -> median barrier, CMF `0.55`
- nighttime visibility -> LED lighting, CMF `0.72`

Planner recommendations appear in blue. Structured recommendations returned by the
assistant appear in red. Both can be removed from the board to compare implications.

## Setup
### Server
```powershell
server\venv\Scripts\python.exe -m pip install -r server\requirements.txt
server\venv\Scripts\python.exe server\run_pipeline.py
server\venv\Scripts\python.exe -m uvicorn server.api.main:app --port 8000
```

For chat, add a Groq API key to `server/.env`:

```dotenv
GROQ_API_KEY="gsk_your_key_here"
```

### Client
```powershell
cd client
npm install
npm run dev
```

## CMF RAG
Add CMF PDFs/text files to `server/RAG/cmf_rag/docs` and build embeddings:

```powershell
server\venv\Scripts\python.exe server\RAG\cmf_rag\cmf_rag.py
```

## Environment Variables
- `HOTSPOTS_API_URL` (client) defaults to `http://localhost:8000`
- `RAG_EMBEDDINGS_PATH` (server) optional override for CMF embeddings
- `GROQ_API_KEY` (server) required for `/api/chat`
- `GROQ_MODEL` (server) defaults to `llama-3.1-8b-instant`
- `GROQ_TEMP` (server) defaults to `0.4`
- `GROQ_MAX_TOKENS` (server) defaults to `320`
