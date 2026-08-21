"""TRIP-477 — CachingScoringWorker: 2단계 생성 점수 중복 호출 제거.

증명하는 것 (실 LLM 0 — inner는 계수 fake):
  ① 성공 점수 → 같은 풀·부분집합 풀 재요청 시 inner 호출 0 (2차 생성 정상 경로)
  ② 부분 미스 — inner에는 **미스만** 담긴 부분 풀, 병합 결과는 poi_id 오름차순
  ③ 폴백 미캐시 — 다음 호출이 실 LLM 재시도 (강등 고착 금지)
  ④ 폴백 + 캐시 히트 → 히트만 부분 성공(error 표기) — 규칙 채움은 상위 몫
  ⑤ TTL 경과·페르소나 변경 → 미스
  ⑥ 규칙 점수 혼입(is_llm_score=False)은 캐시하지 않는다
  ⑦ LRU 상한 — 오래된 항목 축출
  ⑧ wiring — build_orchestrator가 점수 워커를 캐시로 감싼다
"""

from __future__ import annotations

import datetime as dt

import pytest

from trippilot.domain.common import GeoPoint, PoiId, TraceId
from trippilot.domain.llm import CandidatePool, ScoredPoi, TypedResult
from trippilot.domain.persona import BudgetLevel, CompanionType, PersonaSummary
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.workers.preference_cache import CachingScoringWorker

_NOW = dt.datetime(2026, 8, 21, 9, 0, tzinfo=dt.timezone.utc)
_TRACE = TraceId("t-477")
_PERSONA = PersonaSummary(
    taste_tags=(), companion=CompanionType.SOLO, budget=BudgetLevel.MID)


def _poi(pid: str) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=pid, category=PoiCategory.SIGHT,
        coord=GeoPoint(37.5, 127.0), open_hours=(), avg_cost=None, rating=None,
        quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None,
    )


def _pool(*pids: str) -> CandidatePool:
    pois = tuple(_poi(p) for p in pids)
    return CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=_NOW)


class FakeInner:
    """점수 = poi_id 길이(결정론). fallback_after로 폴백 전환 제어."""

    def __init__(self, *, fallback: bool = False, llm_score: bool = True) -> None:
        self.calls: list[tuple[str, ...]] = []
        self.fallback = fallback
        self.llm_score = llm_score

    def score(self, pool, persona, trace_id, now, *, timeout_sec=None):
        self.calls.append(tuple(sorted(str(p) for p in pool.poi_ids)))
        if self.fallback:
            return TypedResult(value=None, is_fallback=True,
                               error="llm down (fake)", call_record=None)
        return TypedResult(
            value=tuple(
                ScoredPoi(poi_id=p.poi_id, score=float(len(str(p.poi_id))),
                          is_llm_score=self.llm_score)
                for p in pool.pois
            ),
            is_fallback=False, error=None, call_record=None,
        )


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def _worker(inner: FakeInner, **kw) -> CachingScoringWorker:
    return CachingScoringWorker(inner, **kw)


# ── ① 전부 히트 ──────────────────────────────────────────────────────


def test_second_call_with_same_pool_makes_no_inner_call() -> None:
    inner = FakeInner()
    worker = _worker(inner)
    first = worker.score(_pool("a", "b", "c"), _PERSONA, _TRACE, _NOW)
    second = worker.score(_pool("a", "b", "c"), _PERSONA, _TRACE, _NOW)
    assert len(inner.calls) == 1  # 2차는 캐시 — LLM 0회
    assert second.is_fallback is False and second.error is None
    assert {(str(s.poi_id), s.score) for s in second.value} == \
           {(str(s.poi_id), s.score) for s in first.value}


def test_subset_pool_is_full_hit() -> None:
    """2차 풀 = 1차 풀 − day1 배치분 (TRIP-293) — 전부 히트가 정상 경로."""
    inner = FakeInner()
    worker = _worker(inner)
    worker.score(_pool("a", "b", "c", "d"), _PERSONA, _TRACE, _NOW)
    result = worker.score(_pool("b", "d"), _PERSONA, _TRACE, _NOW)
    assert len(inner.calls) == 1
    assert [str(s.poi_id) for s in result.value] == ["b", "d"]


# ── ② 부분 미스 ──────────────────────────────────────────────────────


def test_partial_miss_calls_inner_with_misses_only_and_merges_sorted() -> None:
    inner = FakeInner()
    worker = _worker(inner)
    worker.score(_pool("b", "c"), _PERSONA, _TRACE, _NOW)
    result = worker.score(_pool("a", "b", "c", "d"), _PERSONA, _TRACE, _NOW)
    assert inner.calls[1] == ("a", "d")  # 미스만 부분 풀로
    assert [str(s.poi_id) for s in result.value] == ["a", "b", "c", "d"]  # 결정론
    assert all(s.is_llm_score for s in result.value)


# ── ③·④ 폴백 ────────────────────────────────────────────────────────


def test_fallback_is_not_cached_and_retried() -> None:
    inner = FakeInner(fallback=True)
    worker = _worker(inner)
    first = worker.score(_pool("a"), _PERSONA, _TRACE, _NOW)
    assert first.is_fallback is True  # 캐시 비었으면 폴백 그대로
    inner.fallback = False
    second = worker.score(_pool("a"), _PERSONA, _TRACE, _NOW)
    assert len(inner.calls) == 2  # 폴백은 캐시 안 됨 — 실 LLM 재시도
    assert second.is_fallback is False


def test_fallback_with_cached_hits_returns_partial_success() -> None:
    inner = FakeInner()
    worker = _worker(inner)
    worker.score(_pool("a", "b"), _PERSONA, _TRACE, _NOW)
    inner.fallback = True
    result = worker.score(_pool("a", "b", "c"), _PERSONA, _TRACE, _NOW)
    assert result.is_fallback is False  # 히트 2건은 실 LLM 점수 — 부분 성공
    assert [str(s.poi_id) for s in result.value] == ["a", "b"]  # c는 missing 규칙 채움 몫
    assert result.error is not None and "cache_partial_fallback" in result.error


# ── ⑤ TTL·페르소나 ──────────────────────────────────────────────────


def test_ttl_expiry_causes_refetch() -> None:
    inner, clock = FakeInner(), FakeClock()
    worker = _worker(inner, ttl_sec=10.0, clock=clock)
    worker.score(_pool("a"), _PERSONA, _TRACE, _NOW)
    clock.t = 11.0
    worker.score(_pool("a"), _PERSONA, _TRACE, _NOW)
    assert len(inner.calls) == 2


def test_different_persona_misses() -> None:
    inner = FakeInner()
    worker = _worker(inner)
    worker.score(_pool("a"), _PERSONA, _TRACE, _NOW)
    other = PersonaSummary(
        taste_tags=(), companion=CompanionType.SOLO, budget=BudgetLevel.HIGH)
    worker.score(_pool("a"), other, _TRACE, _NOW)
    assert len(inner.calls) == 2  # 취향이 다르면 점수도 다르다 — 재호출


# ── ⑥ 규칙 점수 미캐시 ──────────────────────────────────────────────


def test_rule_scores_are_not_cached() -> None:
    inner = FakeInner(llm_score=False)
    worker = _worker(inner)
    worker.score(_pool("a"), _PERSONA, _TRACE, _NOW)
    worker.score(_pool("a"), _PERSONA, _TRACE, _NOW)
    assert len(inner.calls) == 2  # is_llm_score=False는 저장 안 함


# ── ⑦ LRU 상한 ──────────────────────────────────────────────────────


def test_lru_evicts_oldest_beyond_max_entries() -> None:
    inner = FakeInner()
    worker = _worker(inner, max_entries=2)
    worker.score(_pool("a", "b", "c"), _PERSONA, _TRACE, _NOW)  # 3건 → a 축출
    result = worker.score(_pool("a", "b", "c"), _PERSONA, _TRACE, _NOW)
    assert inner.calls[1] == ("a",)  # b·c 히트, a만 재호출
    assert len(result.value) == 3


# ── ⑧ wiring ────────────────────────────────────────────────────────


def test_build_orchestrator_wraps_scoring_with_cache() -> None:
    from trippilot.api import wiring
    from trippilot.domain.llm import ModelTier
    from trippilot.llm_gateway.config import C1Config

    orchestrator = wiring.build_orchestrator(
        llm=wiring.UnwiredLlm(),
        poi_db=wiring.StaticPoiDb(wiring.demo_poi_seed()),
        context_store=wiring.StaticPersonaStore(_PERSONA),
        c1_config=C1Config(model_ids={ModelTier.LIGHT: "m", ModelTier.HEAVY: "m"}),
    )
    assert isinstance(
        orchestrator._orchestrator._scoring, CachingScoringWorker  # noqa: SLF001
    )
