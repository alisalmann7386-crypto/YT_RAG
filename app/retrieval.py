import math
import re
import threading
import unicodedata
from collections import Counter, defaultdict
from functools import lru_cache
import httpx
from app.config import Settings
from app.store import load_database

STOP = set("a an the is are was be to of and or for in on with what why how when where who explain please me my i it this that can do does difference between kya hai ka ki ke ko se aur mein me hota hote hoti batao samjhao bhai mujhe bata tell about works work algorithm code python java cpp give show use using versus vs time complexity return returns".split())
STOP.update("taught teach teaches teaching covered cover lecture lectures video videos playlist striver strivers a2z dsa topic summary summarize summarise revision revise kis konsa kaunsa kaha kahan which find locate learned learn learning short briefly understand".split())
STOP.update("its their these those same above previous both more again also now then small simple simpler example examples explanation details please provide".split())
STOP.update("make create prepare good note notes detailed concise recap cheat sheet exam ready study important point key takeaway overview".split())
STOP.update("kab padhaya padhate padhaya samjha samjhaao kaunse kaunsi milta bataiye बताओ समझाओ पढ़ाया कहाँ कब".split())
STOP.update("का की के है हैं में किस कौन विषय गया यह इस".split())
ALIASES = {"dp":"dynamic programming", "bfs":"breadth first search", "dfs":"depth first search",
           "memoisation":"memoization", "tabulate":"tabulation", "bst":"binary search tree",
           "heap":"heap priority queue", "dijkstra":"dijkstra shortest path", "द्विआधारी":"binary",
           "रिकर्शन":"recursion", "रिकर्सन":"recursion", "मेमोइज़ेशन":"memoization",
           "टैबुलेशन":"tabulation", "ग्राफ":"graph", "ऐरे":"array", "हैशिंग":"hashing",
           "kadane's":"kadane", "kadanes":"kadane", "djikstra":"dijkstra", "dijsktra":"dijkstra",
           "hashmap":"hash map", "hashset":"hash set", "parameterized":"parameterised",
           "binarry":"binary", "binay":"binary", "bianry":"binary", "serach":"search",
           "partion":"partition", "partiton":"partition", "knapsak":"knapsack",
           "recusrion":"recursion", "recurssion":"recursion", "memozation":"memoization",
           "subsequnce":"subsequence", "slidingwindow":"sliding window", "twopointer":"two pointer",
           "barabar":"equal", "बराबर":"equal", "सबसेट":"subset", "योग":"sum",
           "बाइनरी":"binary", "सर्च":"search"}


def tokens(text: str) -> list[str]:
    for digit, word in (("2","two"),("3","three"),("4","four")):
        text = re.sub(rf"\b{digit}\s*sum\b",word+" sum",text,flags=re.I)
    # Keep combining marks with their letters: Hindi vowel signs must not be
    # split into unrelated tokens by Python's \w character class.
    terms = "".join(ch if unicodedata.category(ch)[0] in "LNM" else " " for ch in unicodedata.normalize("NFC",text.lower())).split()
    result = []
    for term in terms:
        if term in STOP or len(term) < 2:
            continue
        if term.endswith("s") and len(term) > 4:
            term = term[:-1]
        result.extend(ALIASES.get(term, term).split())
    return [t for t in result if t not in STOP]


@lru_cache(maxsize=2)
def embedder(model_name: str):
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise RuntimeError("Hybrid retrieval needs pip install -e '.[semantic]'") from exc
    return SentenceTransformer(model_name, device="cpu")


def embed(texts: list[str], model_name: str):
    return embedder(model_name).encode(texts, normalize_embeddings=True, show_progress_bar=False)


class Retriever:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.signature = None
        self.lock = threading.RLock()
        self.chunks, self.metadata, self.vectors = [], {}, None
        self.postings = {}

    def refresh(self):
        with self.lock:
            p = self.settings.database
            signature = (p.stat().st_mtime_ns, p.stat().st_size) if p.exists() else None
            if signature == self.signature:
                return
            if signature is None:
                self.chunks, self.metadata, self.vectors, self.postings = [], {}, None, {}
                self.signature = None
                return
            chunks, raw_vectors, metadata = load_database(p)
            postings = defaultdict(dict)
            lengths = []
            for i, c in enumerate(chunks):
                terms = tokens(c.title + " " + c.title + " " + c.text)
                lengths.append(len(terms))
                for word, count in Counter(terms).items():
                    postings[word][i] = count
            vectors = None
            if self.settings.backend == "hybrid":
                if metadata.get("embedding_model") != self.settings.embedding_model or not all(raw_vectors):
                    raise RuntimeError("Hybrid index missing or embedding model changed. Run a2z index --semantic.")
                import numpy as np
                vectors = np.stack([np.frombuffer(v, dtype="float32") for v in raw_vectors])
                if self.settings.qdrant_url and not metadata.get("qdrant_collection"):
                    raise RuntimeError("Qdrant index is missing. Run a2z index --semantic --qdrant.")
            self.chunks, self.metadata, self.vectors = chunks, metadata, vectors
            self.postings, self.lengths = postings, lengths
            self.avg_len = sum(lengths) / max(1, len(lengths))
            self.signature = signature

    def search(self, question: str, top_k: int = 6, video_id: str | None = None):
        with self.lock:
            self.refresh()
            terms = set(tokens(question))
            if not terms or not self.chunks:
                return []
            n = len(self.chunks)
            scores, matches = defaultdict(float), defaultdict(set)
            query_weights = {}
            for term in terms:
                posting = self.postings.get(term, {})
                idf = math.log(1 + (n - len(posting) + .5) / (len(posting) + .5))
                query_weights[term] = idf
                for idx, tf in posting.items():
                    if video_id and self.chunks[idx].video_id != video_id:
                        continue
                    norm = tf + 1.5 * (1 - .75 + .75 * self.lengths[idx] / max(1, self.avg_len))
                    scores[idx] += idf * tf * 2.5 / norm
                    matches[idx].add(term)
            total_weight = sum(query_weights.values())
            coverage = {i:sum(query_weights[t] for t in matched)/max(total_weight,1e-9)
                        for i,matched in matches.items()}
            lexical = sorted([i for i in scores if coverage[i] >= self.settings.lexical_min], key=lambda i: scores[i], reverse=True)
            dense, dense_scores = [], {}
            if self.vectors is not None:
                query = embed([question], self.settings.embedding_model)[0]
                if self.settings.qdrant_url:
                    # A versioned collection name in metadata pins this database to its matching vectors.
                    url = f"{self.settings.qdrant_url}/collections/{self.metadata['qdrant_collection']}/points/query"
                    payload = {"query": query.tolist(), "limit": min(50, n), "with_payload": True}
                    if video_id:
                        payload["filter"] = {"must": [{"key":"video_id","match":{"value":video_id}}]}
                    response = httpx.post(url, json=payload, headers={"api-key":self.settings.qdrant_key}, timeout=20)
                    response.raise_for_status()
                    ids = {c.id: i for i, c in enumerate(self.chunks)}
                    for hit in response.json()["result"]["points"]:
                        idx = ids.get(hit.get("payload", {}).get("chunk_id"))
                        if idx is not None:
                            dense_scores[idx] = float(hit["score"])
                else:
                    dense_scores = {i:float(score) for i, score in enumerate(self.vectors @ query) if not video_id or self.chunks[i].video_id == video_id}
                dense = sorted([i for i,s in dense_scores.items() if s >= self.settings.semantic_min], key=lambda i:dense_scores[i], reverse=True)
            fused = defaultdict(float)
            for ranking in (lexical[:50], dense[:50]):
                for rank, idx in enumerate(ranking):
                    fused[idx] += 1 / (60 + rank + 1)
            ordered = sorted(fused, key=lambda i:fused[i], reverse=True)
            selected = []
            per_video = Counter()
            for idx in ordered:
                c = self.chunks[idx]
                # Keep a long lecture from consuming every global result slot.
                # A per-lecture query still gets all requested windows.
                if not video_id and c.video_id and per_video[c.video_id] >= 2:
                    continue
                duplicate = any(c.video_id and c.video_id == old["chunk"].video_id and
                    max(0, min(c.end, old["chunk"].end) - max(c.start, old["chunk"].start)) /
                    max(1, min(c.end-c.start, old["chunk"].end-old["chunk"].start)) > .6 for old in selected)
                if duplicate:
                    continue
                selected.append({"chunk":c, "score":round(fused[idx], 5),
                    "lexical_coverage":round(coverage.get(idx,0), 3),
                    "query_terms":terms,
                    "semantic_score":round(dense_scores[idx], 3) if idx in dense_scores else None})
                if c.video_id:
                    per_video[c.video_id] += 1
                if len(selected) == top_k:
                    break
            return selected
