"""TRIP-887 — ALTERNATIVE_EXPLANATION: 프롬프트 yaml 로드 + 변수 조립 + 워커 왕복(ExplanationGate 재사용).

증명하는 것 (실 LLM 0 — FakeLlm):
  ① prompts/alternative_explanation.yaml 이 Registry 로 로드되고(semver) 쌍의 선택지·확정 장소가 렌더된다
  ② 같은 선택지는 첫 쌍만, 확정 슬롯이 풀 밖이면 "(미등록 장소)" — 지어내지 않는다
  ③ 선택지가 풀 밖이면 호출측 버그로 거부(INV-1 우회 금지)
  ④ 워커 왕복 — 게이트가 풀 밖 poiId 를 버리고 풀 안만 PoiExplanation 으로 돌려준다
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, ModelTier, PoiExplanation
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.explanation import ExplanationGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.alternative_explanation import (
    AlternativeExplanationWorker,
    build_alternative_explanation_vars,
)

from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
_NOW = datetime(2026, 9, 17, 9, 0, tzinfo=timezone.utc)
_TRACE = TraceId("t-887")
_PERSONA = PersonaSummary(
    taste_tags=(TasteTag.NATURE,), companion=CompanionType.SOLO, budget=BudgetLevel.MID
)
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-light", ModelTier.HEAVY: "m-heavy"})


def _poi(pid: str, name: str, category: PoiCategory = PoiCategory.CAFE) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=name, category=category, coord=GeoPoint(33.45, 126.57),
        open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL,
        source=PoiSource.SEED, confidence=None,
    )


_SLOT = _poi("s1", "성산일출봉", PoiCategory.SIGHT)
_ALT1 = _poi("a1", "카페 한라")
_ALT2 = _poi("a2", "우도 카페")
_POOL = CandidatePool(
    poi_ids=frozenset({_SLOT.poi_id, _ALT1.poi_id, _ALT2.poi_id}),
    pois=(_SLOT, _ALT1, _ALT2), generated_at=_NOW,
)


def test_yaml_loads_and_renders_pairs() -> None:
    variables = build_alternative_explanation_vars(
        _POOL, ((_SLOT.poi_id, _ALT1.poi_id),), _PERSONA)
    prompt, ref = PromptRegistry(_PROMPTS_DIR).render(
        LlmFeature.ALTERNATIVE_EXPLANATION, variables)

    assert ref.version == "0.1.0" and ref.feature == "ALTERNATIVE_EXPLANATION"
    assert "a1 | CAFE | 카페 한라 | 대신: 성산일출봉" in prompt
    assert "NATURE" in prompt and "SOLO" in prompt
    assert "33.45" not in prompt and "126.57" not in prompt  # 좌표 미포함 (G181)


def test_vars_dedupe_alternative_and_tolerate_unregistered_slot() -> None:
    variables = build_alternative_explanation_vars(
        _POOL,
        ((_SLOT.poi_id, _ALT1.poi_id), (PoiId("ghost-slot"), _ALT1.poi_id),
         (PoiId("ghost-slot"), _ALT2.poi_id)),
        _PERSONA,
    )
    lines = variables["alternatives"].splitlines()
    assert [l.split(" | ")[0] for l in lines] == ["1. a1", "2. a2"]  # a1 은 첫 쌍만
    assert lines[1].endswith("대신: (미등록 장소)")


def test_vars_reject_alternative_outside_pool() -> None:
    with pytest.raises(ValueError, match="풀 밖"):
        build_alternative_explanation_vars(
            _POOL, ((_SLOT.poi_id, PoiId("ghost")),), _PERSONA)


def test_worker_roundtrip_keeps_only_pool_ids() -> None:
    canned = json.dumps({"explanations": [
        {"poiId": "a1", "text": "조용한 자연 풍경을 좋아하시면 여기도 잘 맞아요."},
        {"poiId": "ghost", "text": "환각"},
    ]})
    worker = AlternativeExplanationWorker(GatewayFacade(
        FakeLlm(canned), PromptRegistry(_PROMPTS_DIR), ExplanationGate(), _CFG,
        InMemoryTrace()))

    result = worker.explain(
        _POOL, ((_SLOT.poi_id, _ALT1.poi_id),), _PERSONA, _TRACE, _NOW, timeout_sec=5.0)

    assert result.is_fallback is False
    assert result.value == (PoiExplanation(PoiId("a1"), "조용한 자연 풍경을 좋아하시면 여기도 잘 맞아요."),)


def test_worker_rejects_non_persona() -> None:
    worker = AlternativeExplanationWorker(GatewayFacade(
        FakeLlm("{}"), PromptRegistry(_PROMPTS_DIR), ExplanationGate(), _CFG, InMemoryTrace()))
    with pytest.raises(TypeError):
        worker.explain(_POOL, (), "not-a-persona", _TRACE, _NOW)  # type: ignore[arg-type]
