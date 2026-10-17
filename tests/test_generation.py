import json
import httpx
import pytest
from app.answer import answer_question
from app.cli import build_index
from app.config import Settings
from app.models import AskRequest
from app.retrieval import Retriever


def prepared(tmp_path,monkeypatch,body,finish="stop"):
    settings=Settings(data_dir=tmp_path,provider="groq",llm_model="openai/gpt-oss-20b",backend="bm25",app_key="")
    build_index(settings,demo=True)
    monkeypatch.setenv("GROQ_API_KEY","fixture-not-a-real-key")
    calls=[]
    def post(url,**kwargs):
        calls.append(kwargs["json"])
        return httpx.Response(200,request=httpx.Request("POST",url),json={"choices":[{"finish_reason":finish,
            "message":{"content":json.dumps(body),"reasoning":"ignored-provider-metadata"}}]})
    monkeypatch.setattr(httpx,"post",post)
    return settings,Retriever(settings),calls


def test_structured_sources_are_rendered_and_renumbered(tmp_path,monkeypatch):
    body={"no_evidence":False,"blocks":[{"text":"Binary search halves a sorted range.","source_ids":[2]},
        {"text":"Check the sorted input assumption.","source_ids":[1,2]}]}
    s,r,calls=prepared(tmp_path,monkeypatch,body)
    expected=r.search("binary search",6)
    result=answer_question(AskRequest(question="binary search"),r,s)
    assert result["mode"] == "generated" and not result["warning"]
    assert "range. [1]" in result["answer"] and "assumption. [2] [1]" in result["answer"]
    assert result["sources"][0]["id"] == expected[1]["chunk"].id
    assert "ignored-provider-metadata" not in result["answer"]
    payload=calls[0]
    assert payload["response_format"]["json_schema"]["strict"]
    enum=payload["response_format"]["json_schema"]["schema"]["properties"]["blocks"]["items"]["properties"]["source_ids"]["items"]["enum"]
    assert enum == list(range(1,len(expected)+1))
    assert payload["reasoning_effort"] == "low" and payload["include_reasoning"] is False
    assert payload["max_completion_tokens"] == 4096 and "max_tokens" not in payload


@pytest.mark.parametrize("body",[
    {"no_evidence":False,"blocks":[{"text":"Invented source","source_ids":[999]}]},
    {"no_evidence":False,"blocks":[{"text":"Uncited answer","source_ids":[]}]},
    {"no_evidence":False,"blocks":[{"text":"Boolean is not an ID","source_ids":[True]}]},
    {"no_evidence":False,"blocks":[{"text":"   ","source_ids":[1]}]},
    {"no_evidence":False,"blocks":[]},
    {"no_evidence":True,"blocks":[{"text":"Contradictory answer","source_ids":[1]}]},
    {"no_evidence":False,"blocks":[{"text":"Unclosed ```python\na[0]","source_ids":[1]}]},
    {"no_evidence":False,"blocks":[{"text":"Smuggled citation [999]","source_ids":[1]}]}
])
def test_invalid_structured_answer_keeps_evidence_fallback(tmp_path,monkeypatch,body):
    s,r,_=prepared(tmp_path,monkeypatch,body)
    result=answer_question(AskRequest(question="memoization"),r,s)
    assert result["mode"] == "evidence" and result["warning"]
    assert result["sources"] and "Invented source" not in result["answer"]


def test_truncated_output_is_not_treated_as_citation_failure(tmp_path,monkeypatch):
    s,r,_=prepared(tmp_path,monkeypatch,{"no_evidence":False,"blocks":[]},finish="length")
    result=answer_question(AskRequest(question="memoization"),r,s)
    assert result["mode"] == "evidence" and "response limit" in result["warning"]


def test_model_abstention_keeps_matching_sources_available(tmp_path,monkeypatch):
    s,r,_=prepared(tmp_path,monkeypatch,{"no_evidence":True,"blocks":[]})
    result=answer_question(AskRequest(question="memoization"),r,s)
    assert result["mode"] == "evidence" and result["sources"]
    assert "could not establish" in result["warning"]


def test_structured_code_preserves_array_indices(tmp_path,monkeypatch):
    body={"no_evidence":False,"blocks":[{"text":"Implementation derived from the source.","source_ids":[1]},
        {"text":"```python\nbest = nums[0]\n```","source_ids":[1]}]}
    s,r,_=prepared(tmp_path,monkeypatch,body)
    result=answer_question(AskRequest(question="Kadane maximum subarray",mode="code"),r,s)
    assert result["mode"] == "generated" and "nums[0]" in result["answer"]
    assert "```\n\n[1]" in result["answer"]


def test_malformed_structured_sources_get_one_bounded_repair(tmp_path,monkeypatch):
    s,r,_=prepared(tmp_path,monkeypatch,{})
    calls=[]
    def post(url,**kwargs):
        calls.append(kwargs["json"])
        body={"no_evidence":False,"blocks":[{"text":"Memoization caches computed states.","source_ids":[1] if len(calls)>1 else []}]}
        return httpx.Response(200,request=httpx.Request("POST",url),json={"choices":[{"finish_reason":"stop","message":{"content":json.dumps(body)}}]})
    monkeypatch.setattr(httpx,"post",post)
    result=answer_question(AskRequest(question="memoization"),r,s)
    assert len(calls)==2 and result["mode"]=="generated"
    assert "source-format validation" in calls[1]["messages"][-1]["content"]
    assert result["sources"] and "[1]" in result["answer"]


def test_persistently_malformed_sources_stop_after_two_calls(tmp_path,monkeypatch):
    s,r,calls=prepared(tmp_path,monkeypatch,{"no_evidence":False,"blocks":[{"text":"Uncited","source_ids":[]}]})
    result=answer_question(AskRequest(question="memoization"),r,s)
    assert len(calls)==2 and result["mode"]=="evidence"
    assert "after one repair attempt" in result["warning"] and result["sources"]
