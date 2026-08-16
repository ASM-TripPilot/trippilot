"""TRIP-380 — 점수 단계 벽시계 강제 + 적응형 청크 공식.

증명하는 것 (전부 fake — 실 호출 0, D37):
  ① 공식: c* = clamp(⌊(예산/safety − base) ÷ per_item⌋, min, max) —
     기본 파라미터에서 14s→20(TRIP-378 상수 재현)·10s→10·8s→5·4s→5(클램프)·
     대예산→chunk_max 클램프. 예산이 바뀌면 워커 청크 수가 자동 추종.
  ② 벽시계 강제: 마감 초과 청크 → 실패 처리, 성공분은 수용, 점수 단계 소요는
     마감에 유계 (시간 단언은 여유 마진 — flaky 방지)
  ③ 유기 스레드의 늦은 완료는 폐기 — 반환된 병합 결과·관측에 미반영
  ④ 병합 결정론: 청크 도착 순서가 뒤집혀도 병합 산출은 청크 인덱스 순으로 동일
  ⑤ ScoreChunkEvent 사유 구분(timed_out_count) 직렬화 왕복 + C1Config 검증

배경 실측 (2026-08-16): SDK read-timeout(LlmRequest.timeout_sec)은 바이트 간격
기준이라 총 시간을 못 막는다 — 19.5s 청크가 14s 타임아웃에도 "성공" 완료, 슬로
테일이 단계 상한을 뚫고 deadline 잠식(총 22.9s, 이전 504 사건 동인).
"""

from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.context import ContextResolver
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.preference import (
    PreferenceScoringWorker,
    adaptive_chunk_size,
)
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, TraceId
from trippilot.domain.context import Principal, ResourceRef
from trippilot.domain.llm import CandidatePool, ModelTier
from trippilot.domain.observability import ScoreChunkEvent
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.ports.llm_port import LlmRequest, LlmResponse
from tests.fakes.in_memory_trace import InMemoryTrace

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
_NOW = datetime(2026, 8, 16, 12, 0, tzinfo=timezone.utc)
_TRACE_ID = TraceId("t-380")
_PERSONA = PersonaSummary(
    taste_tags=(TasteTag.NATURE,), companion=CompanionType.SOLO, budget=BudgetLevel.MID
)
_PRINCIPAL = Principal(user_id="u-owner")
_REF = ResourceRef(kind="persona", ref_id="persona-1", owner_id="u-owner")

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


def _pool(n: int) -> CandidatePool:
    pois = tuple(_poi_with(f"c{i:03d}") for i in range(1, n + 1))
    return CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=_NOW
    )


class _Store:
    def get(self, ref: ResourceRef) -> object | None:
        return _PERSONA


def _cfg(**overrides) -> C1Config:
    return C1Config(
        model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"}, **overrides
    )


def _fast_cfg() -> C1Config:
    """벽시계 테스트용 — 소예산(1s 미만)에서도 40건 풀이 정확히 2청크가 되게
    공식 파라미터를 조정 (base 0·per_item 1·safety 1 → c* = chunk_max = 20)."""
    return _cfg(
        score_base_ms=0,
        score_per_item_ms=1,
        score_safety=1.0,
        score_chunk_min=5,
        score_chunk_max=20,
    )


def _worker(llm, cfg: C1Config | None = None) -> tuple[PreferenceScoringWorker, InMemoryTrace]:
    cfg = cfg or _cfg()
    trace = InMemoryTrace()
    gateway = GatewayFacade(
        llm, PromptRegistry(_PROMPTS_DIR), ClosedSetGate(), cfg, trace
    )
    return PreferenceScoringWorker(gateway, ContextResolver(_Store())), trace


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
    def __init__(self) -> None:
        self.requests: list[LlmRequest] = []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)  # list.append는 GIL 원자적 — 동시 호출 안전
        return _echo_response(request, _CANDIDATE_LINE.findall(request.prompt))


class _BlockOnPoiLlm(_EchoScoresLlm):
    """특정 poi_id가 실린 청크만 release 신호까지 블록 — 마감 초과 청크 재현.

    done은 블록됐던 유기 스레드가 응답을 완성한 시점 신호 (늦은 완료 재현).
    """

    def __init__(self, poison: str, release: threading.Event,
                 done: threading.Event | None = None) -> None:
        super().__init__()
        self._poison = poison
        self._release = release
        self._done = done

    def invoke(self, request: LlmRequest) -> LlmResponse:
        ids = _CANDIDATE_LINE.findall(request.prompt)
        if self._poison in ids:
            # 마감(초 단위)보다 훨씬 길게 붙잡는다 — 테스트가 끝나면 release로 즉시 해제
            self._release.wait(timeout=15.0)
            response = _echo_response(request, ids)
            if self._done is not None:
                self._done.set()
            return response
        return _echo_response(request, ids)


class _DelayOnPoiLlm(_EchoScoresLlm):
    """특정 poi_id가 실린 청크만 살짝 지연 — 도착 순서 뒤집기 (마감 안 완료)."""

    def __init__(self, poison: str, delay_sec: float) -> None:
        super().__init__()
        self._poison = poison
        self._delay_sec = delay_sec

    def invoke(self, request: LlmRequest) -> LlmResponse:
        ids = _CANDIDATE_LINE.findall(request.prompt)
        if self._poison in ids:
            time.sleep(self._delay_sec)
        return _echo_response(request, ids)


def _value_ids(result) -> list[str]:
    return [str(sp.poi_id) for sp in result.value]


# ── ① 적응형 청크 공식 ──────────────────────────────────────────────


@pytest.mark.parametrize(
    ("budget_ms", "expected_c"),
    [
        (14_000, 20),   # TRIP-378 고정 상수 20 재현 (현행 동등)
        (10_000, 10),   # (10000/2 − 3000) ÷ 200
        (8_000, 5),     # (8000/2 − 3000) ÷ 200 = 5 — 딱 chunk_min 경계
        (4_000, 5),     # 음수 → chunk_min 클램프
        (100_000, 40),  # 대예산 → chunk_max 클램프
    ],
)
def test_adaptive_chunk_size_formula(budget_ms: int, expected_c: int) -> None:
    assert adaptive_chunk_size(budget_ms, _cfg()) == expected_c


@pytest.mark.parametrize(
    ("pool_size", "expected_n"),
    [(40, 2), (100, 5), (193, 10), (250, 10)],  # 예산 14s(c*=20) — TRIP-378 N 표 유지
)
def test_parallelism_table_kept_at_14s_budget(pool_size: int, expected_n: int) -> None:
    llm = _EchoScoresLlm()
    worker, _ = _worker(llm)

    worker.score(_pool(pool_size), _REF, _PRINCIPAL, _TRACE_ID, _NOW, timeout_sec=14.0)

    assert len(llm.requests) == expected_n


def test_chunk_size_follows_budget() -> None:
    """같은 풀 20건 — 예산 14s면 단일 호출(≤ c*=20), 8s면 c*=5 → 4청크."""
    llm14, llm8 = _EchoScoresLlm(), _EchoScoresLlm()
    worker14, _ = _worker(llm14)
    worker8, _ = _worker(llm8)

    worker14.score(_pool(20), _REF, _PRINCIPAL, _TRACE_ID, _NOW, timeout_sec=14.0)
    worker8.score(_pool(20), _REF, _PRINCIPAL, _TRACE_ID, _NOW, timeout_sec=8.0)

    assert len(llm14.requests) == 1
    assert len(llm8.requests) == 4


# ── ② 벽시계 강제 — 마감 초과 청크 실패 처리 + 단계 소요 유계 ───────


def test_deadline_exceeding_chunk_fails_and_stage_stays_bounded() -> None:
    """첫 청크(c001~c020)가 마감(0.5s)을 넘겨 블록 → 실패 처리, 성공분만 수용.

    소요 단언은 여유 마진(3s) — 벽시계가 없었다면 블록 해제(15s)까지 기다렸을
    것이므로, 마진이 커도 "슬로 테일이 단계를 잠식하지 못한다"는 증명은 유효하다.
    """
    release = threading.Event()
    worker, trace = _worker(_BlockOnPoiLlm("c001", release), cfg=_fast_cfg())

    started = time.monotonic()
    result = worker.score(
        _pool(40), _REF, _PRINCIPAL, _TRACE_ID, _NOW, timeout_sec=0.5
    )
    elapsed = time.monotonic() - started
    release.set()  # 유기 스레드 즉시 해제 (테스트 위생 — 인터프리터 종료 대기 방지)

    assert elapsed < 3.0                                # 마감 0.5s + 여유 마진
    assert result.is_fallback is False                  # 성공분이 있다 — 폴백 아님
    assert sorted(_value_ids(result)) == [f"c{i:03d}" for i in range(21, 41)]
    assert result.error is not None
    assert result.error.startswith("partial_chunks_failed:1/2")
    events = trace.of_type(ScoreChunkEvent)
    assert len(events) == 1
    assert (events[0].success_count, events[0].failure_count) == (1, 0)
    assert events[0].timed_out_count == 1               # 사유 구분: 실패 아닌 마감초과


def test_all_chunks_timed_out_is_fallback_signal() -> None:
    """전 청크 마감초과 — 완료 결과가 하나도 없어도 폴백 신호는 명시적 (INV-4)."""
    release = threading.Event()

    class _BlockAll(_EchoScoresLlm):
        def invoke(self, request: LlmRequest) -> LlmResponse:
            release.wait(timeout=15.0)  # 두 청크 모두 마감 너머까지 블록
            return _echo_response(request, _CANDIDATE_LINE.findall(request.prompt))

    worker, trace = _worker(_BlockAll(), cfg=_fast_cfg())

    result = worker.score(
        _pool(40), _REF, _PRINCIPAL, _TRACE_ID, _NOW, timeout_sec=0.5
    )
    release.set()

    assert result.is_fallback is True and result.value is None
    assert result.error is not None
    assert result.error.startswith("all_chunks_failed:2")
    assert "stage_deadline" in result.error             # 완료 결과가 없을 때의 사유
    events = trace.of_type(ScoreChunkEvent)
    assert (events[0].success_count, events[0].failure_count) == (0, 0)
    assert events[0].timed_out_count == 2


# ── ③ 유기 스레드의 늦은 완료는 폐기 ────────────────────────────────


def test_late_orphan_completion_is_discarded() -> None:
    release = threading.Event()
    done = threading.Event()
    worker, trace = _worker(
        _BlockOnPoiLlm("c001", release, done), cfg=_fast_cfg()
    )

    result = worker.score(
        _pool(40), _REF, _PRINCIPAL, _TRACE_ID, _NOW, timeout_sec=0.5
    )
    # 마감 후 유기 스레드를 풀어 늦은 응답을 완성시킨다
    release.set()
    assert done.wait(timeout=5.0)                       # 늦은 완료가 실제로 일어났다

    # 이미 반환된 병합 결과·관측에 늦은 결과는 반영되지 않는다 (폐기)
    assert "c001" not in _value_ids(result)
    assert sorted(_value_ids(result)) == [f"c{i:03d}" for i in range(21, 41)]
    events = trace.of_type(ScoreChunkEvent)
    assert len(events) == 1                             # 요약 관측도 마감 시점 그대로
    assert events[0].timed_out_count == 1


# ── ④ 병합 결정론 — 도착 순서와 무관 ────────────────────────────────


def test_merge_is_deterministic_regardless_of_arrival_order() -> None:
    """첫 청크를 지연시켜 도착 순서를 뒤집어도(2번 청크 먼저 완료) 산출 동일."""
    shuffled = _DelayOnPoiLlm("c001", delay_sec=0.2)    # 마감(14s) 안 — 완료는 된다
    plain = _EchoScoresLlm()
    worker_s, _ = _worker(shuffled)
    worker_p, _ = _worker(plain)

    r_shuffled = worker_s.score(
        _pool(40), _REF, _PRINCIPAL, _TRACE_ID, _NOW, timeout_sec=14.0
    )
    r_plain = worker_p.score(
        _pool(40), _REF, _PRINCIPAL, _TRACE_ID, _NOW, timeout_sec=14.0
    )

    assert _value_ids(r_shuffled) == _value_ids(r_plain)          # 도착 순서 무관
    assert _value_ids(r_shuffled) == sorted(_value_ids(r_shuffled))  # 인덱스 순 병합


# ── ⑤ 관측 사유 구분 직렬화 + 설정 검증 ─────────────────────────────


def test_score_chunk_event_roundtrip_with_timed_out_count() -> None:
    """timed_out 필드 왕복 — trace_events() generator 편입으로 U5-P10 PBT에도 자동
    포함된다 (test_observability_skeleton의 직렬화 왕복)."""
    ev = ScoreChunkEvent(
        trace_id=_TRACE_ID,
        occurred_at=_NOW,
        component="c1.worker.preference",
        feature="PREFERENCE_SCORING",
        pool_size=40,
        chunk_count=2,
        success_count=1,
        failure_count=0,
        timed_out_count=1,
    )

    assert ev.to_dict()["timed_out_count"] == 1
    assert ScoreChunkEvent.from_dict(ev.to_dict()) == ev


@pytest.mark.parametrize(
    "bad",
    [
        {"score_base_ms": -1},
        {"score_per_item_ms": 0},
        {"score_safety": 0.9},
        {"score_chunk_min": 0},
        {"score_chunk_min": 10, "score_chunk_max": 9},
        {"score_max_parallel": 0},
    ],
)
def test_config_rejects_invalid_chunk_params(bad: dict) -> None:
    with pytest.raises(ValueError):
        _cfg(**bad)
