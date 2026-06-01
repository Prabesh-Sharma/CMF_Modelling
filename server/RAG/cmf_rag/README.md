# CMF Embedding Builder

Build the CMF reference embeddings consumed by the API chat endpoint.

## Quickstart
1. Install requirements
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. Add CMF documents
   - Put PDFs or text files in `docs/`.
   - See `docs/README.md` for recommended sources and format.

3. Build the embeddings
   ```bash
   python cmf_rag.py
   ```

## Notes
- The script recursively embeds `.pdf`, `.txt`, and `.md` files from `docs/`.
- Embeddings are written to `data/cmf_embeddings.parquet`.
- Query answering is handled by the API chat endpoint.
- Training data is not required.
- Results depend on the quality and relevance of your CMF documents.
