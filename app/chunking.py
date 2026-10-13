from collections import Counter
import hashlib
import re
from app.models import Chunk, Transcript


def repetitive(text: str) -> bool:
    sentences = [s.strip().lower() for s in re.split(r"[.!?\n]+", text) if s.strip()]
    return len(sentences) >= 4 and max(Counter(sentences).values()) / len(sentences) >= .7


def chunk_transcript(transcript: Transcript, window: int = 75, overlap: int = 15) -> list[Chunk]:
    if window <= 0 or not 0 <= overlap < window:
        raise ValueError("Require 0 <= overlap < window")
    segments = sorted([s for s in transcript.segments if s.text.strip()], key=lambda s: s.start)
    chunks, i = [], 0
    while i < len(segments):
        j = i + 1
        while j < len(segments) and segments[j].end - segments[i].start <= window:
            j += 1
        batch = segments[i:j]
        text = " ".join(s.text.strip() for s in batch)
        if text and not repetitive(text):
            identity = f"{transcript.video_id}:{batch[0].start:.3f}:{batch[-1].end:.3f}:{text}"
            chunks.append(Chunk(id=hashlib.sha256(identity.encode()).hexdigest()[:32],
                title=transcript.title, text=text, kind="lecture", video_id=transcript.video_id,
                start=batch[0].start, end=batch[-1].end, language=transcript.language,
                source=transcript.source))
        if j == len(segments):
            break
        boundary = batch[-1].end - overlap
        k = next((k for k in range(i + 1, j) if segments[k].start >= boundary), j)
        i = max(i + 1, k)
    return chunks
