# A2Z Studyroom — Striver DSA lecture RAG

A deployable study application for [Striver’s A2Z DSA playlist](https://www.youtube.com/playlist?list=PLgUwDviBIf0oF6QL8m22w1hIDC1vJ_BHz). Ask a question, retrieve transcript segments, and open the lecture near the explanation. Generated answers are optional; retrieval works without an LLM key.

**What students get:** ask “Where is binary search taught?” or “Revise distinct subsequences” to see the video title, playlist position, the creator's series label (for example `DP 32`), a timestamp link, and a short extractive recap from indexed captions. Optional LLM explanations add examples, hints and code.

**Data included in GitHub:** a verified catalog of **315 accessible A2Z videos** (15 October 2026 UTC), plus 22 original DSA revision notes. One unavailable/untitled playlist entry was excluded. The catalog provides genuine lecture links immediately; timestamps and lecture summaries require a prepared caption index. Raw lecture transcripts, API keys and runtime databases are not committed. Coverage is visible in the website and `/api/stats`; no title-only result is presented as a verified timestamp.

## Features

- Caption-level timestamp links, playlist positions, series labels, concise extractive summaries, and an embedded YouTube player.
- Find lecture and Quick revision modes; title-search fallback for missing captions.
- Full playlist browser, caption coverage, saved lectures on your device, and chat exports including source links.
- Per-lecture retrieval filters; English, Hinglish, and Hindi response choices.
- Explain, hint, compare, complexity, and code modes with a configured LLM.
- Captions-first offline ingestion, cached resume, optional Whisper, JSON/SRT/VTT imports.
- BM25 + SQLite without model downloads; optional semantic embeddings and Qdrant.
- Responsive UI and API on one FastAPI server, network binding, Docker and Render setup.
- No-evidence refusal, citation validation, provider failure fallback, optional shared access key.

Independent application, not affiliated with Striver or takeUforward. References identify retrieved evidence; a syntactically valid citation does not prove every generated claim. Verify important answers against the source.

## Start locally without keys

Python 3.11–3.12 recommended; Python 3.12 used for validation.

```bash
git clone https://github.com/alisalmann7386-crypto/YT_RAG.git
cd YT_RAG
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -e ".[dev,ingest]"
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, or `cp .env.example .env` on macOS/Linux), then:

```bash
python -m app.cli index --demo
python -m app.cli serve --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000**. API documentation: **http://localhost:8000/docs**. Other devices on the same Wi-Fi use **http://YOUR_LAPTOP_LAN_IP:8000** after you allow inbound TCP 8000. `0.0.0.0` is the bind address, not a browser address; it does not automatically create public internet access.

## Prepare the real playlist (“training”)

RAG uses pretrained models. You build its knowledge index rather than training an LLM from scratch.

```bash
python -m app.cli preflight
python -m app.cli ingest --start-position 8 --limit 3
python -m app.cli index
python -m app.cli search "recursion base case"
```

Inspect `data/transcripts/` and `data/ingest_report.json`. When the pilot works:

```bash
python -m app.cli ingest --workers 3
python -m app.cli index
python -m app.cli stats
```

Ingestion caches timestamped text; indexing creates the query snapshot. Real indexing replaces the demo corpus. The running server notices a rebuilt index on the next request. Rerunning ingestion skips valid cached work. A blocked or partial run records failures and exits nonzero. Run again to resume transient failures; known IP blocks stop new requests. Use `--start-position` / `--end-position` to prepare particular sections. Refresh title metadata alone with `python -m app.cli catalog`.

**Your users do not download any videos.** Available captions are fetched once as text by the administrator. Only optional offline Whisper preparation downloads audio for missing captions. Deployed retrieval reads the prepared index and is tested with YouTube/network access blocked; playing the linked video still requires YouTube access.

Read **[docs/TRAINING.md](docs/TRAINING.md)** for the complete setup, semantic embeddings, missing captions, Colab, and evaluation.

## Move a prepared index to another machine

```bash
python -m app.cli export --output a2z_index.zip
```

Extract `index.sqlite3` into the target `data/` directory and start the server. The archive includes its SHA256 checksum and coverage report. The snapshot also contains playlist order, so no playlist scrape is needed at query time. See the deployment guide for HTTPS index transfer on Render.

## Enable generated explanations

In server `.env` or hosting secrets:

```dotenv
LLM_PROVIDER=groq
GROQ_API_KEY=your_key_here
LLM_MODEL=openai/gpt-oss-20b
```

Restart after changing environment values. Keys remain on the server. Missing keys, provider errors, and invalid citations fall back to retrieved excerpts. A no-evidence refusal makes no LLM call. Provider costs and quotas depend on your account.

## Retrieval choices

| Setup | Requirements | Suitable for |
|---|---|---|
| BM25 + SQLite | Base installation, no GPU | Low-memory deployments and first launch |
| BM25 + local dense vectors | `.[semantic]`, pretrained MiniLM | Better paraphrase retrieval |
| BM25 + Qdrant | Same embedder, Qdrant HTTPS | Managed vector storage |

```bash
python -m pip install -e ".[semantic]"
python -m app.cli index --semantic
```

Set `RETRIEVAL_BACKEND=hybrid`. Index and queries must use the same `EMBEDDING_MODEL`. To use Qdrant, set its URL/key and run `python -m app.cli index --semantic --qdrant`. Qdrant is optional; it does not remove the query embedding model's memory requirement or the local evidence corpus.

## Deploy

```bash
# Create .env first and prepare the index locally.
docker compose up --build -d
```

The container binds to `0.0.0.0:8000` and mounts `./data`. The server reads a prepared index; students do not transcribe lectures. See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for Render, Railway, disk/index transfer, optional access control, and network setup. The included `render.yaml` launches the notes demo until you supply a real index.

## API

| Route | Purpose |
|---|---|
| `GET /health` | Process health and corpus readiness |
| `GET /api/stats` | Corpus size and configuration |
| `GET /api/videos` | Indexed library |
| `POST /api/locate` | Search the verified lecture catalog by title |
| `POST /api/search` | Retrieval only |
| `POST /api/ask` | Answer with source references |

```bash
curl -X POST http://localhost:8000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"memoization vs tabulation", "mode":"compare", "language":"English"}'
```

If `APP_API_KEY` is set, add `X-API-Key` or enter it in UI settings. Default UI/API traffic is same-origin. SQLite rate limiting covers search and ask across workers sharing one disk. Separate replicas need a shared limiter.

## Source layout and checks

`app/main.py` serves FastAPI; `ingest.py` prepares transcripts; `chunking.py` preserves timestamps; `retrieval.py` ranks evidence; `answer.py` handles prompting and citations; `cli.py` builds/evaluates indexes; `store.py` writes atomic snapshots; `bootstrap.py` prepares remote indexes; `catalog.py` handles metadata-only lecture discovery; `static/` contains the UI. Runtime data and `.env` are ignored by Git.

```bash
python -m pytest -q
python -m app.cli eval --file data/eval.json
# With actual prepared captions, use the live regression targets:
python -m app.cli eval --file data/eval_lectures.json
```

The bundled evaluation set is for demo notes. Replace expected titles with real video IDs and timestamp ranges after playlist ingestion.

## Reference analysis

Designed after reviewing [week3/ytscraper in padho_with_pratyush_Ai_Enginner](https://github.com/perryvegehan/padho_with_pratyush_Ai_Enginner/tree/main/week3/ytscraper). This is a fresh implementation of its timestamp-aware lecture RAG workflow. Reference source and transcripts were not copied. Read **[docs/REFERENCE_ANALYSIS.md](docs/REFERENCE_ANALYSIS.md)**.
