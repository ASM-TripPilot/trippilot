"""EXIST-A1~A8 — 지도 미검출 **점수 강등** (TRIP-904 · ScheduleAgent ②′).

| 속성 | 내용 |
|---|---|
| EXIST-A1 | **미주입 불변**: `existence=None` 이면 후보(점수 포함)가 종전과 같다 — 호출·강등 기록 0 |
| **EXIST-A2** | **강등이지 배제가 아니다**: NOT_FOUND 0~100% 스윕에 poi_id 순서·개수·집합 불변, 점수 ≤ 입력, 입력 > 0 ⇒ 결과 > 0 |
| **EXIST-A3** | **UNVERIFIED 는 강등 대상이 아니다**: FOUND·UNVERIFIED 만이면 결과 == 입력, 3상태 혼합은 UNVERIFIED→FOUND 치환표와 결과가 같다 |
| EXIST-A4 | NOT_FOUND 만 **정확히** max(점수 − penalty, 점수 × factor) (점수 ≤ 0 은 그대로) — config 값으로, 나머지는 입력 그대로. 오라클은 산식을 **테스트가 따로 적은 것**이다 |
| EXIST-A5 | 계약 깨는 포트(결손·중복·뒤섞임·유령 id·모순 판정·묻지 않은 id 판정·예외)에도 후보 손실·중복·이중 강등 0 |
| EXIST-A6 | 조회 계약: 호출 1회, 대상 = 점수 상위 N(제외·고정·풀 밖 빠짐, 점수↓→poi_id 순), 개수 ≤ top_n, 마감 = min(config, 잔여 − 어셈블리 바닥) |
| EXIST-A7 | 결정론: 같은 입력·같은 fake 두 번 → 같은 후보·같은 강등 기록·같은 호출 장부 |
| EXIST-A8 | 설정 검증: top_n ≤ 0 · deadline ≤ 0 · factor ∉ (0, 1] · penalty ∉ [0, ∞) → `OrchestratorConfig` ValueError. 설정 정본은 한 곳 |
| (물림) | 실 어댑터(`KakaoExistenceAdapter`) + 전송 fake 로 A2·A3 재확인 — 장애·형식 밖·예산 0·마감 부분 검증 |
| (D37) | 전송 계층 지뢰 위에서 `run()` — 실 HTTP 0건 |
| (배선) | 합성 루트(`build_orchestrator`·`build_dev_app`)에 꽂은 포트가 ②′ 까지 **실제로 닿는다** |

**이력.** `test_poi_curation_existence_demote.py`(POOL-P7~P14, 풀 빌더 대상)의 후신이다.
TRIP-683 은 `CandidatePoolBuilder` 가 풀 **순서**만 바꿨는데 이후 아무도 풀 순서를 읽지
않아 일정에 효과가 0이었고(TRIP-898), TRIP-904 가 검증을 점수 뒤·어셈블리 앞(②′)으로
옮겨 **점수**를 깎는다. 속성 대응: P7→A1 · P8→A2 · P9→A3 · P11→A7 · P12→A6 · P13→A5 ·
P14→A8 · 물림→물림. **P10(풀 정렬 키 우선순위)은 옮기지 않았다** — 존재하지 않는 동작이다.
풀 정렬 키 자체(영업시간·saved_count)는 `test_poi_curation_pool.py` 소관이다.
옛 P12 "생존분 **전원** 조회"도 폐기 — 이제 대상은 점수 상위 N 이고, 기본 N=50 을 실제로
밟는 케이스(후보 51건 이상)를 A6 에 넣었다(옛 파일은 풀이 ≤15건이라 한 번도 안 밟았다).

**적대적 우선.** 이 신호의 위험은 "폐업을 못 잡는 것"이 아니라 **"멀쩡한 가게를 버리는
것"**이다 — 실측(영업 중 오탐 4.0% × 모집단 배수 36 = 잘못 버리는 305건 vs 잡는 폐업
102건)이 배제를 기각했다. 그래서 무게중심은 성공 경로가 아니라 **"어떤 판정이 와도
후보가 사라지지 않는가 / 장애가 점수를 바꾸지 않는가 / 묻지 않은 것은 깎이지 않는가"**다.

**점수 도메인.** 생성 점수는 **음이 아닌 유한값**이다 — 게이트가 [0, 1] 로 클램프하고,
규칙 점수는 경계 8종 카테고리에서 [0, ~1.8] 이다. 음수(STAY 원거리 규칙 점수)는 경계 풀에
STAY 가 오지 않아 현재 도달 경로가 없다 — 그래도 음수에 × factor 는 **승격**이 되므로
구현은 0 이하 점수를 건드리지 않고, 그 예제는 `test_schedule_agent.py`
(`test_demotion_never_raises_a_nonpositive_score`)가 고정한다. 또 A2 의 "입력 > 0 ⇒ 결과 > 0" 은 IEEE
언더플로(5e-324 × 0.2 = 0.0)를 피하려고 점수는 subnormal 을 빼고 배율은 1e-3 이상에서 뽑는다
— 운영 배율은 0.2 다.

실 외부 호출 0건 (D37): 포트 fake(FakeExistence) 또는 실 어댑터 + 전송 fake
(FakeHttpGetJson), 시계는 FakeClock, now 는 tz-aware 고정값(`datetime.now` 금지).
"""

from __future__ import annotations

import inspect
import socket
import urllib.request
from dataclasses import dataclass, fields, replace
from datetime import datetime

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from trippilot.agents.schedule.agent import (
    GenerateItineraryRequest,
    ScheduleAgent,
    demote_missing_on_map,
    demoted_score,
)
from trippilot.agents.schedule.budget import OrchestratorConfig, allocate
from trippilot.agents.schedule.outcome import Degradation, GenerationStatus
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import FixedBlock, TimeWindow
from trippilot.domain.llm import CandidatePool, ScoredPoi
from trippilot.domain.observability import FallbackEvent
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
from trippilot.poi_curation.adapters.kakao_existence import KakaoExistenceAdapter
from trippilot.poi_curation.config import M7Config
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder
from trippilot.ports.place_existence_port import ExistenceStatus, ExistenceVerdict

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_existence import FakeExistence
from tests.fakes.fake_http_get_json import FakeHttpGetJson
from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.poi import candidate_pools, polluted_scored_pois
from tests.generators.poi_curation import (
    kakao_documents,
    malformed_payloads,
    sortable_pois,
)
from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api.wiring import DEMO_ANCHOR, build_dev_app, build_orchestrator

from tests.fakes.in_memory_poi import InMemoryPoi
from tests.test_e2e_boundary import RoutingLlm
from tests.test_e2e_boundary import _C1CFG as _E2E_C1CFG
from tests.test_e2e_boundary import _DAY1 as _E2E_DAY1
from tests.test_e2e_boundary import _POIS as _E2E_POIS
from tests.test_e2e_boundary import _PersonaStore as _E2EPersonaStore
from tests.test_e2e_boundary import _explanations_json as _e2e_explanations
from tests.test_e2e_boundary import _request as _e2e_request
from tests.test_e2e_boundary import _scores_json as _e2e_scores
from tests.test_schedule_agent import _existence_case, _task
from tests.test_schedule_coordinator import (
    _C1CFG,
    _KST,
    _NOW,
    _TRACE_ID,
    _AssemblyProvider,
    _Renderer,
    _request,
    _scores_json,
    _Sink,
)

_FOUND = ExistenceStatus.FOUND
_NOT_FOUND = ExistenceStatus.NOT_FOUND
_UNVERIFIED = ExistenceStatus.UNVERIFIED

_DEFAULT = OrchestratorConfig()
_PENALTY = _DEFAULT.existence_demote_penalty
_GHOST = PoiId("ghost-없는곳")

# 풀 p1~p6(전부 SIGHT)·창 09–12 — test_schedule_agent ②′ e2e 와 같은 무대. LLM 점수는
# 전부 0.9 라 점수 상위 N 은 poi_id 순으로 갈린다(독립 오라클로 쓰기 좋다).
_POOL6, _REQ6 = _existence_case()
_IDS6 = tuple(sorted((str(p) for p in _POOL6.poi_ids)))


# ── 조립 헬퍼 ───────────────────────────────────────────────────────


def _agent(existence=None, *, config: OrchestratorConfig | None = None,
           clock: FakeClock | None = None):
    """ScheduleAgent 실물 — 점수 FakeLlm(p1~p6 전부 0.9), 어셈블리는 기록 퍼사드.

    `test_schedule_agent._agent_with_existence` 와 같은 조립에 config·clock 주입과 sink
    노출만 더했다 — 그 헬퍼는 sink 를 돌려주지 않아 어셈블리에 **실제로 넘어간 후보 점수**를
    볼 수 없다.
    """
    trace, sink = InMemoryTrace(), _Sink()
    gateway = GatewayFacade(FakeLlm(_scores_json(*_IDS6)), _Renderer(),
                            ClosedSetGate(), _C1CFG, trace)
    agent = ScheduleAgent(
        PreferenceScoringWorker(gateway), _AssemblyProvider(trace, sink, primary=True),
        clock if clock is not None else FakeClock(), trace,
        existence=existence, config=config,
    )
    return agent, trace, sink


@dataclass(frozen=True)
class _Case:
    """②′ 입력 한 벌 — 풀·점수 후보(풀 밖 id 섞임 가능)·요청(제외·고정)·판정표."""

    pool: CandidatePool
    candidates: tuple[ScoredPoi, ...]
    request: GenerateItineraryRequest
    table: dict[PoiId, ExistenceStatus]


def _verify(agent: ScheduleAgent, case: _Case, *, total_ms: int = 20_000, t0: int = 0):
    """에이전트 ②′ 를 단독으로 — 점수·어셈블리를 거치지 않아 임의 점수 분포를 넣을 수 있다."""
    steps: list[Degradation] = []
    out = agent._verify_on_map(  # noqa: SLF001 — ②′ 단계 계약을 직접 본다
        case.request, case.pool, case.candidates,
        allocate(total_ms, _DEFAULT), t0, steps, _TRACE_ID, _NOW,
    )
    return out, steps


def _targets(case: _Case, top_n: int) -> list[PoiId]:
    """조회 대상 오라클 — 풀 안·제외 아님·고정 아님 후보를 (점수↓, poi_id↑) 로 줄 세워 상위 N."""
    skip = case.request.excluded_poi_ids | {b.poi_id for b in case.request.fixed_blocks}
    ranked = sorted(
        (c for c in case.candidates
         if c.poi_id in case.pool.poi_ids and c.poi_id not in skip),
        key=lambda c: (-c.score, str(c.poi_id)),
    )
    return [c.poi_id for c in ranked[:top_n]]


def _verdict(pid: PoiId, status: ExistenceStatus) -> ExistenceVerdict:
    return ExistenceVerdict(pid, status, "fake_unverified" if status is _UNVERIFIED else None)


def _verdicts(case: _Case) -> tuple[ExistenceVerdict, ...]:
    """판정표 → 계약을 지키는 판정열(후보 순서대로). 순수 함수 속성의 입력."""
    return tuple(_verdict(c.poi_id, case.table[c.poi_id]) for c in case.candidates)


def _as_found(table: dict[PoiId, ExistenceStatus]) -> dict[PoiId, ExistenceStatus]:
    """UNVERIFIED → FOUND 치환표 — '모른다'가 '없다'로 기울면 이 표와 결과가 갈린다."""
    return {k: (_FOUND if v is _UNVERIFIED else v) for k, v in table.items()}


def _existence_steps(steps) -> list[Degradation]:
    return [d for d in steps if d.stage == "existence"]


def _existence_events(trace) -> list[FallbackEvent]:
    return [e for e in trace.of_type(FallbackEvent) if e.stage == "existence"]


# ── 생성기 (새것은 이 파일 안 — 기존 generator 를 조합만 한다) ─────────
#
# 점수: 음이 아닌 유한값(모듈 docstring '점수 도메인'). 동률이 잦아야 poi_id tie-break 가
# 실제로 순서를 가르는 자리가 생긴다 — 그래서 고정값 몇 개를 섞는다.
_SCORES = st.one_of(
    st.sampled_from([0.0, 0.2, 0.5, 0.9, 1.0]),
    st.floats(0.0, 2.0, allow_nan=False, allow_infinity=False, allow_subnormal=False),
)
# 배율: (0, 1]. 하한 1e-3 은 언더플로 회피용이고, 운영 기본값 0.2 와 무강등 끝값 1.0 을 늘 섞는다.
_FACTORS = st.one_of(st.sampled_from([0.2, 1.0]), st.floats(1e-3, 1.0))
# 감점: [0, ∞) 중 운영 기본 0.3 과 무감점 0.0 을 늘 섞는다.
_PENALTIES = st.one_of(st.sampled_from([0.0, 0.3]),
                       st.floats(0.0, 1.0, allow_subnormal=False))


def _expected_demotion(score: float, *, factor: float, penalty: float) -> float:
    """강등 산식 오라클 — `agent.demoted_score` 를 부르지 않고 설계(TRIP-904 리뷰 반영)를 따로 적었다.

    구현 함수를 오라클로 쓰면 그 함수 안의 변이(배율 무시·하드코딩 등)가 양쪽에 똑같이 들어가
    A4 가 아무것도 증명하지 못한다. 산식을 바꾸면 구현과 이 줄을 **둘 다** 고친다.
    """
    return score if score <= 0 else max(score - penalty, score * factor)


_FIXED_WINDOW = TimeWindow(start=datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
                           end=datetime(2026, 8, 5, 10, 0, tzinfo=_KST))
_THREE = (_FOUND, _NOT_FOUND, _UNVERIFIED)


def _pool_of(pois) -> CandidatePool:
    return CandidatePool(poi_ids=frozenset(p.poi_id for p in pois), pois=tuple(pois),
                         generated_at=_NOW)


def _pools(*, min_size: int = 0, max_size: int = 10) -> st.SearchStrategy[CandidatePool]:
    """풀 두 갈래 — `candidate_pools`(임의 유니코드 id, ≤ 6건) | `sortable_pois` 목록(정돈된 id).

    큰 풀(min_size > 6)이 필요하면 뒤 갈래만 쓴다.
    """
    listed = st.lists(sortable_pois(), min_size=min_size, max_size=max_size,
                      unique_by=lambda p: p.poi_id).map(_pool_of)
    if min_size > 6:
        return listed
    return st.one_of(candidate_pools().filter(lambda p: len(p.pois) >= min_size), listed)


@st.composite
def _cases(draw, *, kinds=_THREE, min_pois: int = 0, max_pois: int = 10) -> _Case:
    """후보 = 풀 전원(점수 임의) + 풀 밖 id 0~2건, **순서는 임의 순열**.

    판정표는 kinds 를 순환 적용한 flags 로 만든다 — 길이 1 이면 0%·100% 가 되어
    오염률 0~100% 를 쓸어낸다(옛 `_statuses` 와 같은 손잡이).
    """
    pool = draw(_pools(min_size=min_pois, max_size=max_pois))
    ids = sorted(pool.poi_ids, key=str)
    own = [ScoredPoi(pid, draw(_SCORES), draw(st.booleans())) for pid in ids]
    foreign = [replace(sp, score=draw(_SCORES)) for sp in draw(st.lists(
        polluted_scored_pois(pool), max_size=2, unique_by=lambda sp: sp.poi_id))]
    candidates = tuple(draw(st.permutations(own + foreign)))

    excluded = frozenset(draw(st.lists(st.sampled_from(ids), unique=True,
                                       max_size=min(3, len(ids))))) if ids else frozenset()
    fixed_ids = draw(st.lists(st.sampled_from(ids), unique=True,
                              max_size=min(3, len(ids)))) if ids else []
    request = _request(
        excluded=excluded,
        fixed_blocks=tuple(FixedBlock(pid, _FIXED_WINDOW, "must") for pid in fixed_ids),
    )

    flags = draw(st.lists(st.sampled_from(kinds), min_size=1, max_size=12))
    table = {c.poi_id: flags[i % len(flags)]
             for i, c in enumerate(sorted(candidates, key=lambda c: str(c.poi_id)))}
    return _Case(pool, candidates, request, table)


_PBT = settings(max_examples=150, deadline=None)
_AGENT_PBT = settings(max_examples=100, deadline=None)
_RUN_PBT = settings(max_examples=25, deadline=None)


# ── EXIST-A1: 미주입 불변 ───────────────────────────────────────────
#
# "포트 호출 0건"은 장부로 관찰할 수 없다 — 미주입이면 부를 대상 자체가 없다. 그래서
# 여기서는 (a) 후보가 **바이트 단위로 같은가**, (b) 시간이 없어도 강등 기록이 **없는가**
# (기능 부재 ≠ 강등)를 못 박고, 몰래 전송을 자작하는 회귀는 아래 D37 지뢰가 잡는다.


@_AGENT_PBT
@given(case=_cases(), total_ms=st.integers(0, 30_000), elapsed=st.integers(0, 40_000))
def test_exist_a1_no_port_returns_candidates_untouched(case, total_ms, elapsed) -> None:
    """미주입이면 어떤 후보·어떤 잔여 시간(0·음수 포함)에도 입력 그대로, 강등 기록 0."""
    agent, trace, _ = _agent(None, clock=FakeClock(start_ms=elapsed))

    out, steps = _verify(agent, case, total_ms=total_ms, t0=0)

    assert out == case.candidates
    assert steps == []
    assert _existence_events(trace) == []


def test_exist_a1_run_without_port_hands_scoring_output_to_assembly() -> None:
    """e2e — 어셈블리가 받은 후보 = 점수 단계 산출 그대로(LLM 0.9 × 6), 상태 SUCCESS.

    전부 FOUND 인 포트를 꽂은 실행과도 **완전히 같다** — 강등할 근거가 없으면 흔적도 없다.
    """
    agent, _, sink = _agent(None)
    outcome = agent.run(_task(_POOL6, request=_REQ6))

    (problem,) = sink.problems
    assert sorted(str(c.poi_id) for c in problem.candidates) == list(_IDS6)
    assert all(c.score == 0.9 and c.is_llm_score for c in problem.candidates)
    assert outcome.status is GenerationStatus.SUCCESS
    assert _existence_steps(outcome.degradations) == []

    fake = FakeExistence(default=_FOUND)
    found_agent, _, found_sink = _agent(fake)
    found = found_agent.run(_task(_POOL6, request=_REQ6))
    assert fake.call_count == 1
    assert found_sink.problems[0].candidates == problem.candidates
    assert found.solution == outcome.solution
    assert found.status is GenerationStatus.SUCCESS


# ── EXIST-A2: 강등이지 배제가 아니다 (핵심) ─────────────────────────


@_PBT
@given(case=_cases(kinds=(_FOUND, _NOT_FOUND)), factor=_FACTORS)
def test_exist_a2_demotion_never_drops_candidates(case, factor) -> None:
    """NOT_FOUND 0~100% 스윕: poi_id 순서·개수·집합 불변, 점수 ≤ 입력, 입력 > 0 ⇒ 결과 > 0.

    실패하면 강등이 조용히 배제(목록 탈락·점수 0)로 변질된 것이다.
    """
    out = demote_missing_on_map(case.candidates, _verdicts(case), factor, _PENALTY)

    assert [c.poi_id for c in out] == [c.poi_id for c in case.candidates]
    assert len(out) == len(case.candidates)
    assert {c.poi_id for c in out} == {c.poi_id for c in case.candidates}
    for before, after in zip(case.candidates, out):
        assert after.score <= before.score
        if before.score > 0:
            assert after.score > 0, f"{before.poi_id}: {before.score} → 0 (배제로 변질)"
        assert after.is_llm_score == before.is_llm_score


@_PBT
@given(case=_cases(), factor=_FACTORS)
def test_exist_a2_all_not_found_never_reverses_ranking(case, factor) -> None:
    """**전부 미검출이면 점수 순위가 뒤집히지 않는다** — 다 같이 깎이면 제자리다.

    "전부 폐업으로 찍히는 날"이 최악이 아니라 무해하다는 뜻. 부동소수 반올림이 인접값을
    동률로 합칠 수는 있어 약단조(a > b ⇒ a′ ≥ b′, a = b ⇒ a′ = b′)로 주장한다.
    """
    all_missing = tuple(ExistenceVerdict(c.poi_id, _NOT_FOUND) for c in case.candidates)
    out = demote_missing_on_map(case.candidates, all_missing, factor, _PENALTY)

    pairs = list(zip(case.candidates, out))
    for a, a2 in pairs:
        for b, b2 in pairs:
            if a.score > b.score:
                assert a2.score >= b2.score
            elif a.score == b.score:
                assert a2.score == b2.score


@_AGENT_PBT
@given(case=_cases(kinds=(_FOUND, _NOT_FOUND)))
def test_exist_a2_agent_sweep_keeps_every_candidate(case) -> None:
    """에이전트 경유 스윕 — 포트가 무엇을 NOT_FOUND 로 찍든 후보 목록은 그대로다."""
    agent, _, _ = _agent(FakeExistence(case.table))

    out, _ = _verify(agent, case)

    assert [c.poi_id for c in out] == [c.poi_id for c in case.candidates]
    for before, after in zip(case.candidates, out):
        assert after.score <= before.score
        assert (after.score > 0) == (before.score > 0)


# ── EXIST-A3: UNVERIFIED 는 강등 대상이 아니다 ─────────────────────


@_PBT
@given(case=_cases(kinds=(_FOUND, _UNVERIFIED)), factor=_FACTORS)
def test_exist_a3_found_and_unverified_only_is_identity(case, factor) -> None:
    """실패율 0~100%: NOT_FOUND 가 한 건도 없으면 결과 == 입력 (장애 ≠ 폐업)."""
    assert demote_missing_on_map(case.candidates, _verdicts(case), factor, _PENALTY) == case.candidates


@_PBT
@given(case=_cases(), factor=_FACTORS)
def test_exist_a3_unverified_ranks_with_found(case, factor) -> None:
    """3상태 임의 혼합: UNVERIFIED 를 FOUND 로 바꾼 판정표와 결과가 같다."""
    swapped = replace(case, table=_as_found(case.table))
    assert (demote_missing_on_map(case.candidates, _verdicts(case), factor, _PENALTY)
            == demote_missing_on_map(case.candidates, _verdicts(swapped), factor, _PENALTY))


@_AGENT_PBT
@given(case=_cases())
def test_exist_a3_agent_unverified_equals_found(case) -> None:
    """에이전트 경유 — 후보는 치환표와 같다. 다른 것은 '전량 확인 실패' 강등 기록뿐이다."""
    out, _ = _verify(_agent(FakeExistence(case.table))[0], case)
    swapped, _ = _verify(_agent(FakeExistence(_as_found(case.table)))[0], case)
    assert out == swapped


@_AGENT_PBT
@given(case=_cases(min_pois=1))
def test_exist_a3_port_all_unverified_changes_nothing_but_says_so(case) -> None:
    """포트가 통째로 죽어(전부 UNVERIFIED) 돌아오면 후보 그대로 + 강등 1건 + 이벤트 (INV-4).

    장애를 강등으로 수렴시키면 벤더가 죽는 날 후보 점수가 통째로 깎인다.
    """
    fake = FakeExistence(default=_UNVERIFIED)
    agent, trace, _ = _agent(fake)

    out, steps = _verify(agent, case)

    assert out == case.candidates
    if fake.call_count:  # 조회 대상이 있었을 때만 판정이 온다
        assert [d.reason for d in _existence_steps(steps)] == [
            "existence_unverified: fake_unverified"]
        assert [e.component for e in _existence_events(trace)] == ["agents.schedule"]
    else:
        assert steps == []


# ── EXIST-A4: NOT_FOUND 만 정확히 factor 배 ────────────────────────


@_PBT
@given(case=_cases(), factor=_FACTORS, penalty=_PENALTIES)
def test_exist_a4_only_not_found_is_scaled_exactly(case, factor, penalty) -> None:
    """각 후보 점수 == 산식값 (NOT_FOUND) 또는 입력 그대로 — 다른 필드는 불변."""
    out = demote_missing_on_map(case.candidates, _verdicts(case), factor, penalty)

    for before, after in zip(case.candidates, out):
        if case.table[before.poi_id] is _NOT_FOUND:
            assert after == replace(before, score=_expected_demotion(
                before.score, factor=factor, penalty=penalty))
        else:
            assert after == before


@_AGENT_PBT
@given(case=_cases(), factor=_FACTORS, penalty=_PENALTIES)
def test_exist_a4_agent_applies_configured_factor_to_asked_not_found_only(
    case, factor, penalty
) -> None:
    """에이전트는 **config 의** 배율·감점으로, **물어본** NOT_FOUND 에만 한 번 강등한다."""
    fake = FakeExistence(case.table)
    agent, _, _ = _agent(fake, config=OrchestratorConfig(
        existence_demote_factor=factor, existence_demote_penalty=penalty))

    out, _ = _verify(agent, case)

    asked = set(fake.queried_ids)
    for before, after in zip(case.candidates, out):
        if before.poi_id in asked and case.table[before.poi_id] is _NOT_FOUND:
            assert after.score == _expected_demotion(before.score, factor=factor, penalty=penalty)
        else:
            assert after == before


@_PBT
@given(score=st.floats(-2.0, 2.0, allow_nan=False, allow_subnormal=False),
       factor=_FACTORS, penalty=_PENALTIES)
def test_exist_a4_demoted_score_matches_spec(score, factor, penalty) -> None:
    """공개 산식 함수 == 독립 오라클 — 음수·0 은 그대로(승격 금지), 양수는 두 항 중 큰 쪽."""
    assert demoted_score(score, factor=factor, penalty=penalty) == _expected_demotion(
        score, factor=factor, penalty=penalty)


# ── EXIST-A5: 포트가 계약을 깨도 후보를 잃지 않는다 ─────────────────


def _mangle_contradict(vs):
    """같은 id 에 원래 판정 + NOT_FOUND + 원래 판정 — 모순·중복 판정 (이중 강등 유혹)."""
    return vs + tuple(ExistenceVerdict(v.poi_id, _NOT_FOUND) for v in vs) + vs


_MANGLERS = {
    "empty": lambda vs: (),                                         # 판정을 통째로 빼먹음
    "half": lambda vs: vs[::2],                                     # 절반 결손
    "reversed": lambda vs: tuple(reversed(vs)),                     # 순서 뒤집힘
    "duplicated": lambda vs: vs + vs + vs,                          # 중복 판정
    "ghost": lambda vs: vs + (ExistenceVerdict(_GHOST, _NOT_FOUND),),   # 유령 poi_id
    "contradict": _mangle_contradict,
}


def _check_intact(case: _Case, out, fake: FakeExistence, factor: float) -> None:
    """A5 공통 단언 — 목록 불변, 강등은 '물어봤고 NOT_FOUND 가 실제로 돌아온' id 에만 한 번."""
    assert [c.poi_id for c in out] == [c.poi_id for c in case.candidates]
    assert _GHOST not in {c.poi_id for c in out}
    demotable = fake.not_found_ids & set(fake.queried_ids)
    for before, after in zip(case.candidates, out):
        expected = (_expected_demotion(before.score, factor=factor, penalty=_PENALTY)
                    if before.poi_id in demotable else before.score)
        assert after.score == expected, f"{before.poi_id}: {before.score} → {after.score}"
        assert after.is_llm_score == before.is_llm_score


@_AGENT_PBT
@given(case=_cases(), kind=st.sampled_from(sorted(_MANGLERS)))
def test_exist_a5_broken_port_contract_keeps_candidates_intact(case, kind) -> None:
    """결손·중복·뒤섞임·유령 id·모순 판정 어느 사고에도 후보 손실·중복·이중 강등 0.

    호출측이 포트의 개수·순서 계약에 **매달려 있으면**(zip 으로 짝짓기 등) 벤더 어댑터
    교체 한 번에 엉뚱한 후보가 깎이거나 사라진다. 판정은 집합으로만 읽어야 한다.
    """
    fake = FakeExistence(case.table, mangle=_MANGLERS[kind])

    out, _ = _verify(_agent(fake)[0], case)

    _check_intact(case, out, fake, _DEFAULT.existence_demote_factor)


@_AGENT_PBT
@given(case=_cases(), top_n=st.integers(1, 4))
def test_exist_a5_verdicts_for_unasked_ids_are_ignored(case, top_n) -> None:
    """포트가 **묻지 않은** 후보(상위 N 밖·제외·고정·풀 밖)까지 NOT_FOUND 로 찍어 와도 무시.

    사칭 판정을 받아들이면 조회 대상 규칙(A6)이 강등 범위를 더는 묶지 못한다.
    """
    everyone = tuple(ExistenceVerdict(c.poi_id, _NOT_FOUND) for c in case.candidates)
    fake = FakeExistence(case.table, mangle=lambda vs: vs + everyone)
    agent, _, _ = _agent(fake, config=OrchestratorConfig(existence_verify_top_n=top_n))

    out, _ = _verify(agent, case)

    asked = set(fake.queried_ids)
    for before, after in zip(case.candidates, out):
        if before.poi_id not in asked:
            assert after == before, f"묻지 않은 {before.poi_id} 가 깎였다"
    _check_intact(case, out, fake, _DEFAULT.existence_demote_factor)


@_AGENT_PBT
@given(case=_cases(min_pois=1),
       exc=st.sampled_from([TimeoutError("timed out"), ConnectionError("reset"),
                            RuntimeError("vendor down"), ValueError("bad key"),
                            KeyError("documents")]))
def test_exist_a5_raising_port_changes_nothing_but_says_so(case, exc) -> None:
    """포트가 예외를 던져도(DL-5 위반) 후보 그대로 + 강등 1건 + 이벤트 — 생성은 산다."""
    class _Raising:
        calls = 0

        def verify(self, queries, *, deadline_ms):
            _Raising.calls += 1
            raise exc

    agent, trace, _ = _agent(_Raising())

    out, steps = _verify(agent, case)

    assert out == case.candidates
    if _Raising.calls:
        (step,) = _existence_steps(steps)
        assert step.reason.startswith(f"existence_error: {type(exc).__name__}")
        assert [e.component for e in _existence_events(trace)] == ["agents.schedule"]
    else:
        assert steps == []


# ── EXIST-A6: 조회 계약 (대상·횟수·마감) ────────────────────────────


@_AGENT_PBT
@given(case=_cases(),
       top_n=st.integers(1, 8), deadline=st.integers(1, 5_000),
       total_ms=st.integers(1_000, 30_000), t0=st.integers(0, 10**6),
       elapsed_share=st.floats(0.0, 1.0))
def test_exist_a6_query_contract(case, top_n, deadline, total_ms, t0, elapsed_share) -> None:
    """호출 ≤ 1회 · 대상 = 점수 상위 N(제외·고정·풀 밖 제외, 점수↓→poi_id) · 마감 = min(config, 잔여 − 바닥).

    잔여는 **오케스트레이터 시계 원점(t0)** 기준이다. 어셈블리 바닥(c2_reserved_ms)을
    침범할 시간밖에 없으면 부르지 않고 그 사실을 강등으로 남긴다(DL-2 · INV-4).
    """
    elapsed = int(total_ms * elapsed_share)
    cfg = OrchestratorConfig(existence_verify_top_n=top_n, existence_deadline_ms=deadline)
    fake = FakeExistence(default=_FOUND)
    agent, _, _ = _agent(fake, config=cfg, clock=FakeClock(start_ms=t0 + elapsed))

    out, steps = _verify(agent, case, total_ms=total_ms, t0=t0)

    expected = _targets(case, top_n)
    available = total_ms - elapsed - allocate(total_ms, _DEFAULT).c2_reserved_ms
    assert out == case.candidates                        # 전부 FOUND — 무강등
    if not expected:                                     # 물을 것이 없으면 부르지 않는다
        assert fake.calls == [] and steps == []
    elif available <= 0:                                 # 바닥 침범 — 건너뛰고 기록
        assert fake.calls == []
        assert steps == [Degradation(stage="existence",
                                     reason=f"deadline:available={available}ms")]
    else:
        assert fake.call_count == 1                      # POI 마다가 아니라 일괄 1회
        (queries, passed), = fake.calls
        assert [q.poi_id for q in queries] == expected   # 점수 상위부터 — 마감에 잘려도 1순위가 검증된다
        assert len(queries) <= top_n
        assert 0 < passed <= cfg.existence_deadline_ms
        assert passed <= available                       # 어셈블리 바닥 비침범
        assert passed == min(cfg.existence_deadline_ms, available)
        by_id = {p.poi_id: p for p in case.pool.pois}
        for q in queries:                                # 이름만으로는 동명이 걸린다 — 좌표 동봉
            assert (q.name, q.coord) == (by_id[q.poi_id].name, by_id[q.poi_id].coord)
        assert steps == []


@settings(max_examples=15, deadline=None,
          suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large])
@given(case=_cases(min_pois=57, max_pois=70))
def test_exist_a6_default_top_n_caps_queries_at_50(case) -> None:
    """기본 상한 50 을 **반드시 밟는다** — 풀 57건 이상(제외·고정 ≤ 6 빼도 적격 ≥ 51)이면 딱 상위 50."""
    fake = FakeExistence()
    _verify(_agent(fake)[0], case)

    assert _DEFAULT.existence_verify_top_n == 50
    assert len(_targets(case, 10**6)) > 50               # 전제 — 상한이 실제로 걸린다
    assert fake.queried_ids == _targets(case, 50)
    assert len(fake.queried_ids) == 50


@_AGENT_PBT
@given(case=_cases())
def test_exist_a6_nothing_eligible_means_no_call(case) -> None:
    """적격 후보 0건(전원 제외 — 풀 밖 후보만 남음)이면 주입돼 있어도 부르지 않고 기록도 없다."""
    case = replace(case, request=_request(excluded=case.pool.poi_ids))
    fake = FakeExistence(default=_NOT_FOUND)
    agent, trace, _ = _agent(fake)

    out, steps = _verify(agent, case)

    assert fake.calls == []
    assert out == case.candidates and steps == []
    assert _existence_events(trace) == []


@_RUN_PBT
@given(top_n=st.integers(1, 7), deadline=st.integers(1, 20_000),
       excluded=st.sets(st.sampled_from(_IDS6), max_size=3),
       fixed=st.lists(st.sampled_from(_IDS6), unique=True, max_size=2))
def test_exist_a6_run_queries_top_n_of_eligible(top_n, deadline, excluded, fixed) -> None:
    """run() 경유 — LLM 점수가 전부 0.9 동률이라 대상 = 적격 id 를 poi_id 순으로 상위 N.

    고정 블록 창은 겹치지 않게 09:00·10:00 부터 30분씩 둔다(창 09–12).
    """
    blocks = tuple(
        FixedBlock(PoiId(pid), TimeWindow(
            start=datetime(2026, 8, 5, 9 + i, 0, tzinfo=_KST),
            end=datetime(2026, 8, 5, 9 + i, 30, tzinfo=_KST)), "must")
        for i, pid in enumerate(fixed)
    )
    req = replace(_REQ6, excluded_poi_ids=frozenset(PoiId(x) for x in excluded),
                  fixed_blocks=blocks)
    cfg = OrchestratorConfig(existence_verify_top_n=top_n, existence_deadline_ms=deadline)
    fake = FakeExistence(default=_FOUND)
    agent, _, _ = _agent(fake, config=cfg)

    agent.run(_task(_POOL6, request=req))

    eligible = [x for x in _IDS6 if x not in excluded and x not in fixed]
    expected = [PoiId(x) for x in eligible[:top_n]]
    if not expected:
        assert fake.calls == []
        return
    (queries, passed), = fake.calls
    assert [q.poi_id for q in queries] == expected
    # 정지 시계라 잔여 = 20,000 − 바닥 5,000 = 15,000
    assert passed == min(deadline, 20_000 - allocate(20_000, _DEFAULT).c2_reserved_ms)
    assert passed <= cfg.existence_deadline_ms


# ── EXIST-A7: 결정론 ────────────────────────────────────────────────


@_AGENT_PBT
@given(case=_cases(), kind=st.sampled_from(sorted(_MANGLERS)), factor=_FACTORS,
       top_n=st.integers(1, 8), deadline=st.integers(1, 30_000))
def test_exist_a7_same_input_same_output_and_same_calls(case, kind, factor, top_n,
                                                        deadline) -> None:
    """같은 입력·같은 fake 두 번 → 같은 후보·같은 강등 기록·같은 호출 장부 (숨은 상태 없음)."""
    cfg = OrchestratorConfig(existence_verify_top_n=top_n, existence_deadline_ms=deadline,
                             existence_demote_factor=factor)

    def once():
        fake = FakeExistence(case.table, mangle=_MANGLERS[kind])
        out, steps = _verify(_agent(fake, config=cfg)[0], case)
        return out, steps, fake.calls, fake.returned

    assert once() == once()


@_RUN_PBT
@given(kinds=st.lists(st.sampled_from(_THREE), min_size=6, max_size=6))
def test_exist_a7_run_is_deterministic(kinds) -> None:
    """run() 경유 — 판정표가 무엇이든 두 번 돌리면 어셈블리 입력·일정·강등·호출이 같다."""
    table = {PoiId(pid): k for pid, k in zip(_IDS6, kinds)}

    def once():
        fake = FakeExistence(table)
        agent, _, sink = _agent(fake)
        outcome = agent.run(_task(_POOL6, request=_REQ6))
        return sink.problems, outcome, fake.calls

    first, second = once(), once()
    assert first == second
    assert first[1].solution is not None


# ── EXIST-A8: 설정 검증 ─────────────────────────────────────────────


@given(bad=st.integers(max_value=0))
def test_exist_a8_nonpositive_top_n_is_rejected(bad) -> None:
    """상위 0건 검증은 '검증 꺼짐'인데 강등 기록 없이 조용히 꺼진다 — 설정 자체를 막는다."""
    with pytest.raises(ValueError):
        OrchestratorConfig(existence_verify_top_n=bad)


@given(bad=st.integers(max_value=0))
def test_exist_a8_nonpositive_deadline_is_rejected(bad) -> None:
    """마감 ≤ 0 은 전 후보 UNVERIFIED — 설정으로 표현할 수 없게 한다."""
    with pytest.raises(ValueError):
        OrchestratorConfig(existence_deadline_ms=bad)


@given(bad=st.one_of(st.floats(max_value=0.0),                     # 0 = 배제 (9/12 팀 결정)
                     st.floats(min_value=1.0, exclude_min=True),   # > 1 = 승격
                     st.just(float("nan"))))
def test_exist_a8_factor_outside_open_unit_interval_is_rejected(bad) -> None:
    """배율 ∉ (0, 1] → ValueError. 0 은 OR-Tools 방문 이득 0(사실상 배제), 1 초과는 승격, NaN 은 비교 불능."""
    with pytest.raises(ValueError):
        OrchestratorConfig(existence_demote_factor=bad)


@given(top_n=st.integers(1, 10**6), deadline=st.integers(1, 10**7),
       factor=st.floats(0.0, 1.0, exclude_min=True))
def test_exist_a8_valid_values_are_kept_as_is(top_n, deadline, factor) -> None:
    """유효값은 클램프·반올림 없이 그대로 보관 — 포트·강등에 그 값이 간다."""
    cfg = OrchestratorConfig(existence_verify_top_n=top_n, existence_deadline_ms=deadline,
                             existence_demote_factor=factor)
    assert (cfg.existence_verify_top_n, cfg.existence_deadline_ms,
            cfg.existence_demote_factor) == (top_n, deadline, factor)


@given(bad=st.one_of(st.floats(max_value=0.0, exclude_max=True), st.just(float("inf")),
                     st.just(float("nan"))))
def test_exist_a8_penalty_outside_nonnegative_finite_is_rejected(bad) -> None:
    """감점 ∉ [0, ∞) → ValueError. 음수는 승격, 무한·NaN 은 비교 불능."""
    with pytest.raises(ValueError):
        OrchestratorConfig(existence_demote_penalty=bad)


def test_exist_a8_single_source_of_truth_for_existence_settings() -> None:
    """설정·강등 지점은 에이전트 한 곳 — 풀 빌더 쪽에 되살아나면 두 설정이 갈리고 이중 강등이 된다."""
    assert not [f.name for f in fields(M7Config) if "existence" in f.name]
    assert "existence" not in inspect.signature(CandidatePoolBuilder.__init__).parameters


# ── 실 어댑터와 물린 상태 (KakaoExistenceAdapter × ②′) ───────────────
#
# FakeExistence 는 **판정이 오는 경우**만 그린다. 운영에서 실제로 오는 것은 전송 장애·
# 형식 밖 응답·예산·마감에 잘린 **부분 판정**이다(어댑터는 순차 1건=1호출, 재시도 없음).
# 전송은 FakeHttpGetJson, 시계는 FakeClock 논리 시계 — 실 HTTP 0건 (D37).


def _kakao(http, *, max_calls: int = 1_000, clock: FakeClock | None = None):
    return KakaoExistenceAdapter(
        http, "test-rest-key", max_calls=max_calls,
        monotonic_ms=(clock or FakeClock(1_000_000)).monotonic_ms,
    )


_FACTOR = _DEFAULT.existence_demote_factor


@_AGENT_PBT
@given(case=_cases(min_pois=1),
       exc=st.sampled_from([TimeoutError("timed out"), ConnectionError("reset"),
                            OSError("dns failure"), RuntimeError("429")]))
def test_integration_transport_down_changes_nothing(case, exc) -> None:
    """카카오가 죽은 날 후보 점수가 통째로 그대로 — 전송 장애 → 전부 UNVERIFIED → 강등 기록."""
    http = FakeHttpGetJson(default=exc)

    out, steps = _verify(_agent(_kakao(http))[0], case)

    expected = _targets(case, _DEFAULT.existence_verify_top_n)
    assert out == case.candidates
    assert len(http.calls) == len(expected)              # 던져도 호출은 나간다
    if expected:
        (step,) = _existence_steps(steps)
        assert step.reason == f"existence_unverified: http_error:{type(exc).__name__}"


@_AGENT_PBT
@given(case=_cases(min_pois=1), junk=malformed_payloads())
def test_integration_malformed_response_changes_nothing(case, junk) -> None:
    """벤더가 응답 스키마를 바꿔도 강등 0건 (EXIST-P3 의 호출측 대응)."""
    out, steps = _verify(_agent(_kakao(FakeHttpGetJson(default=junk)))[0], case)

    assert out == case.candidates
    if _targets(case, _DEFAULT.existence_verify_top_n):
        assert [d.reason for d in _existence_steps(steps)] == [
            "existence_unverified: malformed_response"]


@_AGENT_PBT
@given(case=_cases(min_pois=1))
def test_integration_zero_call_budget_makes_no_http_and_no_change(case) -> None:
    """예산 0 → HTTP 0건, 후보 그대로 (검증이 꺼져도 생성은 돈다 — 꺼진 사실은 남긴다)."""
    http = FakeHttpGetJson(default=kakao_documents(0))

    out, steps = _verify(_agent(_kakao(http, max_calls=0))[0], case)

    assert http.calls == []
    assert out == case.candidates
    if _targets(case, _DEFAULT.existence_verify_top_n):
        assert [d.reason for d in _existence_steps(steps)] == [
            "existence_unverified: call_budget_exhausted"]


@_AGENT_PBT
@given(case=_cases(min_pois=1))
def test_integration_all_missing_on_map_demotes_but_keeps_every_candidate(case) -> None:
    """전 후보가 지도에 없어도(documents=[]) 목록 불변 — 물어본 것만 정확히 × factor (A2·A4)."""
    http = FakeHttpGetJson(default=kakao_documents(0))

    out, steps = _verify(_agent(_kakao(http))[0], case)

    asked = set(_targets(case, _DEFAULT.existence_verify_top_n))
    assert len(http.calls) == len(asked)
    assert [c.poi_id for c in out] == [c.poi_id for c in case.candidates]
    for before, after in zip(case.candidates, out):
        assert after.score == (_expected_demotion(before.score, factor=_FACTOR, penalty=_PENALTY) if before.poi_id in asked
                               else before.score)
    assert steps == []                                   # 강등은 정상 동작 — 폴백 아님


_REPLIES = {
    "found": kakao_documents(1),
    "missing": kakao_documents(0),
    "error": TimeoutError("timed out"),
    "junk": {"errorType": "RequestThrottled", "message": "quota exceeded"},
}


@_AGENT_PBT
@given(case=_cases(min_pois=1),
       plan=st.lists(st.sampled_from(sorted(_REPLIES)), min_size=1, max_size=12))
def test_integration_unverified_ranks_with_found(case, plan) -> None:
    """응답이 섞여 와도(찾음·없음·장애·형식 밖) 장애·형식 밖을 '찾음'으로 바꾼 세계와 후보가 같고,
    깎인 것은 정확히 documents=[] 를 받은 조회뿐이다 (A3·A4 를 전송 층에서)."""
    targets = _targets(case, _DEFAULT.existence_verify_top_n)
    replies = [plan[i % len(plan)] for i in range(len(targets))]
    healed = ["found" if r in ("error", "junk") else r for r in replies]

    def run(names):
        http = FakeHttpGetJson([_REPLIES[n] for n in names])
        return _verify(_agent(_kakao(http))[0], case)[0]

    out = run(replies)
    assert out == run(healed)
    missing = {pid for pid, r in zip(targets, replies) if r == "missing"}
    for before, after in zip(case.candidates, out):
        assert after.score == (_expected_demotion(before.score, factor=_FACTOR, penalty=_PENALTY) if before.poi_id in missing
                               else before.score)


@_AGENT_PBT
@given(case=_cases(min_pois=2), overrun=st.integers(1, 5_000))
def test_integration_partial_verification_demotes_exactly_the_top_one(case, overrun) -> None:
    """마감이 첫 호출에서 날아가면 **점수 1순위 딱 한 건만** 강등된다 — 나머지는 '모름'.

    운영의 기본 모양이다: 순차 호출 × 1.5s 마감이면 앞 몇 건만 검증된다. 그때 뒤쪽이
    '미검출'로 물들면(또는 검증분이 그대로면) 신호가 거짓말이 된다. 조회 순서가 점수
    내림이라 잘려도 **실제로 배치될 가능성이 가장 큰** 후보가 검증된다.
    """
    clock = FakeClock(1_000_000)
    http = FakeHttpGetJson(
        default=kakao_documents(0),                      # 응답은 전부 '없음'
        on_call=lambda: clock.advance(_DEFAULT.existence_deadline_ms + overrun),
    )

    out, steps = _verify(_agent(_kakao(http, clock=clock))[0], case)

    targets = _targets(case, _DEFAULT.existence_verify_top_n)
    if not targets:
        assert http.calls == [] and out == case.candidates
        return
    assert len(http.calls) == 1                          # 초과는 1건으로 묶인다
    demoted = [a.poi_id for b, a in zip(case.candidates, out) if a != b]
    top = targets[0]
    before_top = next(c for c in case.candidates if c.poi_id == top)
    assert demoted == ([top] if _expected_demotion(before_top.score, factor=_FACTOR, penalty=_PENALTY) != before_top.score else [])
    assert steps == []                                   # 한 건이라도 확인됐다 — 실패 아님


# ── D37: 전송 계층 지뢰 ─────────────────────────────────────────────


def test_d37_run_never_makes_its_own_transport(monkeypatch) -> None:
    """D37 — 에이전트는 전송을 **자작하지 않는다** (실 HTTP 0건).

    미주입 경로의 "호출 0건"은 장부로 못 본다. 대신 전송 계층(urllib·소켓)에 지뢰를 깔아,
    에이전트가 환경변수를 보고 어댑터를 스스로 만들어 나가는 류의 회귀를 잡는다.
    **지뢰는 예외만으로는 부족하다** — `run()` 은 모든 예외를 FAILED 로, ②′ 는 포트 예외를
    강등으로 삼키므로 던지기만 하면 조용히 묻힌다. 밟은 흔적을 따로 적어 단언한다.
    """
    hits: list[str] = []

    def mine(name):
        def boom(*args, **kwargs):
            hits.append(name)
            raise AssertionError(f"실 네트워크 호출이 나갔다 (D37 위반): {name}")
        return boom

    monkeypatch.setattr(urllib.request, "urlopen", mine("urllib.request.urlopen"))
    monkeypatch.setattr(socket.socket, "connect", mine("socket.connect"))
    monkeypatch.setattr(socket.socket, "connect_ex", mine("socket.connect_ex"))
    monkeypatch.setattr(socket, "create_connection", mine("socket.create_connection"))

    fake = FakeExistence(default=_NOT_FOUND)
    http = FakeHttpGetJson(default=kakao_documents(0))
    for port in (None, fake, _kakao(http)):
        outcome = _agent(port)[0].run(_task(_POOL6, request=_REQ6))
        assert outcome.status is not GenerationStatus.FAILED, outcome.error
        assert outcome.solution is not None

    assert hits == []
    assert fake.call_count == 1                          # fake 만 불렸다
    assert len(http.calls) == len(_IDS6)                 # 전송 fake 만 불렸다


# ── (배선) 합성 루트에서 ②′ 까지 포트가 닿는가 ─────────────────────
#
# TRIP-904 가 고친 버그가 바로 이 자리다: 포트는 배선돼 있었지만 강등이 **아무 데도
# 닿지 않아** 효과가 0이었고, 스위트는 전부 초록이었다. 위 속성들은 에이전트에 포트가
# **주어졌을 때**를 증명할 뿐이라, 합성 루트가 그 인자를 빠뜨리면 한 건도 울지 않는다
# (`build_orchestrator(existence=...)` 를 지워도 전 스위트가 통과한다 — 실측).
# 그래서 HTTP 경계에서 "포트가 불렸는가"를 장부로 본다. 경로 전체 관통은
# test_e2e_boundary.py 소관이고, 여기서는 **이 포트의 배선 한 줄**만 못 박는다.


def _wired_client(existence):
    ids = tuple(str(p.poi_id) for p in _E2E_POIS)
    orchestrator = build_orchestrator(
        llm=RoutingLlm(_e2e_scores(*ids), _e2e_explanations(*ids)),
        poi_db=InMemoryPoi(_E2E_POIS),
        context_store=_E2EPersonaStore(),
        c1_config=_E2E_C1CFG,
        clock=FakeClock(),
        trace=InMemoryTrace(),
        existence=existence,
    )
    return TestClient(create_app(orchestrator), raise_server_exceptions=False)


def test_wiring_existence_port_reaches_the_agent() -> None:
    """`build_orchestrator(existence=...)` → ②′ 호출 1회. 전부 미검출이어도 200 (강등 ≠ 배제)."""
    fake = FakeExistence(default=_NOT_FOUND)

    response = _wired_client(fake).post("/ai/v1/itinerary/generate", json=_e2e_request())

    assert response.status_code == 200, response.text
    assert fake.call_count == 1, "합성 루트의 포트가 ②′ 에 닿지 않았다 (TRIP-904 회귀)"
    assert response.json()["days"], "강등이 일정을 비웠다 — 배제로 변질"


def test_wiring_dev_app_passes_existence_through() -> None:
    """`build_dev_app(existence=...)` 도 같은 자리로 관통 — 스모크 조립이 포트를 흘리지 않는다."""
    fake = FakeExistence(default=_FOUND)
    with TestClient(build_dev_app(existence=fake), raise_server_exceptions=False) as client:
        request = _e2e_request()
        request["anchors"] = [{"date": _E2E_DAY1.isoformat(),
                               "lat": DEMO_ANCHOR.lat, "lng": DEMO_ANCHOR.lng}]
        response = client.post("/ai/v1/itinerary/generate", json=request)

    assert response.status_code == 200, response.text
    assert fake.call_count == 1
