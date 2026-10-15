# Validation performed

Date: 16 October 2026 (India time). Python 3.12.

## Current data status

The official A2Z playlist was read live. It contained 315 accessible titled videos and one unavailable/untitled entry, which was excluded. The full accessible title catalog is committed with its retrieval date; playlist positions remain the original positions.

The extraction retry checkpoint contains **239/315 saved lectures (75.9%)**, producing 5,421 timed windows. The saved caption cache and prepared index are exported separately from application source. Repeated YouTube request/IP blocks were handled with cooldowns and cached resume; the remaining extraction is still in progress.

Lecture #113 (`KSsk8AhdOZA`, Ceil in BST) reports disabled captions. Its media download returned a 195-byte HTML “Site Unavailable” page, which is rejected before speech recognition. Lecture #196 had a read timeout and remains queued for retry. The run paused on an IP block at lecture #242. No missing lecture was replaced with fabricated transcript text or timestamps.

The trusted OS CA store resolved the environment's original certificate-chain error; TLS verification was never disabled. Caption requests now have bounded connect/read timeouts.

## Code checks

- 34 automated tests pass, including all prior regression tests plus playlist positions and series labels, caption-level seek timestamps, summaries, title-only fallback, protection against incidental timestamp matches, coverage reporting, section ingestion, concurrent ingestion, portable export/checksum, malformed catalog handling, new API modes, and no-network serving.
- The notes-demo retrieval evaluation passes 8/8 cases. The separate live-caption evaluation passes **9/9 cases** (six known lecture/time-window targets and three unrelated-question refusals). This is a small retrieval regression set, not a full-playlist quality score.
- Python modules compile, frontend JavaScript passes `node --check`, and repository whitespace checks pass.
- FastAPI test clients verify the website/static assets and API responses. Saved lecture controls and exported source links are implemented in the browser client.

Timestamp tests verify the data-to-link mapping. Actual captions may have speech-recognition errors; a link seeks to the best matching subtitle segment with four seconds of lead-in, rather than claiming independently verified audiovisual precision.

Additional coverage verifies IDF-weighted lexical evidence, rejection of downloaded HTML error pages, and local-media transcription with preserved input. The expanded 239-lecture retrieval evaluation passes 9/9 cases.

Optional dense/Qdrant tests use deterministic fixture vectors and mocked HTTP. LLM tests use mocked responses. The pretrained Whisper `small.en` model was downloaded and loaded. Real media transcription was blocked by the unusable download; the local-media path is tested with a mocked speech model. A real semantic retrieval model, live Qdrant service, or paid LLM key was not used. BM25 and extractive revision require none of them.

## Verification limits

Browser rendering was not run because the prescribed browser-control capability was unavailable. Docker image building and external hosting were not run. The FastAPI repository includes Render/Docker deployment configuration; it is not an already deployed public URL.

For the missing lectures, rerun ingestion on your own laptop/network or import timestamped captions obtained with permission, then rebuild the index. Do not repeatedly retry a known YouTube IP block. For deployment, transfer the prepared database; do not scrape YouTube inside visitor requests.
