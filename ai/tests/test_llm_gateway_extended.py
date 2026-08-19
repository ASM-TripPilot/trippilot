"""U6-02(TRIP-243) — 확장 워커 3종: Explanation·Reflection·PlaceExtraction.

게이트: EXPLANATION은 closed-set 교차(INV-1), REFLECTION은 스키마만,
PLACE_EXTRACTION은 항목 단위 격리(전체 실패 아님 — 정본 §2.5 폴백 정책).
워커: 조립 → gateway.call, 폴백 TypedResult 그대로 (BR-U4-09).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from hypothesis import given

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.context import ContextResolver
from trippilot.llm_gateway.gates.explanation import ExplanationGate
from trippilot.llm_gateway.gates.place_extraction import PlaceExtractionGate
from trippilot.llm_gateway.gates.reflection import ReflectionGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.explanation import ExplanationWorker
from trippilot.llm_gateway.workers.place_extraction import PlaceExtractionWorker
from trippilot.llm_gateway.workers.reflection import ReflectionInput, ReflectionWorker
from trippilot.domain.common import BudgetLevel, TraceId
from trippilot.domain.context import Principal, ResourceRef
from trippilot.domain.llm import (
    CandidatePool,
    LlmFeature,
    ModelTier,
    Mood,
    PoiExplanation,
    ReflectionDraft,
)
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from trippilot.domain.poi import ExtractedPlace
from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.poi import candidate_pools

_NOW = datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc)
_TID = TraceId("t-u6")
_FEAT_EXP = LlmFeature.EXPLANATION
_PERSONA = PersonaSummary(
    taste_tags=(TasteTag.NATURE,), companion=CompanionType.SOLO, budget=BudgetLevel.LOW
)
_PRINCIPAL = Principal(user_id="u-owner")
_REF = ResourceRef(kind="persona", ref_id="p1", owner_id="u-owner")
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})


class _Store:
    def __init__(self, value):
        self._v = value

    def get(self, ref):
        return self._v


def _facade(llm, gate):
    return GatewayFacade(llm, PromptRegistry(_PROMPTS), gate, _CFG, InMemoryTrace())


# ── ExplanationGate: closed-set 교차 ─────────────────────────


@given(candidate_pools().filter(lambda p: bool(p.poi_ids)))
def test_explanation_gate_drops_out_of_pool(pool: CandidatePool) -> None:
    pid = str(sorted(pool.poi_ids, key=str)[0])
    raw = json.dumps(
        {"explanations": [
            {"poiId": pid, "text": "취향에 맞는 곳입니다. 분위기가 좋아요."},
            {"poiId": "유령장소", "text": "환각 설명"},
        ]}
    )
    out = ExplanationGate().apply(raw, pool, feature=_FEAT_EXP, trace_id=_TID, now=_NOW)
    assert out.error is None
    assert [str(e.poi_id) for e in out.value] == [pid]
    assert out.drop_event is not None and out.drop_event.dropped_count == 1


def test_explanation_gate_schema_and_pool_guard() -> None:
    g = ExplanationGate()
    assert g.apply("깨짐", None, feature=_FEAT_EXP, trace_id=_TID, now=_NOW).error.startswith("gate_error:")
    pool = _tiny_pool()
    assert g.apply("깨짐", pool, feature=_FEAT_EXP, trace_id=_TID, now=_NOW).error.startswith("parse_error:")
    bad = json.dumps({"explanations": [{"poiId": "p1", "text": "  "}]})
    assert g.apply(bad, pool, feature=_FEAT_EXP, trace_id=_TID, now=_NOW).error is not None


# ── ReflectionGate: 스키마 강제 (풀 불필요) ──────────────────


def test_reflection_gate_valid_and_invalid() -> None:
    g = ReflectionGate()
    ok = json.dumps(
        {"title": "대전의 하루", "body": "성심당에서 빵을 먹었다. 좋았다. 또 가고 싶다.",
         "highlights": ["성심당"], "mood": "GREAT"}
    )
    out = g.apply(ok, None, feature=LlmFeature.REFLECTION, trace_id=_TID, now=_NOW)
    assert out.error is None
    assert isinstance(out.value, ReflectionDraft) and out.value.mood is Mood.GREAT

    bad_mood = json.dumps({"title": "t", "body": "b", "highlights": [], "mood": "AMAZING"})
    assert g.apply(bad_mood, None, feature=LlmFeature.REFLECTION, trace_id=_TID, now=_NOW).error is not None
    assert g.apply("텍스트", None, feature=LlmFeature.REFLECTION, trace_id=_TID, now=_NOW).error is not None


def test_reflection_draft_roundtrip() -> None:
    d = ReflectionDraft(title="t", body="b", highlights=("a", "b"), mood=Mood.TIRED)
    assert ReflectionDraft.from_dict(d.to_dict()) == d


# ── PlaceExtractionGate: 항목 단위 격리 ──────────────────────


def test_extraction_gate_isolates_bad_items_keeps_good() -> None:
    raw = json.dumps({"places": [
        {"name": "성심당", "address": "대전 중구", "coord": {"lat": 36.3, "lng": 127.4},
         "hours": None, "category": "빵집", "confidence": 1.7, "sourceUrl": "https://x"},
        {"name": "좌표오염", "address": None, "coord": {"lat": 999, "lng": 0},
         "hours": None, "category": None, "confidence": 0.9, "sourceUrl": "https://y"},
        {"address": "이름 없음", "confidence": 0.5, "sourceUrl": "https://z"},
    ]})
    out = PlaceExtractionGate().apply(
        raw, None, feature=LlmFeature.PLACE_EXTRACTION, trace_id=_TID, now=_NOW
    )
    assert out.error is None
    assert len(out.value) == 1 and isinstance(out.value[0], ExtractedPlace)
    assert out.value[0].confidence == 1.0  # 클램프
    assert out.value[0].category_raw == "빵집"
    assert out.drop_event is not None and out.drop_event.dropped_count == 2


def test_extraction_gate_nulls_preserved_and_top_level_strict() -> None:
    g = PlaceExtractionGate()
    ok = json.dumps({"places": [
        {"name": "주소만 있는 곳", "address": "제주 서귀포", "coord": None,
         "hours": None, "category": None, "confidence": 0.4, "sourceUrl": "https://b"},
    ]})
    out = g.apply(ok, None, feature=LlmFeature.PLACE_EXTRACTION, trace_id=_TID, now=_NOW)
    assert out.error is None and out.value[0].coord is None  # 좌표 임의 생성 없음
    assert g.apply("[]", None, feature=LlmFeature.PLACE_EXTRACTION, trace_id=_TID, now=_NOW).error is not None


def test_extracted_place_roundtrip() -> None:
    p = ExtractedPlace(name="n", address=None, coord=None, hours="10-22",
                       category_raw=None, confidence=0.5, source_url="https://s")
    assert ExtractedPlace.from_dict(p.to_dict()) == p


# ── 워커 e2e (실물 레지스트리·게이트) ────────────────────────


def _tiny_pool() -> CandidatePool:
    from trippilot.domain.common import GeoPoint, PoiId  # noqa: PLC0415
    from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource  # noqa: PLC0415

    p1 = Poi(poi_id=PoiId("p1"), name="성심당", category=PoiCategory.FOOD,
             coord=GeoPoint(36.3, 127.4), open_hours=(), avg_cost=None, rating=None,
             quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None)
    return CandidatePool(poi_ids=frozenset({PoiId("p1")}), pois=(p1,), generated_at=_NOW)


def test_explanation_worker_end_to_end() -> None:
    from trippilot.domain.common import PoiId  # noqa: PLC0415

    pool = _tiny_pool()
    canned = json.dumps({"explanations": [{"poiId": "p1", "text": "자연 취향에 맞아요. 여유로워요."}]})
    worker = ExplanationWorker(_facade(FakeLlm(canned=canned), ExplanationGate()))
    result = worker.explain(pool, (PoiId("p1"),), _PERSONA, _TID, _NOW)
    assert result.is_fallback is False
    assert isinstance(result.value[0], PoiExplanation)


def test_reflection_worker_end_to_end_and_fallback() -> None:
    canned = json.dumps({"title": "하루", "body": "좋은 하루였다. 많이 걸었다. 만족.",
                         "highlights": ["성심당"], "mood": "GOOD"})
    inp = ReflectionInput(visited=("성심당 (40분)",), distance_km=5.2, photo_count=12,
                          planb_applied=True, weather="맑음")
    ok = ReflectionWorker(_facade(FakeLlm(canned=canned), ReflectionGate())).reflect(inp, _TID, _NOW)
    assert ok.is_fallback is False and ok.value.mood is Mood.GOOD

    fb = ReflectionWorker(_facade(FailingLlm(), ReflectionGate())).reflect(inp, _TID, _NOW)
    assert fb.is_fallback is True and fb.value is None  # FallbackCard는 호출측


def test_extraction_worker_end_to_end() -> None:
    canned = json.dumps({"places": [
        {"name": "숨은 카페", "address": None, "coord": None, "hours": None,
         "category": "카페", "confidence": 0.6, "sourceUrl": "https://blog"},
    ]})
    result = PlaceExtractionWorker(_facade(FakeLlm(canned=canned), PlaceExtractionGate())).extract(
        "블로그 본문...", "제주", "카페", _TID, _NOW
    )
    assert result.is_fallback is False and result.value[0].name == "숨은 카페"


def test_registry_loads_all_four_features() -> None:
    reg = PromptRegistry(_PROMPTS)
    for feature, variables in [
        (LlmFeature.EXPLANATION, {"taste_tags": "x", "companion": "SOLO", "slots": "1. p"}),
        (LlmFeature.REFLECTION, {"visited": "v", "distance_km": "1.0", "photo_count": "3",
                                 "planb": "없음", "weather": "맑음"}),
        (LlmFeature.PLACE_EXTRACTION, {"document": "d", "region": "제주", "category": "카페"}),
    ]:
        prompt, ref = reg.render(feature, variables)
        assert ref.version == "0.1.0" and feature.value == ref.feature
        assert "JSON" in prompt


# ── TRIP-260 리뷰 후속 회귀 ──────────────────────────────────


def test_extraction_gate_bool_coord_is_isolated() -> None:
    """TRIP-260 #1: bool ⊂ int라 GeoPoint 범위 검사를 통과하던 구멍."""
    raw = json.dumps({"places": [
        {"name": "불좌표", "address": None, "coord": {"lat": True, "lng": 0},
         "hours": None, "category": None, "confidence": 0.5, "sourceUrl": "https://x"},
    ]})
    out = PlaceExtractionGate().apply(
        raw, None, feature=LlmFeature.PLACE_EXTRACTION, trace_id=_TID, now=_NOW
    )
    assert out.value == () and out.drop_event.dropped_count == 1


def test_extraction_drop_event_has_no_pseudo_ids() -> None:
    """TRIP-260 #3: 드롭 항목의 장소명/item[i]가 PoiId 지표를 오염하지 않는다."""
    raw = json.dumps({"places": [{"confidence": 0.5, "sourceUrl": "https://z"}]})
    out = PlaceExtractionGate().apply(
        raw, None, feature=LlmFeature.PLACE_EXTRACTION, trace_id=_TID, now=_NOW
    )
    assert out.drop_event.dropped_ids == () and out.drop_event.dropped_count == 1
