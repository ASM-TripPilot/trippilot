"""U4-05 — PromptRegistry(yaml 로드·결정론 렌더) + PreferenceScoringWorker.

PROMPT-P1: 렌더 결정론 ∧ 후보 poi_id 전원 프롬프트 포함(누락 금지) ∧ 좌표 문자열 미포함 (G181)
DoD: prompts/preference_scoring.yaml v0.1.0 존재 + Registry 로드 왕복
워커: 권한 재조회 → 조립 → gateway.call, 폴백 TypedResult 그대로 반환 (BR-U4-09)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from hypothesis import given

from trippilot.c1.config import C1Config
from trippilot.c1.context import ContextResolver
from trippilot.c1.gates.scoring import ClosedSetGate
from trippilot.c1.gateway import GatewayFacade
from trippilot.c1.prompts import PromptRegistry
from trippilot.c1.workers.preference import PreferenceScoringWorker, build_prompt_vars
from trippilot.domain.common import BudgetLevel, TraceId
from trippilot.domain.context import PermissionDeniedError, Principal, ResourceRef
from trippilot.domain.llm import CandidatePool, LlmFeature, ModelTier
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.poi import candidate_pools

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
_NOW = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)
_TRACE_ID = TraceId("t-u4-worker")
_PERSONA = PersonaSummary(
    taste_tags=(TasteTag.NATURE, TasteTag.FOOD),
    companion=CompanionType.COUPLE,
    budget=BudgetLevel.MID,
)
_PRINCIPAL = Principal(user_id="u-owner")
_REF = ResourceRef(kind="persona", ref_id="persona-1", owner_id="u-owner")


class _Store:
    def __init__(self, value: object) -> None:
        self._value = value

    def get(self, ref: ResourceRef) -> object | None:
        return self._value


def _registry() -> PromptRegistry:
    return PromptRegistry(_PROMPTS_DIR)


# ── DoD: yaml 실체 존재 + Registry 로드 왕복 ─────────────────


def test_preference_scoring_yaml_loads_with_semver() -> None:
    prompt, ref = _registry().render(
        LlmFeature.PREFERENCE_SCORING, build_prompt_vars_empty()
    )
    assert ref.prompt_id == "prompts/preference_scoring.yaml"
    assert ref.version == "0.1.0" and ref.feature == "PREFERENCE_SCORING"
    assert "poiId" in prompt  # 출력 스키마 안내 포함


def build_prompt_vars_empty() -> dict[str, str]:
    return {
        "taste_tags": "미설정",
        "companion": "SOLO",
        "budget": "LOW",
        "candidates": "(후보 없음)",
    }


def test_registry_rejects_unregistered_feature_and_non_str_vars() -> None:
    reg = _registry()
    with pytest.raises(ValueError):
        reg.render(LlmFeature.REFLECTION, build_prompt_vars_empty())  # 미등록
    with pytest.raises(ValueError):
        reg.render(
            LlmFeature.PREFERENCE_SCORING,
            {**build_prompt_vars_empty(), "budget": 3},  # str 아님 — 워커 몫
        )


def test_registry_rejects_broken_yaml(tmp_path: Path) -> None:
    (tmp_path / "bad.yaml").write_text(
        "feature: NOT_A_FEATURE\nversion: '0.1.0'\ntemplate: x", encoding="utf-8"
    )
    with pytest.raises(ValueError):
        PromptRegistry(tmp_path)
    (tmp_path / "bad.yaml").write_text(
        # version 따옴표 누락 → float 1.0 → 문자열 아님 (yaml 함정 자동 차단)
        "feature: PREFERENCE_SCORING\nversion: 1.0\ntemplate: x",
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        PromptRegistry(tmp_path)


# ── PROMPT-P1: 렌더 결정론 · 후보 전원 포함 · 좌표 미포함 ────


@given(candidate_pools())
def test_prompt_p1_deterministic_complete_and_coordinate_free(
    pool: CandidatePool,
) -> None:
    variables = build_prompt_vars(pool, _PERSONA)
    reg = _registry()
    p1, _ = reg.render(LlmFeature.PREFERENCE_SCORING, variables)
    p2, _ = reg.render(
        LlmFeature.PREFERENCE_SCORING, build_prompt_vars(pool, _PERSONA)
    )
    assert p1 == p2  # 결정론 (같은 입력 → 같은 프롬프트)
    for poi in pool.pois:
        assert str(poi.poi_id) in p1  # 후보 누락 금지
        # 좌표 미포함 (G181) — lat/lng 문자열이 프롬프트에 나타나면 안 됨
        assert str(poi.coord.lat) not in p1
        assert str(poi.coord.lng) not in p1


# ── 워커: 권한 → 조립 → 게이트웨이 (전 구간 실물) ────────────


def _worker(llm, store_value: object) -> PreferenceScoringWorker:
    cfg = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
    gateway = GatewayFacade(llm, _registry(), ClosedSetGate(), cfg, InMemoryTrace())
    return PreferenceScoringWorker(gateway, ContextResolver(_Store(store_value)))


@given(candidate_pools().filter(lambda p: bool(p.poi_ids)))
def test_worker_end_to_end_success(pool: CandidatePool) -> None:
    pid = str(sorted(pool.poi_ids, key=str)[0])
    canned = json.dumps({"scores": [{"poiId": pid, "score": 0.8, "reason": "r"}]})
    result = _worker(FakeLlm(canned=canned), _PERSONA).score(
        pool, _REF, _PRINCIPAL, _TRACE_ID, _NOW
    )
    assert result.is_fallback is False
    assert [str(s.poi_id) for s in result.value] == [pid]
    assert result.value[0].is_llm_score is True


def test_worker_permission_violation_raises_before_llm(pool=None) -> None:
    foreign_ref = ResourceRef(kind="persona", ref_id="p", owner_id="u-else")
    worker = _worker(FakeLlm(), _PERSONA)
    with pytest.raises(PermissionDeniedError):
        worker.score(_empty_pool(), foreign_ref, _PRINCIPAL, _TRACE_ID, _NOW)


def test_worker_passes_fallback_through_unchanged() -> None:
    result = _worker(FailingLlm(), _PERSONA).score(
        _empty_pool(), _REF, _PRINCIPAL, _TRACE_ID, _NOW
    )
    assert result.is_fallback is True and result.value is None  # 실행은 호출측 (BR-U4-09)


def test_worker_rejects_non_persona_context() -> None:
    with pytest.raises(TypeError):
        _worker(FakeLlm(), {"raw": "dict"}).score(
            _empty_pool(), _REF, _PRINCIPAL, _TRACE_ID, _NOW
        )


def _empty_pool() -> CandidatePool:
    return CandidatePool(poi_ids=frozenset(), pois=(), generated_at=_NOW)


def test_registry_rejects_stray_dollar_template(tmp_path: Path) -> None:
    """TRIP-260 #2: 리터럴 $ 템플릿은 로드 시점에 거부 — 런타임 크래시 방지."""
    (tmp_path / "bad.yaml").write_text(
        "feature: PREFERENCE_SCORING\nversion: '0.1.0'\ntemplate: '가격 $10 이내'",
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        PromptRegistry(tmp_path)
