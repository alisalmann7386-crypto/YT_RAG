import hashlib
import hmac
import logging
import os
import sqlite3
import time
import httpx
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.answer import answer_question, retrieval_query, source
from app.config import Settings, PLAYLIST_URL
from app.models import AskRequest
from app.retrieval import Retriever
from app.catalog import lecture_label, load_catalog, locate


class RateLimiter:
    """Atomic SQLite limiter shared across processes on a single host."""
    def __init__(self, path: Path, count: int, window: int):
        self.path, self.count, self.window = path, count, window
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS hits (client TEXT, ts REAL)")
            db.execute("CREATE INDEX IF NOT EXISTS client_time ON hits(client, ts)")

    def check(self, client: str):
        now = time.time()
        client = hashlib.sha256(client.encode()).hexdigest()
        with sqlite3.connect(self.path, timeout=10) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM hits WHERE ts < ?", (now-self.window,))
            n = db.execute("SELECT COUNT(*) FROM hits WHERE client = ?", (client,)).fetchone()[0]
            if n >= self.count:
                raise HTTPException(429, "Too many requests. Please try again in a minute.", headers={"Retry-After":str(self.window)})
            db.execute("INSERT INTO hits VALUES (?,?)", (client, now))


def create_app(settings: Settings | None = None):
    settings = settings or Settings()
    retriever = Retriever(settings)
    limiter = RateLimiter(settings.data_dir / "rate_limit.sqlite3", settings.rate_requests, settings.rate_window)

    @asynccontextmanager
    async def lifespan(app):
        if not settings.database.exists() and settings.demo:
            from app.cli import build_index
            if settings.backend == "hybrid":
                raise RuntimeError("No semantic index. Run a2z index --demo --semantic or index real transcripts first.")
            build_index(settings, demo=True)
        retriever.refresh()
        yield

    app = FastAPI(title="A2Z Studyroom API", version="0.2.0", lifespan=lifespan)
    app.state.retriever = retriever
    origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET","POST"], allow_headers=["Content-Type","X-API-Key"])

    def authorize(request: Request):
        if settings.app_key and not hmac.compare_digest(request.headers.get("X-API-Key", ""), settings.app_key):
            raise HTTPException(401, "Enter the server access key to continue.")

    def limited(request: Request):
        # Never trust client-supplied X-Forwarded-For. Let Uvicorn trust only your reverse proxy.
        limiter.check(request.client.host if request.client else "unknown")

    @app.middleware("http")
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health")
    def health():
        retriever.refresh()
        return {"status":"ok" if retriever.chunks else "empty", "ready":bool(retriever.chunks)}

    @app.get("/api/stats", dependencies=[Depends(authorize)])
    def stats():
        retriever.refresh()
        lectures = {c.video_id for c in retriever.chunks if c.kind == "lecture"}
        catalog = retriever.metadata.get("playlist") or load_catalog(settings.data_dir)
        catalog_ids = {v["video_id"] for v in catalog["videos"]}
        return {"chunks":len(retriever.chunks),"lectures":len(lectures),"notes":sum(c.kind=="note" for c in retriever.chunks),
            "catalog_lectures":len(catalog_ids),"unindexed_lectures":len(catalog_ids-lectures),
            "coverage_percent":round(100*len(lectures & catalog_ids)/max(1,len(catalog_ids)),1),
            "catalog_verified_at":catalog.get("verified_at"),
            "backend":settings.backend,"llm_provider":settings.provider,"model":settings.llm_model if settings.provider != "none" else None,
            "playlist_url":catalog.get("url",PLAYLIST_URL),"corpus":retriever.metadata.get("corpus", "empty"),
            "indexed_at":retriever.metadata.get("indexed_at"),"access_key_required":bool(settings.app_key)}

    @app.get("/api/videos", dependencies=[Depends(authorize)])
    def videos():
        retriever.refresh()
        catalog = retriever.metadata.get("playlist") or load_catalog(settings.data_dir)
        items = {v["video_id"]:{**v,"id":v["video_id"],"kind":"catalog","chunks":0,
                               "topic":"A2Z playlist", "indexed":False,
                               "lecture_label":lecture_label(v["title"])} for v in catalog["videos"]}
        for c in retriever.chunks:
            key = c.video_id or c.id
            if key not in items:
                items[key] = {"id":key,"video_id":c.video_id,"title":c.title,"kind":c.kind,"topic":c.topic,"chunks":0,"duration":0,
                              "playlist_position":c.playlist_position,"lecture_label":lecture_label(c.title)}
            items[key]["kind"] = c.kind
            items[key]["indexed"] = True
            items[key]["chunks"] += 1
            items[key]["duration"] = max(items[key]["duration"], c.end or 0)
        return {"items":sorted(items.values(),key=lambda v:(v.get("playlist_position") or 100000,v["title"]))}

    @app.post("/api/locate", dependencies=[Depends(authorize), Depends(limited)])
    def locate_lecture(payload: AskRequest):
        retriever.refresh()
        catalog = retriever.metadata.get("playlist") or load_catalog(settings.data_dir)
        return {"items":locate(retrieval_query(payload),catalog,payload.top_k,payload.video_id),
                "basis":"playlist titles only; timestamps require indexed transcripts"}

    @app.post("/api/search", dependencies=[Depends(authorize), Depends(limited)])
    def search(payload: AskRequest):
        try:
            hits = retriever.search(retrieval_query(payload),payload.top_k,payload.video_id)
            return {"sources":[source(h,i+1,settings) for i,h in enumerate(hits)],"retrieved":len(hits)}
        except (RuntimeError, httpx.HTTPError) as exc:
            logging.getLogger(__name__).error("Retrieval unavailable: %s", type(exc).__name__)
            raise HTTPException(503, "Retrieval unavailable. Check server configuration and rebuild the index.") from exc

    @app.post("/api/ask", dependencies=[Depends(authorize), Depends(limited)])
    def ask(payload: AskRequest):
        try:
            return answer_question(payload,retriever,settings)
        except (RuntimeError, httpx.HTTPError) as exc:
            logging.getLogger(__name__).error("Retrieval unavailable: %s", type(exc).__name__)
            raise HTTPException(503, "Retrieval unavailable. Check server configuration and rebuild the index.") from exc

    static = Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=static), name="static")

    @app.get("/", include_in_schema=False)
    def home():
        return FileResponse(static / "index.html")
    return app


app = create_app()
