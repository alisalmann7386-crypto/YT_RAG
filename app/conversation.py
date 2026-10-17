"""Resolve short study follow-ups using user questions, never generated answers."""
import re
from app.models import AskRequest
from app.retrieval import tokens
from app.catalog import lecture_reference

FOLLOWUP_WORDS = set("its their these those same above previous both more another again also now then next small simple simpler example examples explanation detail details solution approach approaches implementation implement write show convert translate language python java cpp english hindi hinglish time space complexity auxiliary memory cost optimize optimise optimized optimised optimal optimization optimisation efficient efficiency pseudocode recurrence hint hints please give provide briefly discuss discussion tell taught covered number no about".split())


def topic_terms(question: str) -> list[str]:
    return [t for t in tokens(question) if t not in FOLLOWUP_WORDS and not t.isdigit()]


def is_followup(question: str) -> bool:
    if lecture_reference(question):
        return False
    # A question that names its topic is standalone even if it says "its time
    # complexity" later. Pure follow-ups have only generic study instructions.
    words = topic_terms(question)
    relational = re.search(r"\b(?:it|this|that|both)\s+(?:using|with|instead|to)\b|\bwhat if\b|\bedge case",question,re.I)
    if len(words)>=2 and not relational:
        return False
    anaphor = re.search(r"\b(?:it|its|this|that|these|those|same|above|both)\b|\b(?:iska|iski|isko|uska|uski|ise|isko)\b|इसका|इसकी|इसे|उसका", question, re.I)
    return bool(anaphor) or not words


def conversation_topic(request: AskRequest) -> str:
    if not is_followup(request.question):
        return request.question
    if request.context_question:
        return request.context_question
    for turn in reversed(request.history):
        if turn.role == "user" and not is_followup(turn.content):
            return turn.content[:1200]
    return ""


def resolve_question(request: AskRequest) -> str:
    topic = conversation_topic(request)
    if topic and topic != request.question:
        # Drop earlier requests for code/examples so they do not pollute the new search.
        words = " ".join(topic_terms(topic)) or topic
        return words + " " + request.question
    return request.question
