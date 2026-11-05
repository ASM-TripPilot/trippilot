"""다시 짜기 후보 순위에 KB-5 문서 순위를 섞는다 (U4 FD 2026-11-04 — 측정 42 : 20, p≈0.008).

증명하는 것 (실 검색·LLM 0 — 검색기는 대역):
  ① 섞인 순위는 규칙 랭킹의 순열이다 — 후보를 만들거나 빼지 않는다(INV-1)
  ② 게이트 닫힘·검색 OK 아님이면 규칙 랭킹 그대로이고 상태를 돌려준다(INV-4)
  ③ 질의는 사용자 말이 사유의 필요를 이긴다 · 필요가 없는 사유는 말이 없으면 섞지 않는다
  ④ 에이전트: `fuse_docs` 이고 검색기가 있을 때만 순위가 바뀌고, 노트에 `open_search=…` 가 남는다
  ⑤ 배선: 스위치를 안 켜면 PlanB 에 검색기가 붙지 않는다
  ⑥ 미리 임베딩(`warm_docs`): 다시 짜기 진입에서 수집보다 먼저 띄우고, 검색은 같은 질의를 쓴다(이벤트 순서 — 시간 문턱 아님) ·
     미리 띄운 몫이 먼저 치워져도 검색은 임베딩 캐시(`CachingEmbedding`)에서 집어 다시 임베딩하지 않는다
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from hypothesis import given
from hypothesis import strategies as st

from tests.agents.planb.test_planb_rag import _NOW, _SMALL, _poi, _request
from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from trippilot.agents.planb import rag
from trippilot.domain.llm.llm import CandidatePool
from trippilot.poi_curation import hybrid_rank

_IDS = tuple(f"p{i}" for i in range(8))


def _pool(*ids: str) -> CandidatePool:
    pois = tuple(replace(_poi(i), source_ref=f"r-{i}") for i in ids)
    return CandidatePool(poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=_NOW)


class _Search:
    """`PlaceSearch` 대역 — 정한 상태·문서 순위를 돌려주고 질의를 붙잡는다. `events` = 미리 임베딩·검색이 불린 순서(질의 문자열과 함께)."""

    def __init__(self, status: str = "OK", ranks: dict[str, int] | None = None, events: list | None = None) -> None:
        self.status, self.ranks, self.queries = status, ranks or {}, []
        self.events = events if events is not None else []

    def warm(self, query):
        self.events.append(("warm", query.text))

    def search(self, query, scope_refs, wait_s, *, trace=""):
        self.queries.append((query, tuple(scope_refs), wait_s))
        self.events.append(("search", query.text))
        return self.status, self.ranks


@given(st.permutations(_IDS), st.dictionaries(st.sampled_from([f"r-{i}" for i in _IDS]), st.integers(0, 20), max_size=8))
def test_섞인_순위는_규칙_랭킹의_순열이다(ranked, ranks) -> None:
    fused, status = rag.fuse_rule_ranking(_Search("OK", ranks), _pool(*_IDS), tuple(ranked), "비를 피해 실내", 1.0)
    assert status == "OK" and sorted(fused) == sorted(ranked)


def test_문서_순위가_있는_곳이_앞으로_온다() -> None:
    ranked = _IDS
    fused, _ = rag.fuse_rule_ranking(_Search("OK", {"r-p7": 0, "r-p6": 1}), _pool(*_IDS), ranked, "조용한 북카페", 1.0)
    assert fused[:2] == ("p7", "p6") and fused != ranked


@pytest.mark.parametrize("status", ["NO_EVIDENCE", "TIMEOUT", "BUSY", "ERROR", "EMPTY"])
def test_검색이_OK_가_아니면_규칙_랭킹_그대로(status) -> None:
    assert rag.fuse_rule_ranking(_Search(status, {"r-p7": 0}), _pool(*_IDS), _IDS, "조용한 북카페", 1.0) == (_IDS, status)


def test_게이트가_닫히면_검색하지_않고_그대로() -> None:
    search = _Search("OK", {"r-p7": 0})
    for text in ("", "가볼 만한 곳 추천"):  # 묘사 낱말 없음
        assert rag.fuse_rule_ranking(search, _pool(*_IDS), _IDS, text, 1.0) == (_IDS, "GATE_CLOSED")
    assert search.queries == []


def _agent(search) -> rag.PlanBAgent:
    return rag.PlanBAgent(FakeEmbedding(dim=_SMALL), InMemoryVectorStore(), place_search=search)


def _run(search, *, fuse_docs: bool, reason: str = "weather", said: str = "") -> rag.PlanBRagResult:
    request = replace(_request(_pool(*_IDS), reason=reason), use_llm=False, fuse_docs=fuse_docs, user_request=said)
    return _agent(search).run(request)


def test_fuse_docs_가_아니면_검색기가_있어도_순위는_그대로() -> None:
    base = _run(None, fuse_docs=True)
    search = _Search("OK", {"r-p7": 0})
    assert _run(search, fuse_docs=False).ranked_poi_ids == base.ranked_poi_ids and search.queries == []
    assert _run(None, fuse_docs=True).ranked_poi_ids == base.ranked_poi_ids  # 검색기 없음 = 꺼짐


def test_fuse_docs_면_순위가_섞이고_노트에_상태가_남는다() -> None:
    base = _run(None, fuse_docs=True)
    out = _run(_Search("OK", {"r-p7": 0}), fuse_docs=True)
    assert out.ranked_poi_ids[0] == "p7" and sorted(out.ranked_poi_ids) == sorted(base.ranked_poi_ids)
    assert any("open_search=OK" in n for n in out.notes)


def test_질의는_사용자_말이_사유의_필요를_이긴다() -> None:
    search = _Search("OK", {})
    _run(search, fuse_docs=True, said="조용한 북카페")
    _run(search, fuse_docs=True)
    assert [q.text for q, _, _ in search.queries] == [
        hybrid_rank.open_query("조용한 북카페", None, generic=hybrid_rank.GENERIC_WORDS).text,
        hybrid_rank.open_query(rag.REASON_NEED["weather"], None, generic=hybrid_rank.GENERIC_WORDS).text]


def test_필요가_없는_사유는_말이_없으면_섞지_않는다() -> None:
    search = _Search("OK", {"r-p7": 0})
    out = _run(search, fuse_docs=True, reason="closed")
    assert search.queries == [] and any("open_search=GATE_CLOSED" in n for n in out.notes)


def test_스위치를_안_켜면_PlanB_에_검색기가_붙지_않는다(monkeypatch) -> None:
    from trippilot.agents.planb.place_search import PlaceSearch, wire

    monkeypatch.delenv(hybrid_rank.SWITCH, raising=False)
    assert wire(FakeEmbedding(dim=_SMALL), InMemoryVectorStore()) == (None, f"{hybrid_rank.SWITCH} 꺼짐")
    monkeypatch.setenv(hybrid_rank.SWITCH, "on")
    assert wire(FakeEmbedding(dim=_SMALL), None)[0] is None
    assert isinstance(wire(FakeEmbedding(dim=_SMALL), InMemoryVectorStore())[0], PlaceSearch)


@pytest.mark.parametrize("switch, wired", [(None, False), ("on", True)])
def test_조립이_스위치대로_PlanB_에_검색기를_붙인다(monkeypatch, switch, wired) -> None:
    from trippilot.agents.planb.place_search import PlaceSearch
    from trippilot.api import wiring

    if switch is None:
        monkeypatch.delenv(hybrid_rank.SWITCH, raising=False)
    else:
        monkeypatch.setenv(hybrid_rank.SWITCH, switch)
    seen: list = []
    real = wiring.PlanBAgent
    monkeypatch.setattr(wiring, "PlanBAgent", lambda *a, **kw: seen.append(kw.get("place_search")) or real(*a, **kw))
    wiring.build_dev_app(model_id="m", vector_store=InMemoryVectorStore(), embedding=FakeEmbedding(dim=_SMALL))
    assert len(seen) == 1 and isinstance(seen[0], PlaceSearch) is wired


def _doc_text(said: str, reason: str = "weather") -> str:
    return hybrid_rank.open_query(said or rag.REASON_NEED[reason], None, generic=hybrid_rank.GENERIC_WORDS).text


@pytest.mark.parametrize("said", ["", "조용한 북카페"])
def test_미리_임베딩한_질의를_검색이_그대로_쓴다(said) -> None:
    search = _Search("OK", {})
    agent = _agent(search)
    agent.warm_docs(said, "weather")
    agent.run(replace(_request(_pool(*_IDS), reason="weather"), use_llm=False, fuse_docs=True, user_request=said))
    assert search.events == [("warm", _doc_text(said)), ("search", _doc_text(said))]


def test_검색기가_없거나_게이트가_닫히면_미리_임베딩하지_않는다() -> None:
    _agent(None).warm_docs("조용한 북카페", "weather")  # 검색기 없음 — 아무것도 하지 않는다(던지지 않는다)
    search = _Search("OK", {})
    _agent(search).warm_docs("", "closed")  # 말도 필요도 없다 — 검색도 게이트에서 닫힌다
    _agent(search).warm_docs("가볼 만한 곳 추천", "weather")  # 묘사 낱말 없는 말이 필요를 이긴다 — 검색도 GATE_CLOSED
    assert search.events == []


def test_미리_띄운_몫이_치워져도_검색은_임베딩_캐시에서_집는다() -> None:
    """운영 임베딩은 `CachingEmbedding`(main.py `_vector_backend`)이다. 끝난 미리 임베딩은 다음 `warm` 이 치운다(다른 요청) — 그때
    검색은 직접 임베딩하는데, 같은 문자열이라 캐시에 걸려 안쪽 임베딩은 한 번뿐이다."""
    from tests.agents.planb.test_place_search import _Embedding, _Store
    from trippilot.agents.planb.place_search import PlaceSearch
    from trippilot.llm_gateway.adapters.caching_embedding import CachingEmbedding

    inner = _Embedding()
    searcher = PlaceSearch(CachingEmbedding(inner), _Store({"overview:r-p7#0": ("r-p7", "조용한 북카페")}),
                           index=lambda: {"r-p7": ("overview:r-p7#0",)})
    agent = _agent(searcher)
    agent.warm_docs("조용한 북카페", "weather")
    searcher._warming[_doc_text("조용한 북카페")].result(timeout=2.0)  # noqa: SLF001 — 미리 임베딩이 끝날 때까지(시간 문턱 대신)
    searcher.warm(hybrid_rank.OpenQuery(("다른",), "다른 질의"))  # 다른 요청의 미리 임베딩 — 끝난 몫을 치운다
    assert _doc_text("조용한 북카페") not in searcher._warming  # noqa: SLF001
    out = agent.run(replace(_request(_pool(*_IDS), reason="weather"), use_llm=False, fuse_docs=True,
                            user_request="조용한 북카페"))
    assert any("open_search=OK" in n for n in out.notes), out.notes
    assert inner.calls.count(_doc_text("조용한 북카페")) == 1, inner.calls


def test_다시_짜기는_진입에서_질의를_미리_임베딩하고_검색이_같은_질의를_쓴다(monkeypatch) -> None:
    """미리 임베딩이 장소 수집(`InfoCollector.collect`)보다 먼저 불려야 수집과 겹친다 — 순서는 이벤트로 본다."""
    from fastapi.testclient import TestClient

    from tests.api.test_api_replan_wired import _DIRECTIVES, _body
    from trippilot.api import wiring

    events: list = []
    monkeypatch.setattr(wiring, "wire_place_search", lambda embedding, store: (_Search("OK", {}, events), ""))
    app = wiring.build_dev_app(directives=_DIRECTIVES)
    info = app.state.orchestrator._info  # noqa: SLF001
    real = info.collect
    monkeypatch.setattr(info, "collect", lambda *a, **kw: events.append(("collect", "")) or real(*a, **kw))
    for said in (None, "조용한 북카페"):
        events.clear()
        with TestClient(app) as client:
            assert client.post("/ai/v1/planb/replan", json=_body(free_text=said)).status_code == 200
        text = _doc_text(said or "")
        assert events[0] == ("warm", text), events
        assert [e for e in events if e[0] != "collect"] == [("warm", text), ("search", text)], events
        assert events.index(("collect", "")) < events.index(("search", text)), events


def test_구성_LLM_이_없으면_진입에서_미리_임베딩하지_않는다(monkeypatch) -> None:
    """문서 순위를 섞는 조건(`fuse_docs` = 구성 LLM 있음)과 미리 임베딩 조건이 같다 — 안 섞을 질의를 임베딩하지 않는다."""
    from fastapi.testclient import TestClient

    from tests.api.test_api_replan_wired import _DIRECTIVES, _body
    from trippilot.api import wiring

    events: list = []
    monkeypatch.setattr(wiring, "wire_place_search", lambda embedding, store: (_Search("OK", {}, events), ""))
    app = wiring.build_dev_app(directives=_DIRECTIVES)
    app.state.orchestrator._composer = None  # noqa: SLF001
    with TestClient(app) as client:
        assert client.post("/ai/v1/planb/replan", json=_body()).status_code == 200
    assert events == []
