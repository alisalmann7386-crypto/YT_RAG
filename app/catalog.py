"""Playlist discovery is metadata, never proof of a particular spoken explanation."""
import json
import re
from pathlib import Path
from app.config import PLAYLIST_URL
from app.retrieval import tokens


def load_catalog(data_dir: Path):
    for path in (data_dir / "playlist.json", Path(__file__).with_name("playlist_catalog.json")):
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            videos = data["videos"]
            if not isinstance(videos, list) or not videos:
                continue
            cleaned = []
            for position, video in enumerate(videos, 1):
                if not isinstance(video,dict) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video.get("video_id", "")) or not video.get("title"):
                    continue
                cleaned.append({**video, "playlist_position":video.get("playlist_position") or position})
            return {**data, "videos":cleaned}
        except (KeyError, TypeError, ValueError, OSError):
            continue
    return {"url":PLAYLIST_URL, "title":"Striver A2Z", "videos":[]}


def lecture_label(title: str):
    # Series labels in the creator's title differ from playlist positions.
    match = re.search(r"\b(DP|BS|G|L|Re|T|BT|BST|LL|SL|S)\s*[.\-]?\s*(\d+)\b", title, re.I)
    return f"{match[1]} {match[2]}" if match else None


def lecture_reference(question: str):
    position = re.search(r"\b(?:playlist|lecture|video)(?:\s+(?:number|no\.?))?\s*#?\s*(\d+)\b", question, re.I)
    if not position:
        position = re.fullmatch(r"\s*#?\s*(\d+)\s*", question)
    if position:
        return ("position", int(position[1]))
    series = re.search(r"\b(DP|BS|G|L|Re|T|BT|BST|LL|SL|S)\s*[.\-]?\s*(\d+)\b", question, re.I)
    return (series[1].lower(), int(series[2])) if series else None


def locate(question: str, catalog: dict, top_k: int = 5, video_id=None):
    reference = lecture_reference(question)
    terms = set(tokens(question))
    if not terms and not reference:
        return []
    matches = []
    for video in catalog["videos"]:
        if video_id and video["video_id"] != video_id:
            continue
        if reference:
            label = lecture_label(video["title"])
            match = video["playlist_position"] == reference[1] if reference[0] == "position" else bool(
                label and label.lower() == f"{reference[0]} {reference[1]}")
            if match:
                matches.append({**video,"lecture_label":label,
                    "url":f"https://www.youtube.com/watch?v={video['video_id']}",
                    "match_basis":"playlist position" if reference[0] == "position" else "series lecture number",
                    "timestamp_available":False,"score":3.0})
            continue
        words = set(tokens(video["title"])) - {"striver", "a2z", "course", "dsa"}
        overlap = terms & words
        coverage = len(overlap) / len(terms)
        if coverage < .75:
            continue
        heading = re.sub(r"^(?:[A-Za-z]+\s*[-.]?\s*\d+\s*[.:]?\s*)", "", video["title"]).lower()
        heading_terms = tokens(heading.split("|")[0])
        prefix = bool(heading_terms and heading_terms[0] in terms)
        penalty = .3 if {"binary","search"} <= terms and "tree" in words and "tree" not in terms else 0
        introduction = .1 if "introduction" in words else 0
        matches.append({**video, "lecture_label":lecture_label(video["title"]),
                        "url":f"https://www.youtube.com/watch?v={video['video_id']}",
                        "match_basis":"playlist title", "timestamp_available":False,
                        "score":round(coverage + .4*prefix + .1*len(overlap)/max(1,len(words)) + introduction-penalty, 4)})
    return sorted(matches, key=lambda v:(-v["score"], v["playlist_position"]))[:top_k]
