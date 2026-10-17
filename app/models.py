from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class Segment(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    text: str = Field(min_length=1, max_length=20000)

    @field_validator("end")
    @classmethod
    def end_after_start(cls, value, info):
        if value <= info.data.get("start", 0):
            raise ValueError("segment end must be after start")
        return value


class Transcript(BaseModel):
    video_id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    title: str = Field(min_length=1, max_length=500)
    language: str = "en"
    source: Literal["captions", "whisper", "import"] = "import"
    duration: float = Field(default=0, ge=0, allow_inf_nan=False)
    playlist_position: int | None = Field(default=None, ge=1)
    segments: list[Segment] = Field(min_length=1)


class Chunk(BaseModel):
    id: str
    title: str
    text: str
    kind: Literal["lecture", "note"]
    video_id: str | None = None
    start: float | None = None
    end: float | None = None
    language: str = "en"
    source: str = "original study note"
    topic: str = "DSA"
    playlist_position: int | None = Field(default=None, ge=1)
    segments: list[Segment] = Field(default_factory=list)


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=3000)


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=1200)
    top_k: int = Field(default=6, ge=1, le=10)
    video_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{11}$")
    mode: Literal["explain", "locate", "summary", "hint", "compare", "complexity", "code"] = "explain"
    language: Literal["English", "Hinglish", "Hindi"] = "English"
    code_language: Literal["Python", "C++", "Java"] = "Python"
    revision_detail: Literal["quick", "detailed"] = "detailed"
    context_question: str | None = Field(default=None, max_length=1200)
    context_video_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{11}$")
    history: list[HistoryTurn] = Field(default_factory=list, max_length=6)

    @field_validator("question")
    @classmethod
    def nonblank(cls, v):
        if not v.strip():
            raise ValueError("question must contain text")
        return v.strip()
