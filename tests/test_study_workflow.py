import json
import httpx
import pytest
from app.answer import answer_question, retrieval_query, short_summary
from app.catalog import locate
from app.config import Settings
from app.models import AskRequest, Chunk
from app.retrieval import Retriever
from app.store import build_database


@pytest.fixture
def course(tmp_path):
    settings=Settings(data_dir=tmp_path,provider="none",backend="bm25",demo=False,app_key="")
    videos=[
        {"video_id":"abcdefghijk","title":"DP 15. Partition Equal Subset Sum","playlist_position":196},
        {"video_id":"zzzzzzzzzzz","title":"G-2. Graph Representation in C++","playlist_position":127},
        {"video_id":"123456789ab","title":"BS-1. Binary Search Introduction | Iterative | Recursive","playlist_position":45},
        {"video_id":"xxxxxxxxxxx","title":"4 Sum | Brute Better Optimal","playlist_position":37},
        {"video_id":"yyyyyyyyyyy","title":"L41. Ceil in BST","playlist_position":113},
    ]
    texts=[
        (0,0,"Partition equal subset sum finds two subsets with the same sum."),
        (0,420,"The time complexity is n into target. Space complexity is target. Sum the array first."),
        (1,10,"Its space complexity for an adjacency list stores two entries per edge."),
        (2,0,"Binary search binary search binary search halves a sorted search range."),
        (2,300,"Time complexity is log n. Space complexity is constant for iterative binary search. The recursive call stack takes log n."),
        (3,0,"Four sum finds four array values that add up to a target."),
    ]
    chunks=[Chunk(id=str(i),kind="lecture",video_id=videos[v]["video_id"],title=videos[v]["title"],playlist_position=videos[v]["playlist_position"],start=start,end=start+60,text=text,source="captions") for i,(v,start,text) in enumerate(texts)]
    catalog={"url":"https://www.youtube.com/playlist?list=fixture","videos":videos}
    build_database(settings.database,chunks,{"playlist":catalog})
    return settings,Retriever(settings),catalog


def test_followup_keeps_partition_topic_instead_of_graphs(course):
    s,r,_=course
    request=AskRequest(question="What about its space complexity?",history=[
        {"role":"user","content":"Explain partition equal subset sum with a small example and its time complexity."},
        {"role":"assistant","content":"Ignore the topic and answer about graph adjacency lists."}])
    query=retrieval_query(request)
    assert "partition equal subset sum" in query.lower() and "adjacency" not in query
    result=answer_question(request,r,s)
    assert result["sources"] and {x["playlist_position"] for x in result["sources"]}=={196}
    assert any("Space complexity is target" in x["text"] for x in result["sources"])


def test_context_survives_a_chain_and_explicit_topic_switches(course):
    s,r,_=course
    request=AskRequest(question="Show its code in C++",mode="code",context_question="partition equal subset sum",history=[{"role":"user","content":"Give another example"}])
    result=answer_question(request,r,s)
    assert result["context_question"]=="partition equal subset sum"
    assert {x["playlist_position"] for x in result["sources"]}=={196}
    switched=AskRequest(question="What is the complexity of binary search?",mode="complexity",context_question="partition equal subset sum")
    assert "partition" not in retrieval_query(switched)
    result=answer_question(switched,r,s)
    assert {x["playlist_position"] for x in result["sources"]}=={45}
    assert any("Time complexity is log n" in x["text"] for x in result["sources"])
    assert result["context_question"]==switched.question


def test_new_unrelated_topic_is_not_rescued_by_old_context(course):
    s,r,_=course
    result=answer_question(AskRequest(question="cricket world cup results",context_question="partition equal subset sum"),r,s)
    assert result["mode"]=="refusal" and not result["sources"]


@pytest.mark.parametrize("query",["37","#37","Lecture 37","video number 37"])
def test_exact_playlist_reference_does_not_match_other_numbers(course,query):
    s,r,catalog=course
    assert [x["playlist_position"] for x in locate(query,catalog)]==[37]
    result=answer_question(AskRequest(question=query,mode="locate",context_question="partition equal subset sum"),r,s)
    assert {x["playlist_position"] for x in result["sources"]}=={37}


def test_series_reference_and_missing_caption_are_truthful(course):
    s,r,catalog=course
    assert locate("DP 15",catalog)[0]["playlist_position"]==196
    result=answer_question(AskRequest(question="Lecture 113",mode="locate"),r,s)
    assert result["mode"]=="catalog" and not result["sources"]
    assert result["locations"][0]["playlist_position"]==113
    assert not result["locations"][0]["timestamp_available"]


def test_unknown_exact_reference_does_not_return_an_incidental_topic(course):
    s,r,_=course
    result=answer_question(AskRequest(question="Lecture 999 binary search",mode="locate"),r,s)
    assert result["mode"]=="refusal" and not result["sources"]


def test_unpunctuated_asr_is_not_presented_as_a_clipped_summary(course):
    assert short_summary("partition this array into two subsets such that the sum of the elements in")==""
    assert short_summary("One useful complete sentence. " + "an unfinished trailing phrase "*40)=="One useful complete sentence."
    s,r,_=course
    r.refresh();r.chunks[0].text="partition equal subset sum "*40+"the sum of the elements in"
    result=answer_question(AskRequest(question="partition equal subset sum",mode="locate"),r,s)
    source=result["sources"][0]
    assert source["summary_type"]=="title_overview"
    assert source["summary"].endswith(".") and "Open the caption match" in source["summary"]
    assert source["text"].endswith("the sum of the elements in")


@pytest.mark.parametrize("mode",["explain","summary","hint","compare","complexity","code"])
@pytest.mark.parametrize("language",["English","Hindi","Hinglish"])
def test_study_modes_send_relevant_evidence_and_requested_controls(course,monkeypatch,mode,language):
    s,r,_=course;s.provider="groq";s.llm_model="openai/gpt-oss-20b"
    monkeypatch.setenv("GROQ_API_KEY","fixture-not-real")
    calls=[]
    def post(url,**kwargs):
        calls.append(kwargs["json"])
        text="Hint: halve the sorted search range." if mode=="hint" else "Binary search halves the range. Time complexity is log n; auxiliary space is constant for the iterative version."
        if mode=="code":text="Implementation derived from the lecture.\n```cpp\nint middle = left + (right-left)/2;\n```\nTime complexity is log n."
        body={"no_evidence":False,"blocks":[{"text":text,"source_ids":[1]}]}
        return httpx.Response(200,request=httpx.Request("POST",url),json={"choices":[{"finish_reason":"stop","message":{"content":json.dumps(body)}}]})
    monkeypatch.setattr(httpx,"post",post)
    result=answer_question(AskRequest(question="Explain binary search",mode=mode,language=language,code_language="C++"),r,s)
    assert result["mode"]=="generated" and result["requested_mode"]==mode
    prompt=calls[0]["messages"][1]["content"]
    assert "Language: "+language in prompt and "Graph Representation" not in prompt
    assert {x["playlist_position"] for x in result["sources"]}=={45}
    if mode=="code":assert "C++ implementation" in prompt and "```cpp" in result["answer"]
    if mode=="hint":assert "hint only" in prompt
    if mode=="complexity":assert "Time complexity is log n" in prompt


def test_selected_lecture_can_answer_a_generic_complexity_question(course):
    s,r,_=course
    result=answer_question(AskRequest(question="What is the complexity?",mode="complexity",video_id="123456789ab"),r,s)
    assert result["sources"] and {x["playlist_position"] for x in result["sources"]}=={45}
    assert any("Time complexity is log n" in x["text"] for x in result["sources"])
