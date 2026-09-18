"""TRIP-378 — PREFERENCE_SCORING 병렬 청킹 (풀 크기 적응 병렬수).

증명하는 것 (전부 fake — 실 호출 0, D37):
  ① 병렬수 정책: N = ⌈풀 ÷ chunk_size⌉, 상한 max_parallel (7→1, 40→2, 100→5,
     193→10, 250→10)
  ② 균등 분할·결정론: 청크 크기 차 ≤ 1, 서로소, 합집합 = 풀, 같은 풀 → 같은 청크
  ③ 병합 정확성: 청크별 응답 → 전 POI 점수 정확히 1회씩 + ScoreChunkEvent 요약
  ④ 부분 실패: 실패 청크 제외 성공분만 value, error에 부분 실패 표기
     (is_fallback=False 유지 — 규칙 점수 실행은 호출측 몫, BR-U4-09)
  ⑤ 전 청크 실패 = 단일 호출과 동일한 폴백 신호 (INV-4 경로 불변)
  ⑥ 단일 호출 경로 회귀: 풀 ≤ chunk_size면 호출 1회·청킹 이벤트 없음
  ⑦ INV-1 PBT: 임의 풀 + 오염 응답(풀 밖 id 섞임) → 산출 ⊆ 풀, 중복 없음
  ⑧ timeout override 관통: 모든 청크 호출의 LlmRequest.timeout_sec = 단계 예산
  ⑨ 동시 실행: 청크 호출이 실제로 겹친다 (barrier — 순차였다면 타임아웃)

TRIP-380 갱신: 청크 크기가 고정 상수(20)에서 단계 예산 유도 공식으로 바뀌어,
워커 경로 테스트는 예산 14s를 명시해 c*=20(종전 상수 동치)을 재현한다.
공식 자체·벽시계 마감은 test_llm_gateway_preference_wallclock.py 소유.
"""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.context import ContextResolver
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.preference import (
    PreferenceScoringWorker,
    plan_chunks,
)
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, TraceId
from trippilot.domain.context import Principal, ResourceRef
from trippilot.domain.llm import CandidatePool, ModelTier
from trippilot.domain.observability import FallbackEvent, ScoreChunkEvent
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.ports.llm_port import LlmRequest, LlmResponse
from tests.fakes.fake_llm import FailingLlm
from tests.fakes.in_memory_trace import InMemoryTrace

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
_NOW = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)
_TRACE_ID = TraceId("t-378")
_PERSONA = PersonaSummary(
    taste_tags=(TasteTag.NATURE,), companion=CompanionType.SOLO, budget=BudgetLevel.MID
)
_PRINCIPAL = Principal(user_id="u-owner")
_REF = ResourceRef(kind="persona", ref_id="persona-1", owner_id="u-owner")

# 프롬프트의 후보 행 "- {poiId} | {카테고리} | {상호명}" (build_prompt_vars 형식)
_CANDIDATE_LINE = re.compile(r"^- (\S+) \|", re.MULTILINE)


# ── fixtures ────────────────────────────────────────────────────────


def _poi_with(pid: str) -> Poi:
    return Poi(
        poi_id=PoiId(pid),
        name=f"장소-{pid}",
        category=PoiCategory.SIGHT,
        coord=GeoPoint(37.75, 128.87),
        open_hours=(),
        avg_cost=None,
        rating=None,
        quality=DataQuality.FULL,
        source=PoiSource.SEED,
        confidence=None,
    )


def _pool_of(ids: tuple[str, ...], *, reverse: bool = False) -> CandidatePool:
    pois = tuple(_poi_with(x) for x in (reversed(ids) if reverse else ids))
    return CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=_NOW
    )


def _pool(n: int, *, reverse: bool = False) -> CandidatePool:
    return _pool_of(tuple(f"c{i:03d}" for i in range(1, n + 1)), reverse=reverse)


class _Store:
    def get(self, ref: ResourceRef) -> object | None:
        return _PERSONA


def _worker(llm, cfg: C1Config | None = None) -> tuple[PreferenceScoringWorker, InMemoryTrace]:
    cfg = cfg or C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
    trace = InMemoryTrace()
    gateway = GatewayFacade(
        llm, PromptRegistry(_PROMPTS_DIR), ClosedSetGate(), cfg, trace
    )
    return PreferenceScoringWorker(gateway), trace


def _echo_response(request: LlmRequest, ids: list[str]) -> LlmResponse:
    text = json.dumps({"scores": [{"poiId": x, "score": 0.5} for x in ids]})
    return LlmResponse(
        raw_text=text,
        input_tokens=1,
        output_tokens=1,
        latency_ms=1,
        model_id=request.model_id,
    )


class _EchoScoresLlm:
    """프롬프트의 후보 poi_id 전원에 점수 응답 — 청크별 응답을 만드는 fake."""

    def __init__(self) -> None:
        self.requests: list[LlmRequest] = []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)  # list.append는 GIL 원자적 — 동시 호출 안전
        return _echo_response(request, _CANDIDATE_LINE.findall(request.prompt))


class _FailOnPoiLlm(_EchoScoresLlm):
    """특정 poi_id가 후보에 실린 청크만 실패 — 부분 실패 재현."""

    def __init__(self, poison: str) -> None:
        super().__init__()
        self._poison = poison

    def invoke(self, request: LlmRequest) -> LlmResponse:
        ids = _CANDIDATE_LINE.findall(request.prompt)
        if self._poison in ids:
            raise RuntimeError("chunk down (fake)")
        return _echo_response(request, ids)


class _PollutingLlm(_EchoScoresLlm):
    """청크 후보 + 풀 밖 유령 id를 섞어 응답 — INV-1 적대적 fake."""

    def invoke(self, request: LlmRequest) -> LlmResponse:
        ids = _CANDIDATE_LINE.findall(request.prompt)
        polluted = ids + [f"ghost::{x}" for x in ids] + ["ghost::solo"]
        return _echo_response(request, polluted)


class _BarrierLlm(_EchoScoresLlm):
    """전 청크가 동시에 진입해야만 통과 — 순차 실행이면 barrier 타임아웃으로 실패."""

    def __init__(self, parties: int) -> None:
        super().__init__()
        self._barrier = threading.Barrier(parties)

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self._barrier.wait(timeout=10.0)
        return _echo_response(request, _CANDIDATE_LINE.findall(request.prompt))


def _value_ids(result) -> list[str]:
    return [str(sp.poi_id) for sp in result.value]


# ── ① 병렬수 정책 ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("pool_size", "expected_n"),
    [(7, 1), (40, 2), (100, 5), (193, 10), (250, 10)],  # 250은 상한 10에 걸린다
)
def test_parallelism_policy(pool_size: int, expected_n: int) -> None:
    chunks = plan_chunks(_pool(pool_size), 20, 10)

    assert len(chunks) == expected_n


# ── ② 균등 분할 · 결정론 ────────────────────────────────────────────


def test_chunks_are_balanced_partition_of_pool() -> None:
    """193건·N=10 → 20×3+19×7 (자투리 13짜리 청크 없음 — 최대 청크가 벽시계다)."""
    pool = _pool(193)

    chunks = plan_chunks(pool, 20, 10)

    sizes = sorted(len(c.pois) for c in chunks)
    assert sizes == [19] * 7 + [20] * 3
    assert max(sizes) - min(sizes) <= 1
    ids_concat = [str(p.poi_id) for c in chunks for p in c.pois]
    assert ids_concat == sorted(str(p) for p in pool.poi_ids)  # 서로소 + 전원 포함
    # 상한 초과 풀(250 → N=10)도 균형 유지
    over = plan_chunks(_pool(250), 20, 10)
    assert sorted(len(c.pois) for c in over) == [25] * 10


def test_chunks_deterministic_regardless_of_pool_order() -> None:
    """같은 풀 = 항상 같은 청크 구성 — pois 튜플 순서와 무관 (poi_id 정렬 기준)."""
    a = plan_chunks(_pool(45), 20, 10)
    b = plan_chunks(_pool(45, reverse=True), 20, 10)

    assert [tuple(str(p.poi_id) for p in c.pois) for c in a] == [
        tuple(str(p.poi_id) for p in c.pois) for c in b
    ]


# ── ③ 병합 정확성 ───────────────────────────────────────────────────


def test_merge_scores_every_poi_exactly_once() -> None:
    pool = _pool(50)  # ⌈50/20⌉ = 3청크
    llm = _EchoScoresLlm()
    worker, trace = _worker(llm)

    result = worker.score(
        pool, _PERSONA, _TRACE_ID, _NOW, timeout_sec=14.0
    )

    assert result.is_fallback is False and result.error is None
    ids = _value_ids(result)
    assert sorted(ids) == sorted(str(p) for p in pool.poi_ids)  # 전원 1회씩
    assert len(ids) == len(set(ids))
    assert all(sp.is_llm_score for sp in result.value)
    assert len(llm.requests) == 3
    events = trace.of_type(ScoreChunkEvent)
    assert len(events) == 1
    assert (events[0].pool_size, events[0].chunk_count) == (50, 3)
    assert (events[0].success_count, events[0].failure_count) == (3, 0)
    assert events[0].timed_out_count == 0              # 마감초과 없음 (TRIP-380)


# ── ④ 부분 실패 ─────────────────────────────────────────────────────


def test_partial_chunk_failure_keeps_successes_without_fallback_signal() -> None:
    pool = _pool(40)  # 2청크: c001~c020 / c021~c040
    worker, trace = _worker(_FailOnPoiLlm("c001"))

    result = worker.score(
        pool, _PERSONA, _TRACE_ID, _NOW, timeout_sec=14.0
    )

    assert result.is_fallback is False                 # 성공분이 있다 — 폴백 아님
    assert result.error is not None
    assert result.error.startswith("partial_chunks_failed:1/2")
    assert sorted(_value_ids(result)) == [f"c{i:03d}" for i in range(21, 41)]
    assert result.call_record is not None              # 계측 첨부 유지 (NFR-7.1)
    events = trace.of_type(ScoreChunkEvent)
    assert len(events) == 1
    assert (events[0].success_count, events[0].failure_count) == (1, 1)
    # 실패 청크의 폴백은 게이트웨이가 이미 관측 (침묵 금지, INV-4)
    assert len(trace.of_type(FallbackEvent)) == 1


# ── ⑤ 전 청크 실패 = 기존 폴백 신호 ─────────────────────────────────


def test_all_chunks_failed_is_same_fallback_signal_as_single_call() -> None:
    worker, trace = _worker(FailingLlm())

    result = worker.score(
        _pool(40), _PERSONA, _TRACE_ID, _NOW, timeout_sec=14.0
    )

    assert result.is_fallback is True and result.value is None  # INV-4 경로 불변
    assert result.error is not None
    assert result.error.startswith("all_chunks_failed:2")
    events = trace.of_type(ScoreChunkEvent)
    assert len(events) == 1
    assert (events[0].success_count, events[0].failure_count) == (0, 2)
    assert len(trace.of_type(FallbackEvent)) == 2      # 청크별 게이트웨이 관측


# ── ⑥ 단일 호출 경로 회귀 (풀 ≤ chunk_size) ─────────────────────────


def test_small_pool_keeps_single_call_path() -> None:
    pool = _pool(20)  # 경계값 — 예산 14s에서 딱 c*(=20)
    llm = _EchoScoresLlm()
    worker, trace = _worker(llm)

    result = worker.score(
        pool, _PERSONA, _TRACE_ID, _NOW, timeout_sec=14.0
    )

    assert len(llm.requests) == 1                      # 청킹 없음 — 현행 경로 그대로
    assert trace.of_type(ScoreChunkEvent) == []
    assert result.is_fallback is False
    assert sorted(_value_ids(result)) == sorted(str(p) for p in pool.poi_ids)


# ── ⑦ INV-1 PBT: 오염 응답에도 산출 ⊆ 풀 ───────────────────────────


@settings(max_examples=25, deadline=None)
@given(
    ids=st.lists(
        st.text(alphabet="abcdefgh", min_size=1, max_size=8),
        unique=True,
        min_size=21,
        max_size=45,
    )
)
def test_pbt_merged_output_is_subset_of_pool(ids: list[str]) -> None:
    pool = _pool_of(tuple(ids))
    worker, _ = _worker(_PollutingLlm())

    result = worker.score(
        pool, _PERSONA, _TRACE_ID, _NOW, timeout_sec=14.0
    )

    assert result.is_fallback is False
    out = _value_ids(result)
    assert set(out) <= {str(p) for p in pool.poi_ids}  # INV-1: 산출 ⊆ 풀
    assert len(out) == len(set(out))                   # 중복 poi_id 없음 (첫 등장 우선)


# ── ⑧ timeout override 관통 ─────────────────────────────────────────


def test_timeout_override_passes_through_to_every_chunk_call() -> None:
    llm = _EchoScoresLlm()
    worker, _ = _worker(llm)

    worker.score(_pool(40), _PERSONA, _TRACE_ID, _NOW, timeout_sec=14.0)

    assert len(llm.requests) == 2
    assert [r.timeout_sec for r in llm.requests] == [14.0, 14.0]  # 청크가 작아도 예산 기준


# ── ⑨ 동시 실행 ─────────────────────────────────────────────────────


def test_chunk_calls_actually_run_in_parallel() -> None:
    """barrier(2): 두 청크 호출이 겹쳐야만 통과 — 순차였다면 타임아웃 → 폴백."""
    worker, _ = _worker(_BarrierLlm(parties=2))

    result = worker.score(
        _pool(40), _PERSONA, _TRACE_ID, _NOW, timeout_sec=14.0
    )

    assert result.is_fallback is False
    assert len(_value_ids(result)) == 40
