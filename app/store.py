"""Build complete snapshots and atomically swap them; server never sees half an index."""
import json
import os
import sqlite3
import tempfile
from pathlib import Path
from app.models import Chunk


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        Path(tmp).unlink(missing_ok=True)


def build_database(path: Path, chunks: list[Chunk], metadata: dict, vectors=None):
    if not chunks:
        raise ValueError("No usable chunks; existing index has been preserved")
    if vectors is not None and len(vectors) != len(chunks):
        raise ValueError("Vector count does not match chunk count")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".index-")
    os.close(fd)
    try:
        with sqlite3.connect(tmp) as db:
            db.execute("CREATE TABLE chunks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, vector BLOB)")
            db.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.executemany("INSERT INTO chunks VALUES (?, ?, ?)", [
                (c.id, c.model_dump_json(), None if vectors is None else vectors[i].astype("float32").tobytes())
                for i, c in enumerate(chunks)])
            db.executemany("INSERT INTO metadata VALUES (?, ?)", [(k, json.dumps(v)) for k, v in metadata.items()])
        os.replace(tmp, path)
    finally:
        Path(tmp).unlink(missing_ok=True)


def load_database(path: Path):
    with sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True) as db:
        rows = db.execute("SELECT payload, vector FROM chunks ORDER BY rowid").fetchall()
        metadata = {k: json.loads(v) for k, v in db.execute("SELECT key, value FROM metadata")}
    return [Chunk.model_validate_json(r[0]) for r in rows], [r[1] for r in rows], metadata
