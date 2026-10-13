from dataclasses import dataclass, field
from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()
PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLgUwDviBIf0oF6QL8m22w1hIDC1vJ_BHz"


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", "data")).resolve())
    demo: bool = field(default_factory=lambda: os.getenv("DEMO_MODE", "true").lower() == "true")
    provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "none"))
    llm_model: str = field(default_factory=lambda: os.getenv("LLM_MODEL", "openai/gpt-oss-20b"))
    backend: str = field(default_factory=lambda: os.getenv("RETRIEVAL_BACKEND", "bm25"))
    embedding_model: str = field(default_factory=lambda: os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"))
    semantic_min: float = field(default_factory=lambda: float(os.getenv("SEMANTIC_MIN_SCORE", "0.40")))
    lexical_min: float = field(default_factory=lambda: float(os.getenv("LEXICAL_MIN_COVERAGE", "0.35")))
    chunk_seconds: int = field(default_factory=lambda: int(os.getenv("CHUNK_SECONDS", "75")))
    overlap: int = field(default_factory=lambda: int(os.getenv("CHUNK_OVERLAP", "15")))
    top_k: int = field(default_factory=lambda: int(os.getenv("TOP_K", "6")))
    rewind: int = field(default_factory=lambda: int(os.getenv("LINK_REWIND", "4")))
    rate_requests: int = field(default_factory=lambda: int(os.getenv("RATE_LIMIT_REQUESTS", "20")))
    rate_window: int = field(default_factory=lambda: int(os.getenv("RATE_LIMIT_WINDOW", "60")))
    qdrant_url: str = field(default_factory=lambda: os.getenv("QDRANT_URL", "").rstrip("/"))
    qdrant_key: str = field(default_factory=lambda: os.getenv("QDRANT_API_KEY", ""))
    collection: str = field(default_factory=lambda: os.getenv("QDRANT_COLLECTION", "a2z_dsa"))
    app_key: str = field(default_factory=lambda: os.getenv("APP_API_KEY", ""))

    def __post_init__(self):
        if self.backend not in {"bm25", "hybrid"}:
            raise ValueError("RETRIEVAL_BACKEND must be bm25 or hybrid")
        if self.provider not in {"none", "groq", "compatible"}:
            raise ValueError("LLM_PROVIDER must be none, groq or compatible")
        if not 0 <= self.overlap < self.chunk_seconds or self.chunk_seconds < 1:
            raise ValueError("CHUNK_OVERLAP must be smaller than CHUNK_SECONDS")
        if not 0 <= self.semantic_min <= 1 or not 0 <= self.lexical_min <= 1:
            raise ValueError("Retrieval thresholds must be between 0 and 1")
        if self.rate_window < 1 or self.rate_requests < 1:
            raise ValueError("Rate limits must be positive")
        self.data_dir.mkdir(parents=True, exist_ok=True)

    @property
    def database(self) -> Path:
        return self.data_dir / "index.sqlite3"
