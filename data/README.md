Runtime data lives here and is ignored by Git, except this file and the evaluation examples.

- `transcripts/<video_id>.json`: precious cached captions or Whisper output; back these up.
- `playlist.json`: cached playlist manifest; refresh with `a2z ingest --refresh-playlist`.
- `ingest_report.json`: records partial failures and aborted runs.
- `index.sqlite3`: portable, atomically replaced retrieval snapshot.
- `rate_limit.sqlite3`: server rate limiter, disposable.
- `eval_report.json`: most recent evaluation results.

The repository does **not** bundle Striver's lecture transcripts. The startup demo contains original short DSA notes with no fabricated video timestamps. After ingesting real lectures, run `a2z index` to replace that demo snapshot.
