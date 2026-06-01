from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional, Tuple
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict
import torch


BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

DATA_DIR = BASE_DIR / "data"
CRASH_MAP_PATH = DATA_DIR / "crash_map.json"
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

CMF_CATALOG = {
    "pedestrian-bridge": ("Pedestrian Bridge", 0.30, 320000, "Separates pedestrians from traffic where pedestrian collisions dominate."),
    "raised-crosswalk": ("Raised Crosswalk", 0.55, 9000, "Slows vehicles and improves pedestrian priority at crossings."),
    "speed-camera": ("Speed Camera", 0.65, 35000, "Targets repeated speeding and unsafe driving behavior."),
    "traffic-signal": ("Traffic Signal", 0.65, 80000, "Separates conflicting movements at crash-prone intersections."),
    "protected-left": ("Protected Left Turn Phase", 0.70, 18000, "Reduces turning conflicts at signalized junctions."),
    "led-lighting": ("LED Street Lighting", 0.72, 15000, "Improves visibility for night crashes."),
    "median-barrier": ("Median Barrier", 0.55, 60000, "Reduces severe head-on collisions."),
    "lane-narrowing": ("Lane Narrowing", 0.80, 8000, "Encourages lower speeds and disciplined lane use."),
    "reflective-signage": ("Reflective Signage", 0.88, 2000, "Provides a low-cost visibility improvement."),
}

CMF_DEFINITION = (
    "CMF means Crash Modification Factor / Crash Multiplication Factor. "
    "It is a multiplier on expected crashes: projected crashes = baseline crashes * CMF. "
    "CMF < 1 reduces crashes, CMF = 1 means no change, CMF > 1 increases crashes. "
    "Lower CMF is better only when the intervention matches the crash mechanism."
)


def _catalog_intervention(intervention_id: str) -> dict:
    name, cmf, cost, rationale = CMF_CATALOG[intervention_id]
    return {
        "interventionId": intervention_id,
        "interventionType": name,
        "cmf": cmf,
        "cost": cost,
        "rationale": rationale,
    }


def _with_impact(item: dict, baseline: float | None) -> dict:
    enriched = dict(item)
    if baseline is not None:
        projected = baseline * float(enriched["cmf"])
        enriched["baselineCrashes"] = round(baseline, 1)
        enriched["projectedCrashes"] = round(projected, 1)
        enriched["crashReduction"] = round(baseline - projected, 1)
        enriched["reductionPct"] = round((1.0 - float(enriched["cmf"])) * 100)
    return enriched


def _recommendations_for_context(ctx: "ChatContext") -> list[dict]:
    text_parts = []
    if ctx.hotspot:
        text_parts.extend([ctx.hotspot.name, ctx.hotspot.riskLevel])
        if isinstance(ctx.hotspot.riskFactors, list):
            text_parts.extend(
                str(f.get("name", ""))
                for f in ctx.hotspot.riskFactors
                if isinstance(f, dict)
            )
        accident_reports = getattr(ctx.hotspot, "accidentReports", None) or {}
    else:
        accident_reports = {}
    text = " ".join(text_parts).lower()
    ranked_ids = []
    crash_count = max(1, int(ctx.hotspot.predictedCrashes or 1)) if ctx.hotspot else 1
    if accident_reports.get("pedestrian_related", 0) > 0 or any(
        token in text for token in ["pedestrian", "crossing"]
    ):
        pedestrian_share = accident_reports.get("pedestrian_related", 0) / crash_count
        ranked_ids.extend(
            [
                (pedestrian_share + 0.08, "pedestrian-bridge"),
                (pedestrian_share + 0.04, "raised-crosswalk"),
            ]
        )
    if accident_reports.get("speed_related", 0) > 0 or any(
        token in text for token in ["speed", "careless", "motorcycle"]
    ):
        speed_share = accident_reports.get("speed_related", 0) / crash_count
        ranked_ids.extend([(speed_share + 0.05, "speed-camera"), (speed_share, "lane-narrowing")])
    if accident_reports.get("turning_related", 0) > 0 or any(
        token in text for token in ["turn", "rear", "side", "lane"]
    ):
        turning_share = accident_reports.get("turning_related", 0) / crash_count
        ranked_ids.extend(
            [(turning_share + 0.05, "traffic-signal"), (turning_share + 0.02, "protected-left")]
        )
    if accident_reports.get("head_on", 0) > 0 or any(token in text for token in ["head on", "median"]):
        ranked_ids.append((accident_reports.get("head_on", 0) / crash_count + 0.04, "median-barrier"))
    if any(token in text for token in ["night", "light", "visibility"]):
        ranked_ids.append((0.07, "led-lighting"))
    ranked_ids.extend([(0.03, "speed-camera"), (0.01, "reflective-signage")])
    ranked_ids.sort(reverse=True)
    ids = list(dict.fromkeys(intervention_id for _, intervention_id in ranked_ids))
    baseline = ctx.hotspot.predictedCrashes if ctx.hotspot else None
    return [_with_impact(_catalog_intervention(i), baseline) for i in list(dict.fromkeys(ids))[:4]]


def _evaluate_custom_intervention(name: str) -> dict:
    text = name.lower()
    if any(token in text for token in ["bridge", "overhead", "footbridge"]):
        intervention_id = "pedestrian-bridge"
    elif any(token in text for token in ["crosswalk", "zebra", "pedestrian"]):
        intervention_id = "raised-crosswalk"
    elif any(token in text for token in ["camera", "speed"]):
        intervention_id = "speed-camera"
    elif any(token in text for token in ["signal", "traffic light"]):
        intervention_id = "traffic-signal"
    elif any(token in text for token in ["median", "barrier"]):
        intervention_id = "median-barrier"
    elif any(token in text for token in ["light", "lamp"]):
        intervention_id = "led-lighting"
    elif any(token in text for token in ["lane", "narrow"]):
        intervention_id = "lane-narrowing"
    else:
        intervention_id = "reflective-signage"
    result = _catalog_intervention(intervention_id)
    result["interventionType"] = name
    result["matchedModel"] = CMF_CATALOG[intervention_id][0]
    return result


def _combined_impact(ctx: "ChatContext") -> dict:
    baseline = ctx.hotspot.predictedCrashes if ctx.hotspot else None
    combined_cmf = 1.0
    applied = []
    for iv in ctx.interventions:
        combined_cmf *= iv.cmf
        applied.append(
            {
                "name": iv.interventionType,
                "cmf": iv.cmf,
                "origin": iv.origin,
                "rationale": getattr(iv, "rationale", None),
            }
        )
    projected = baseline * combined_cmf if baseline is not None else None
    return {
        "cmfDefinition": CMF_DEFINITION,
        "baselineCrashes": baseline,
        "combinedCmf": round(combined_cmf, 4) if applied else None,
        "projectedCrashes": round(projected, 1) if projected is not None else None,
        "crashReduction": round(baseline - projected, 1)
        if baseline is not None and projected is not None
        else None,
        "appliedInterventions": applied,
    }


def _static_chat_reply(message: str, ctx: "ChatContext", recommendations: list[dict]) -> str:
    impact = _combined_impact(ctx)
    baseline = impact.get("baselineCrashes")
    combined_cmf = impact.get("combinedCmf")
    projected = impact.get("projectedCrashes")
    reduction = impact.get("crashReduction")
    lines = []

    if ctx.hotspot and ctx.hotspot.id == "all-kathmandu-valley":
        planned = ctx.hotspot.recommendedInterventions or []
        cluster_count = 0
        clusters = set()
        for item in planned:
            cluster_name = str(item).split(":", 1)[0].strip()
            if cluster_name:
                clusters.add(cluster_name)
        cluster_count = len(clusters)
        lines.append(
            f"- Static Kathmandu Valley demo plan covers {baseline} crash records across {cluster_count or 'all'} hotspot clusters."
        )
        lines.append(
            "- Every mapped cluster gets a fixed 5-8 intervention bundle: enforcement, signal/turning control, pedestrian protection, lighting, barrier/signage, and audit."
        )
        for item in planned[:3]:
            lines.append(f"- {item}")
        lines.append(
            "- This is a deterministic demo plan, so the answer is valley-wide and does not optimize for one selected location."
        )
        return "\n".join(lines[:5])

    if combined_cmf is not None and baseline is not None:
        lines.append(
            f"- Current board impact: baseline {baseline} crashes * combined CMF {combined_cmf:.3f} = {projected} projected crashes, reducing about {reduction} crashes."
        )
    elif baseline is not None:
        lines.append(f"- Selected cluster baseline: {baseline} recorded crashes.")

    if recommendations:
        best = recommendations[0]
        projected_text = ""
        if best.get("projectedCrashes") is not None:
            projected_text = (
                f" It projects {best['baselineCrashes']} -> {best['projectedCrashes']} "
                f"crashes ({best['reductionPct']}% reduction)."
            )
        lines.append(
            f"- Best matching intervention: {best['interventionType']} with fixed CMF {best['cmf']:.2f}. {best['rationale']}{projected_text}"
        )
        for item in recommendations[1:4]:
            lines.append(
                f"- Alternative: {item['interventionType']} has fixed CMF {item['cmf']:.2f}; {item['rationale']}"
            )

    if "remove" in message.lower() or "implication" in message.lower():
        lines.append(
            "- Removal implication: deleting an intervention removes its CMF from the product, so projected crashes move back upward by that intervention's avoided-crash contribution."
        )

    return "\n".join(lines[:5])


def _demo_chat_reply(message: str, ctx: "ChatContext") -> str:
    text = message.lower().strip()
    baseline = (
        float(ctx.hotspot.predictedCrashes)
        if ctx.hotspot and ctx.hotspot.predictedCrashes is not None
        else None
    )
    removal_models = [
        (
            ["streetlight", "street light", "lighting", "lamp", "led"],
            "LED street lighting",
            0.72,
            "Night-time visibility drops, increasing pedestrian, turning, and low-visibility crash exposure.",
        ),
        (
            ["camera", "speed enforcement"],
            "speed cameras",
            0.65,
            "Speed deterrence is lost, increasing unsafe-speed and driver-carelessness exposure.",
        ),
        (
            ["barrier", "guardrail", "median"],
            "crash barriers",
            0.55,
            "Vehicles lose protection from severe run-off-road and head-on crash outcomes.",
        ),
        (
            ["crosswalk", "pedestrian bridge", "footbridge", "overhead bridge"],
            "pedestrian crossing protection",
            0.30,
            "Pedestrians return to direct traffic conflict points, increasing pedestrian crash exposure.",
        ),
        (
            ["signal", "traffic light", "turn phase"],
            "signal and turning controls",
            0.65,
            "Conflicting movements are no longer separated, increasing turning and intersection crashes.",
        ),
        (
            ["sign", "signage", "warning"],
            "warning signage",
            0.88,
            "Drivers receive less advance warning before hotspot approaches.",
        ),
    ]

    if any(token in text for token in ["remove", "removing", "without", "implication"]):
        for aliases, label, cmf, explanation in removal_models:
            if any(alias in text for alias in aliases):
                increase = (1.0 / cmf - 1.0) * 100
                avoided = round(baseline * (1.0 - cmf), 1) if baseline is not None else None
                lines = [
                    f"- Removing {label} raises the applicable CMF from {cmf:.2f} back to 1.00.",
                    f"- That is a {increase:.1f}% increase in matching crash risk relative to the treated state.",
                    f"- {explanation}",
                ]
                if avoided is not None:
                    lines.append(
                        f"- Demo implication: up to {avoided} avoided crashes are put back at risk across the mapped valley baseline."
                    )
                return "\n".join(lines)
        return (
            "- Removing an intervention returns its CMF to 1.00 for the crashes it was treating.\n"
            "- Crash risk rises because the intervention's reduction is no longer applied.\n"
            "- Name the intervention to calculate its specific reverse-CMF increase."
        )

    if any(token in text for token in ["recommend", "what model", "what should", "intervention"]):
        return (
            "- Use a fixed cluster bundle: speed cameras for driver carelessness, adaptive signals and protected turns for junction conflicts.\n"
            "- Add pedestrian bridges or raised crossings where pedestrian crashes dominate.\n"
            "- Add LED lighting for night visibility and barriers for severe run-off-road or head-on crashes.\n"
            "- Keep warning signage and a recurring safety audit as baseline controls.\n"
            "- Apply each CMF only to the matching crash mechanism; do not multiply every CMF across every crash."
        )

    if "cmf" in text:
        return (
            "- CMF is applied only to the crash type targeted by an intervention.\n"
            "- A CMF below 1.00 reduces matching crash risk; removing the intervention returns that factor to 1.00.\n"
            "- Ask about a specific intervention to calculate its demo impact."
        )

    return (
        "- The demo uses fixed intervention rules matched to recorded crash causes across Kathmandu Valley clusters.\n"
        "- Ask about removing an intervention, adding a treatment, or the expected CMF effect for a crash type."
    )


def _is_addition_recommendation_question(message: str) -> bool:
    text = message.lower()
    asks_for_recommendation = any(
        token in text
        for token in [
            "recommend",
            "suggest",
            "what model",
            "what should i add",
            "what can i add",
            "which intervention",
            "add intervention",
            "adding an intervention",
        ]
    ) or (
        any(token in text for token in ["add", "install", "apply", "build"])
        and any(token in text for token in ["intervention", "treatment", "model", "measure"])
    )
    asks_about_removal = any(
        token in text for token in ["remove", "removing", "without", "implication", "rise"]
    )
    return asks_for_recommendation and not asks_about_removal


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


def _groq_generate(prompt: str) -> str:
    from groq import Groq

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Create a key at https://console.groq.com/keys "
            "and set it before starting the backend."
        )

    client = Groq(api_key=api_key)
    response = client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
        messages=[{"role": "user", "content": prompt}],
        temperature=float(os.getenv("GROQ_TEMP", "0.4")),
        max_tokens=int(os.getenv("GROQ_MAX_TOKENS", "320")),
        stop=["\n\n\n", "Note:", "Remember:"],
    )
    return response.choices[0].message.content or ""


def _format_prompt(message: str, context: ChatContext, refs: List[dict]) -> str:
    hotspot_block = "None"
    if context.hotspot:
        hotspot_block = json.dumps(context.hotspot.model_dump(), ensure_ascii=False)

    interventions_block = json.dumps(
        [iv.model_dump() for iv in context.interventions[:12]], ensure_ascii=False
    )
    selected_block = (
        json.dumps(context.selectedIntervention.model_dump(), ensure_ascii=False)
        if context.selectedIntervention
        else "null"
    )

    references = "\n".join(
        [
            f"- ({r.get('source', 'unknown')}) {str(r.get('text', ''))[:220]}..."
            for r in refs
        ]
    )
    deterministic = {
        "fixedCmfCatalog": {
            intervention_id: {
                "name": values[0],
                "cmf": values[1],
                "rationale": values[3],
            }
            for intervention_id, values in CMF_CATALOG.items()
        },
        "rankedRecommendations": _recommendations_for_context(context),
    }

    return (
        "You are a road safety engineer answering a general user question for a hackathon "
        "demo. Reason directly about the user's question. CMF is Crash Modification Factor "
        "/ Crash Multiplication Factor, not a model accuracy score. A treatment CMF below "
        "1.00 reduces matching crash risk. Removing that treatment returns its applicable "
        "factor to 1.00; calculate the relative rise from the treated state as "
        "(1 / treatment_CMF - 1) * 100 when relevant. Never multiply every intervention "
        "across every crash, never invent or estimate any CMF, and do not provide unrelated "
        "recommendations. Use the fixedCmfCatalog value when a matching treatment exists. "
        "For streetlights or lighting, use LED Street Lighting CMF 0.72. Answer only "
        "the question in 2-5 concise bullets.\n\n"
        f"HOTSPOT_CONTEXT_JSON:\n{hotspot_block}\n\n"
        f"INTERVENTIONS_JSON:\n{interventions_block}\n\n"
        f"SELECTED_INTERVENTION_JSON:\n{selected_block}\n\n"
        f"DETERMINISTIC_CMF_JSON:\n{json.dumps(deterministic, ensure_ascii=False)}\n\n"
        f"REFERENCES:\n{references}\n\n"
        f"QUESTION: {message}\n"
        "ANSWER (up to five concise bullets):"
    )


class ChatHotspot(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    riskLevel: str
    riskScore: float
    predictedCrashes: Optional[float] = None
    source: Optional[str] = None
    riskFactors: Optional[list] = None
    recommendedInterventions: Optional[list] = None
    accidentReports: Optional[dict] = None
    roadAnchorLat: Optional[float] = None
    roadAnchorLon: Optional[float] = None
    roadName: Optional[str] = None


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
    origin: Optional[str] = "planner"


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
    recommendations: Optional[list] = None
    impactModel: Optional[dict] = None


class InterventionEvaluationRequest(BaseModel):
    name: str


class RecommendationRequest(BaseModel):
    context: ChatContext


class InterventionEvaluationResponse(BaseModel):
    interventionId: str
    interventionType: str
    cmf: float
    cost: float
    rationale: str
    matchedModel: Optional[str] = None


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/hotspots")
def get_hotspots() -> dict:
    if not CRASH_MAP_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Crash map not found. Run server/run_pipeline.py to create {CRASH_MAP_PATH}.",
        )
    raw = CRASH_MAP_PATH.read_text(encoding="utf-8")
    return json.loads(raw)


@app.post("/api/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    ctx = payload.context
    if _is_addition_recommendation_question(payload.message):
        recommendations = _recommendations_for_context(ctx)
        return ChatResponse(
            reply=_demo_chat_reply(payload.message, ctx),
            sources=[],
            recommendations=recommendations,
            impactModel=None,
        )

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
        if isinstance(ctx.hotspot.riskFactors, list):
            factor_names = [
                str(f.get("name"))
                for f in ctx.hotspot.riskFactors
                if isinstance(f, dict) and f.get("name")
            ]
            query_parts.extend(factor_names)
        if isinstance(ctx.hotspot.recommendedInterventions, list):
            query_parts.extend([str(x) for x in ctx.hotspot.recommendedInterventions])
    if ctx.selectedIntervention:
        query_parts.append(ctx.selectedIntervention.interventionType)
    if ctx.interventions:
        query_parts.extend([iv.interventionType for iv in ctx.interventions])

    query = " ".join([p for p in query_parts if p]).strip()

    try:
        refs = _retrieve_context(query=query, top_k=3)
        recommendations = []
        reply = _groq_generate(_format_prompt(payload.message, ctx, refs))
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
        recommendations=recommendations,
        impactModel=_combined_impact(ctx),
    )


@app.post("/api/evaluate-intervention", response_model=InterventionEvaluationResponse)
def evaluate_intervention(payload: InterventionEvaluationRequest) -> dict:
    return _evaluate_custom_intervention(payload.name.strip())


@app.post("/api/cmf-recommendations")
def cmf_recommendations(payload: RecommendationRequest) -> dict:
    return {
        "definition": CMF_DEFINITION,
        "impactModel": _combined_impact(payload.context),
        "recommendations": _recommendations_for_context(payload.context),
    }
