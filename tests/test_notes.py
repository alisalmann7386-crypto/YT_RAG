import json
import httpx
import pytest
from pydantic import ValidationError
from app.answer import answer_question, render_grounded_draft
from app.config import Settings
from app.models import AskRequest, Chunk
from app.retrieval import Retriever
from app.revision import SECTIONS, labels, overlap, revision_context
from app.store import build_database
from app.practice import practice_cards
from app.note_cache import NoteCache
from app.answer import readable_math


@pytest.fixture
def lecture(tmp_path):
    s=Settings(data_dir=tmp_path,provider="none",backend="bm25",app_key="")
    passages=[
        "Given a sorted array, binary search finds the position of a target value. This is the problem statement.",
        "The idea is to halve the search interval. The observation is that the sorted order lets us discard one half.",
        "The while loop continues while low is at most high. Initialize low to zero and high to n minus one. Update the boundaries to mid plus one or mid minus one.",
        "For example take the sorted array 1 3 5 7 9 and search for seven. Compare the middle value five, discard the left half, and compare seven.",
        "The time complexity is logarithmic, log n. Space complexity for the iterative version is constant because it stores only the boundaries.",
        "The recursive implementation uses stack space. Overflow of the midpoint can be avoided by computing low plus half the difference.",
    ]
    chunks=[Chunk(id=str(i),kind="lecture",video_id="abcdefghijk",title="BS-1. Binary Search Introduction",playlist_position=45,start=i*120,end=i*120+60,text=text,source="captions") for i,text in enumerate(passages)]
    chunks.append(Chunk(id="other",kind="lecture",video_id="zzzzzzzzzzz",title="Graph Representation",playlist_position=127,start=0,end=60,text="An adjacency list stores graph edges and has space complexity depending on vertices and edges."))
    catalog={"videos":[{"video_id":"abcdefghijk","title":chunks[0].title,"playlist_position":45},{"video_id":"yyyyyyyyyyy","title":"L41. Ceil in BST","playlist_position":113}]}
    build_database(s.database,chunks,{"playlist":catalog})
    return s,Retriever(s)


def draft():
    texts=[
        "Find a target in a **sorted array**.",
        "Sorted order lets us discard half the remaining interval.",
        "1. Initialize the boundaries.\n2. Compare the middle value and update a boundary.",
        "Illustration: for `[1,3,5,7,9]`, searching for 7 first compares against 5, then searches the right half.",
        "Time complexity is `O(log n)`; auxiliary space is `O(1)` for the iterative version.",
        "- Avoid midpoint overflow.\n- Why must the array be sorted? Sorted order makes discarding a half valid.\n- What changes after each comparison? One search boundary moves past the middle.",
    ]
    return {"no_evidence":False,"blocks":[{"section":k,"text":v,"source_ids":[1]} for k,v in zip(SECTIONS,texts)]}


def provider(monkeypatch, s, bodies):
    s.provider="groq";s.llm_model="openai/gpt-oss-20b";monkeypatch.setenv("GROQ_API_KEY","fixture-not-real")
    calls=[]
    def post(url,**kwargs):
        calls.append(kwargs["json"])
        body=bodies[min(len(calls)-1,len(bodies)-1)]
        return httpx.Response(200,request=httpx.Request("POST",url),json={"choices":[{"finish_reason":"stop","message":{"content":json.dumps(body)}}]})
    monkeypatch.setattr(httpx,"post",post)
    return calls


def test_revision_retrieves_distinct_method_example_and_complexity_sections(lecture):
    s,r=lecture;r.refresh()
    hits=revision_context(AskRequest(question="binary search",mode="summary"),r.search("binary search",6,"abcdefghijk"),r)
    assert len(hits)==6 and {h["chunk"].video_id for h in hits}=={"abcdefghijk"}
    text=" ".join(h["chunk"].text for h in hits)
    assert "while loop" in text and "log n" in text and "For example" in text
    assert not any(overlap(a["chunk"],b["chunk"]) for i,a in enumerate(hits) for b in hits[i+1:])
    single=revision_context(AskRequest(question="binary search",mode="summary",top_k=1),hits,r)
    assert len(single)==1


def test_validated_notes_cache_reuses_only_matching_inputs(lecture,monkeypatch):
    s,r=lecture;calls=provider(monkeypatch,s,[draft()])
    req=AskRequest(question="binary search",mode="summary")
    first=answer_question(req,r,s);second=answer_question(req,r,s)
    assert len(calls)==1 and not first["cache_hit"] and second["cache_hit"]
    assert first["sources"]==second["sources"]
    answer_question(req.model_copy(update={"language":"Hindi"}),r,s)
    answer_question(req.model_copy(update={"revision_detail":"quick"}),r,s)
    assert len(calls)==3
    r.chunks[0].text+=" New caption evidence."
    answer_question(req,r,s)
    assert len(calls)==4


def test_fallback_and_invalid_drafts_are_never_cached(lecture,monkeypatch):
    s,r=lecture;calls=provider(monkeypatch,s,[{"no_evidence":False,"blocks":[]}])
    req=AskRequest(question="binary search",mode="summary")
    for _ in range(2):
        result=answer_question(req,r,s)
        assert result["mode"]=="evidence"
    assert len(calls)==4
    assert NoteCache(s.data_dir/"revision_cache.sqlite3").get("missing") is None


def test_cache_is_bounded_expiring_and_handles_corrupt_json(tmp_path):
    import sqlite3
    cache=NoteCache(tmp_path/"cache.sqlite3",limit=2)
    result={"mode":"generated","summary_type":"revision_notes","sources":[{"number":1}]}
    for key in ("a","b","c"):cache.put(key,result)
    assert cache.get("a") is None and cache.get("c")["cache_hit"]
    with sqlite3.connect(cache.path) as db:
        db.execute("UPDATE notes SET body='broken' WHERE key='b'")
        db.execute("UPDATE notes SET created=0 WHERE key='c'")
    assert cache.get("b") is None and cache.get("c") is None


def test_math_notation_is_readable_without_modifying_code_literals():
    assert readable_math(r"Time: \(O(n \times T)\). Space: O(T).") == "Time: O(n × T). Space: O(T)."
    assert readable_math("O(n \times T)")=="O(n × T)"
    code='```python\nprint("\\times")\n```'
    assert readable_math(code)==code
    assert readable_math('Use `\\times` literally.')=='Use `\\times` literally.'


def test_practice_cards_hide_no_sources_and_reuse_validated_sections(lecture,monkeypatch):
    s,r=lecture;provider(monkeypatch,s,[draft()])
    result=answer_question(AskRequest(question="binary search",mode="summary"),r,s)
    cards=practice_cards(result)
    assert len(cards)==6 and len({c["id"] for c in cards})==6
    assert "recurrence" in cards[2]["question"] and "O(log n)" in cards[4]["answer"]
    assert all(c["sources"] and c["basis"]=="generated notes" for c in cards)
    assert cards==practice_cards(result)
    assert practice_cards({"sources":[],"answer":"Title only"})==[]


def test_practice_without_model_is_explicitly_caption_based(lecture):
    s,r=lecture
    result=answer_question(AskRequest(question="binary search",mode="summary"),r,s)
    cards=practice_cards(result)
    assert cards and all(c["basis"]=="original caption excerpt" for c in cards)
    assert all(c["sources"][0]["text"] in c["answer"] for c in cards)


def test_practice_api_returns_cards_and_no_cards_for_missing_captions(lecture,monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import create_app
    s,r=lecture;provider(monkeypatch,s,[draft()])
    with TestClient(create_app(s)) as client:
        response=client.post("/api/practice",json={"question":"binary search"})
        assert response.status_code==200 and len(response.json()["cards"])==6
        assert "Self-assessment" in response.json()["grading"]
        missing=client.post("/api/practice",json={"question":"Lecture 113"}).json()
        assert missing["cards"]==[] and missing["notes"]["mode"]=="catalog"


def test_practice_api_respects_server_authentication(lecture):
    from fastapi.testclient import TestClient
    from app.main import create_app
    s,_=lecture;s.app_key="fixture-private-key"
    with TestClient(create_app(s)) as client:
        assert client.post("/api/practice",json={"question":"binary search"}).status_code==401
        assert client.post("/api/practice",json={"question":"binary search"},headers={"X-API-Key":s.app_key}).status_code==200


@pytest.mark.parametrize("question",["Create good revision notes for binary search","Prepare exam-ready notes on binary search","Make a cheat sheet for binary search"])
def test_note_intent_does_not_displace_the_actual_lecture(lecture,question):
    s,r=lecture
    result=answer_question(AskRequest(question=question,mode="summary"),r,s)
    assert {x["playlist_position"] for x in result["sources"]}=={45}
    assert len(result["sources"])>1 and "log n" in result["answer"]
    assert result["summary_type"]=="revision_extracts" and "This lecture covers" not in result["answer"]


@pytest.mark.parametrize("question",["Summarise it","Make good notes","Create detailed revision notes for this topic"])
def test_notes_followup_retains_previous_topic(lecture,question):
    s,r=lecture
    result=answer_question(AskRequest(question=question,mode="summary",context_question="Where is binary search taught?"),r,s)
    assert {x["playlist_position"] for x in result["sources"]}=={45}
    assert result["context_question"]=="Where is binary search taught?"


@pytest.mark.parametrize("language",["English","Hindi","Hinglish"])
@pytest.mark.parametrize("detail",["quick","detailed"])
def test_generated_notes_have_six_ordered_cited_sections(lecture,monkeypatch,language,detail):
    s,r=lecture;calls=provider(monkeypatch,s,[draft()])
    result=answer_question(AskRequest(question="binary search",mode="summary",language=language,revision_detail=detail),r,s)
    assert result["mode"]=="generated" and len(calls)==1
    assert result["summary_type"]=="revision_notes" and result["revision_detail"]==detail
    positions=[result["answer"].index("### "+title) for title in labels(language).values()]
    assert positions==sorted(positions) and result["answer"].count("[1]")==6
    prompt=calls[0]["messages"][1]["content"]
    assert ("180–300 words" if detail=="quick" else "450–700 words") in prompt
    assert "while loop" in prompt and "log n" in prompt and "Graph Representation" not in prompt
    schema=calls[0]["response_format"]["json_schema"]["schema"]
    assert "section" in schema["properties"]["blocks"]["items"]["required"]


def test_incomplete_notes_get_one_repair_then_validate_the_whole_contract(lecture,monkeypatch):
    s,r=lecture;bad=draft();bad["blocks"]=bad["blocks"][:1]
    calls=provider(monkeypatch,s,[bad,draft()])
    result=answer_question(AskRequest(question="binary search",mode="summary"),r,s)
    assert len(calls)==2 and result["mode"]=="generated"
    assert "exactly six blocks" in calls[1]["messages"][-1]["content"]


def test_persistent_bad_note_sources_keep_multiple_useful_passages(lecture,monkeypatch):
    s,r=lecture;bad=draft();bad["blocks"][0]["source_ids"]=[999]
    calls=provider(monkeypatch,s,[bad])
    result=answer_question(AskRequest(question="binary search",mode="summary"),r,s)
    assert len(calls)==2 and result["mode"]=="evidence" and len(result["sources"])>1
    assert "while loop" in result["answer"] and "log n" in result["answer"]
    assert "after one repair" in result["warning"]


def test_quick_caption_notes_are_shorter_and_missing_captions_are_honest(lecture):
    s,r=lecture
    quick=answer_question(AskRequest(question="binary search",mode="summary",revision_detail="quick"),r,s)
    detailed=answer_question(AskRequest(question="binary search",mode="summary"),r,s)
    assert len(quick["sources"])<len(detailed["sources"]) and len(quick["answer"])<len(detailed["answer"])
    missing=answer_question(AskRequest(question="Lecture 113",mode="summary"),r,s)
    assert missing["mode"]=="catalog" and not missing["sources"] and not missing["grounded"]
    assert not missing["locations"][0]["timestamp_available"]


def test_duplicate_sections_and_injected_references_are_rejected():
    body=draft();body["blocks"][-1]["section"]="overview"
    with pytest.raises(ValueError):render_grounded_draft(json.dumps(body),1,revision=True)
    with pytest.raises(ValidationError):AskRequest(question="binary search",revision_detail="unlimited")


def test_incorrect_logarithmic_count_is_repaired_before_notes_are_displayed(lecture,monkeypatch):
    s,r=lecture;bad=draft();bad["blocks"][0]["text"]="The algorithm terminates in at most ⌈log₂ n⌉ steps."
    calls=provider(monkeypatch,s,[bad,draft()])
    result=answer_question(AskRequest(question="binary search",mode="summary"),r,s)
    assert len(calls)==2 and result["mode"]=="generated"
    assert "exact upper bound" in calls[1]["messages"][-1]["content"]
    assert "at most ⌈log₂ n⌉" not in result["answer"]


def test_bad_reachable_sum_trace_is_repaired_in_revision_notes(lecture,monkeypatch):
    s,r=lecture;bad=draft();good=draft()
    bad["blocks"][3]["text"]="Illustration: array [1,5,11,5]. After final 5 → {1,5,6,10,11,15,16}. The subsets are {11} and {1,5,5}."
    good["blocks"][3]["text"]="Illustration: array [1,5,11,5]. The total sum is 22 and the target is 11. The subsets are {11} and {1,5,5}."
    calls=provider(monkeypatch,s,[bad,good])
    # Isolate generation verification; lecture/topic ranking has separate tests.
    hits=r.search("binary search",6,"abcdefghijk")
    monkeypatch.setattr(r,"search",lambda *a,**k:hits)
    result=answer_question(AskRequest(question="partition equal subset sum",mode="summary",video_id="abcdefghijk"),r,s)
    assert len(calls)==2 and result["mode"]=="generated"
    assert "reachable-sum trace" in calls[1]["messages"][-1]["content"]
    assert "15,16" not in result["answer"]
