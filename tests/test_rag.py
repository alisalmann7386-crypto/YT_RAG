import json
from pathlib import Path
import httpx
import pytest
from fastapi.testclient import TestClient
from app.answer import answer_question
from app.chunking import chunk_transcript
from app.cli import build_index, evaluate
from app.config import Settings
from app.ingest import import_transcript, ingest_playlist
from app.main import create_app, RateLimiter
from app.models import AskRequest, Transcript
from app.retrieval import Retriever
from app.store import atomic_json, load_database


@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path, provider="none", backend="bm25", demo=True, app_key="",qdrant_url="")


def transcript():
    return Transcript(video_id="abcdefghijk",title="Memoization vs tabulation",segments=[
        {"start":0,"end":30,"text":"Memoization caches repeated recursive states."},
        {"start":30,"end":60,"text":"Tabulation fills a table in dependency order."},
        {"start":60,"end":90,"text":"Bottom-up dynamic programming can avoid the recursion stack."},
        {"start":90,"end":120,"text":"Use rolling arrays when only the previous row is needed."}])


def test_chunk_timestamps_and_overlap():
    chunks=chunk_transcript(transcript(),window=75,overlap=35)
    assert chunks[0].start==0 and chunks[0].end==60
    assert chunks[1].start==30 and chunks[1].end==90
    assert chunks[-1].end==120
    assert chunks[0].id==chunk_transcript(transcript(),75,35)[0].id
    assert len({c.id for c in chunks})==len(chunks)


def test_single_long_segment_never_hangs():
    t=Transcript(video_id="abcdefghijk",title="Recursion",segments=[{"start":0,"end":300,"text":"A recursion base case ends the call chain."}])
    assert len(chunk_transcript(t))==1


def test_demo_retrieval_and_refusal(settings):
    build_index(settings,demo=True)
    assert evaluate(settings,Path("data/eval.json"))
    r=Retriever(settings)
    assert "Sliding window" in r.search("longest substring without repeating characters",1)[0]["chunk"].title
    answer=answer_question(AskRequest(question="Explain memoization vs tabulation"),r,settings)
    assert answer["grounded"] and answer["mode"]=="evidence"
    assert all(s["url"] is None and s["video_id"] is None for s in answer["sources"])
    refusal=answer_question(AskRequest(question="React useEffect hooks"),r,settings)
    assert not refusal["grounded"] and refusal["sources"]==[]


def test_reindex_idempotent_and_failed_index_preserves_snapshot(settings):
    directory=settings.data_dir / "transcripts"
    atomic_json(directory / "abcdefghijk.json",transcript().model_dump())
    build_index(settings)
    before=settings.database.read_bytes()
    a=load_database(settings.database)[0]
    build_index(settings)
    b=load_database(settings.database)[0]
    assert [c.id for c in a]==[c.id for c in b]
    valid=settings.database.read_bytes()
    (directory / "bad.json").write_text('{')
    with pytest.raises(ValueError,match="Invalid transcript"):
        build_index(settings)
    assert settings.database.read_bytes()==valid


def test_lecture_filter_timestamps_and_reload(settings):
    build_index(settings,demo=True)
    r=Retriever(settings)
    assert r.search("memoization")
    atomic_json(settings.data_dir / "transcripts" / "abcdefghijk.json",transcript().model_dump())
    build_index(settings)
    result=answer_question(AskRequest(question="memoization",video_id="abcdefghijk"),r,settings)
    assert result["sources"][0]["url"].startswith("https://www.youtube.com/watch?v=abcdefghijk&t=")
    assert r.search("memoization",video_id="zzzzzzzzzzz")==[]
    assert all(c.kind=="lecture" for c in r.chunks)


def test_api_startup_validation_auth_and_rate_limit(settings):
    settings.rate_requests=3
    settings.app_key="test-access-key"
    with TestClient(create_app(settings)) as client:
        assert client.get("/").status_code==200
        assert client.get("/static/app.js").status_code==200
        assert client.get("/health").json()["ready"]
        assert client.get("/api/stats").status_code==401
        headers={"X-API-Key":"test-access-key"}
        stats=client.get("/api/stats",headers=headers).json()
        assert stats["lectures"]==0 and stats["notes"]==22
        assert client.post("/api/ask",json={"question":" "},headers=headers).status_code==422
        for _ in range(2):
            assert client.post("/api/ask",json={"question":"binary search"},headers=headers).status_code==200
        assert client.post("/api/search",json={"question":"bfs"},headers=headers).status_code==429


def test_rate_limiter_shared_across_instances(settings):
    a=RateLimiter(settings.data_dir / "limit.sqlite3",1,60)
    b=RateLimiter(settings.data_dir / "limit.sqlite3",1,60)
    a.check("client")
    with pytest.raises(Exception) as exc:
        b.check("client")
    assert exc.value.status_code==429


def test_srt_import(settings,tmp_path):
    path=tmp_path / "example.srt"
    path.write_text('1\n00:00:10,000 --> 00:00:14,500\nA base case ends recursion.\n\n2\n00:00:14,500 --> 00:00:19,000\nStore the repeated subproblem.\n')
    dest=import_transcript(path,settings,"abcdefghijk","Recursion")
    parsed=Transcript.model_validate_json(dest.read_text())
    assert parsed.segments[0].start==10 and parsed.segments[1].end==19


def test_ingest_cache_resume_and_abort(settings,monkeypatch):
    import app.ingest as module
    manifest={"url":"https://www.youtube.com/playlist?list=PL1234567890","title":"Fixture playlist","videos":[{"video_id":"abcdefghijk","title":"DP"},{"video_id":"zzzzzzzzzzz","title":"Graphs"}]}
    monkeypatch.setattr(module,"list_playlist",lambda url:manifest)
    monkeypatch.setattr(module.time,"sleep",lambda _:None)
    calls=[]
    def fake_caption(video):
        calls.append(video["video_id"])
        if video["video_id"]=="zzzzzzzzzzz":
            raise type("IpBlocked",(Exception,),{})()
        return transcript()
    monkeypatch.setattr(module,"captions",fake_caption)
    report=ingest_playlist(settings,manifest["url"])
    assert report["completed"]==1 and report["aborted"]
    calls.clear()
    report=ingest_playlist(settings,manifest["url"])
    assert report["cached"]==1 and calls==["zzzzzzzzzzz"]
    assert (settings.data_dir / "ingest_report.json").exists()


@pytest.mark.parametrize("text",["This is invented [99].","Uncited model output.","Code array [0]."])
def test_invalid_citations_fall_back(settings,monkeypatch,text):
    build_index(settings,demo=True)
    settings.provider="groq"
    settings.llm_model="custom-chat"  # Legacy free-form providers still validate citations.
    monkeypatch.setenv("GROQ_API_KEY","test-key-not-real")
    monkeypatch.setattr(httpx,"post",lambda *a,**k:httpx.Response(200,json={"choices":[{"message":{"content":text}}]},request=httpx.Request("POST","https://example.com")))
    result=answer_question(AskRequest(question="memoization vs tabulation"),Retriever(settings),settings)
    assert result["mode"]=="evidence" and result["warning"]


def test_generated_citations_renumber_and_provider_failure(settings,monkeypatch):
    build_index(settings,demo=True)
    settings.provider="groq"
    settings.llm_model="custom-chat"
    monkeypatch.setenv("GROQ_API_KEY","test-key-not-real")
    monkeypatch.setattr(httpx,"post",lambda *a,**k:httpx.Response(200,json={"choices":[{"message":{"content":"Memoization caches results. [1]"}}]},request=httpx.Request("POST","https://example.com")))
    result=answer_question(AskRequest(question="memoization"),Retriever(settings),settings)
    assert result["mode"]=="generated" and result["sources"][0]["number"]==1
    def unavailable(*a,**k):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(httpx,"post",unavailable)
    assert answer_question(AskRequest(question="memoization"),Retriever(settings),settings)["mode"]=="evidence"


def test_hybrid_rejects_mismatched_index(settings):
    build_index(settings,demo=True)
    settings.backend="hybrid"
    with pytest.raises(RuntimeError,match="Hybrid index missing"):
        Retriever(settings).search("binary search")


def test_code_indices_are_not_citations(settings,monkeypatch):
    build_index(settings,demo=True)
    settings.provider="groq"
    settings.llm_model="custom-chat"
    monkeypatch.setenv("GROQ_API_KEY","test-key-not-real")
    text="This implementation uses the evidence. [1]\n\n```python\nbest = nums[0]\n```"
    monkeypatch.setattr(httpx,"post",lambda *a,**k:httpx.Response(200,json={"choices":[{"message":{"content":text}}]},request=httpx.Request("POST","https://example.com")))
    result=answer_question(AskRequest(question="Kadane maximum subarray"),Retriever(settings),settings)
    assert result["mode"]=="generated"
    assert "nums[0]" in result["answer"]
