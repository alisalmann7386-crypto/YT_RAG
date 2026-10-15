"""Offline ingestion; no expensive transcription or YouTube scraping in HTTP handlers."""
import json
import os
import re
import time
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from app.config import PLAYLIST_URL, Settings
from app.models import Transcript
from app.store import atomic_json


def youtube_options():
    # Use the OS trust store on managed machines with an installed corporate CA.
    # TLS verification remains enabled; never use nocheckcertificate.
    return {"compat_opts":{"no-certifi"}} if os.getenv("YOUTUBE_USE_SYSTEM_CA", "false").lower() == "true" else {}


def validate_playlist(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in {"www.youtube.com", "youtube.com"}:
        raise ValueError("Use an HTTPS YouTube playlist URL")
    playlist = parse_qs(parsed.query).get("list", [""])[0]
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,100}", playlist):
        raise ValueError("URL does not contain a valid playlist ID")
    return url


def list_playlist(url: str):
    from yt_dlp import YoutubeDL
    validate_playlist(url)
    with YoutubeDL({**youtube_options(), "extract_flat":"in_playlist", "skip_download":True, "quiet":True,
                    "socket_timeout":20, "retries":2, "extractor_retries":2}) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise RuntimeError("Playlist metadata could not be fetched")
    seen, items = set(), []
    for position, e in enumerate(info.get("entries") or [], 1):
        if not e or not re.fullmatch(r"[A-Za-z0-9_-]{11}", e.get("id", "")) or e["id"] in seen:
            continue
        if not e.get("title") or e.get("title") in {"[Private video]", "[Deleted video]"}:
            continue
        seen.add(e["id"])
        items.append({"video_id":e["id"], "title":e.get("title") or e["id"], "duration":e.get("duration") or 0,
                      "playlist_position":position})
    if not items:
        raise RuntimeError("Playlist has no accessible videos")
    return {"url":url,"title":info.get("title","YouTube playlist"),"videos":items}


def captions(video: dict) -> Transcript:
    from youtube_transcript_api import YouTubeTranscriptApi
    from requests import Session
    class TimedSession(Session):
        def request(self, *args, **kwargs):
            kwargs.setdefault("timeout", (10, 30))
            return super().request(*args, **kwargs)
    languages = [x.strip() for x in os.getenv("CAPTION_LANGUAGES", "en,hi").split(",") if x.strip()]
    with TimedSession() as session:
        fetched = YouTubeTranscriptApi(http_client=session).fetch(video["video_id"], languages=languages)
    segments = [{"start":s.start,"end":s.start + max(s.duration, .01),"text":s.text.strip()}
                for s in fetched if s.text.strip()]
    return Transcript(**video, language=fetched.language_code, source="captions", segments=segments)


@lru_cache(maxsize=1)
def whisper_model():
    from faster_whisper import WhisperModel
    device = os.getenv("WHISPER_DEVICE", "cpu")
    return WhisperModel(os.getenv("WHISPER_MODEL", "small"), device=device,
                        compute_type="int8" if device == "cpu" else "float16")


def whisper(video: dict, settings: Settings) -> Transcript:
    from yt_dlp import YoutubeDL
    audio = settings.data_dir / "audio"
    audio.mkdir(exist_ok=True)
    with YoutubeDL({**youtube_options(), "format":"bestaudio/best","outtmpl":str(audio / "%(id)s.%(ext)s"),
                    "quiet":True,"noplaylist":True,"socket_timeout":20,"retries":2}) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video['video_id']}",download=True)
        path = Path(ydl.prepare_filename(info))
    segments, info = whisper_model().transcribe(str(path),
        language=os.getenv("WHISPER_LANGUAGE", "en") or None, vad_filter=True,
        condition_on_previous_text=False, beam_size=5)
    items = [{"start":s.start,"end":s.end,"text":s.text.strip()} for s in segments if s.text.strip()]
    # The caller persists the transcript before deleting audio.
    return Transcript(**{**video,"duration":video.get("duration") or info.duration},
                      language=info.language, source="whisper", segments=items)


def load_cached(path: Path):
    try:
        return Transcript.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def ingest_playlist(settings: Settings, url: str = PLAYLIST_URL, limit: int | None = None,
                    allow_whisper: bool = False, refresh_playlist: bool = False,
                    start_position: int = 1, end_position: int | None = None, workers: int = 1):
    validate_playlist(url)
    if limit is not None and limit < 1:
        raise ValueError("--limit must be positive")
    if start_position < 1 or end_position is not None and end_position < start_position:
        raise ValueError("Require 1 <= --start-position <= --end-position")
    if not 1 <= workers <= 4:
        raise ValueError("--workers must be between 1 and 4")
    manifest_path = settings.data_dir / "playlist.json"
    manifest = None
    if manifest_path.exists() and not refresh_playlist:
        try:
            old = json.loads(manifest_path.read_text())
            if old.get("url") == url and old.get("videos"):
                manifest = old
        except (OSError, ValueError):
            pass
    if manifest is None:
        manifest = list_playlist(url)
        atomic_json(manifest_path, manifest)
    directory = settings.data_dir / "transcripts"
    directory.mkdir(exist_ok=True)
    videos = [{**v,"playlist_position":v.get("playlist_position") or i}
              for i,v in enumerate(manifest["videos"],1)]
    videos = [v for v in videos if v["playlist_position"] >= start_position and
              (end_position is None or v["playlist_position"] <= end_position)]
    if limit:
        videos = videos[:limit]
    report = {"playlist_url":url,"playlist_title":manifest["title"],"selected":len(videos),
              "cached":0,"completed":0,"failed":[],"aborted":False, "attempted":0,
              "total_playlist_videos":len(manifest["videos"])}
    stop = threading.Event()

    def prepare(video):
        if stop.is_set():
            return "skipped", video, None
        path = directory / (video["video_id"] + ".json")
        cached = load_cached(path)
        if cached and cached.video_id == video["video_id"]:
            return "cached", video, None
        try:
            try:
                transcript = captions(video)
            except Exception as exc:
                if type(exc).__name__ in {"RequestBlocked", "IpBlocked"} or not allow_whisper:
                    raise
                transcript = whisper(video, settings)
            atomic_json(path, transcript.model_dump())
            for audio in (settings.data_dir / "audio").glob(video["video_id"] + ".*"):
                audio.unlink(missing_ok=True)
            time.sleep(1)
            return "completed", video, None
        except Exception as exc:
            kind = type(exc).__name__
            if kind in {"RequestBlocked", "IpBlocked"}:
                stop.set()
            return "failed", video, kind

    consecutive = 0
    try:
        if workers == 1:
            results = map(prepare,videos)
            pool = None
        else:
            pool = ThreadPoolExecutor(max_workers=workers)
            futures = [pool.submit(prepare,v) for v in videos]
            results = (f.result() for f in as_completed(futures))
        for status, video, error in results:
            if status == "skipped":
                continue
            report["attempted"] += 1
            if status == "failed":
                report["failed"].append({"video_id":video["video_id"],"title":video["title"],"error":error})
                consecutive += 1
                if error in {"RequestBlocked", "IpBlocked"} or consecutive >= 3:
                    stop.set()
                    report["aborted"] = True
            else:
                report[status] += 1
                consecutive = 0
            position = video.get("playlist_position", "?")
            print(f"[{report['attempted']}/{len(videos)}] #{position} {status}: {video['title']}" +
                  (f" ({error})" if error else ""), flush=True)
    except KeyboardInterrupt:
        stop.set()
        report["aborted"] = True
        print("Interrupted; cached transcripts are safe.", flush=True)
    finally:
        if 'pool' in locals() and pool is not None:
            pool.shutdown(wait=True,cancel_futures=True)
        report["unattempted"] = report["selected"] - report["attempted"]
        atomic_json(settings.data_dir / "ingest_report.json", report)
    return report


def import_transcript(path: Path, settings: Settings, video_id=None, title=None):
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        # Also accept youtube-transcript-api's raw list, with explicit video metadata.
        if isinstance(data, list):
            data = {"video_id":video_id,"title":title,"segments":data}
        for s in data.get("segments", []):
            if "end" not in s and "duration" in s:
                s["end"] = s["start"] + max(s["duration"], .01)
    elif path.suffix.lower() in {".srt", ".vtt"}:
        if not video_id or not title:
            raise ValueError("SRT/VTT import needs --video-id and --title")
        segments = []
        for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")):
            lines = block.splitlines()
            timing = next((i for i,l in enumerate(lines) if " --> " in l), None)
            if timing is None:
                continue
            start, end = lines[timing].split(" --> ", 1)
            def seconds(value):
                parts = value.strip().split()[0].replace(",", ".").split(":")
                total = 0.0
                for p in parts:
                    total = total * 60 + float(p)
                return total
            text = re.sub(r"<[^>]+>", "", " ".join(lines[timing+1:])).strip()
            if text:
                segments.append({"start":seconds(start),"end":seconds(end),"text":text})
        data = {"video_id":video_id,"title":title,"source":"import","segments":segments}
    else:
        raise ValueError("Import .json, .srt or .vtt")
    transcript = Transcript.model_validate(data)
    destination = settings.data_dir / "transcripts" / f"{transcript.video_id}.json"
    atomic_json(destination, transcript.model_dump())
    return destination
