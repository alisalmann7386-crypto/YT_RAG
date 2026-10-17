"""Lecture coverage and presentation rules for grounded revision notes."""
import re
from app.retrieval import tokens

SECTIONS = ("overview", "intuition", "method", "example", "complexity", "recall")
LABELS = {
    "English": ("Topic & goal", "Core idea", "Steps & recurrence", "Worked example",
                "Time & space complexity", "Pitfalls & recall questions"),
    "Hindi": ("विषय और लक्ष्य", "मुख्य विचार", "चरण और रिकरेंस", "उदाहरण",
              "समय और स्पेस जटिलता", "सावधानियाँ और अभ्यास प्रश्न"),
    "Hinglish": ("Topic aur goal", "Core idea", "Steps aur recurrence", "Worked example",
                 "Time aur space complexity", "Common mistakes aur recall questions"),
}
PATTERNS = {
    "overview": r"problem statement|\bgiven\b|\btask\b|\bdefinition\b|\bmeans\b",
    "intuition": r"\bintuition\b|\bidea\b|\bobservation\b|\bwhy\b|\binvariant\b|\bhalve\w*\b",
    "method": r"\brecurrence\b|\btransition\b|\bbase case\b|\brecursive\b|\bwhile\b|\binitiali[sz]\w*\b|\bpseudocode\b|\bimplement\w*\b|\btabulation\b",
    "example": r"\bexample\b|\bdry run\b|\billustrat\w*\b|\bconsider\b",
    "complexity": r"\b(?:time|space|auxiliary)\s+complexity\b|\blogarithm\w*\b|\bO\s*\(",
}


def labels(language):
    return dict(zip(SECTIONS, LABELS.get(language, LABELS["English"])))


def revision_prompt(detail, language, structured=False):
    length = "180–300 words" if detail == "quick" else "450–700 words, when the evidence is sufficient"
    headings = "; ".join(f"{key}: {value}" for key, value in labels(language).items())
    return f"""Create useful revision notes in {language}, approximately {length}.
Cover these six sections in order: {headings}.
Overview: define the problem, goal, input assumptions and prerequisites established by the excerpts.
Intuition: explain WHY the approach works, including its invariant or state meaning when supported.
Method: give numbered steps; include DP state, transition, base case and evaluation order only for DP topics where supported. Distinguish approaches actually present in the evidence.
Example: give one small, fully worked illustration derived from the supported rule; label it an illustration, not the lecturer's example. Do not invent a trace the evidence cannot support.
Complexity: separate time from auxiliary space and distinguish iterative/recursive or memoized/tabulated variants only when supported. State missing bounds explicitly.
Keep asymptotic bounds separate from exact operation counts. Do not convert O(log n) into an exact number of comparisons or claim "at most log2(n) steps" (with or without ceil). Use the asymptotic O(log n) wording when that is what the excerpts establish. Prefer recall questions about the invariant, termination or boundary updates over unsupported exact-count quizzes.
Recall: include supported implementation cautions and 2–3 short questions WITH concise answers, so the student can check understanding. Questions may be derived from the supported concepts.
Use short bullets, numbered steps, bold key terms and inline code where helpful. Prefer precise explanations over filler. Do not repeat lecture metadata in every section. Do not claim the notes cover an entire lecture when only excerpts are available.
If a section cannot be established, state that briefly rather than inventing it. Keep all factual content cited.
{"Return exactly six blocks, one for each section ID. Each block needs section, text and nonempty source_ids. The application adds headings: do not repeat headings inside text. A missing detail may cite the inspected excerpts while explicitly saying it is not established. Use no_evidence=true with blocks=[] only if none of the topic is supported." if structured else "Use a Markdown heading for each of the six sections and source citations in every section."}"""


def overlap(a, b):
    if a.start is None or b.start is None or a.end is None or b.end is None:
        return a.id == b.id
    return max(0, min(a.end, b.end)-max(a.start, b.start)) / max(1, min(a.end-a.start, b.end-b.start)) > .55


def revision_context(request, hits, retriever):
    """Sample distinct teaching sections from the primary, already matched lecture.

    Section keywords guide coverage; they are not claims about an algorithm.
    Original search scores are preserved. Added passages carry a section-match basis.
    """
    if request.mode != "summary" or not hits or not hits[0]["chunk"].video_id:
        return hits
    primary = hits[0]["chunk"].video_id
    candidates = [c for c in retriever.chunks if c.video_id == primary and len(tokens(c.text)) >= 8]
    if not candidates:
        return hits
    existing = {h["chunk"].id: h for h in hits}
    selected = [{**hits[0], "revision_section": "overview"}]
    limit = min(request.top_k, 8)
    duration = max((c.end or 0 for c in candidates), default=1)

    def eligible(c):
        return not any(overlap(c, h["chunk"]) for h in selected)

    def add(c, section):
        selected.append({**existing.get(c.id, {"chunk":c, "score":0.0, "lexical_coverage":0.0, "semantic_score":None}),
                         "revision_section":section, "match_basis":"lecture section",
                         "query_terms":set(tokens(section + " " + ("time space complexity log target" if section == "complexity" else request.question)))})

    # Reserve the tail's complexity discussion before term-heavy introductory windows.
    for section in ("complexity", "method", "intuition", "example", "overview"):
        if len(selected) >= limit:
            break
        options = [c for c in candidates if eligible(c) and re.search(PATTERNS[section], c.text, re.I)]
        if options:
            def rank(c):
                count = min(5, len(re.findall(PATTERNS[section], c.text, re.I)))
                # Prefer a stated bound to an introduction merely promising complexity.
                bound = bool(re.search(r"\blog\w*\b|\bconstant\b|\btarget\b|\bn\s+(?:into|square|cube)\b|O\s*\(", c.text, re.I)) if section == "complexity" else False
                distance = min(abs((c.start or 0)-(h["chunk"].start or 0)) for h in selected) / max(1, duration)
                return (bound, count, distance)
            add(max(options, key=rank), section)
    # Fill remaining slots with distant passages, not near-duplicate chunks.
    while len(selected) < limit:
        options = [c for c in candidates if eligible(c)]
        if not options:
            break
        c = max(options, key=lambda c:min(abs((c.start or 0)-(h["chunk"].start or 0)) for h in selected))
        add(c, "overview")
    return selected


def caption_excerpt(chunk, query_terms=(), limit=650):
    """Keep whole subtitle units, explicitly for an excerpt rather than a paraphrase."""
    if not chunk.segments:
        return chunk.text.strip()
    segments = chunk.segments
    terms = set(query_terms)
    start = max(range(len(segments)), key=lambda i:len(set(tokens(segments[i].text)) & terms))
    start = max(0, start-1)
    chosen = []
    for segment in segments[start:]:
        if chosen and sum(len(s) for s in chosen)+len(segment.text) > limit:
            break
        chosen.append(segment.text.strip())
    return " ".join(chosen)
