from pathlib import Path
from typing import List

import pandas as pd
import torch
from sentence_transformers import SentenceTransformer
from tqdm.auto import tqdm


BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = BASE_DIR / "docs"
OUTPUT_PATH = BASE_DIR / "data" / "cmf_embeddings.parquet"
EMBED_MODEL = "all-mpnet-base-v2"
MIN_WORDS = 30
SUPPORTED_EXTENSIONS = {".md", ".pdf", ".txt"}


def load_text_from_file(path: Path) -> str:
    if path.suffix.lower() in {".txt", ".md"}:
        return path.read_text(errors="ignore")
    if path.suffix.lower() == ".pdf":
        import fitz

        with fitz.open(path) as doc:
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
        if end == len(words):
            break
        start = end - overlap
    return chunks


def build_embeddings(
    input_dir: Path = DOCS_DIR,
    output_path: Path = OUTPUT_PATH,
    model_name: str = EMBED_MODEL,
    min_words: int = MIN_WORDS,
) -> None:
    input_files = sorted(
        path
        for path in input_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    if not input_files:
        raise FileNotFoundError(f"No supported documents found in {input_dir}")

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

    texts = [row["text"] for row in rows]
    embeddings = model.encode(texts, convert_to_tensor=True, batch_size=32)

    for idx, row in enumerate(rows):
        row["embedding"] = embeddings[idx].cpu().numpy()

    df = pd.DataFrame(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(output_path, index=False)
    print(f"Saved {len(df)} chunks to {output_path}")


def main() -> None:
    build_embeddings()


if __name__ == "__main__":
    main()
