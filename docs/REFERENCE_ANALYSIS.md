# Reference repository analysis

Reviewed [padho_with_pratyush_Ai_Enginner](https://github.com/perryvegehan/padho_with_pratyush_Ai_Enginner), especially [week3/ytscraper](https://github.com/perryvegehan/padho_with_pratyush_Ai_Enginner/tree/main/week3/ytscraper), on 16 October 2026, India time.

The repository is an AI engineering course with weekly exercises: prompting, structured output, resume parsing, retrieval, embeddings, vector stores, agents, evaluation, and a coding proctor. The deployable lecture RAG project is inside `week3/ytscraper`, not the root.

| Component | Reference project | This implementation |
|---|---|---|
| Ingestion | yt-dlp audio downloads | Captions first; cached yt-dlp playlist metadata |
| Transcription | faster-whisper, configurable model/device | Explicit optional Whisper fallback and JSON/SRT/VTT imports |
| Chunking | Timed overlapping windows | Segment-aligned windows and deterministic content IDs |
| Embeddings | sentence-transformers, bge-m3 or MiniLM | Optional MiniLM; model identity stored in index |
| Storage | Qdrant; local vectors artifact also present | Atomic SQLite snapshots; optional versioned Qdrant collections |
| Generation | Code supports Groq, Gemini, and disabled explanations | Groq/OpenAI-compatible provider; usable keyless evidence mode |
| Grounding | Distance guard, refusal and citation filtering | Lexical/dense cutoffs, no-evidence refusal, citation checks, provider fallback |
| Serving | FastAPI + one HTML page and YouTube player | FastAPI + responsive studyroom, lecture filters and evidence panel |
| Recovery | Atomic transcript cache, retries, resume | Atomic transcript/index writes, cached resume, explicit failure report |
| Deployment | README instructions for cloud hosts | Docker/Compose, Render Blueprint and verified index transfer |

Its strongest design choice is making the **video timestamp part of the answer**. A generic character splitter loses this relationship. Keeping timed segments allows each retrieved passage to point to a real lecture moment.

It also separates expensive transcription from serving. We preserve that: an administrator prepares a corpus once; students query a prepared index without downloading audio or running Whisper.

For Striver, the verified A2Z playlist is [PLgUwDviBIf0oF6QL8m22w1hIDC1vJ_BHz](https://www.youtube.com/playlist?list=PLgUwDviBIf0oF6QL8m22w1hIDC1vJ_BHz). Its graph/two-pointer/placement playlists have different IDs. No fixed video count is hardcoded because availability changes.

The upstream [caption library](https://github.com/jdepoix/youtube-transcript-api#working-around-ip-bans-requestblocked-or-ipblocked-exception) warns that cloud IPs can be blocked. Therefore captions are prepared offline, not fetched in API requests or at every cloud startup.

BM25 is available for low-memory serving; semantic retrieval is optional. A Qdrant cluster does not eliminate query model memory. English MiniLM does not guarantee equal Hindi/Hinglish performance: choose a multilingual model and evaluate if needed.

The October update adds playlist-position and series-label metadata, a verified title catalog, caption-level matching within windows, extractive revision summaries, saved lectures, coverage reporting, range ingestion and portable snapshot export. Caption clients now have bounded request timeouts.

Known limits: the reference author's performance figures were not reproduced; full A2Z transcripts are not bundled; syntactically valid citations are not proof of answer correctness; private/deleted/blocked videos are reported rather than silently counted as complete. Optional provider/model integrations need configuration and evaluation.

This is a fresh implementation. Reference source files and lecture transcripts were not copied.
