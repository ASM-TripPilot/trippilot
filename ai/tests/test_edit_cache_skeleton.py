"""U1 — 나머지 커버리지 절편 PBT (trigger·edit·evals·execution·cache·places).

증명하는 것:
  ① 직렬화 왕복 (U5-P10): 위 타입 전부 왕복 동일 (자유형 dict·중첩 튜플 포함)
  ② 파괴적 편집 확인 규칙  : resolve_apply_mode (business-rules.md §6)
  ③ 캐시 TTL 결정론      : InMemoryCache 논리 시계 만료 (실시간 sleep 없이)
  ④ places fake 결정론    : 시드 데이터만 반환
"""

from __future__ import annotations

import pytest
from hypothesis import given

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.edit import (
    ApplyMode,
    Dispatch,
    EditCommand,
    EditOp,
    resolve_apply_mode,
)
from trippilot.domain.evals import EvalCase, EvalRun, EvalScore
from trippilot.domain.execution import AgentKind, ExecutionPlan
from trippilot.domain.poi import PoiCategory, SourcedPoi
from trippilot.domain.trigger import TriggerEvalResult, TriggerParams

from tests.fakes.fake_places import FakePlaces
from tests.fakes.in_memory_cache import InMemoryCache
from tests.generators.edit import (
    dispatches,
    edit_commands,
    eval_cases,
    eval_runs,
    eval_scores,
    execution_plans,
    trigger_eval_results,
    trigger_params,
)


# ① 직렬화 왕복
@given(x=trigger_params())
def test_trigger_params_roundtrip(x: TriggerParams) -> None:
    assert TriggerParams.from_dict(x.to_dict()) == x


@given(x=trigger_eval_results())
def test_trigger_eval_result_roundtrip(x: TriggerEvalResult) -> None:
    assert TriggerEvalResult.from_dict(x.to_dict()) == x


@given(x=edit_commands())
def test_edit_command_roundtrip(x: EditCommand) -> None:
    assert EditCommand.from_dict(x.to_dict()) == x


@given(x=dispatches())
def test_dispatch_roundtrip(x: Dispatch) -> None:
    assert Dispatch.from_dict(x.to_dict()) == x


@given(x=eval_cases())
def test_eval_case_roundtrip(x: EvalCase) -> None:
    assert EvalCase.from_dict(x.to_dict()) == x


@given(x=eval_scores())
def test_eval_score_roundtrip(x: EvalScore) -> None:
    assert EvalScore.from_dict(x.to_dict()) == x


@given(x=eval_runs())
def test_eval_run_roundtrip(x: EvalRun) -> None:
    assert EvalRun.from_dict(x.to_dict()) == x


@given(x=execution_plans())
def test_execution_plan_roundtrip(x: ExecutionPlan) -> None:
    assert ExecutionPlan.from_dict(x.to_dict()) == x


# ② 파괴적 편집 확인 규칙
@pytest.mark.parametrize(
    "op,slots,expected",
    [
        (EditOp.ADD_SLOT, ("p1",), ApplyMode.AUTO_APPLY),  # 비파괴 + 단일
        (EditOp.MOVE_SLOT, (), ApplyMode.AUTO_APPLY),  # 비파괴 + 0개
        (EditOp.REMOVE_SLOT, ("p1",), ApplyMode.CONFIRM_REQUIRED),  # 파괴적
        (EditOp.CLEAR_DAY, (), ApplyMode.CONFIRM_REQUIRED),  # 파괴적
        (EditOp.ADD_SLOT, ("p1", "p2"), ApplyMode.CONFIRM_REQUIRED),  # 대규모(affected>1)
    ],
)
def test_resolve_apply_mode(op, slots, expected) -> None:
    cmd = EditCommand(op=op, params={}, affected_slots=tuple(PoiId(s) for s in slots))
    assert resolve_apply_mode(cmd) == expected


def test_dispatch_default_fallback_is_confirm() -> None:
    fb = Dispatch.default_fallback()
    assert fb.apply_mode == ApplyMode.CONFIRM_REQUIRED
    assert fb.agent == AgentKind.ORCHESTRATOR_FAST


# ③ 캐시 TTL — 논리 시계로 결정론적 만료
def test_cache_ttl_expiry_is_deterministic() -> None:
    cache = InMemoryCache()
    cache.set("poi:1", {"name": "성심당"}, ttl_sec=100)

    assert cache.get("poi:1") == {"name": "성심당"}  # 아직 유효
    cache.advance(99)
    assert cache.get("poi:1") == {"name": "성심당"}  # 경계 직전
    cache.advance(1)  # now=100 == expires
    assert cache.get("poi:1") is None  # 만료


def test_cache_ttl_zero_means_no_expiry() -> None:
    cache = InMemoryCache()
    cache.set("k", {"v": 1}, ttl_sec=0)
    cache.advance(10_000)
    assert cache.get("k") == {"v": 1}


# ④ places fake — 시드 데이터만 결정론 반환
def test_fake_places_returns_only_seeded() -> None:
    cafe = SourcedPoi(
        name="테라로사",
        coord=GeoPoint(37.77, 128.90),
        category=PoiCategory.CAFE,
        source_url=None,
        raw_confidence=0.9,
    )
    places = FakePlaces(
        by_category={PoiCategory.CAFE: (cafe,)},
        geocodes={"강릉역": GeoPoint(37.76, 128.90)},
    )
    assert places.search("강릉", PoiCategory.CAFE, limit=5) == (cafe,)
    assert places.search("강릉", PoiCategory.FOOD, limit=5) == ()  # 시드 없음
    assert places.geocode("강릉역", "강릉") == GeoPoint(37.76, 128.90)
    assert places.geocode("없는곳", "강릉") is None
