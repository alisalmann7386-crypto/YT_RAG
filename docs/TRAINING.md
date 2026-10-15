# Prepare the A2Z knowledge base

You do not train an LLM from scratch for this app. Whisper, embeddings, and the hosted LLM use pretrained weights. You prepare timestamped lecture text, build its retrieval index, and evaluate it. Fine-tuning is a separate task and is not implemented here.

## 1. Install

```bash
git clone https://github.com/alisalmann7386-crypto/YT_RAG.git
cd YT_RAG
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
Copy-Item .env.example .env
```

macOS/Linux:

```bash
source .venv/bin/activate
cp .env.example .env
```

Then:

```bash
python -m pip install --upgrade pip
python -m pip install -e ".[dev,ingest]"
python -m app.cli preflight
```

Preflight checks local dependencies and whether keys are set. It does not verify external access or quotas. Leave `LLM_PROVIDER=none` and `RETRIEVAL_BACKEND=bm25` for the initial run; no GPU or model download is needed.

## 2. Check three lectures first

```bash
python -m app.cli ingest --limit 3
```

Default playlist: https://www.youtube.com/playlist?list=PLgUwDviBIf0oF6QL8m22w1hIDC1vJ_BHz

The tool prefers English captions, then Hindi (`CAPTION_LANGUAGES=en,hi`). Inspect the generated JSON in `data/transcripts/`, checking technical terms and real segment start/end timestamps against each video. Check `data/ingest_report.json` for failures. A nonzero exit or `aborted=true` means the run was incomplete.

## 3. Fetch the full playlist

```bash
python -m app.cli ingest
```

The command resumes valid cached transcripts. For modest concurrency use `python -m app.cli ingest --workers 3` (maximum 4; default 1). In-flight requests may finish after a failure triggers a stop. Never increase concurrency to work around a known block. To discover newly added videos:

```bash
python -m app.cli ingest --refresh-playlist
```

An IP block or three consecutive failures stops the run. Completed transcripts survive interruption. Cached, newly completed, selected, and failed counts are reported separately.

### Prepare a particular section

```bash
python -m app.cli ingest --start-position 182 --end-position 237 --workers 3
python -m app.cli index
python -m app.cli catalog
```

Positions are the original playlist positions, not the number of successfully downloaded videos. The creator’s `DP 1`, `G-5`, etc. series labels are retained separately. Refreshing the catalog does not fetch captions. Rebuild the index after updating metadata so the deployed snapshot includes the new order.

### Missing captions

Install optional speech recognition and explicitly permit it:

```bash
python -m pip install -e ".[whisper]"
python -m app.cli ingest --limit 3 --whisper
```

Defaults: `WHISPER_MODEL=small`, `WHISPER_DEVICE=cpu`, `WHISPER_LANGUAGE=en`. Test a representative lecture before scaling. CPU transcription of a long playlist can take substantial time. NVIDIA GPU execution requires compatible CUDA libraries; Intel Arc is not the CUDA backend. The app does not promise a fixed processing time.

Audio is deleted only after the transcript is safely written. `--whisper` does not attempt audio download after a known IP block. Failed audio may remain under `data/audio/` for inspection. The web-serving install does not need Whisper.

### Certificate trust errors

Use an up-to-date trusted CA store. On a managed machine whose corporate CA is installed in the OS store, set `YOUTUBE_USE_SYSTEM_CA=true`; for the captions client, `REQUESTS_CA_BUNDLE` can point to your trusted PEM bundle. On Linux this may be `/etc/ssl/certs/ca-certificates.crt`; use your actual platform’s path. Do not disable HTTPS verification.

### Blocked access or unavailable transcripts

Prepare captions on your own laptop network rather than during cloud startup. Update packages if YouTube changes its interfaces:

```bash
python -m pip install --upgrade yt-dlp youtube-transcript-api
```

Import timestamped transcripts you have obtained with permission:

```bash
python -m app.cli import lecture.json
python -m app.cli import lecture.srt --video-id REAL_VIDEO_ID --title "Real lecture title"
python -m app.cli import lecture.vtt --video-id REAL_VIDEO_ID --title "Real lecture title"
```

`REAL_VIDEO_ID` must be the actual 11-character ID. JSON schema example (not a real Striver transcript):

```json
{
  "video_id":"abcdefghijk",
  "title":"Your lecture title",
  "language":"en",
  "source":"import",
  "segments":[{"start":10.0,"end":15.0,"text":"A base case terminates recursion."}]
}
```

JSON segment `duration` is converted to `end` by the importer. The reference repo's timed transcript shape is compatible, but its unrelated Pratyush lectures should not be labeled as Striver content.

## 4. Build the index

```bash
python -m app.cli index
python -m app.cli stats
python -m app.cli search "recursion base case"
```

This builds `data/index.sqlite3` from your cached transcripts and **replaces the demo corpus**. The default is 75-second windows with 15 seconds of target overlap, aligned to full segments. Retrieved sources retain individual subtitle segments; timestamp links use the best matching caption inside the window, rewound four seconds. Captions are approximate and may contain recognition errors. Short summaries select relevant source sentences and are explicitly labeled extractive. Boundaries can vary because segments are never split. A long single segment remains intact. Invalid transcripts fail before the old index is replaced.

### Optional semantic index

For a CPU laptop, install CPU PyTorch first to avoid unnecessary CUDA dependencies:

```bash
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install -e ".[semantic]"
python -m app.cli index --semantic
```

Update `.env`:

```dotenv
RETRIEVAL_BACKEND=hybrid
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
```

The app combines BM25 and dense retrieval through reciprocal-rank fusion. It embeds each query with the **same pretrained model** used at indexing. Precomputed document vectors do not remove the query model's memory requirement. The first model download needs internet.

For stronger Hindi coverage, evaluate a multilingual model such as `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`. Rebuild with the changed model name before serving. Scores are ranking signals, not confidence probabilities.

For optional Qdrant, set `QDRANT_URL` and `QDRANT_API_KEY`, then:

```bash
python -m app.cli index --semantic --qdrant
```

The collection name is versioned by the model and chunk IDs, saved in index metadata, and queried with matching configuration. Old collections are not deleted. You still deploy the SQLite corpus for BM25 and source text plus the query embedding model. Leave `QDRANT_URL` empty for local vectors.

## 5. Enable explanations and serve

```dotenv
LLM_PROVIDER=groq
GROQ_API_KEY=your_real_key
LLM_MODEL=openai/gpt-oss-20b
```

```bash
python -m app.cli serve --host 0.0.0.0 --port 8000
```

Open http://localhost:8000. Restart after editing `.env`. The default model appears in [Groq's model list](https://console.groq.com/docs/models); provider availability, prices, and quotas can change. Keep keys out of Git. Without an LLM, the app returns excerpts and clearly labels evidence-only mode; it does not claim to generate a new hint, translation, or code solution.

## Evaluate before sharing

The included `data/eval.json` tests the notes demo. For the actual playlist, create `data/my_eval.json` with 15–20 real questions and verified expected positions:

```json
[
  {"question":"Your actual lecture question","expect_video_id":"abcdefghijk","expect_second":120,"tolerance":30},
  {"question":"React hooks useEffect","expect_refusal":true}
]
```

Replace the placeholder first row with a genuine video and timestamp, then:

```bash
python -m app.cli eval --file data/my_eval.json
```

This measures retrieval hits/refusals, not answer correctness. Check real video links manually and verify generated claims against transcript excerpts. Tune `LEXICAL_MIN_COVERAGE` and `SEMANTIC_MIN_SCORE` against your corpus; defaults are starting points, not universal validated cutoffs.

## Optional Colab

Mount Drive and keep cached work there:

```python
from google.colab import drive
drive.mount('/content/drive')
import os, subprocess, sys
subprocess.run(['git','clone','https://github.com/alisalmann7386-crypto/YT_RAG.git','/content/YT_RAG'],check=True)
os.chdir('/content/YT_RAG')
subprocess.run([sys.executable,'-m','pip','install','-e','.[ingest,semantic]'],check=True)
os.environ['DATA_DIR']='/content/drive/MyDrive/YT_RAG_A2Z'
subprocess.run([sys.executable,'-m','app.cli','ingest','--limit','3'],check=True)
```

Colab's cloud IP may be blocked too. A GPU does not resolve that. If blocked, ingest on your laptop and upload cached transcripts. After successful preparation:

```python
subprocess.run([sys.executable,'-m','app.cli','ingest'],check=True)
subprocess.run([sys.executable,'-m','app.cli','index','--semantic'],check=True)
```

Download `index.sqlite3` and deploy matching model settings. Colab is for preparation, not a permanent public server.

Back up both `data/transcripts/` and `data/index.sqlite3`. They are ignored by Git. Keeping an index privately does not automatically authorize redistributing complete lecture transcripts in a public repository. To update content, refresh metadata, ingest, and rebuild; no fine-tuning is required.

## Export the prepared runtime

```bash
python -m app.cli export --output a2z_index.zip
```

Transfer this archive privately, extract `index.sqlite3` into the server’s data directory, and verify the supplied checksum. Application source comes from GitHub. No raw audio, cookies, API keys or request logs are included. The database embeds playlist metadata and coverage, so the target machine needs no YouTube ingestion packages to answer questions. Only the optional LLM and semantic query embedder have their own network/model requirements.
