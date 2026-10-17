# Validation performed

Updated: 17 October 2026. Python 3.12; Node 24. Playlist/data figures below were verified on 16 October; this update changes application code, not the prepared corpus.

## Lecture data

The official playlist was read live again: **315 accessible titled videos**, with the same IDs as the earlier snapshot. Original playlist positions are preserved. An untitled/unavailable entry is excluded.

**314/315 lectures (99.7%) are saved**, with **6,933 timed retrieval windows**. Every cached transcript validates against the application schema. The prepared ZIP includes the SQLite index, SHA256 checksum, playlist manifest, coverage, and 314 caption-cache files. Application source and runtime data are distributed separately.

Only playlist #113, `KSsk8AhdOZA`, **L41. Ceil in a Binary Search Tree**, is missing. Its captions report `TranscriptsDisabled`. A fresh audio fallback returned another 195-byte HTML error page, rejected before transcription. No substitute transcript or timestamp was invented. A supplied timestamped caption file or usable local media copy can complete this gap using the documented import/transcribe commands.

Earlier timeouts, proxy failures, and request blocks for #196, #242, #261, #268–270 were resolved on resumed requests. All 13 final playlist entries (#303–315) were saved. HTTPS certificate verification remained enabled.

## Bugs fixed

- Lecture lookup now searches strong title matches directly. Previously, the global top-k could omit the actual lecture and incorrectly fall back to titles or an incidental mention.
- Global retrieval allows at most two windows per video, leaving room for other relevant lectures. Per-video filtering still returns the requested number of windows. This fixed the merge-sort regression exposed by the larger corpus.
- Browser storage denial no longer crashes startup or access-key handling; in-memory use remains available.
- Clicking an earlier citation restores that answer's sources and related lectures together, avoiding stale evidence from a newer answer.
- Ctrl/Cmd K focuses the composer without discarding the conversation. A separate Shift shortcut starts a new conversation.
- Caption read timeouts are configurable and bounded. Live playlist refresh records its verification timestamp.
- Export builds and flushes a temporary archive before atomically replacing the destination. Failed/interrupted exports preserve the previous archive; a regression test verifies this.

## Checks passed

- **89 Python tests**, including no-network serving, caption-level seek links, truthful title-only fallback, exact playlist/series references, user-only follow-up resolution, explicit topic switching, complexity-section selection, all generated modes/languages with mocked responses, provider failures, optional backend fixtures, cache/export integrity, interrupted export preservation, structured generation, and example-verification regressions.
- **21 frontend DOM integration tests**: startup, search/bookmarks/coverage, per-lecture filters, earlier citations, cancellation, unavailable storage, safe text rendering, bold result labels, all mode/language request controls, exact lecture search, optional saved-chat restoration, revision filters, continue-at-timestamp behavior, direct watch links, comparison tables, code copying, exports, malformed stored state, and history clearing during an in-flight request.
- **18/18 real-caption retrieval cases**: six lecture/time-window targets, nine additional lecture-ID targets from newly saved sections, and three unrelated-query refusals. This is a regression sample, not an exhaustive quality score for every possible question.
- **8/8 original-notes demo cases**.
- Prepared-corpus FastAPI smoke checks: 315 library entries, 314 indexed lectures, LRU/LFU, equal partition, odd/even linked list, caption-backed summaries and seek links, and the truthful title-only result for Ceil in BST.
- JavaScript syntax, Python compilation, HTML/JS element-ID checks, and Git whitespace checks.

## Interface

The buildless frontend now uses a dark charcoal workspace with mint accents and secondary violet/amber/blue cards. It includes a searchable lecture library, saved view, availability filters, topic shortcuts, visible coverage and missing-lecture details, request cancellation, source tabs, caption excerpts, timestamp-link copying, lecture preview, and responsive library/source drawers. Reduced-motion preferences and keyboard focus styles are supported.

The 17 October workflow update retains that layout and adds optional on-device chat history, completed/revise-again markers, a continue card, primary/related watch links, mode guidance, tables and code-copy controls. Mobile controls use larger tap targets and 16px composer/select text. Saved state is validated and storage denial falls back to session-only operation. Clearing chats does not remove bookmarks/progress or immediately resave the open conversation. CSS and JavaScript URLs carry a release version to prevent the updated HTML from using stale cached assets; the live browser initially exhibited the old substring search despite displaying new HTML controls.

The screenshot's binary-search Complexity-mode failure was reproduced as a retrieval/context problem: generic intent words and introductory mentions could displace the relevant lecture's complexity discussion. Strong title matches now take priority in every mode, and up to two explicit complexity sections are reserved. A real-caption diagnostic for “What is the complexity of binary search?” returned playlist #45 with the logarithmic-complexity passage near 28:32. A follow-up about partition equal subset sum's space complexity stayed in #196 instead of switching to graph representation. In-process FastAPI smoke checks with the prepared corpus passed all seven cases: partition lookup, binary-search complexity, partition space follow-up, exact lecture 37, series DP 15, title-only lecture 113, and unknown-reference refusal. No index rebuild or lecture ZIP replacement is needed for this update.

Unpunctuated automatic captions are no longer arbitrarily cut at 360 characters and called complete summaries. Complete source sentences are selected when available; otherwise a clearly labeled metadata-based overview points to the caption match, and the original retrieved passage remains expandable. This does not repair recognition errors or guarantee that a grammatically complete ASR sentence is correct.

## Verification limits

### Groq generation follow-up

The live service returned a citation-validation fallback after Groq was configured. Configuration and successful HTTP responses do not ensure usable source references. GPT-OSS generation now uses Groq's documented strict JSON-schema mode with excerpt IDs enumerated in the schema. The application validates and renders source IDs, rejects incomplete/uncited blocks and out-of-range IDs, preserves explicit refusals and code indices, and ignores reasoning metadata. Low reasoning effort and a 4,096-token completion allowance replace the previous 1,600-token free-form budget for these two supported Groq models. Length-truncated responses receive a distinct fallback warning. Other models keep the existing free-form citation path.

Twelve additional generation cases cover structured citation rendering/renumbering, request settings, invalid IDs/types, missing/contradictory evidence, incomplete code, embedded invalid citations, truncation, explicit refusal, and code indices. These use mocked provider responses. The 18 real-caption retrieval cases still pass. A pre-fix live request was checked using the deployed application; validating the new provider behavior requires the updated commit to be deployed.

The deployed structured-generation path was subsequently confirmed to return generated, cited answers. A user screenshot then exposed an inconsistent numerical partition example and omitted complexity. Eleven further cases cover that exact error, duplicate counts, equal sums, stated totals/parity, user-provided inputs, primary-lecture complexity context, a single correction attempt, persistent-failure fallback, and avoiding a second model call for a valid answer. The index contains the lecture's explicit complexity discussion at 427.199 seconds, which is now eligible as supplemental context. These checks target supported literal integer-list examples, not every possible phrasing or all mathematical assertions. The latest example-verification change needs deployment before live validation.

DOM checks do not verify visual browser layout. The deployed pre-update app was reviewed in a browser on 17 October, including lecture search, citations and follow-up failures. The updated local preview could not be opened by the remote browser (connection refused), so its responsive visual layout is not yet browser-verified. Docker building was not run. The existing public Render deployment predates this workflow update until its new commit is deployed.

Optional dense/Qdrant tests use fixture vectors and mocked HTTP. LLM tests use mocked provider responses; no paid model key was used. The local-media transcription path uses a mocked speech model in tests. Real speech transcription could not run for #113 because the source media response was unusable.

Links seek to the best matching subtitle segment with four seconds of lead-in. Caption text can contain recognition errors; segment matching does not claim independently verified audiovisual precision. With no LLM key, the app returns extractive source recaps; generation, translation, and derived code require a configured provider.
