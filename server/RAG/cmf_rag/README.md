# CMF RAG Pipeline (Ollama + Qwen)

Build a small knowledge base of CMF references, retrieve relevant excerpts, and use Qwen (via Ollama) to answer CMF questions and estimate crash changes from interventions.

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

3. Build the knowledge base
   ```bash
   python cmf_rag.py build --input-dir docs --output data/cmf_embeddings.parquet
   ```

4. Ask a question
   ```bash
   python cmf_rag.py ask \
     --query "Add a roundabout at a 4-leg urban intersection" \
     --facility "urban 4-leg intersection" \
     --crash-type "all crashes" \
     --severity "injury" \
     --baseline-crashes 50
   ```

## Notes
- Ensure Ollama is running and the model is available:
  ```bash
  ollama pull qwen2.5:7b-instruct-q4_K_M
  ```
- Training data is not required; this is a retrieval-augmented lookup pipeline.
- Results depend on the quality and relevance of your CMF documents.
