"""다시 짜기 자유입력의 종류 조건 — "카페는 두 군데만"·"카페로만" (2026-10-15 사용자 요청).

LLM 이 뽑고(게이트가 모양만), 후보 풀로 검증하고, **코드가 구성 결과를 맞춘다** — 구성 LLM 이 조건을
안 따라도 최종 일정이 조건을 지켜야 한다.
"""

from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from trippilot.agents.planb import request_verification as v
from trippilot.api.wiring import DEMO_ANCHOR, StaticPoiDb, build_dev_app, demo_poi_seed
from trippilot.domain.common import GeoPoint, PoiId, TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.gates.replan_request_extraction import (
    ExtractedCategory, ExtractedRequest, ReplanRequestExtractionGate,
)

from tests.api.test_api_replan_wired import _DIRECTIVES, _body
from tests.agents.planb.test_replan_nl_request import _StubExtractor


def _gate(raw: str):
    from datetime import datetime
    return ReplanRequestExtractionGate().apply(
        raw, None, feature=LlmFeature.REPLAN_REQUEST_EXTRACTION, trace_id=TraceId("t"),
        now=datetime(2026, 9, 21))


# ── ① 게이트 — 모양만 ─────────────────────────────────────────────

def test_gate_reads_categories_counts_and_only() -> None:
    out = _gate('{"places": [], "categories": [{"category": "CAFE", "count": 2},'
                ' {"category": "FOOD", "count": null}], "only": true}').value
    assert out.categories == (ExtractedCategory("CAFE", 2), ExtractedCategory("FOOD", None))
    assert out.only is True and not out.empty


def test_gate_drops_unknown_category_and_bad_count_and_only_without_categories() -> None:
    out = _gate('{"places": [], "categories": [{"category": "CLUB", "count": 1},'
                ' {"category": "CAFE", "count": 0}, {"category": "FOOD", "count": "2"},'
                ' {"category": "SIGHT", "count": true}], "only": true}').value
    assert out.categories == () and out.only is False  # 종류가 하나도 없으면 "only" 도 없다
    assert out.empty


# ── ② 검증 — 후보 풀에 그 종류가 있는가 ──────────────────────────────

def test_category_missing_from_pool_is_rejected_and_only_lifts_with_it() -> None:
    ex = ExtractedRequest(categories=(ExtractedCategory("CAFE", 2), ExtractedCategory("SHOPPING")), only=True)
    only, counts, notes = v.verify_categories(ex, frozenset({PoiCategory.CAFE, PoiCategory.FOOD}))
    assert only == {PoiCategory.CAFE} and counts == ((PoiCategory.CAFE, 2),)
    assert "nl_category_rejected: SHOPPING no_candidates" in notes
    only, counts, _ = v.verify_categories(ex, frozenset({PoiCategory.FOOD}))
    assert only == frozenset() and counts == ()  # 따를 수 없는 "카페로만"은 빈 하루를 만든다 — 풀어 준다


# ── ③ 맞추기 — 구성 LLM 이 안 따라도 ──────────────────────────────

_CAT = {PoiId(f"c{i}"): PoiCategory.CAFE for i in range(1, 6)} | {
    PoiId(f"f{i}"): PoiCategory.FOOD for i in range(1, 4)} | {PoiId("s1"): PoiCategory.SIGHT}


def _apply(picks, *, only=frozenset(), counts=(), fill=(), keep=()):
    return v.apply_counts([PoiId(p) for p in picks], only=only, counts=counts, category_of=_CAT,
                          fill=[PoiId(p) for p in fill], keep=[PoiId(k) for k in keep])


def test_count_trims_extra_from_the_back_and_keeps_other_kinds() -> None:
    out, notes = _apply(["c1", "f1", "c2", "c3", "s1"], counts=((PoiCategory.CAFE, 2),))
    assert out == ("c1", "f1", "c2", "s1") and notes == []


def test_count_fills_missing_from_the_fill_order_and_reports_shortfall() -> None:
    out, notes = _apply(["f1"], counts=((PoiCategory.CAFE, 2),), fill=["s1", "c4", "c5"])
    assert out == ("f1", "c4", "c5")
    out, notes = _apply(["f1"], counts=((PoiCategory.CAFE, 2),), fill=["c4"])
    assert out == ("f1", "c4") and notes == ["nl_category_short: CAFE 1/2"]


def test_only_drops_other_kinds_but_a_named_place_stays() -> None:
    out, _ = _apply(["c1", "f1", "s1", "c2"], only=frozenset({PoiCategory.CAFE}), keep=["s1"])
    assert out == ("c1", "s1", "c2")


# ── ④ 배선 — 최종 일정 ─────────────────────────────────────────────

def _poi(pid: str, name: str, lat: float, cat: PoiCategory) -> Poi:
    return Poi(poi_id=PoiId(pid), name=name, category=cat, coord=GeoPoint(lat, DEMO_ANCHOR.lng),
               open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL,
               source=PoiSource.SEED, confidence=None)


# 앵커 근처 카페 6·맛집 6·문화 4 — 실내라 기본 바디의 우천 사유(실외 회피)에 안 걸린다.
_NEAR = (*(_poi(f"cafe{i}", f"카페{i}", DEMO_ANCHOR.lat + 0.003 * i, PoiCategory.CAFE) for i in range(1, 7)),
         *(_poi(f"food{i}", f"식당{i}", DEMO_ANCHOR.lat - 0.003 * i, PoiCategory.FOOD) for i in range(1, 7)),
         *(_poi(f"cult{i}", f"전시{i}", DEMO_ANCHOR.lat + 0.004 * i + 0.001, PoiCategory.CULTURE)
           for i in range(1, 5)))


class _MixComposer:
    """조건을 무시하는 구성 LLM — `want` 에 맞는 곳을 숏리스트 순서로 고른다."""

    def __init__(self, want) -> None:
        self.want, self.shortlists = want, []

    def compose(self, pool, inp, trace_id, now, *, timeout_sec=None):
        self.shortlists.append(({p.category for p in pool.pois}, inp.directives))
        picks = tuple(SimpleNamespace(poi_id=p.poi_id, reason="r") for p in pool.pois if self.want(p))[:6]
        return TypedResult(value=picks, is_fallback=False, error=None, call_record=None)


def _run(extracted: ExtractedRequest, composer=None):
    app = build_dev_app(directives=_DIRECTIVES, poi_db=StaticPoiDb(demo_poi_seed() + _NEAR))
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(extracted)
    orch._composer = composer
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ai/v1/planb/replan", json=_body(free_text="카페 조건"))
    assert r.status_code == 200, r.text
    body = r.json()
    cats = {p.poi_id: p.category for p in (*demo_poi_seed(), *_NEAR)}
    placed = [cats[PoiId(s["poi_id"])] for d in body["itinerary"]["days"] for s in d["slots"]]
    return body, placed


def test_cafe_only_day_is_all_cafes_even_when_the_composer_picks_others() -> None:
    composer = _MixComposer(lambda p: True)
    body, placed = _run(ExtractedRequest(categories=(ExtractedCategory("CAFE"),), only=True), composer)
    assert placed and set(placed) == {PoiCategory.CAFE}, body["notes"]
    seen, directives = composer.shortlists[0]
    assert seen == {PoiCategory.CAFE}  # 다른 종류는 후보에서부터 빠진다
    assert "CAFE 곳만" in directives  # 구성 LLM 에게도 알린다


def test_two_cafes_means_exactly_two_whether_the_composer_picks_too_many_or_none() -> None:
    ask = ExtractedRequest(categories=(ExtractedCategory("CAFE", 2),))
    body, placed = _run(ask, _MixComposer(lambda p: p.category is PoiCategory.CAFE))
    assert placed.count(PoiCategory.CAFE) == 2, body["notes"]
    body, placed = _run(ask, _MixComposer(lambda p: p.category is not PoiCategory.CAFE))
    assert placed.count(PoiCategory.CAFE) == 2, body["notes"]
    assert any(n.startswith("nl_category_applied") for n in body["notes"])


def test_cafe_only_holds_without_the_composer_too() -> None:
    body, placed = _run(ExtractedRequest(categories=(ExtractedCategory("CAFE"),), only=True))
    assert placed and set(placed) == {PoiCategory.CAFE}, body["notes"]


def test_kind_missing_from_the_pool_is_noted_and_the_day_still_comes_back() -> None:
    body, placed = _run(ExtractedRequest(categories=(ExtractedCategory("SHOPPING"),), only=True),
                        _MixComposer(lambda p: True))
    assert "nl_category_rejected: SHOPPING no_candidates" in body["notes"]
    assert placed  # 따를 수 없는 조건이 빈 하루를 만들지 않는다
