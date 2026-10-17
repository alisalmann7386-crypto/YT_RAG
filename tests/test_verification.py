import json
import httpx
import pytest
from app.answer import answer_question,complexity_context
from app.cli import build_index
from app.config import Settings
from app.models import AskRequest,Chunk
from app.retrieval import Retriever
from app.store import build_database
from app.verification import answer_issues,illustration_hint

QUESTION="Explain partition equal subset sum with a small example and its time complexity."
BAD="Given the array [2,3,3,4,5] the total sum is 20. One valid partition is {2,3,5} and {3,3,4}, both summing to 10."
GOOD="Illustration: the array [1,5,11,5] has a total sum of 22. A valid partition is {11} and {1,5,5}, both summing to 11. Time complexity is not established by these excerpts."


def test_screenshot_example_and_missing_complexity_are_rejected():
    errors=answer_issues(QUESTION,BAD)
    assert any("17" in e for e in errors)
    assert any("multiplicities" in e for e in errors)
    assert any("complexity" in e for e in errors)


def test_correct_duplicate_values_and_equation_are_accepted():
    text="The array [2,3,3,3,4,5] has total sum = 2+3+3+3+4+5 = 20. Its subsets [2,3,5] and [3,3,4] both sum to 10. Time complexity is O(n * target)."
    assert not answer_issues(QUESTION,text)
    assert not answer_issues(QUESTION,GOOD)


@pytest.mark.parametrize("text",[
    "The array [1,2,3,4] has total sum is 10. A valid partition is [1,2] and [3,4]. Time complexity is not established.",
    "The array [1,5,11,5] has total sum is 22. A valid partition is [11] and [1,5,5], both summing to 10. Time complexity is not established.",
    "The array [2,3,3,4,5] has total sum is 17, which is even. Time complexity is not established."
])
def test_unequal_sums_wrong_sum_and_parity_are_rejected(text):
    assert answer_issues(QUESTION,text)


def test_different_topics_code_indices_and_explicitly_invalid_partitions_are_not_flagged():
    assert not answer_issues("Explain merge sort",BAD)
    assert not answer_issues("Explain equal partition","```python\nnums=[2,3,3,4,5]\n```The source explains subsets.")
    text="The array [1,2,3,4] has total sum is 10. The invalid partition [1,2] and [3,4] has unequal sums."
    assert not answer_issues("Explain equal partition",text)


def test_user_array_is_authoritative_and_hint_is_not_lecture_testimony():
    assert answer_issues("Explain equal partition for array [2,3,3,4,5]",GOOD)
    assert not illustration_hint("Explain equal partition for array [2,3,3,4,5]")
    assert "not a quotation" in illustration_hint(QUESTION)


def test_explicit_complexity_section_is_added_from_primary_lecture(tmp_path):
    s=Settings(data_dir=tmp_path,backend="bm25",provider="none")
    chunks=[Chunk(id=str(i),kind="lecture",title="Partition equal subset sum",video_id="abcdefghijk",
        start=i*100,end=i*100+60,text="Partition equal subset sum "*20) for i in range(3)]
    chunks.append(Chunk(id="complexity",kind="lecture",title="Partition equal subset sum",video_id="abcdefghijk",
        start=420,end=480,text="The time complexity is n into target. Space complexity is target."))
    build_database(s.database,chunks,{})
    r=Retriever(s);hits=r.search("partition equal subset sum",2)
    assert all(h["chunk"].id!="complexity" for h in hits)
    result=complexity_context(AskRequest(question=QUESTION,top_k=2),hits,r)
    assert len(result)==2 and result[0]==hits[0] and result[-1]["chunk"].id=="complexity"


def run_generation(tmp_path,monkeypatch,bodies):
    s=Settings(data_dir=tmp_path,backend="bm25",provider="groq",llm_model="openai/gpt-oss-20b")
    build_index(s,demo=True);monkeypatch.setenv("GROQ_API_KEY","fixture-not-real")
    calls=[]
    def post(url,**kwargs):
        calls.append(kwargs["json"])
        body=bodies[min(len(calls)-1,len(bodies)-1)]
        return httpx.Response(200,request=httpx.Request("POST",url),json={"choices":[{"finish_reason":"stop","message":{"content":json.dumps({"no_evidence":False,"blocks":[{"text":body,"source_ids":[1]}]})}}]})
    monkeypatch.setattr(httpx,"post",post)
    # A deterministic retrieval fixture isolates generation verification from ranking.
    r=Retriever(s);r.refresh()
    original=r.search("memoization",1)
    monkeypatch.setattr(r,"search",lambda *a,**k:original)
    return answer_question(AskRequest(question=QUESTION),r,s),calls


def test_bad_example_is_corrected_once_before_display(tmp_path,monkeypatch):
    result,calls=run_generation(tmp_path,monkeypatch,[BAD,GOOD])
    assert len(calls)==2 and result["mode"]=="generated"
    assert "17" in calls[1]["messages"][-1]["content"]
    assert calls[1]["reasoning_effort"]=="medium"
    assert GOOD in result["answer"] and BAD not in result["answer"]


def test_second_bad_answer_is_never_shown_and_retry_is_bounded(tmp_path,monkeypatch):
    result,calls=run_generation(tmp_path,monkeypatch,[BAD,BAD])
    assert len(calls)==2 and result["mode"]=="evidence"
    assert "verification" in result["warning"] and BAD not in result["answer"]


def test_valid_example_does_not_trigger_an_extra_paid_call(tmp_path,monkeypatch):
    result,calls=run_generation(tmp_path,monkeypatch,[GOOD])
    assert len(calls)==1 and result["mode"]=="generated"


def test_binary_search_exact_count_is_distinct_from_halvings_or_a_trace():
    from app.verification import binary_search_issues
    assert binary_search_issues("binary search","The algorithm terminates in at most ⌈log₂ n⌉ steps.")
    assert binary_search_issues("binary search","Each step halves the range, leading to at most (log_2 n) steps.")
    assert binary_search_issues("binary search","What is the worst-case number of comparisons for an array of size 64? Answer: ⌈log₂ 64⌉ = 6 comparisons.")
    assert not binary_search_issues("binary search","O(log n) time. For this particular input, finding the middle value takes 1 comparison.")
    assert not binary_search_issues("binary search","The worst case requires at most O(log n) iterations.")
    assert not binary_search_issues("binary search","The worst-case array size 64 requires 7 iterations.")
    assert not binary_search_issues("binary search","Six halvings reduce a range of 64 elements to one.")
