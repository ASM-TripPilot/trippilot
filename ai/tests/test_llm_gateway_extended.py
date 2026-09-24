"""U6-02(TRIP-243) — 확장 워커 3종: Explanation·Reflection·PlaceExtraction.

게이트: EXPLANATION은 closed-set 교차(INV-1),
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
from trippilot.llm_gateway.gates.explanation import (
    HASHTAG_COUNT,
    HASHTAG_MAX_LEN,
    ExplanationGate,
)
from trippilot.llm_gateway.gates.place_extraction import PlaceExtractionGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.explanation import ExplanationWorker
from trippilot.llm_gateway.workers.place_extraction import PlaceExtractionWorker
from trippilot.domain.common import BudgetLevel, PoiId, TraceId
from trippilot.domain.context import Principal, ResourceRef
from trippilot.domain.llm import (
    CandidatePool,
    LlmFeature,
    ModelTier,
    PoiExplanation,
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
            {"poiId": pid, "tags": ["#취향저격", "#분위기좋은"]},
            {"poiId": "유령장소", "tags": ["#환각"]},
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
    # 형태 위반은 엄격하게 — tags 가 배열이 아니거나, v0.1.0 문장 스키마(text)로 답하면 parse_error
    for bad_item in ({"poiId": "p1", "tags": "#문자열아님"}, {"poiId": "p1", "text": "문장으로 답함"}):
        bad = json.dumps({"explanations": [bad_item]})
        assert g.apply(bad, pool, feature=_FEAT_EXP, trace_id=_TID, now=_NOW).error.startswith("parse_error:")


# ── ExplanationGate: 해시태그 경로 (v0.2.0) ─────────────────────


def _apply_tags(tags: list[str], feature: LlmFeature = _FEAT_EXP):
    raw = json.dumps({"explanations": [{"poiId": "p1", "tags": tags}]})
    return ExplanationGate().apply(raw, _tiny_pool(), feature=feature, trace_id=_TID, now=_NOW)


def test_explanation_gate_joins_hashtags_and_caps_at_fixed_count() -> None:
    tags = [f"#태그{i}" for i in range(HASHTAG_COUNT + 3)]
    out = _apply_tags(tags)
    assert out.error is None and out.drop_event is None
    assert out.value[0].text == " ".join(tags[:HASHTAG_COUNT])  # 앞에서 자르고 순서 보존


def test_explanation_gate_filters_bad_tags_individually() -> None:
    """형식·시간 표현·연락처 꼴은 **그 태그만** 빠지고, 중복은 첫 등장, 부족분은 그대로."""
    out = _apply_tags([
        "#뷰맛집", "공백 있음", "#뷰 맛집", "#서울#맛집", "#30분코스", "#book.kr",
        " #혼자여행 ", "#뷰맛집", "#" + "가" * (HASHTAG_MAX_LEN + 1),
    ])  # 태그 안 공백·내부 '#'·앞뒤 공백(strip 후 살림)·중복·길이 초과를 한 줄에
    assert out.error is None
    assert out.value[0].text == "#뷰맛집 #혼자여행"


def test_explanation_gate_all_tags_invalid_omits_slot_and_counts_it() -> None:
    """태그가 하나도 안 남은 슬롯은 **빈 문자열로 싣지 않는다** — 백엔드가 기존 근거를 빈 값으로
    덮고, 성공으로 집계돼 '#' 누락 드리프트가 어디에도 남지 않는다(INV-4). 세어서 이벤트에 남기고,
    유일한 슬롯이면 폴백 사유(`gate_dropped_all`)가 실린다. `dropped_ids` 는 풀 밖 poiId 전용.
    """
    for tags in (["문장입니다", "#오후3시"], []):
        out = _apply_tags(tags)
        assert out.value == () and out.error == "gate_dropped_all"
        assert out.drop_event is not None
        assert out.drop_event.dropped_ids == () and out.drop_event.dropped_count == 1
        assert out.drop_event.total_count == 1


def test_explanation_gate_sentence_path_stays_for_alternatives() -> None:
    """ALTERNATIVE_EXPLANATION(TRIP-887)은 같은 게이트를 쓰지만 문장 그대로 — feature 로 갈린다."""
    alt = LlmFeature.ALTERNATIVE_EXPLANATION
    raw = json.dumps({"explanations": [{"poiId": "p1", "text": "조용한 곳이라 잘 맞아요."}]})
    out = ExplanationGate().apply(raw, _tiny_pool(), feature=alt, trace_id=_TID, now=_NOW)
    assert out.error is None and out.value[0].text == "조용한 곳이라 잘 맞아요."
    assert _apply_tags(["#태그"], feature=alt).error.startswith("parse_error:")


def test_explanation_prompt_states_the_gate_limits() -> None:
    """게이트가 검사하는 규칙은 프롬프트에 전부 있어야 한다(share_card 해시태그 규칙 누락 사고).

    상수를 베끼지 않고 관계로 묶는다 — 게이트 상한을 바꾸면 이 테스트가 프롬프트를 고치라고 말한다.
    """
    text = (Path(__file__).resolve().parents[1] / "prompts" / "explanation.yaml").read_text(encoding="utf-8")
    assert f"해시태그 {HASHTAG_COUNT}개" in text and f"정확히 {HASHTAG_COUNT}개" in text
    assert f"{HASHTAG_MAX_LEN}자 이내" in text
    assert '"tags"' in text and '"text"' not in text



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
    tags = ["#자연", "#여유", "#힐링", "#산책", "#조용한"]
    canned = json.dumps({"explanations": [{"poiId": "p1", "tags": tags}]})
    worker = ExplanationWorker(_facade(FakeLlm(canned=canned), ExplanationGate()))
    result = worker.explain(pool, (PoiId("p1"),), _PERSONA, _TID, _NOW)
    assert result.is_fallback is False
    assert isinstance(result.value[0], PoiExplanation)
    assert result.value[0].text == " ".join(tags)  # 와이어는 문자열 하나 — 공백으로 이어 붙인다


def test_extraction_worker_end_to_end() -> None:
    canned = json.dumps({"places": [
        {"name": "숨은 카페", "address": None, "coord": None, "hours": None,
         "category": "카페", "confidence": 0.6, "sourceUrl": "https://blog"},
    ]})
    result = PlaceExtractionWorker(_facade(FakeLlm(canned=canned), PlaceExtractionGate())).extract(
        "블로그 본문...", "제주", "카페", _TID, _NOW
    )
    assert result.is_fallback is False and result.value[0].name == "숨은 카페"


def test_registry_loads_registered_features() -> None:
    reg = PromptRegistry(_PROMPTS)
    for feature, version, variables in [
        # 0.3.0 — 추천 이유가 문장에서 해시태그 5개로 바뀐 판 (2026-09-24; 0.2.0 은 #703 의 활동·음식 선호 변수)
        (LlmFeature.EXPLANATION, "0.3.0", {"taste_tags": "x", "companion": "SOLO",
                                           "activities": "카페", "cuisines": "한식",
                                           "slots": "1. p"}),
        (LlmFeature.PLACE_EXTRACTION, "0.1.0", {"document": "d", "region": "제주", "category": "카페"}),
    ]:
        prompt, ref = reg.render(feature, variables)
        assert ref.version == version and feature.value == ref.feature
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
