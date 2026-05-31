import json
from pathlib import Path
from typing import List, Optional, Tuple
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
import torch


BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
HOTSPOTS_PATH = DATA_DIR / "shap_hotspots.json"
INTERVENTIONS_LOG = DATA_DIR / "interventions_log.jsonl"
RAG_EMBEDDINGS = Path(
    os.getenv(
        "RAG_EMBEDDINGS_PATH",
        str(DATA_DIR / "cmf_embeddings.parquet"),
    )
)
RAG_EMBEDDINGS_ALT = (
    BASE_DIR / "RAG" / "cmf_rag" / "data" / "cmf_embeddings.parquet"
)


app = FastAPI(title="SafeRoute API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_RAG_MODEL = None
_RAG_EMBEDS = None
_RAG_CHUNKS = None


def _ensure_rag_loaded() -> Tuple["SentenceTransformer", torch.Tensor, List[dict]]:
    if not RAG_EMBEDDINGS.exists() and not RAG_EMBEDDINGS_ALT.exists():
        raise HTTPException(
            status_code=500,
            detail="CMF embeddings not found. Build them first in server/RAG/cmf_rag.",
        )

    path = RAG_EMBEDDINGS if RAG_EMBEDDINGS.exists() else RAG_EMBEDDINGS_ALT

    global _RAG_MODEL, _RAG_EMBEDS, _RAG_CHUNKS
    if _RAG_MODEL is None:
        from sentence_transformers import SentenceTransformer

        device = "cuda" if torch.cuda.is_available() else "cpu"
        _RAG_MODEL = SentenceTransformer(
            model_name_or_path=os.getenv("RAG_EMBED_MODEL", "all-mpnet-base-v2"),
            device=device,
        )

    if _RAG_EMBEDS is None or _RAG_CHUNKS is None:
        import pandas as pd
        import numpy as np

        df = pd.read_parquet(path)
        _RAG_EMBEDS = torch.tensor(
            np.stack(df["embedding"].tolist(), axis=0), dtype=torch.float32
        ).to(_RAG_MODEL.device)
        _RAG_CHUNKS = df.to_dict(orient="records")

    return _RAG_MODEL, _RAG_EMBEDS, _RAG_CHUNKS


def _retrieve_context(query: str, top_k: int = 5) -> List[dict]:
    model, embeds, chunks = _ensure_rag_loaded()
    from sentence_transformers import util

    q = model.encode(query, convert_to_tensor=True)
    scores = util.dot_score(q, embeds)[0]
    top_scores, top_idx = torch.topk(scores, k=top_k)
    results = []
    for score, idx in zip(top_scores.tolist(), top_idx.tolist()):
        item = dict(chunks[idx])
        item["score"] = float(score)
        results.append(item)
    return results


def _ollama_generate(prompt: str) -> str:
    import ollama

    model_name = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct-q4_K_M")
    response = ollama.chat(
        model=model_name,
        messages=[{"role": "user", "content": prompt}],
        options={
            "temperature": float(os.getenv("OLLAMA_TEMP", "0.4")),
            "num_predict": int(os.getenv("OLLAMA_MAX_TOKENS", "512")),
            "num_ctx": 4096,
            "stop": ["\n\n\n", "Note:", "Remember:"],
        },
    )
    return response["message"]["content"]


def _format_prompt(message: str, context: ChatContext, refs: List[dict]) -> str:
    hotspot_block = "None"
    if context.hotspot:
        hotspot_block = json.dumps(context.hotspot.model_dump(), ensure_ascii=False)

    interventions_block = json.dumps(
        [iv.model_dump() for iv in context.interventions], ensure_ascii=False
    )
    selected_block = (
        json.dumps(context.selectedIntervention.model_dump(), ensure_ascii=False)
        if context.selectedIntervention
        else "null"
    )

    references = "\n".join(
        [
            f"- ({r.get('source', 'unknown')}) {str(r.get('text', ''))[:350]}..."
            for r in refs
        ]
    )

    return (
        "You are a road safety engineer. Use the CMF references to suggest interventions "
        "and compute crash reduction. Provide concise bullets and cite sources when possible.\n\n"
        f"HOTSPOT_CONTEXT_JSON:\n{hotspot_block}\n\n"
        f"INTERVENTIONS_JSON:\n{interventions_block}\n\n"
        f"SELECTED_INTERVENTION_JSON:\n{selected_block}\n\n"
        f"REFERENCES:\n{references}\n\n"
        f"QUESTION: {message}\n"
        "ANSWER (bullets only):"
    )


class InterventionInput(BaseModel):
    id: str
    interventionType: str
    interventionId: str
    cmf: float
    cost: float
    latitude: float
    longitude: float
    timestamp: int
    roadId: Optional[str] = None


class InterventionRequest(BaseModel):
    interventions: List[InterventionInput]
    baselineCrashes: Optional[float] = None


class InterventionResponse(BaseModel):
    interventions: List[InterventionInput]
    totalCost: float
    combinedCmf: float
    baselineCrashes: Optional[float] = None
    postCrashes: Optional[float] = None


class ChatHotspot(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    riskLevel: str
    riskScore: float
    predictedCrashes: Optional[float] = None
    source: Optional[str] = None
    shapFactors: Optional[list] = None
    recommendedInterventions: Optional[list] = None


class ChatIntervention(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    interventionType: str
    interventionId: str
    cmf: float
    cost: float
    latitude: float
    longitude: float
    timestamp: int
    roadId: Optional[str] = None


class ChatContext(BaseModel):
    model_config = ConfigDict(extra="allow")

    hotspot: Optional[ChatHotspot] = None
    interventions: List[ChatIntervention] = []
    selectedIntervention: Optional[ChatIntervention] = None


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    message: str
    context: ChatContext


class ChatResponse(BaseModel):
    reply: str
    combinedCmf: Optional[float] = None
    postCrashes: Optional[float] = None
    sources: Optional[list] = None


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/hotspots")
def get_hotspots() -> dict:
    if not HOTSPOTS_PATH.exists():
        raise HTTPException(status_code=500, detail="shap_hotspots.json not found")
    raw = HOTSPOTS_PATH.read_text(encoding="utf-8")
    return json.loads(raw)


@app.post("/api/interventions", response_model=InterventionResponse)
def post_interventions(payload: InterventionRequest) -> InterventionResponse:
    interventions = payload.interventions
    combined_cmf = 1.0
    total_cost = 0.0
    for iv in interventions:
        combined_cmf *= iv.cmf
        total_cost += iv.cost

    post_crashes = None
    if payload.baselineCrashes is not None:
        post_crashes = payload.baselineCrashes * combined_cmf

    record = {
        "interventions": [iv.model_dump() for iv in interventions],
        "baselineCrashes": payload.baselineCrashes,
        "combinedCmf": combined_cmf,
        "totalCost": total_cost,
    }
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with INTERVENTIONS_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except OSError:
        pass

    return InterventionResponse(
        interventions=interventions,
        totalCost=total_cost,
        combinedCmf=combined_cmf,
        baselineCrashes=payload.baselineCrashes,
        postCrashes=post_crashes,
    )


@app.post("/api/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    ctx = payload.context
    combined_cmf = None
    post_crashes = None

    if ctx.interventions:
        combined_cmf = 1.0
        for iv in ctx.interventions:
            combined_cmf *= iv.cmf

    baseline = None
    if ctx.hotspot and ctx.hotspot.predictedCrashes is not None:
        baseline = ctx.hotspot.predictedCrashes

    if baseline is not None and combined_cmf is not None:
        post_crashes = baseline * combined_cmf

    query_parts = [payload.message]
    if ctx.hotspot:
        query_parts.append(ctx.hotspot.name)
        query_parts.append(ctx.hotspot.riskLevel)
        if isinstance(ctx.hotspot.shapFactors, list):
            shap_names = [
                str(f.get("name"))
                for f in ctx.hotspot.shapFactors
                if isinstance(f, dict) and f.get("name")
            ]
            query_parts.extend(shap_names)
        if isinstance(ctx.hotspot.recommendedInterventions, list):
            query_parts.extend([str(x) for x in ctx.hotspot.recommendedInterventions])
    if ctx.selectedIntervention:
        query_parts.append(ctx.selectedIntervention.interventionType)
    if ctx.interventions:
        query_parts.extend([iv.interventionType for iv in ctx.interventions])

    query = " ".join([p for p in query_parts if p]).strip()

    try:
        refs = _retrieve_context(query=query, top_k=5)
        prompt = _format_prompt(payload.message, ctx, refs)
        reply = _ollama_generate(prompt)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    sources = [{"source": r.get("source"), "score": r.get("score")} for r in refs]

    return ChatResponse(
        reply=reply,
        combinedCmf=combined_cmf,
        postCrashes=post_crashes,
        sources=sources,
    )
