import argparse
import hashlib
import importlib.util
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
import httpx
from app.chunking import chunk_transcript
from app.config import PLAYLIST_URL, Settings
from app.models import Chunk, Transcript
from app.retrieval import Retriever, embed
from app.store import atomic_json, build_database, load_database


def publish_vectors(settings, chunks, vectors):
    digest = hashlib.sha256((settings.embedding_model + "\n" + "\n".join(c.id for c in chunks)).encode()).hexdigest()[:12]
    collection = settings.collection + "_" + digest
    base = settings.qdrant_url
    if not base:
        raise ValueError("Set QDRANT_URL before --qdrant")
    if not base.startswith("https://") and not base.startswith(("http://localhost", "http://127.0.0.1")):
        raise ValueError("Use HTTPS for remote Qdrant")
    headers = {"api-key":settings.qdrant_key}
    with httpx.Client(headers=headers, timeout=60) as client:
        url = f"{base}/collections/{collection}"
        response = client.get(url)
        if response.status_code == 404:
            client.put(url, json={"vectors":{"size":int(vectors.shape[1]),"distance":"Cosine"}}).raise_for_status()
        else:
            response.raise_for_status()
            config = response.json()["result"]["config"]["params"]["vectors"]
            if config["size"] != vectors.shape[1] or config["distance"] != "Cosine":
                raise ValueError("Qdrant vector configuration differs; use a new QDRANT_COLLECTION prefix")
        for i in range(0,len(chunks),100):
            points = [{"id":str(uuid.uuid5(uuid.NAMESPACE_URL,c.id)),"vector":vectors[j].tolist(),
                       "payload":{"chunk_id":c.id,"video_id":c.video_id or ""}}
                      for j,c in enumerate(chunks[i:i+100],start=i)]
            client.put(url + "/points?wait=true",json={"points":points}).raise_for_status()
        # Keyword index is required for filtered queries on strict-mode managed collections.
        client.put(url + "/index?wait=true",json={"field_name":"video_id","field_schema":"keyword"}).raise_for_status()
    return collection


def build_index(settings: Settings, demo=False, semantic=False, qdrant=False):
    chunks = []
    if demo:
        data = json.loads((Path(__file__).parent / "seed_notes.json").read_text(encoding="utf-8"))
        chunks = [Chunk(**entry) for entry in data]
    else:
        paths = sorted((settings.data_dir / "transcripts").glob("*.json"))
        if not paths:
            raise ValueError("No transcripts found. Run a2z ingest or a2z import first. Use --demo for original sample notes.")
        # Reject invalid inputs instead of silently building an incomplete index.
        for path in paths:
            try:
                transcript = Transcript.model_validate_json(path.read_text(encoding="utf-8"))
            except ValueError as exc:
                raise ValueError(f"Invalid transcript {path.name}; repair or move it before indexing") from exc
            chunks.extend(chunk_transcript(transcript, settings.chunk_seconds, settings.overlap))
    if not chunks:
        raise ValueError("No usable chunks; existing index preserved")
    ids = [c.id for c in chunks]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate transcript/chunk IDs; remove duplicate inputs")
    vectors = embed([c.title + "\n" + c.text for c in chunks],settings.embedding_model) if semantic else None
    metadata = {"schema_version":1,"corpus":"original demo notes" if demo else "lecture transcripts",
        "indexed_at":datetime.now(timezone.utc).isoformat(),"chunks":len(chunks),
        "chunk_seconds":settings.chunk_seconds,"chunk_overlap":settings.overlap,
        "embedding_model":settings.embedding_model if semantic else None}
    if qdrant:
        if not semantic:
            raise ValueError("--qdrant requires --semantic")
        metadata["qdrant_collection"] = publish_vectors(settings,chunks,vectors)
    build_database(settings.database,chunks,metadata,vectors)
    return metadata


def evaluate(settings, path):
    retriever = Retriever(settings)
    examples = json.loads(path.read_text(encoding="utf-8"))
    results = []
    for row in examples:
        hits = retriever.search(row["question"], settings.top_k)
        if row.get("expect_refusal"):
            passed = not hits
        elif row.get("expect_video_id"):
            expected, tolerance = row.get("expect_second"), row.get("tolerance",30)
            passed = any(h["chunk"].video_id == row["expect_video_id"] and
                (expected is None or h["chunk"].start <= expected+tolerance and h["chunk"].end >= expected-tolerance) for h in hits)
        else:
            passed = any(row.get("expect_title", "").lower() in h["chunk"].title.lower() for h in hits)
        results.append({"question":row["question"],"passed":passed,"hits":len(hits)})
    summary = {"passed":sum(r["passed"] for r in results),"total":len(results),"results":results}
    atomic_json(settings.data_dir / "eval_report.json",summary)
    print(json.dumps(summary,indent=2))
    return summary["passed"] == summary["total"] and summary["total"] > 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="A2Z Studyroom: prepare transcripts, index, evaluate, and serve")
    sub = parser.add_subparsers(dest="command",required=True)
    ingest = sub.add_parser("ingest",help="Cache captions for the A2Z playlist")
    ingest.add_argument("--playlist",default=os.getenv("PLAYLIST_URL",PLAYLIST_URL))
    ingest.add_argument("--limit",type=int)
    ingest.add_argument("--whisper",action="store_true",help="Explicitly allow audio transcription when captions are absent")
    ingest.add_argument("--refresh-playlist",action="store_true")
    index = sub.add_parser("index",help="Build a complete index from cached transcripts")
    index.add_argument("--demo",action="store_true")
    index.add_argument("--semantic",action="store_true")
    index.add_argument("--qdrant",action="store_true")
    imp = sub.add_parser("import",help="Import a timestamped JSON/SRT/VTT transcript")
    imp.add_argument("file",type=Path)
    imp.add_argument("--video-id")
    imp.add_argument("--title")
    search = sub.add_parser("search")
    search.add_argument("question")
    search.add_argument("--video-id")
    serve = sub.add_parser("serve")
    serve.add_argument("--host",default="0.0.0.0")
    serve.add_argument("--port",type=int,default=int(os.getenv("PORT","8000")))
    serve.add_argument("--reload",action="store_true")
    sub.add_parser("stats")
    sub.add_parser("preflight",help="Check local dependencies and configuration without paid calls")
    ev = sub.add_parser("eval")
    ev.add_argument("--file",type=Path,default=Path("data/eval.json"))
    args = parser.parse_args(argv)
    settings = Settings()
    try:
        if args.command == "index":
            print(json.dumps(build_index(settings,args.demo,args.semantic,args.qdrant),indent=2))
        elif args.command == "ingest":
            from app.ingest import ingest_playlist
            report = ingest_playlist(settings,args.playlist,args.limit,args.whisper,args.refresh_playlist)
            print(json.dumps(report,indent=2))
            if report["failed"] or report["aborted"]:
                return 2
        elif args.command == "import":
            from app.ingest import import_transcript
            print(import_transcript(args.file,settings,args.video_id,args.title))
        elif args.command == "search":
            from app.answer import source
            hits = Retriever(settings).search(args.question, settings.top_k,args.video_id)
            print(json.dumps([source(h,i+1,settings) for i,h in enumerate(hits)],indent=2,ensure_ascii=False))
        elif args.command == "stats":
            chunks,_,metadata = load_database(settings.database)
            print(json.dumps({**metadata,"lectures":len({c.video_id for c in chunks if c.video_id})},indent=2))
        elif args.command == "eval":
            return 0 if evaluate(settings,args.file) else 1
        elif args.command == "preflight":
            required = ["fastapi","uvicorn","httpx"] + (["sentence_transformers","numpy"] if settings.backend=="hybrid" else [])
            info = {"dependencies":{m:bool(importlib.util.find_spec(m)) for m in required},
                "ingest_dependencies":{m:bool(importlib.util.find_spec(m)) for m in ["yt_dlp","youtube_transcript_api"]},
                "database_exists":settings.database.exists(),"backend":settings.backend,
                "llm_provider":settings.provider,"llm_key_configured":settings.provider=="none" or bool(os.getenv("GROQ_API_KEY") if settings.provider=="groq" else os.getenv("LLM_API_KEY")),
                "qdrant_configured":bool(settings.qdrant_url),"checks":"local only; network/credentials not verified"}
            print(json.dumps(info,indent=2))
            return 0 if all(info["dependencies"].values()) and info["llm_key_configured"] else 1
        elif args.command == "serve":
            import uvicorn
            uvicorn.run("app.main:app",host=args.host,port=args.port,reload=args.reload)
    except Exception as exc:
        if isinstance(exc, (ValueError, FileNotFoundError, ImportError, RuntimeError)):
            print(f"Error: {exc}",file=sys.stderr)
        else:
            print(f"Error: {type(exc).__name__}. Check configuration, network access, and cached inputs.",file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
