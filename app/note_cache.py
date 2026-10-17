"""Bounded cache of validated revision notes, invalidated by evidence and settings."""
import hashlib
import json
import sqlite3
import time

VERSION = "study-notes-7"


class NoteCache:
    def __init__(self, path, limit=128, ttl=7*86400):
        self.path, self.limit, self.ttl = path, limit, ttl
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS notes (key TEXT PRIMARY KEY, created REAL, body TEXT)")

    def get(self, key):
        with sqlite3.connect(self.path, timeout=10) as db:
            row = db.execute("SELECT body FROM notes WHERE key=? AND created>?", (key,time.time()-self.ttl)).fetchone()
        if row:
            try:
                result = json.loads(row[0])
                if result.get("mode")=="generated" and result.get("summary_type")=="revision_notes" and result.get("sources"):
                    return {**result, "cache_hit":True}
            except (ValueError, AttributeError):
                pass
        return None

    def put(self, key, result):
        if result.get("mode")!="generated" or result.get("summary_type")!="revision_notes" or result.get("warning") or not result.get("sources"):
            return
        body=json.dumps(result,ensure_ascii=False)
        if len(body.encode())>200000:
            return
        with sqlite3.connect(self.path, timeout=10) as db:
            db.execute("INSERT OR REPLACE INTO notes VALUES (?,?,?)",(key,time.time(),body))
            db.execute("DELETE FROM notes WHERE created<?",(time.time()-self.ttl,))
            db.execute("DELETE FROM notes WHERE key NOT IN (SELECT key FROM notes ORDER BY created DESC LIMIT ?)",(self.limit,))


def cache_key(request, query, hits, settings):
    value=[VERSION,query,request.top_k,request.video_id,request.language,request.revision_detail,
           settings.provider,settings.llm_model,settings.rewind,
           [(h["chunk"].model_dump()) for h in hits]]
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
