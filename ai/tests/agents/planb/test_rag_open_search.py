"""다시 짜기 후보 순위에 KB-5 문서 순위를 섞는다 (U4 FD 2026-11-04 — 측정 42 : 20, p≈0.008).

증명하는 것 (실 검색·LLM 0 — 검색기는 대역):
  ① 섞인 순위는 규칙 랭킹의 순열이다 — 후보를 만들거나 빼지 않는다(INV-1)
  ② 게이트 닫힘·검색 OK 아님이면 규칙 랭킹 그대로이고 상태를 돌려준다(INV-4)
  ③ 질의는 사용자 말이 사유의 필요를 이긴다 · 필요가 없는 사유는 말이 없으면 섞지 않는다
  ④ 에이전트: `fuse_docs` 이고 검색기가 있을 때만 순위가 바뀌고, 노트에 `open_search=…` 가 남는다
  ⑤ 배선: 스위치를 안 켜면 PlanB 에 검색기가 붙지 않는다
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
    """`PlaceSearch.search` 대역 — 정한 상태·문서 순위를 돌려주고 질의를 붙잡는다."""

    def __init__(self, status: str = "OK", ranks: dict[str, int] | None = None) -> None:
        self.status, self.ranks, self.queries = status, ranks or {}, []

    def search(self, query, scope_refs, wait_s, *, trace=""):
        self.queries.append((query, tuple(scope_refs), wait_s))
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
