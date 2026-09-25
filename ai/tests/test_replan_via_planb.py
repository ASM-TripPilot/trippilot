"""`/replan` 이 PlanBAgent(RAG)를 탄다 — 정본 배정 복원.

정본(`planb-rag-design.md`)의 배정은 PlanBAgent = "여행 중 변수 발생 시 기존 일정 +
페르소나 기반 대안", ScheduleAgent = "백지·여행 전"이다. 그런데 배선은 반대였다 —
PlanBAgent 가 `/alternatives`(트리거를 **지어내는** 경로)에만 붙어 있고, 정작 변수
대응 경로인 `/replan` 은 ScheduleAgent 로만 갔다. 계약에 증거가 있었다:
`ReplanRequest` 독스트링이 "RAG(KB-3)를 탄다"라고 적고 `ReplanResponse.retrieved`
필드가 있는데 **항상 빈 dict** 였다.

증명하는 것 (실 LLM·실 벡터·실 API 0 — D37):
  ① 가산이 **실제로 배치를 바꾼다** — 순서만 바꾸고 아무도 안 읽던 TRIP-898 재발 방지
  ② 빈 랭킹은 무영향 — generate 경로가 종전과 한 글자도 다르지 않다
  ③ 가산은 **강등보다 먼저** — 지도 미검출을 되돌리지 않는다
  ④ 랭킹을 순위표로만 읽는다 — 중복·풀 밖 참조가 후보를 늘리거나 없애지 않는다 (INV-1)
  ⑤ 배선이 `ReplanRequest` 의 재료를 PlanB 가 받도록 실어 보낸다 (placement_reason 포함)
  ⑥ `/replan` 응답이 `retrieved` 를 싣는다 — 계약이 약속한 필드가 채워진다
  ⑦ PlanB 가 LLM 을 못 쓰면 랭킹을 넘기지 않고 그 사실을 남긴다 (INV-4, 침묵 금지)
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime

import pytest
from hypothesis import assume, given, settings, strategies as st

from trippilot.agents.planb.rag import MAX_RANKED
from trippilot.agents.schedule.agent import (
    ScheduleAgent,
    lift_planb_ranked,
    planb_lifted_score,
)
from trippilot.agents.schedule.budget import OrchestratorConfig
from trippilot.agents.schedule.outcome import GenerationStatus
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
from trippilot.poi_curation.config import M7Config
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_existence import FakeExistence
from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_poi import InMemoryPoi
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.test_schedule_agent import _task
from tests.test_schedule_coordinator import (
    _C1CFG,
    _KST,
    _NOW,
    _AssemblyProvider,
    _Renderer,
    _Sink,
    _poi,
    _request,
    _scores_json,
)
from trippilot.ports.place_existence_port import ExistenceStatus

_LIFT = OrchestratorConfig().planb_rank_lift


# ── 공통 케이스 — p1..p6 전부 SIGHT·LLM 점수 동률 0.9, 창 09–12 → 2건 배치 ──


def _case():
    pois = tuple(_poi(i, 0.003 * i) for i in range(1, 7))
    req = replace(_request(), day_window=TimeWindow(
        start=datetime(2026, 8, 5, 9, 0, tzinfo=_KST),
        end=datetime(2026, 8, 5, 12, 0, tzinfo=_KST)))
    pool = CandidatePoolBuilder(InMemoryPoi(pois), M7Config()).build(
        CandidatePoolRequest(anchor=req.anchor, dates=req.days,
                             budget=req.budget, transport=req.transport), _NOW,
    )
    return pool, req


def _agent(existence=None):
    trace = InMemoryTrace()
    gateway = GatewayFacade(
        FakeLlm(_scores_json("p1", "p2", "p3", "p4", "p5", "p6")), _Renderer(),
        ClosedSetGate(), _C1CFG, trace)
    agent = ScheduleAgent(
        PreferenceScoringWorker(gateway), _AssemblyProvider(trace, _Sink(), primary=True),
        FakeClock(), trace, existence=existence,
    )
    return agent, trace


def _placed(outcome) -> list[str]:
    return [str(s.poi_id) for d in outcome.solution.days for s in d.slots]


def _run(rank=(), existence=None):
    pool, req = _case()
    agent, trace = _agent(existence)
    task = replace(_task(pool, request=req), planb_rank=tuple(PoiId(p) for p in rank))
    return agent.run(task), trace


# ── ① 가산이 실제로 배치를 바꾼다 (이 파일의 핵심 단언) ─────────────────


def test_planb_rank_changes_the_itinerary() -> None:
    """배치 안 된 두 곳을 PlanB 상위로 올리면 그 둘이 배치된다 — 가산이 어셈블리에 닿는다.

    이 단언이 없으면 TRIP-898 재발이다: 그때는 풀 **순서**만 바꿨고 이후 누구도 풀
    순서를 읽지 않아 일정에 효과가 0 이었다. 순서가 아니라 **점수**여야 닿는다.
    """
    base, _ = _run()
    first = _placed(base)
    assert len(first) == 2, first  # 전제

    unplaced = [f"p{i}" for i in range(1, 7) if f"p{i}" not in first]
    outcome, trace = _run(rank=unplaced[:2])

    after = _placed(outcome)
    assert after != first, f"가산이 배치를 못 바꿨다 — 둘 다 {first}"
    assert unplaced[0] in after, f"1위로 올린 {unplaced[0]} 가 배치되지 않았다 — {after}"
    assert outcome.status is GenerationStatus.SUCCESS  # 가산은 정상 동작이다 — 폴백 아님

    # 슬롯 수가 줄 수 있다(실측 2 → 1). 가산 대상이 앵커에서 더 먼 곳이면 이동시간이
    # 늘어 3시간 창에 덜 들어간다 — 어셈블리가 제 일을 한 결과이고 결함이 아니다.
    # 가산은 **점수만** 민다: 가해성·시각은 여전히 어셈블리 소유다 (INV-2).


def test_planb_rank_records_how_many_it_lifted() -> None:
    """몇 건을 올렸는지 관측에 남는다 — 랭킹이 풀 밖뿐이면 0 건이고, 그건 RAG 가
    일정에 아무 효과가 없었다는 뜻이다(침묵 금지, INV-4)."""
    _, trace = _run(rank=["p5", "p6"])
    assert any("planb_rank_lifted:2/2" in getattr(e, "reason", "")
               for e in trace.events), "가산 건수를 남기지 않았다"

    _, trace = _run(rank=["없는-poi-1", "없는-poi-2"])
    assert any("planb_rank_lifted:0/2" in getattr(e, "reason", "")
               for e in trace.events), "풀 밖 랭킹이 0 건으로 기록되지 않았다"


# ── ② 빈 랭킹은 무영향 ─────────────────────────────────────────────────


def test_empty_rank_is_byte_identical() -> None:
    """generate 경로는 기본값(빈 튜플)이라 동작이 바뀌지 않는다."""
    assert _placed(_run()[0]) == _placed(_run(rank=())[0])


# ── ③ 가산은 강등보다 먼저 ─────────────────────────────────────────────


def test_lift_does_not_undo_map_miss_demotion() -> None:
    """PlanB 1위(+0.3)이면서 지도 미검출(−0.3)이면 상쇄다 — 되살아나지 않는다.

    가산을 ②′ 뒤에 하면 "사용자 눈에 없는 곳"이 최상위로 되살아난다. 순서가 곧 규율이다.
    """
    base = _placed(_run()[0])
    unplaced = [f"p{i}" for i in range(1, 7) if f"p{i}" not in base]
    target = unplaced[0]

    # 올리기만: 배치된다
    lifted = _placed(_run(rank=[target])[0])
    assert target in lifted

    # 올리고 + 같은 곳을 지도 미검출로: 상쇄되어 다시 안 들어간다
    both = _placed(_run(
        rank=[target],
        existence=FakeExistence({PoiId(target): ExistenceStatus.NOT_FOUND}),
    )[0])
    assert target not in both, "강등이 가산에 되돌려졌다 — ②″ 가 ②′ 뒤로 갔다"


# ── ④ 랭킹은 순위표로만 읽는다 (INV-1) ────────────────────────────────


_SCORED = st.lists(
    st.tuples(st.text(min_size=1, max_size=4), st.floats(-2.0, 2.0)),
    min_size=1, max_size=12,
).map(lambda ps: tuple(
    ScoredPoi(poi_id=PoiId(n), score=s, is_llm_score=False)
    for n, s in {n: s for n, s in ps}.items()))


@given(_SCORED, st.lists(st.text(min_size=1, max_size=4), max_size=16),
       st.floats(0.0, 1.0))
@settings(max_examples=200, deadline=None)
def test_lift_preserves_candidate_set_count_and_order(candidates, ranked, lift) -> None:
    out = lift_planb_ranked(candidates, tuple(PoiId(r) for r in ranked), lift)

    assert len(out) == len(candidates)                              # 개수 불변
    assert [c.poi_id for c in out] == [c.poi_id for c in candidates]  # 순서·집합 불변
    for before, after in zip(candidates, out):
        assert after.score >= before.score                          # 가산은 내리지 않는다
        if before.poi_id not in {PoiId(r) for r in ranked}:
            assert after.score == before.score                      # 랭킹 밖은 무보정


@given(_SCORED, st.lists(st.text(min_size=1, max_size=4), min_size=1, max_size=6),
       st.floats(0.01, 1.0))
@settings(max_examples=200, deadline=None)
def test_duplicate_refs_are_counted_once_at_first_position(candidates, ranked, lift) -> None:
    """중복을 넣어도 두 번 가산되지 않고, 순위는 첫 등장 위치다."""
    doubled = tuple(PoiId(r) for r in ranked) * 2
    once = lift_planb_ranked(candidates, tuple(PoiId(r) for r in ranked), lift)
    twice = lift_planb_ranked(candidates, doubled, lift)

    assert [c.score for c in twice] == [c.score for c in once]


@given(st.floats(-2.0, 2.0), st.integers(0, 30), st.integers(1, 30), st.floats(0.0, 1.0))
def test_lifted_score_is_monotone_in_rank_and_score(score, rank, ranked, lift) -> None:
    assume(rank < ranked)
    here = planb_lifted_score(score, rank, ranked, lift=lift)

    assert here >= score                                   # 가산은 가산이다
    if rank + 1 < ranked:                                  # 아래 순위는 더 적게 받는다
        assert here >= planb_lifted_score(score, rank + 1, ranked, lift=lift)
    # 점수에 대해 증가함수 — 랭킹 안에서의 상대 순서가 뒤집히지 않는다
    assert planb_lifted_score(score + 1.0, rank, ranked, lift=lift) > here


def test_negative_score_is_lifted_too() -> None:
    """멀어서 음수가 된 후보도 PlanB 가 되살릴 수 있다 — `demoted_score` 와 달리
    0 이하를 건드리지 않는 가드가 **없는** 것이 의도다 (곱셈이 아니라 덧셈이라 안전)."""
    assert planb_lifted_score(-0.2, 0, 1, lift=0.3) == pytest.approx(0.1)


def test_rank_is_capped_so_the_envelope_stays_small() -> None:
    """`ranked_poi_ids` 상한이 있다 — 규칙 랭킹 경로는 풀 전체라 상한이 없으면
    `ScheduleTask` 봉투가 풀 크기만큼 커진다."""
    assert 0 < MAX_RANKED <= 50


# ── ⑤ 배선이 ReplanRequest 의 재료를 PlanB 로 실어 보낸다 ─────────────

from trippilot.api import schemas  # noqa: E402
from trippilot.api.wiring import (  # noqa: E402
    _REPLAN_PLANB_BUDGET_SHARE,
    _replan_rag_request,
)
from trippilot.domain.common import TraceId  # noqa: E402
from trippilot.domain.trigger import TriggerKind  # noqa: E402
from tests.test_api_replan_wired import _DIRECTIVES, _body  # noqa: E402


def _rag_request(**over):
    pool, _ = _case()
    notes: list[str] = []
    req = schemas.ReplanRequest(**_body(**over))
    out = _replan_rag_request(
        req, pool, None, {}, TraceId("t-1"), _NOW,
        notes=notes, deadline_ms=20_000,
    )
    return out, notes


def test_placement_reason_reaches_planb_as_affected_reasons() -> None:
    """`ReplanSlotSchema.placement_reason` 이 이 필드를 위해 있다 — 종전 배선에서는
    아무도 읽지 않았다. PlanB 가 "원래 취지를 잇는 대안"을 고르는 컨텍스트다."""
    out, _ = _rag_request(current_slots=[
        {"poi_id": "p1", "start_at": "10:00", "end_at": "11:00",
         "placement_reason": "#뷰맛집 #혼자여행"},
        {"poi_id": "p2", "start_at": "12:00", "end_at": "13:00"},  # 이유 없음
    ])
    assert out.affected_reasons == {"p1": "#뷰맛집 #혼자여행"}


@pytest.mark.parametrize("reason,kind", [
    ("weather", TriggerKind.WEATHER),
    ("closed", TriggerKind.CLOSURE),
    ("fully_booked", TriggerKind.CLOSURE),
    ("delay", TriggerKind.DELAY),
    ("canceled", TriggerKind.DELAY),
    ("fatigue", TriggerKind.MANUAL),
    ("none", TriggerKind.MANUAL),
    ("듣보잡사유", TriggerKind.MANUAL),
])
def test_trigger_kind_is_derived_from_a_real_reason(reason, kind) -> None:
    """`/alternatives` 는 `kind` 를 **지어낸다**(입력에 트리거 정보가 아예 없다).
    여기는 FE 칩에서 온 실값에서 유도한다 — 그 차이가 이 경로를 PlanB 것으로 만든다."""
    out, _ = _rag_request(reasons=[reason])
    assert out.trigger.kind is kind
    assert out.reason == reason


def test_explicit_trigger_wins_over_derivation() -> None:
    """백엔드가 트리거를 보내기 시작하면 유도표는 비켜선다 (계약 §2 "자리만")."""
    out, _ = _rag_request(
        reasons=["weather"],
        trigger={"kind": "DELAY", "schedule_id": "s-9",
                 "affected_date": "2026-09-21", "payload": {"minutes": 40}},
    )
    assert out.trigger.kind is TriggerKind.DELAY
    assert str(out.trigger.schedule_id) == "s-9"
    assert out.trigger.payload == {"minutes": 40}


def test_multiple_reasons_are_not_silently_dropped() -> None:
    """PlanB 는 사유를 하나만 받는다 — 버리는 것을 밝힌다. 조용히 첫 번째만 쓰면
    FE 가 칩 두 개를 눌렀는데 하나만 먹은 것을 알 방법이 없다."""
    out, notes = _rag_request(reasons=["weather", "fatigue"])
    assert out.reason == "weather"
    assert any("planb_reason_truncated" in n and "2건" in n for n in notes), notes


def test_no_reason_falls_back_to_none_without_a_note() -> None:
    out, notes = _rag_request(reasons=[])
    assert out.reason == "none"
    assert not any("truncated" in n for n in notes)


def test_planb_gets_a_share_of_the_request_budget() -> None:
    """예산을 통째로 주면 페르소나 점수 + 어셈블리 몫이 남지 않는다."""
    out, _ = _rag_request()
    assert out.deadline_ms == int(20_000 * _REPLAN_PLANB_BUDGET_SHARE)
    assert 0.0 < _REPLAN_PLANB_BUDGET_SHARE < 1.0


def test_excluded_and_saved_pass_through_to_planb() -> None:
    out, _ = _rag_request(
        excluded_poi_ids=["p9"],
        saved_places=[{"poi_id": "p1", "name": "성산일출봉"}],
    )
    assert out.excluded_poi_ids == frozenset({PoiId("p9")})
    assert [(s.poi_id, s.name) for s in out.saved_places] == [("p1", "성산일출봉")]


# ── ⑥⑦ 통합 — /replan 이 실제로 PlanB 를 태우고 그 사실을 응답에 싣는다 ──

from fastapi.testclient import TestClient  # noqa: E402

from trippilot.api.wiring import build_dev_app  # noqa: E402


def _replan_response(**over):
    with TestClient(build_dev_app(directives=_DIRECTIVES),
                    raise_server_exceptions=False) as client:
        return client.post("/ai/v1/itinerary/replan", json=_body(**over))


def test_replan_response_carries_kb_hit_counts() -> None:
    """`ReplanResponse.retrieved` 는 계약이 "KB 히트 수"라고 적어 둔 필드다 —
    배선 전에는 **항상 빈 dict** 였고, 그것이 RAG 미탑승의 측정 가능한 증거였다.

    dev 앱은 실 임베딩이 없어(D37) 건수가 0 이다. 여기서 보는 것은 **키가 있는가** —
    PlanB 검색 단계를 실제로 통과했는가다(실패도 키를 남긴다, 침묵 금지)."""
    body = _replan_response().json()

    assert set(body["retrieved"]) == {"SCHEDULE", "PERSONA", "SITUATION"}, body["retrieved"]


def test_replan_runs_planb_and_says_so() -> None:
    """PlanB 노트가 `planb:` 접두로 응답에 실린다 — 어느 단계가 왜 떨어졌는지가
    ScheduleAgent 강등과 섞이지 않는다."""
    body = _replan_response().json()

    assert any(n.startswith("planb: ") for n in body["notes"]), body["notes"]


def test_planb_fallback_skips_the_rank_and_still_produces_an_itinerary() -> None:
    """실 LLM 이 없으면 PlanB 는 규칙 랭킹으로 떨어진다 → 랭킹을 **넘기지 않고** 그
    사실을 남긴다. 그래도 일정은 나온다 (INV-4 — 폴백은 하되 침묵은 안 한다).

    규칙 랭킹을 넘기지 않는 이유: 그 순서는 `build_rule_score` 가 이미 보는 신호
    (우천·거리·저장 장소)라 두 번 세는 것이고 얻는 것이 없다."""
    body = _replan_response().json()

    assert any("planb_rank_skipped: fallback_level=" in n for n in body["notes"]), body["notes"]
    assert body["empty_reason"] is None, body["notes"]
    assert body["itinerary"]["days"][0]["slots"], body["notes"]
