"""Resolve short study follow-ups using user questions, never generated answers."""
import re
from app.models import AskRequest
from app.retrieval import tokens
from app.catalog import lecture_reference

FOLLOWUP_WORDS = set("its their these those same above previous both more another again also now then next small simple simpler example examples explanation detail details solution approach approaches implementation implement write show convert translate language python java cpp english hindi hinglish time space complexity auxiliary memory cost optimize optimise optimized optimised optimal optimization optimisation efficient efficiency pseudocode recurrence hint hints please give provide briefly discuss discussion tell taught covered number no about".split())
FOLLOWUP_WORDS.update("make create prepare good note notes detailed concise recap cheat sheet exam ready study important point key takeaway overview summarise summarize summary revision".split())
FOLLOWUP_WORDS.update("step steps third second first last line lines version iterative recursive backwards backward forward iterate iteration loop loops invariant base case transition dry run flashcards quiz test practice recall".split())

# These refer to an explanation, even when their wording contains several nouns.
# Explicit lecture references and a named new topic still take precedence.
STUDY_FOLLOWUP = re.compile(
    r"^(?:please\s+)?(?:explain|expand|repeat|clarify|show|what (?:is|about))\s+(?:the\s+)?(?:step|line|point)\s*#?\s*\d+\b"
    r"|^(?:why|how|can we|could we|what if)\b.*\b(?:iterate|iteration|backwards|backward|loop|base case|transition|mid\s*\+?\s*1)\b"
    r"|^(?:give|show|write|convert to)\s+(?:me\s+)?(?:the\s+)?(?:recursive|iterative|space.optimized)\s+(?:version|solution|approach|code)\b",
    re.I,
)


def topic_terms(question: str) -> list[str]:
    return [t for t in tokens(question) if t not in FOLLOWUP_WORDS and not t.isdigit()]


def is_followup(question: str) -> bool:
    if lecture_reference(question):
        return False
    # A question that names its topic is standalone even if it says "its time
    # complexity" later. Pure follow-ups have only generic study instructions.
    words = topic_terms(question)
    if STUDY_FOLLOWUP.search(question) and not words:
        return True
    if STUDY_FOLLOWUP.search(question) and len(words)<=1 and not re.search(r"\b(?:of|for|in)\s+\w+", question, re.I):
        return True
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
