import hashlib
import httpx
import pytest
from app.bootstrap import download_index
from app.cli import build_index
from app.config import Settings
from app.retrieval import Retriever


def test_semantic_fusion_and_cutoff_with_fixture_vectors(tmp_path,monkeypatch):
    np=pytest.importorskip("numpy")
    import app.cli as cli
    import app.retrieval as retrieval
    settings=Settings(data_dir=tmp_path,provider="none",backend="bm25",qdrant_url="")
    # The second demo chunk is hashing; query vector selects it independent of lexical terms.
    def documents(texts,model):
        x=np.zeros((len(texts),2),dtype=np.float32)
        x[:,1]=1
        x[1]=[1,0]
        return x
    monkeypatch.setattr(cli,"embed",documents)
    build_index(settings,demo=True,semantic=True)
    settings.backend="hybrid"
    monkeypatch.setattr(retrieval,"embed",lambda text,model:np.array([[1,0]],dtype=np.float32))
    r=Retriever(settings)
    hits=r.search("frequency lookup",top_k=1)
    assert hits[0]["chunk"].id=="note-hashing"
    assert hits[0]["semantic_score"]==1.0
    monkeypatch.setattr(retrieval,"embed",lambda text,model:np.array([[-1,0]],dtype=np.float32))
    assert r.search("income tax filing")==[]


def test_qdrant_query_contract_with_fixture_vectors(tmp_path,monkeypatch):
    np=pytest.importorskip("numpy")
    import app.cli as cli
    import app.retrieval as retrieval
    from app.store import load_database,build_database
    settings=Settings(data_dir=tmp_path,provider="none",backend="bm25",qdrant_url="")
    vectors=np.ones((22,2),dtype=np.float32)/np.sqrt(2)
    monkeypatch.setattr(cli,"embed",lambda texts,model:vectors)
    build_index(settings,demo=True,semantic=True)
    chunks,_,metadata=load_database(settings.database)
    metadata["qdrant_collection"]="fixture_collection"
    build_database(settings.database,chunks,metadata,vectors)
    settings.backend="hybrid"
    settings.qdrant_url="https://qdrant.example"
    monkeypatch.setattr(retrieval,"embed",lambda texts,model:np.array([[1,0]],dtype=np.float32))
    calls=[]
    def post(url,**kwargs):
        calls.append((url,kwargs["json"]))
        return httpx.Response(200,json={"result":{"points":[{"score":.8,"payload":{"chunk_id":"note-hashing"}}]}},request=httpx.Request("POST",url))
    monkeypatch.setattr(httpx,"post",post)
    assert Retriever(settings).search("frequency lookup",1)[0]["chunk"].id=="note-hashing"
    assert calls[0][0].endswith("/collections/fixture_collection/points/query")
    assert calls[0][1]["with_payload"] is True


def test_verified_index_download_and_checksum_failure(tmp_path,monkeypatch):
    source=Settings(data_dir=tmp_path/"source",backend="bm25",provider="none")
    build_index(source,demo=True)
    content=source.database.read_bytes()
    class Response:
        def __enter__(self):return self
        def __exit__(self,*a):pass
        def raise_for_status(self):pass
        def iter_bytes(self):yield content
    monkeypatch.setattr(httpx,"stream",lambda *a,**k:Response())
    monkeypatch.setenv("INDEX_DOWNLOAD_URL","https://artifact.example/index.sqlite3")
    monkeypatch.setenv("INDEX_SHA256",hashlib.sha256(content).hexdigest())
    dest=Settings(data_dir=tmp_path/"destination",backend="bm25",provider="none")
    download_index(dest)
    assert dest.database.read_bytes()==content
    monkeypatch.setenv("INDEX_SHA256","0"*64)
    fail=Settings(data_dir=tmp_path/"fail",backend="bm25",provider="none")
    with pytest.raises(ValueError,match="checksum mismatch"):
        download_index(fail)
    assert not fail.database.exists()
