# Validation performed

Date: 14 October 2026 (India time). Python 3.12.

- **21 automated tests passed**: timestamp/overlap preservation, deterministic IDs, repeated indexing, preservation after corrupt input, refusal queries, note/lecture attribution, lecture filters, server reload after indexing, SRT import, cached ingestion resume and block handling, API validation/authentication/rate limits, provider failure fallback, citation validation, code indices, hybrid ranking, Qdrant query shape, verified index download and checksum rejection.
- **8/8 demo retrieval evaluation cases passed**, including unrelated React, income tax, and cricket questions.
- Python modules compile and frontend JavaScript passes `node --check`.
- Uvicorn successfully starts on `0.0.0.0:8000`; HTTP endpoints and static assets are smoke-tested.
- Repository whitespace validation passes.
- A hosting regression retrieves a timed lecture fixture while external network access and YouTube/Whisper imports are blocked. Both search and answer return its saved timestamp without any external request. Provider downtime falls back to that evidence, and bootstrap reuses an existing local index without a download.

Tested versions: FastAPI 0.143.0, Uvicorn 0.54.0, httpx 0.28.1, python-dotenv 1.2.4, pydantic 2.13.5, pytest 9.1.1. The ingestion packages installed successfully (yt-dlp 2026.8.19, youtube-transcript-api 1.2.4).

The optional dense/Qdrant tests use deterministic fixture vectors and mocked HTTP responses. They do not claim that a real semantic model was downloaded or a live Qdrant cluster was queried. LLM tests use mocked responses, not a paid API key. No provider key was required to start the actual demo server.

Full YouTube ingestion was **not** completed: the environment's certificate chain prevented yt-dlp from accessing the playlist. The official A2Z playlist URL was verified through web retrieval. No real Striver transcripts or fabricated lecture timestamps are bundled.

Browser rendering was attempted, but a Playwright browser executable was unavailable. Responsive CSS and JavaScript were checked in source; visual/browser interactions still need verification on your device. Docker was unavailable, so the Docker image was not built. No external hosting deployment was created; deployment configuration and instructions are included.

GitHub Actions reruns the base tests on pushes. Optional vector tests skip if NumPy is not installed. The base app does not require NumPy, PyTorch, Whisper, or Qdrant.

Before sharing the real app: ingest a small pilot, inspect transcript accuracy, evaluate actual video/timestamp targets, configure an LLM if desired, and verify the UI and hosting integrations. Syntactically valid citations do not establish factual correctness of every generated claim.
