"""Student-facing contract: lecture identity, truthful coverage, and useful revision."""
import json
import hashlib
import zipfile
import pytest
from fastapi.testclient import TestClient
from app.answer import answer_question, source, short_summary
from app.catalog import lecture_label, load_catalog, locate
from app.chunking import chunk_transcript
from app.cli import build_index, export_index
from app.config import Settings
from app.ingest import ingest_playlist
from app.main import create_app
from app.models import AskRequest, Transcript
from app.retrieval import Retriever
from app.store import atomic_json


def prepare(tmp_path):
    settings = Settings(data_dir=tmp_path,provider="none",backend="bm25",demo=False,app_key="")
    manifest = {"url":"https://www.youtube.com/playlist?list=PL1234567890", "title":"Fixture course", "videos":[
        {"video_id":"abcdefghijk","title":"Re 1. Introduction to Recursion","playlist_position":8,"duration":180},
        {"video_id":"zzzzzzzzzzz","title":"DP 2. Climbing Stairs","playlist_position":21,"duration":600}]}
    atomic_json(tmp_path / "playlist.json",manifest)
    transcript = Transcript(video_id="abcdefghijk",title=manifest["videos"][0]["title"],source="captions",
        segments=[{"start":100,"end":110,"text":"Welcome to the next lesson."},
                  {"start":110,"end":120,"text":"First, draw the calls on paper."},
                  {"start":120,"end":130,"text":"A base case terminates recursion and prevents infinite calls."},
                  {"start":130,"end":140,"text":"Each recursive call uses stack space."}])
    atomic_json(tmp_path / "transcripts" / "abcdefghijk.json",transcript.model_dump())
    build_index(settings)
    return settings, manifest


def test_best_caption_timestamp_and_number_survive_offline_snapshot(tmp_path):
    settings, _ = prepare(tmp_path)
    (tmp_path / "playlist.json").unlink()
    result = answer_question(AskRequest(question="Where is the recursion base case taught?",mode="locate"),Retriever(settings),settings)
    item = result["sources"][0]
    assert item["playlist_position"] == 8 and item["lecture_label"] == "Re 1"
    assert item["start"] == 100 and item["matched_start"] == 120
    assert item["seek_seconds"] == 116 and item["url"].endswith("&t=116s")
    assert "base case" in item["summary"] and "Playlist #8" in result["answer"]
    assert item["summary_type"] == "extractive"
    assert "segments" not in item


def test_title_only_fallback_never_invents_timestamp_or_summary(tmp_path):
    settings, _ = prepare(tmp_path)
    result = answer_question(AskRequest(question="Where is climbing stairs taught?",mode="locate"),Retriever(settings),settings)
    assert result["mode"] == "catalog" and not result["grounded"] and not result["sources"]
    location = result["locations"][0]
    assert location["playlist_position"] == 21 and location["lecture_label"] == "DP 2"
    assert not location["timestamp_available"] and "&t=" not in location["url"]
    assert "cannot be verified" in result["warning"]
    assert not locate("React useEffect hooks",load_catalog(tmp_path))


def test_coverage_library_and_new_modes(tmp_path):
    settings, _ = prepare(tmp_path)
    with TestClient(create_app(settings)) as client:
        stats = client.get("/api/stats").json()
        assert stats["catalog_lectures"] == 2 and stats["lectures"] == 1
        assert stats["coverage_percent"] == 50 and stats["unindexed_lectures"] == 1
        library = client.get("/api/videos").json()["items"]
        assert [v["playlist_position"] for v in library] == [8,21]
        assert library[0]["indexed"] and not library[1]["indexed"]
        assert client.post("/api/locate",json={"question":"climbing stairs"}).json()["items"][0]["playlist_position"] == 21
        for mode in ("locate","summary"):
            response = client.post("/api/ask",json={"question":"recursion base case", "mode":mode})
            assert response.status_code == 200 and response.json()["requested_mode"] == mode


def test_range_ingestion_keeps_original_positions(tmp_path,monkeypatch):
    import app.ingest as module
    settings, manifest = prepare(tmp_path)
    calls = []
    def captions(video):
        calls.append(video["playlist_position"])
        return Transcript(**video,segments=[{"start":10,"end":20,"text":"Climbing stairs uses previous states."}])
    monkeypatch.setattr(module,"captions",captions)
    monkeypatch.setattr(module.time,"sleep",lambda _:None)
    report = ingest_playlist(settings,manifest["url"],start_position=21,end_position=21)
    assert calls == [21] and report["completed"] == 1
    assert report["unattempted"] == 0 and report["total_playlist_videos"] == 2


def test_summary_is_query_relevant_and_bounded():
    text = "Welcome to the lecture. A base case stops recursion. Recursion uses the call stack. " + "More examples. " * 100
    summary = short_summary(text,{"recursion","base","case"})
    assert summary.startswith("A base case") and len(summary) <= 361
    assert lecture_label("DP 32. Distinct Subsequences") == "DP 32"
    assert lecture_label("Unnumbered lecture") is None


def test_corrupt_catalog_entries_are_ignored(tmp_path):
    atomic_json(tmp_path / "playlist.json",{"videos":[{"video_id":"abcdefghijk","title":None},
        {"video_id":"zzzzzzzzzzz","title":"Recursion","playlist_position":9}]})
    catalog = load_catalog(tmp_path)
    assert len(catalog["videos"]) == 1 and locate("recursion",catalog)[0]["playlist_position"] == 9


def test_export_contains_only_portable_snapshot_and_verified_checksum(tmp_path):
    settings, _ = prepare(tmp_path)
    (tmp_path / ".env").write_text("SECRET=do-not-export")
    result = export_index(settings,tmp_path / "prepared.zip")
    with zipfile.ZipFile(result["archive"]) as archive:
        assert set(archive.namelist()) == {"index.sqlite3","index.sha256","coverage.json","README.txt"}
        assert hashlib.sha256(archive.read("index.sqlite3")).hexdigest() == result["sha256"]
        assert json.loads(archive.read("coverage.json"))["indexed_lectures"] == 1
        assert result["sha256"] in archive.read("index.sha256").decode()


def test_export_caption_cache_can_rebuild_without_youtube(tmp_path):
    settings, _ = prepare(tmp_path / "source")
    result = export_index(settings,tmp_path / "prepared_with_captions.zip",include_transcripts=True)
    target = Settings(data_dir=tmp_path / "target",provider="none",backend="bm25",demo=False,app_key="")
    with zipfile.ZipFile(result["archive"]) as archive:
        archive.extractall(target.data_dir)
    assert result["cached_transcripts"] == 1
    target.database.unlink()
    build_index(target)
    answer = answer_question(AskRequest(question="recursion base case",mode="locate"),Retriever(target),target)
    assert answer["sources"][0]["playlist_position"] == 8
    assert answer["sources"][0]["matched_start"] == 120


def test_parallel_ingestion_reports_successes_and_preserves_positions(tmp_path,monkeypatch):
    import app.ingest as module
    settings, manifest = prepare(tmp_path)
    (tmp_path / "transcripts" / "abcdefghijk.json").unlink()
    monkeypatch.setattr(module.time,"sleep",lambda _:None)
    monkeypatch.setattr(module,"captions",lambda v:Transcript(**v,segments=[{"start":2,"end":5,"text":"A repeated state is cached."}]))
    report = ingest_playlist(settings,manifest["url"],workers=2)
    assert report["completed"] == 2 and report["attempted"] == 2
    assert not report["aborted"] and report["unattempted"] == 0
    assert json.loads((tmp_path / "transcripts" / "zzzzzzzzzzz.json").read_text())["playlist_position"] == 21


def test_missing_main_lecture_does_not_get_an_incidental_timestamp(tmp_path):
    settings, _ = prepare(tmp_path)
    transcript_path = tmp_path / "transcripts" / "abcdefghijk.json"
    transcript = json.loads(transcript_path.read_text())
    transcript["segments"][0]["text"] = "Climbing stairs is an example we will cover in a future lesson."
    atomic_json(transcript_path,transcript)
    build_index(settings)
    result = answer_question(AskRequest(question="Where is climbing stairs taught?",mode="locate"),Retriever(settings),settings)
    assert result["mode"] == "catalog" and not result["sources"]
    assert result["locations"][0]["playlist_position"] == 21


def test_common_incidental_words_do_not_ground_an_unrelated_question(tmp_path):
    settings, _ = prepare(tmp_path)
    path = tmp_path / "transcripts" / "abcdefghijk.json"
    transcript = json.loads(path.read_text())
    transcript["segments"][0]["text"] = "In the world of recursion, store previous results in the table."
    atomic_json(path,transcript)
    build_index(settings)
    result = answer_question(AskRequest(question="cricket world cup results"),Retriever(settings),settings)
    assert result["mode"] == "refusal" and result["sources"] == []


def test_audio_error_page_never_reaches_transcription(tmp_path,monkeypatch):
    import yt_dlp
    import app.ingest as module
    settings, manifest = prepare(tmp_path)
    fake_audio = tmp_path / "bad.webm"
    fake_audio.write_text("<html><h1>Site Unavailable</h1></html>")
    class Download:
        def __init__(self,*a,**k):pass
        def __enter__(self):return self
        def __exit__(self,*a):pass
        def extract_info(self,*a,**k):return {}
        def prepare_filename(self,*a):return str(fake_audio)
    monkeypatch.setattr(yt_dlp,"YoutubeDL",Download)
    def forbidden():
        raise AssertionError("An error page must not be transcribed")
    monkeypatch.setattr(module,"whisper_model",forbidden)
    with pytest.raises(RuntimeError,match="error page"):
        module.whisper(manifest["videos"][0],settings)


def test_local_media_transcription_preserves_input_and_needs_no_youtube(tmp_path,monkeypatch):
    from types import SimpleNamespace
    import app.ingest as module
    path = tmp_path / "uploaded.webm"
    path.write_bytes(b"synthetic-media"*100)
    class SpeechModel:
        def transcribe(self,filename,**kwargs):
            assert filename == str(path)
            return iter([SimpleNamespace(start=12,end=18,text="Ceil is the smallest value not below the key.")]),SimpleNamespace(duration=20,language="en")
    monkeypatch.setattr(module,"whisper_model",lambda:SpeechModel())
    transcript = module.transcribe_media(path,{"video_id":"abcdefghijk","title":"Ceil in BST"})
    assert transcript.source == "whisper" and transcript.segments[0].start == 12
    assert transcript.duration == 20 and path.exists()
