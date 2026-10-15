# Validation performed

Date: 16 October 2026 (India time). Python 3.12.

## Current data status

The official A2Z playlist was read live. It contained 315 accessible titled videos and one unavailable/untitled entry, which was excluded. The full accessible title catalog is committed with its retrieval date; playlist positions remain the original positions.

Real captions were successfully retrieved for the first 25 accessible videos. Indexing produced 935 timed windows. The next video returned `RequestBlocked`, so ingestion stopped without further requests. The prepared snapshot therefore has **25/315 lectures with caption evidence (7.9%)**; the remaining 290 lectures support title-based discovery only. Full-playlist caption ingestion is not claimed. A prior transient proxy error was retried only before the explicit block was observed.

The trusted OS CA store resolved the environment's original certificate-chain error; TLS verification was never disabled. Caption requests now have bounded connect/read timeouts.

## Code checks

- 30 automated tests pass, including all prior regression tests plus playlist positions and series labels, caption-level seek timestamps, summaries, title-only fallback, protection against incidental timestamp matches, coverage reporting, section ingestion, concurrent ingestion, portable export/checksum, malformed catalog handling, new API modes, and no-network serving.
- The notes-demo retrieval evaluation passes 8/8 cases. The separate live-caption evaluation passes **9/9 cases** (six known lecture/time-window targets and three unrelated-question refusals). This is a small retrieval regression set, not a full-playlist quality score.
- Python modules compile, frontend JavaScript passes `node --check`, and repository whitespace checks pass.
- FastAPI test clients verify the website/static assets and API responses. Saved lecture controls and exported source links are implemented in the browser client.

Timestamp tests verify the data-to-link mapping. Actual captions may have speech-recognition errors; a link seeks to the best matching subtitle segment with four seconds of lead-in, rather than claiming independently verified audiovisual precision.

Optional dense/Qdrant tests use deterministic fixture vectors and mocked HTTP. LLM tests use mocked responses. A real semantic model, live Qdrant service, or paid LLM key was not used. BM25 and extractive revision require none of them.

## Verification limits

Browser rendering was not run because the prescribed browser-control capability was unavailable. Docker image building and external hosting were not run. The FastAPI repository includes Render/Docker deployment configuration; it is not an already deployed public URL.

For the missing lectures, rerun ingestion on your own laptop/network or import timestamped captions obtained with permission, then rebuild the index. Do not repeatedly retry a known YouTube IP block. For deployment, transfer the prepared database; do not scrape YouTube inside visitor requests.
