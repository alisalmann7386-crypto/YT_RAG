# Deploy and serve over a network

The same FastAPI service hosts the UI and API. Administrators prepare the transcript index offline; no YouTube downloads or Whisper jobs run inside web requests.

## YouTube blocking and user downloads

**Users never download the playlist to retrieve answers.** Administrators fetch available captions as timestamped text once. Only the optional offline `--whisper` path downloads audio for videos without usable captions; complete video files are not required.

After `index.sqlite3` is prepared and placed on the host, `/api/search` and evidence-only `/api/ask` need no YouTube connection. The hosting regression test explicitly blocks network calls and ingestion-package imports while retrieving a timed lecture fixture. It also verifies that an unavailable LLM falls back to the saved evidence and that an existing index is not downloaded again at startup.

Opening an embedded lecture still streams from YouTube and depends on video availability, embedding permission, and the viewer's connection. A deleted/blocked clip may not play even though its previously indexed text remains searchable. This is separate from retrieval.

The repository also ships verified lecture titles, order and links. Metadata-only matches work immediately and explicitly omit in-video timestamps; they are not transcript evidence. An empty host cannot recover a missing caption index by querying YouTube. Transfer your prepared index using the methods below. The code-only demo has original notes, not full A2Z lecture data.

## Same Wi-Fi / LAN

```bash
python -m app.cli serve --host 0.0.0.0 --port 8000
```

On the laptop: http://localhost:8000. On another device: `http://YOUR_LAPTOP_LAN_IP:8000`. Find the actual IPv4 address using Windows `ipconfig` or network settings. Allow inbound TCP 8000 in your firewall and keep the laptop on. Binding to `0.0.0.0` is not public internet hosting.

## Docker

Prepare a local index, copy `.env.example` to `.env`, then:

```bash
docker compose up --build -d
```

Compose mounts `./data` and publishes port 8000. The container runs as nonroot UID 10001; make the mounted directory writable by that user on Linux. `.env` and data are excluded from the image build context.

For hybrid retrieval set `ENABLE_SEMANTIC=true` and `RETRIEVAL_BACKEND=hybrid` in `.env`, prepare a semantic index, and rebuild. Allocate memory for CPU PyTorch and the query model. Model weights may download on the first semantic query unless cached.

The Docker health check assumes internal port 8000, which Compose sets explicitly. Adjust it if you change the internal port.

## Render

Connect the repository as a Python web service, or use `render.yaml`:

| Setting | Value |
|---|---|
| Build | `pip install -e .` |
| Start | `python -m app.bootstrap` |
| Health check | `/health` |
| Runtime | Python 3.12 |
| Port | Render's supplied `PORT` |

Add `LLM_PROVIDER=groq`, `GROQ_API_KEY`, and `LLM_MODEL` in hosting secrets for explanations. Start with BM25 for low memory. The Blueprint initially serves the notes demo; a successful deployment does not mean you have indexed real lectures. Verify `/api/stats` reports `corpus=lecture transcripts` and a positive lecture count.

### Transfer the actual index

Prepare a portable archive with `python -m app.cli export --output a2z_index.zip`. On a machine with direct filesystem access, extract `index.sqlite3` into `DATA_DIR`; the accompanying SHA256 checks the exact snapshot. Playlist positions and catalog metadata are embedded in the database.


Ignored local data does not reach Render through a code push. Choose one:

1. Attach persistent storage, upload `index.sqlite3` through the host's supported mechanism, and set `DATA_DIR` to the mount. Disk/shell availability depends on the service plan.
2. Put the index in private HTTPS object storage and configure these server-side values:

```dotenv
DATA_DIR=/tmp/a2z-data
INDEX_DOWNLOAD_URL=https://YOUR_PRIVATE_STORAGE/your-index.sqlite3
INDEX_SHA256=YOUR_64_CHARACTER_SHA256
DEMO_MODE=false
```

Calculate its checksum:

```bash
python -c "import hashlib,pathlib; print(hashlib.sha256(pathlib.Path('data/index.sqlite3').read_bytes()).hexdigest())"
```

Bootstrap downloads only if the local index is absent. It requires HTTPS, no redirect, a matching SHA256, and a valid SQLite corpus. Maximum download: 200 MiB. Use a direct file URL, not a preview page. The URL must work on future cold starts; short-lived signed URLs eventually expire. URLs and credentials stay in server secrets.

For an existing disk, updating the URL does not overwrite an existing index. Upload/rename a new snapshot atomically or remove the old index during a controlled redeploy, preserving backups. Download failure aborts startup instead of substituting demo notes. With demo disabled and no index/download URL, the service starts empty and `/health` reports `ready=false`; require readiness before sharing.

### Semantic deployment

Use this build command, sufficient instance memory, and matching embedding configuration:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install -e '.[semantic]'
```

Set `RETRIEVAL_BACKEND=hybrid`. Qdrant can store document vectors but does not remove the query embedding model's memory requirement. The SQLite evidence corpus is still deployed.

## Railway / VPS

Use the Dockerfile or the same bootstrap command. Keep `PORT` set to the platform's assigned port and mount persistent data or download a verified index. Use an HTTPS reverse proxy/service manager on a VPS. Do not use development `--reload` for production.

## Access and scaling

- `APP_API_KEY` supplies an optional shared access gate; visitors enter it in UI settings. It is not a per-user account system.
- LLM/Qdrant keys are server-only. Default CORS is same-origin; set exact `CORS_ORIGINS` only for a separate frontend.
- SQLite transactions share request limits across workers on one filesystem. Search and ask are limited; invalid requests can consume slots. Separate replicas need Redis/gateway limits and provider spending controls.
- Trust forwarded client IPs only from your actual reverse proxy. Without proper proxy configuration, visitors may share its IP in the limiter. Never blindly trust every client-supplied `X-Forwarded-For`.
- No public upload/index-mutation endpoint is provided. Index preparation is an administrator action.
- `/health` reports process/corpus state, not successful provider calls. Validate Groq/Qdrant separately.

External hosting was not deployed during repository creation. Docker was unavailable in the authoring environment, so Docker image building requires user-side validation.
