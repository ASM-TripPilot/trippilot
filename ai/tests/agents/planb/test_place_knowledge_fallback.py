"""KB-5 대체 문서(장소 카드 + 웹 확인 사실) — 진짜 문서가 없는 자리에만, 점수로 겨루지 않고 붙는다(2026-10-23 · 10-30 개정).

기본은 꺼짐이다 — 켜기 전 측정 조건은 `place_fallback` docstring. 여기서는 켠 동작을 증명한다."""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path

import pytest

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from trippilot.agents.planb import place_knowledge as pk
from trippilot.agents.planb.kb_retrieval import index_documents
from trippilot.agents.planb.place_knowledge import MAX_DOC_CHARS, fetch_place_knowledge, kb5_counts
from trippilot.agents.planb.rag import RagContext
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.replan_composition import ComposeDayInput, build_compose_vars
from trippilot.orchestrator import place_intro as pi
from trippilot.orchestrator.place_intro import PlaceIntro
from trippilot.poi_curation import place_fallback
from trippilot.poi_curation.place_docs import make_doc

_PROMPTS = Path(__file__).resolve().parents[3] / "prompts"


@pytest.fixture(autouse=True)
def _on(monkeypatch):
    monkeypatch.setenv(place_fallback.SWITCH, "on")


def _poi(pid: str, ref: str | None) -> Poi:
    return Poi(poi_id=PoiId(pid), name=pid, category=PoiCategory.FOOD, coord=GeoPoint(37.5, 127.0), open_hours=(), avg_cost=None,
               rating=None, quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None, source_ref=ref)


def _store(*docs):
    embedding, store = FakeEmbedding(), InMemoryVectorStore()
    if docs:
        index_documents(docs, embedding, store)
    return embedding, store


def test_real_document_wins_and_the_gap_gets_the_fallback() -> None:
    embedding, store = _store(make_doc("overview", "ref-real", "수원 화성은 경기도 수원시에 있는 성곽이다."))
    fallback = {"ref-real": "경기 수원시 팔달구. 주차 가능.", "ref-card": "강원 춘천시 남산면. 대표메뉴 닭갈비."}
    got, _ = fetch_place_knowledge([_poi("p1", "ref-real"), _poi("p2", "ref-card"), _poi("p3", "ref-none")], "우천", embedding, store,
                                   fallback=fallback)
    assert got["ref-real"].startswith("수원 화성은")  # 카드가 개요를 밀어내지 않는다
    assert got["ref-card"] == "강원 춘천시 남산면. 대표메뉴 닭갈비."
    assert "ref-none" not in got


def test_counts_keep_real_documents_and_fallbacks_apart() -> None:
    """POI_DESC 는 적재 전·스토어 장애를 보는 칸이다 — 대체 문서가 섞이면 KB-5 가 비어도 숫자가 찬다."""
    embedding, store = _store(make_doc("overview", "r1", "수원 화성은 경기도 수원시에 있는 성곽이다."))
    got, _ = fetch_place_knowledge([_poi("p1", "r1"), _poi("p2", "r2"), _poi("p3", "r3")], "우천", embedding, store,
                                   fallback={"r2": "대표메뉴 국밥.", "r3": "대표메뉴 냉면."})
    assert kb5_counts(got) == {"POI_DESC": 1, "POI_DESC_FALLBACK": 2}
    assert RagContext(place_knowledge=got).counts()["POI_DESC"] == 1
    assert kb5_counts({"r1": "진짜"}) == {"POI_DESC": 1}  # 대체 문서가 없으면 종전 응답과 같다


def test_real_and_fallback_documents_share_the_max_docs_cap_in_shortlist_order(monkeypatch) -> None:
    monkeypatch.setattr(pk, "MAX_DOCS", 2)
    embedding, store = _store()
    pois = [_poi(f"p{i}", f"r{i}") for i in range(5)]
    got, _ = fetch_place_knowledge(pois, "우천", embedding, store, fallback={f"r{i}": f"대표메뉴 {i}." for i in range(5)})
    assert list(got) == ["r0", "r1"]


def test_fallback_documents_are_clipped_like_real_ones() -> None:
    embedding, store = _store()
    got, _ = fetch_place_knowledge([_poi("p1", "r1")], "우천", embedding, store, fallback={"r1": "가" * 400})
    assert len(got["r1"]) == MAX_DOC_CHARS


def test_switch_is_off_by_default(monkeypatch) -> None:
    monkeypatch.delenv(place_fallback.SWITCH)
    embedding, store = _store()
    got, _ = fetch_place_knowledge([_poi("p1", "r1")], "우천", embedding, store, fallback={"r1": "대표메뉴 국밥."})
    assert got == {} and kb5_counts(got) == {"POI_DESC": 0}


def test_store_failure_still_gives_the_fallback_and_says_so() -> None:
    class _Dead:
        def search(self, *a, **k):
            raise RuntimeError("vector store down")

    got, note = fetch_place_knowledge([_poi("p1", "r1")], "우천", FakeEmbedding(), _Dead(), fallback={"r1": "대표메뉴 국밥."})
    assert got == {"r1": "대표메뉴 국밥."} and "place_knowledge_unavailable" in note
    assert kb5_counts(got) == {"POI_DESC": 0, "POI_DESC_FALLBACK": 1}


def test_web_facts_follow_the_card_one_sentence_each_and_are_capped() -> None:
    text = place_fallback.compose("서울 송파구 삼전동.", ["소고기국밥이 대표 메뉴", "냉수육", "감자전", "포장 가능", "다섯째"])
    assert text == "서울 송파구 삼전동. 웹 확인: 소고기국밥이 대표 메뉴. 냉수육. 감자전. 포장 가능."
    assert place_fallback.compose("", ["바 좌석"]) == "웹 확인: 바 좌석."


def test_fallback_rides_the_doc_column_the_no_preference_rule_speaks_about() -> None:
    """구성 0.8.0 의 '설명이 붙었다는 이유로 우대하지 마세요'는 후보 줄 끝 설명 칸에 걸린다(KB-5 담당 세션 조건, 10-30) —
    대체 문서도 진짜 문서와 같은 그 칸으로만 가고, 렌더된 프롬프트에 그 규칙이 함께 실린다."""
    embedding, store = _store(make_doc("overview", "r1", "수원 화성은 경기도 수원시에 있는 성곽이다."))
    pois = (_poi("a1", "r1"), _poi("a2", "r2"))
    knowledge, _ = fetch_place_knowledge(pois, "우천", embedding, store, fallback={"r2": "대표메뉴 국밥. 주차 가능."})
    pool = CandidatePool(poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=datetime(2026, 10, 30, tzinfo=timezone.utc))
    inp = ComposeDayInput(date="2026-10-30 (목)", window="12:00~20:00", weather="정보 없음", reasons=(), directives=(),
                          user_request="", schedule=(), planb_picks=(), persona="", max_visits=3, change_rule="",
                          place_knowledge=knowledge)
    variables = build_compose_vars(pool, inp)
    lines = variables["candidates"].splitlines()
    assert lines[0].endswith(" | 수원 화성은 경기도 수원시에 있는 성곽이다.")
    assert lines[1].endswith(" | 대표메뉴 국밥. 주차 가능.")
    prompt, _ = PromptRegistry(_PROMPTS).render(LlmFeature.REPLAN_COMPOSITION, variables)
    assert "설명이 붙었다는 이유로 우대하지 마세요" in prompt and "| 대표메뉴 국밥. 주차 가능." in prompt


def test_place_intro_falls_back_to_the_local_document_when_the_store_is_slow(monkeypatch) -> None:
    gate = threading.Event()
    monkeypatch.setattr(pi, "fetch_place_knowledge", lambda *a, **k: (gate.wait(5), ({}, ""))[1])
    monkeypatch.setattr(place_fallback, "fallback_docs", lambda: {"r1": "대표메뉴 국밥. 매일 10:00 개점."})
    try:
        assert PlaceIntro(object(), object()).intro("r1", "소개", wait_s=0.05) == "대표메뉴 국밥."  # 소개 게이트도 지난다
    finally:
        gate.set()


def test_warm_reads_the_table_in_the_background_only_when_switched_on(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(place_fallback, "fallback_docs", lambda: calls.append(1) or {})
    place_fallback.warm()
    for t in threading.enumerate():
        if t.name == "kb5-fallback":
            t.join(2)
    assert calls == [1]
    monkeypatch.setenv(place_fallback.SWITCH, "off")
    place_fallback.warm()
    assert calls == [1]
