import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd
import torch
from sentence_transformers import SentenceTransformer, util
from tqdm.auto import tqdm


@dataclass
class CMFQuery:
    query: str
    facility: str
    crash_type: str
    severity: str
    baseline_crashes: Optional[float] = None


def load_text_from_file(path: Path) -> str:
    if path.suffix.lower() in {".txt", ".md"}:
        return path.read_text(errors="ignore")
    if path.suffix.lower() == ".pdf":
        import fitz

        doc = fitz.open(path)
        pages = []
        for page in doc:
            text = page.get_text().replace("\n", " ").strip()
            pages.append(text)
        return "\n".join(pages)
    raise ValueError(f"Unsupported file type: {path}")


def chunk_text(text: str, max_words: int = 120, overlap: int = 20) -> List[str]:
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = min(len(words), start + max_words)
        chunk = " ".join(words[start:end])
        if chunk:
            chunks.append(chunk)
        start = end - overlap
        if start < 0:
            start = 0
    return chunks


def build_embeddings(
    input_dir: Path,
    output_path: Path,
    model_name: str = "all-mpnet-base-v2",
    min_words: int = 30,
) -> None:
    input_files = sorted([p for p in input_dir.rglob("*") if p.is_file()])
    if not input_files:
        raise FileNotFoundError(f"No files found in {input_dir}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SentenceTransformer(model_name_or_path=model_name, device=device)

    rows = []
    for path in tqdm(input_files, desc="Loading documents"):
        text = load_text_from_file(path)
        chunks = chunk_text(text)
        for idx, chunk in enumerate(chunks):
            if len(chunk.split()) < min_words:
                continue
            rows.append(
                {
                    "source": path.name,
                    "chunk_id": idx,
                    "text": chunk,
                }
            )

    if not rows:
        raise ValueError("No chunks met the minimum length threshold.")

    texts = [r["text"] for r in rows]
    embeddings = model.encode(texts, convert_to_tensor=True, batch_size=32)

    for i, row in enumerate(rows):
        row["embedding"] = embeddings[i].cpu().numpy()

    df = pd.DataFrame(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(output_path, index=False)
    print(f"Saved {len(df)} chunks to {output_path}")


def load_embeddings(path: Path) -> Tuple[torch.Tensor, List[dict]]:
    df = pd.read_parquet(path)
    embeddings = torch.tensor(np.stack(df["embedding"].tolist(), axis=0), dtype=torch.float32)
    return embeddings, df.to_dict(orient="records")


def retrieve(
    query: str,
    embeddings: torch.Tensor,
    model: SentenceTransformer,
    top_k: int = 5,
) -> Tuple[List[float], List[int]]:
    query_embedding = model.encode(query, convert_to_tensor=True)
    scores = util.dot_score(query_embedding, embeddings)[0]
    top_scores, top_indices = torch.topk(scores, k=top_k)
    return top_scores.cpu().tolist(), top_indices.cpu().tolist()


def format_prompt(query: CMFQuery, contexts: List[dict]) -> str:
    context_block = "\n".join(
        [f"- ({c['source']}) {c['text'][:300]}..." for c in contexts]
    )
    base = "" if query.baseline_crashes is None else f"Baseline crashes: {query.baseline_crashes}\n"

    return (
        "You are a road safety engineer. Use the provided CMF references to respond. "
        "If multiple CMFs apply, explain which one is most relevant. If numeric values are present, "
        "show the calculation for post-intervention crashes.\n\n"
        f"Facility: {query.facility}\n"
        f"Crash type: {query.crash_type}\n"
        f"Severity: {query.severity}\n"
        f"{base}"
        "\nREFERENCES:\n"
        f"{context_block}\n\n"
        f"QUERY: {query.query}\n"
        "ANSWER (bullets, include CMF and citation if present):"
    )


def ollama_generate(prompt: str, model: str, temperature: float, max_new_tokens: int) -> str:
    import ollama

    response = ollama.chat(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        options={
            "temperature": temperature,
            "num_predict": max_new_tokens,
            "num_ctx": 4096,
            "stop": ["\n\n\n", "Note:", "Remember:"],
        },
    )
    return response["message"]["content"]


def command_build(args: argparse.Namespace) -> None:
    build_embeddings(
        input_dir=Path(args.input_dir),
        output_path=Path(args.output),
        model_name=args.embed_model,
        min_words=args.min_words,
    )


def command_ask(args: argparse.Namespace) -> None:
    embeddings, chunks = load_embeddings(Path(args.embeddings))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    embeddings = embeddings.to(device)
    model = SentenceTransformer(model_name_or_path=args.embed_model, device=device)

    query_obj = CMFQuery(
        query=args.query,
        facility=args.facility,
        crash_type=args.crash_type,
        severity=args.severity,
        baseline_crashes=args.baseline_crashes,
    )
    enriched_query = f"{args.query} {args.facility} {args.crash_type} {args.severity}"
    scores, indices = retrieve(enriched_query, embeddings, model, top_k=args.top_k)

    contexts = [chunks[i] for i in indices]
    for i, item in enumerate(contexts):
        item["score"] = float(scores[i])

    prompt = format_prompt(query_obj, contexts)
    answer = ollama_generate(
        prompt=prompt,
        model=args.ollama_model,
        temperature=args.temperature,
        max_new_tokens=args.max_new_tokens,
    )

    print(answer)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build")
    build.add_argument("--input-dir", required=True)
    build.add_argument("--output", required=True)
    build.add_argument("--embed-model", default="all-mpnet-base-v2")
    build.add_argument("--min-words", type=int, default=30)
    build.set_defaults(func=command_build)

    ask = sub.add_parser("ask")
    ask.add_argument("--embeddings", default="data/cmf_embeddings.parquet")
    ask.add_argument("--embed-model", default="all-mpnet-base-v2")
    ask.add_argument("--ollama-model", default="qwen2.5:7b-instruct-q4_K_M")
    ask.add_argument("--query", required=True)
    ask.add_argument("--facility", required=True)
    ask.add_argument("--crash-type", required=True)
    ask.add_argument("--severity", required=True)
    ask.add_argument("--baseline-crashes", type=float, default=None)
    ask.add_argument("--top-k", type=int, default=5)
    ask.add_argument("--temperature", type=float, default=0.4)
    ask.add_argument("--max-new-tokens", type=int, default=512)
    ask.set_defaults(func=command_ask)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
