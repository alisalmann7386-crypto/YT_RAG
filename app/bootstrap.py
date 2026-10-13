"""Optional verified index download for ephemeral hosting, then start Uvicorn."""
import hashlib
import os
import re
import sqlite3
import sys
import tempfile
from pathlib import Path
import httpx
from app.config import Settings
from app.store import load_database


def download_index(settings: Settings):
    url = os.getenv("INDEX_DOWNLOAD_URL", "")
    if not url or settings.database.exists():
        return
    checksum = os.getenv("INDEX_SHA256", "").lower()
    if not url.startswith("https://") or not re.fullmatch(r"[a-f0-9]{64}",checksum):
        raise ValueError("INDEX_DOWNLOAD_URL requires HTTPS and a valid INDEX_SHA256")
    fd, name = tempfile.mkstemp(dir=settings.data_dir,prefix=".download-")
    digest, count = hashlib.sha256(), 0
    try:
        with os.fdopen(fd,"wb") as f, httpx.stream("GET",url,timeout=120,follow_redirects=False) as response:
            response.raise_for_status()
            for block in response.iter_bytes():
                count += len(block)
                if count > 200*1024*1024:
                    raise ValueError("Index exceeds 200 MiB download limit")
                digest.update(block)
                f.write(block)
        if digest.hexdigest() != checksum:
            raise ValueError("Downloaded index checksum mismatch; refusing to start")
        chunks,_,metadata = load_database(Path(name))
        if metadata.get("schema_version") != 1 or not chunks:
            raise ValueError("Downloaded index has no valid corpus")
        with sqlite3.connect(name) as db:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("Downloaded SQLite index is corrupt")
        os.replace(name,settings.database)
        print(f"Prepared {len(chunks)} indexed segments",flush=True)
    finally:
        Path(name).unlink(missing_ok=True)


def main():
    settings = Settings()
    try:
        download_index(settings)
    except Exception as exc:
        # Never print signed URLs, API keys or upstream response bodies.
        raise SystemExit(f"Index preparation failed ({type(exc).__name__}). Check URL and SHA256 configuration.")
    os.execv(sys.executable,[sys.executable,"-m","uvicorn","app.main:app","--host","0.0.0.0",
                           "--port",os.getenv("PORT","8000")])


if __name__ == "__main__":
    main()
