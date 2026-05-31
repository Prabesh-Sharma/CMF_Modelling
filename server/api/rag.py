import os
from functools import lru_cache
from pathlib import Path
from typing import List, Tuple

import numpy as np
import pandas as pd
import torch
from sentence_transformers import SentenceTransformer, util


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_EMBED_PATH = BASE_DIR / "RAG" / "cmf_rag" / "data" / "cmf_embeddings.parquet"


def _embed_path() -> Path:
    return Path(os.environ.get("CMF_EMBEDDINGS_PATH", DEFAULT_EMBED_PATH))


def _embed_model_name() -> str:
    return os.environ.get("CMF_EMBED_MODEL", "all-mpnet-base-v2")


def _embed_device() -> str:
    return os.environ.get("CMF_EMBED_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")


@lru_cache
def load_embeddings() -> Tuple[torch.Tensor, List[dict]]:
    path = _embed_path()
    if not path.exists():
        raise FileNotFoundError(f"Embeddings file not found: {path}")

    df = pd.read_parquet(path)
    embeddings = torch.tensor(
        np.stack(df["embedding"].tolist(), axis=0),
        dtype=torch.float32,
    ).to(_embed_device())
    return embeddings, df.to_dict(orient="records")


@lru_cache
def load_model() -> SentenceTransformer:
    return SentenceTransformer(model_name_or_path=_embed_model_name(), device=_embed_device())


def retrieve(query: str, top_k: int = 5) -> List[dict]:
    embeddings, chunks = load_embeddings()
    model = load_model()
    query_embedding = model.encode(query, convert_to_tensor=True)
    scores = util.dot_score(query_embedding, embeddings)[0]
    top_scores, top_indices = torch.topk(scores, k=min(top_k, len(chunks)))

    results = []
    for score, idx in zip(top_scores, top_indices):
        item = chunks[int(idx)].copy()
        item["score"] = float(score)
        results.append(item)
    return results
