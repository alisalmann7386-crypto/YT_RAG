"""Hosting regression: YouTube may be unreachable without breaking indexed retrieval."""
import builtins
import socket
import httpx
from fastapi.testclient import TestClient
from app.bootstrap import download_index
from app.cli import build_index
from app.config import Settings
from app.main import create_app
from app.models import Transcript
from app.store import atomic_json


def prepared_settings(tmp_path):
    settings=Settings(data_dir=tmp_path,provider="none",backend="bm25",demo=False,app_key="",qdrant_url="")
    # Synthetic timed lecture fixture, not a redistributed Striver transcript.
    transcript=Transcript(video_id="abcdefghijk",title="Hashing and frequency maps",source="captions",
        segments=[{"start":123,"end":145,"text":"A frequency map counts how many times each element appears. Hashing allows expected constant-time lookups of a key. Scan the array and update each element's frequency."}])
    atomic_json(settings.data_dir / "transcripts" / "abcdefghijk.json",transcript.model_dump())
    build_index(settings)
    return settings


def test_api_retrieves_prepared_lectures_with_network_and_youtube_dependencies_blocked(tmp_path,monkeypatch):
    settings=prepared_settings(tmp_path)
    calls=[]
    original_import=builtins.__import__
    def guarded_import(name,*args,**kwargs):
        if name.split('.')[0] in {"yt_dlp","youtube_transcript_api","faster_whisper"}:
            calls.append(name)
            raise ImportError("Ingestion dependency deliberately unavailable on host")
        return original_import(name,*args,**kwargs)
    def blocked(*args,**kwargs):
        calls.append("network")
        raise AssertionError("Hosted retrieval attempted external network access")
    monkeypatch.setattr(builtins,"__import__",guarded_import)
    monkeypatch.setattr(socket,"create_connection",blocked)
    monkeypatch.setattr(httpx,"get",blocked)
    monkeypatch.setattr(httpx,"post",blocked)
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").json()["ready"]
        stats=client.get("/api/stats").json()
        assert stats["lectures"]==1 and stats["notes"]==0
        assert stats["corpus"]=="lecture transcripts"
        for route in ("/api/search","/api/ask"):
            response=client.post(route,json={"question":"frequency map hashing"})
            assert response.status_code==200
            sources=response.json()["sources"]
            assert sources[0]["video_id"]=="abcdefghijk"
            assert sources[0]["start"]==123 and sources[0]["seek_seconds"]==119
            assert sources[0]["url"].endswith("&t=119s")
    assert calls==[]


def test_provider_down_still_returns_prepared_evidence(tmp_path,monkeypatch):
    settings=prepared_settings(tmp_path)
    settings.provider="groq"
    monkeypatch.setenv("GROQ_API_KEY","fixture-key-not-real")
    def blocked(*args,**kwargs):
        raise httpx.ConnectError("External services unavailable")
    monkeypatch.setattr(httpx,"post",blocked)
    with TestClient(create_app(settings)) as client:
        response=client.post("/api/ask",json={"question":"frequency map hashing"})
        assert response.status_code==200
        answer=response.json()
        assert answer["mode"]=="evidence" and answer["sources"][0]["start"]==123
        assert answer["warning"]


def test_bootstrap_uses_existing_index_without_redownloading(tmp_path,monkeypatch):
    settings=prepared_settings(tmp_path)
    monkeypatch.setenv("INDEX_DOWNLOAD_URL","https://unreachable.example/index.sqlite3")
    def blocked(*args,**kwargs):
        raise AssertionError("Existing index was needlessly downloaded")
    monkeypatch.setattr(httpx,"stream",blocked)
    download_index(settings)
    assert settings.database.exists()
