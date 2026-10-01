"""JIT — 약한 결정론 지터 (TRIP-1180 · ScheduleAgent 점수 단계 끝·③ 조립 직전).

QA 6회차 3번: 같은 목적지·같은 취향이면 '다른 여행'끼리 일정이 거의 같다(부산 64%·서울 92%).
여행마다 다른 입력은 시드 하나인데 규칙 점수 jitter(≤1e-4)·CP-SAT random_seed 외엔 닿지
않는다. 사용자 결정(2026-10-02): **약한 결정론 지터** — 해시라 무작위가 아니다.

증명하는 것 (실 API 0 — 점수는 FakeLlm, 어셈블리는 규칙 그리디를 1차로 승격한 퍼사드):
  ① 같은 요청 2회 → 같은 배치 (재현성)
  ② 시드만 다르면 동률 풀에서 **배치가** 달라진다 (점수가 아니라 배치 — 안티패턴 TRIP-904)
  ③ 거절 이력이 달라지면 키가 바뀐다 (다시 짜기마다 다른 지터)
  ④ |s′−s| ≤ ε/2 (대칭형) · 후보 집합·순서·개수 불변 (INV-1)
  ⑤ 원점수가 같으면 거절 1회 POI 는 지터 뒤에도 비거절보다 낮다 (PBT)
  ⑥ 설정 제약 — ε 는 거절 1단·'PlanB 가 조금 더 이긴다'·한 단 강등을 못 뒤집는다(관계로 강제)
  ⑦ 어셈블리 입력에만 — ⑥ 차선책은 원점수
  ⑧ 배선 — generate 와이어만 설정값으로 켜고, replan 은 0(바이트 동일)
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.schedule.agent import (
    demote_rejected,
    diversity_jittered,
    pick_slot_alternatives,
    rejection_penalty,
)
from trippilot.agents.schedule.budget import OrchestratorConfig
from trippilot.domain.common import PoiId, Rejection, RejectionKind
from trippilot.domain.llm import ScoredPoi

from tests.test_replan_via_planb import _app_with_spy, _body
from tests.test_schedule_agent import _task
from tests.test_schedule_family_demote import (
    _agent,
    _fed,
    _gen_request,
    _named,
    _placed,
    _pool,
)

_CFG = OrchestratorConfig()
_EPS = _CFG.diversity_jitter

# 동률 풀 — 8곳 전부 같은 점수, 3시간 창이라 다 못 들어간다. 지터 없이는 poi_id 순.
_TIE = tuple(_named(f"t{i}", f"명소{i}", north_m=300 * (i % 3), east_m=300 * (i // 3))
             for i in range(8))
_TIE_SCORES = {f"t{i}": 0.7 for i in range(8)}


def _run(seed: int, *, eps: float = _EPS, rejections: tuple[Rejection, ...] = ()):
    agent, trace, sink = _agent(_TIE_SCORES)
    request = replace(_gen_request(family=False), seed=seed, diversity_jitter=eps,
                      rejections=rejections)
    outcome = agent.run(_task(_pool(_TIE), request=request))
    return outcome, sink


def _cands(*scores: float) -> tuple[ScoredPoi, ...]:
    return tuple(ScoredPoi(poi_id=PoiId(f"p{i}"), score=s, is_llm_score=True)
                 for i, s in enumerate(scores))


# ── ① 재현성 ───────────────────────────────────────────────────────


def test_같은_요청_두_번이면_같은_배치_같은_점수() -> None:
    runs = [_run(11) for _ in range(2)]
    assert _placed(runs[0][0]) == _placed(runs[1][0])
    assert _fed(runs[0][1]) == _fed(runs[1][1])


# ── ② 시드만 다르면 배치가 달라진다 ──────────────────────────────────


def test_시드만_다르면_동률_풀에서_배치가_달라진다() -> None:
    seeds = range(1, 9)
    off = {tuple(_placed(_run(s, eps=0.0)[0])) for s in seeds}
    assert len(off) == 1  # 전제: 지터 없이는 시드가 배치에 닿지 않는다

    on = {tuple(_placed(_run(s)[0])) for s in seeds}
    assert len(on) > 1


# ── ③ 거절 이력이 키에 들어간다 ──────────────────────────────────────


def test_거절_이력이_달라지면_지터가_바뀐다() -> None:
    c = _cands(0.7, 0.7, 0.7)
    rej = (Rejection(poi_id=PoiId("zz"), kind=RejectionKind.REGENERATED),)
    more = rej + (Rejection(poi_id=PoiId("yy"), kind=RejectionKind.SWAPPED_OUT),)
    a = diversity_jittered(c, seed=5, rejections=(), epsilon=_EPS)
    b = diversity_jittered(c, seed=5, rejections=rej, epsilon=_EPS)
    d = diversity_jittered(c, seed=5, rejections=more, epsilon=_EPS)
    assert len({a, b, d}) == 3


def test_거절_이력은_순서와_무관하다() -> None:
    c = _cands(0.7, 0.7)
    r1 = Rejection(poi_id=PoiId("a"), kind=RejectionKind.REGENERATED, count=2)
    r2 = Rejection(poi_id=PoiId("b"), kind=RejectionKind.SWAPPED_OUT)
    assert (diversity_jittered(c, seed=3, rejections=(r1, r2), epsilon=_EPS)
            == diversity_jittered(c, seed=3, rejections=(r2, r1), epsilon=_EPS))


def test_거절_횟수가_늘어도_키가_바뀐다() -> None:
    c = _cands(0.7, 0.7)
    once = (Rejection(poi_id=PoiId("a"), kind=RejectionKind.REGENERATED, count=1),)
    twice = (Rejection(poi_id=PoiId("a"), kind=RejectionKind.REGENERATED, count=2),)
    assert (diversity_jittered(c, seed=3, rejections=once, epsilon=_EPS)
            != diversity_jittered(c, seed=3, rejections=twice, epsilon=_EPS))


# ── ④ 크기 상한 · 후보 집합 불변 (INV-1) ─────────────────────────────


_IDS = st.lists(st.text("abcdef0123", min_size=1, max_size=6), min_size=1, max_size=12,
                unique=True)


@given(_IDS, st.lists(st.floats(-1.0, 1.0), min_size=12, max_size=12),
       st.integers(0, 2**32 - 1), st.floats(0.0, 0.05))
@settings(max_examples=200, deadline=None)
def test_지터는_ε_안이고_후보는_그대로다(ids, scores, seed, eps) -> None:
    c = tuple(ScoredPoi(poi_id=PoiId(i), score=s, is_llm_score=True)
              for i, s in zip(ids, scores))
    out = diversity_jittered(c, seed=seed, rejections=(), epsilon=eps)
    assert [x.poi_id for x in out] == [x.poi_id for x in c]
    assert [x.is_llm_score for x in out] == [x.is_llm_score for x in c]
    # 대칭형(±ε/2) — 평균 0 이라 방문당 이득이 한쪽으로 쏠리지 않는다 (함수 독스트링)
    assert all(abs(o.score - x.score) <= eps / 2 + 1e-12 for o, x in zip(out, c))


def test_ε_0_이면_같은_객체를_돌려준다() -> None:
    """replan 은 0 — 점수가 한 비트도 안 바뀐다(재계획 시드·PlanB 가산 서열 보호)."""
    c = _cands(0.7, 0.3)
    assert diversity_jittered(c, seed=1, rejections=(), epsilon=0.0) is c


# ── ⑤ 거절 1단을 못 뒤집는다 (PBT) ────────────────────────────────────


def _bound(cfg: OrchestratorConfig) -> float:
    return min(cfg.rejection_demote_swapped[0], cfg.rejection_demote_regenerated[0],
               cfg.planb_rank_lift - cfg.rejection_demote_cap)


@given(st.floats(-0.5, 1.0), st.integers(0, 2**32 - 1),
       st.sampled_from(list(RejectionKind)), st.text("abc", min_size=1, max_size=4),
       st.text("xyz", min_size=1, max_size=4), st.floats(0.0, 1.0, exclude_max=True))
@settings(max_examples=300, deadline=None)
def test_원점수가_같으면_거절_1회는_지터_뒤에도_낮다(s, seed, kind, rid, oid, frac) -> None:
    eps = _bound(_CFG) * frac
    rej = (Rejection(poi_id=PoiId(rid), kind=kind),)
    c = (ScoredPoi(poi_id=PoiId(rid), score=s, is_llm_score=True),
         ScoredPoi(poi_id=PoiId(oid), score=s, is_llm_score=True))
    pen = rejection_penalty(rej, swapped=_CFG.rejection_demote_swapped,
                            regenerated=_CFG.rejection_demote_regenerated,
                            cap=_CFG.rejection_demote_cap)
    rejected, other = diversity_jittered(demote_rejected(c, pen), seed=seed,
                                         rejections=rej, epsilon=eps)
    assert rejected.score < other.score


# ── ⑥ 설정 제약 — 관계로 강제한다 ────────────────────────────────────


def test_기본값은_관계_안이다() -> None:
    assert 0.0 < _EPS < _bound(_CFG)


@pytest.mark.parametrize("eps", [-0.001, 0.05, 0.1])
def test_ε_가_범위를_벗어나면_기동을_거부한다(eps) -> None:
    with pytest.raises(ValueError, match="diversity_jitter"):
        OrchestratorConfig(diversity_jitter=eps)


def test_상한은_숫자가_아니라_관계다() -> None:
    """랭크 가산을 키우면 같은 ε 가 허용되고, 거절 1단을 줄이면 거부된다."""
    OrchestratorConfig(planb_rank_lift=0.4, diversity_jitter=0.09)
    with pytest.raises(ValueError, match="diversity_jitter"):
        OrchestratorConfig(rejection_demote_regenerated=(0.01, 0.15, 0.18),
                           diversity_jitter=0.02)


# ── ⑦ 어셈블리 입력에만 ──────────────────────────────────────────────


def test_지터는_어셈블리_입력에만_싣고_차선책은_원점수다() -> None:
    outcome, sink = _run(11)
    fed = _fed(sink)
    assert fed != _TIE_SCORES and set(fed) == set(_TIE_SCORES)
    assert all(abs(fed[k] - v) <= _EPS for k, v in _TIE_SCORES.items())
    # ⑥ 차선책은 원점수(전부 0.7 동률 → 거리순)로 고른다 — 지터 순이 아니다
    raw = tuple(ScoredPoi(poi_id=PoiId(k), score=v, is_llm_score=True)
                for k, v in _TIE_SCORES.items())
    pool = _pool(_TIE)
    assert outcome.slot_alternatives
    assert outcome.slot_alternatives == pick_slot_alternatives(outcome.solution, raw, pool)
    assert outcome.slot_alternatives != pick_slot_alternatives(
        outcome.solution, sink.problems[0].candidates, pool)  # 전제: 지터 순이면 달라진다


def test_요청_기본값은_0_이다() -> None:
    assert _gen_request().diversity_jitter == 0.0


# ── ⑧ 배선 ──────────────────────────────────────────────────────────


def test_generate_와이어는_설정값으로_켠다() -> None:
    from trippilot.api import schemas
    from trippilot.api.wiring import KST, _domain_generate_request
    from tests.test_schedule_fixed_poi_index import _request as _wire_request
    from datetime import date

    body = schemas.GenerateItineraryRequest.model_validate(
        _wire_request((date(2026, 10, 25),), []))
    assert _domain_generate_request(body, KST).diversity_jitter == 0.0
    assert _domain_generate_request(body, KST, diversity_jitter=_EPS).diversity_jitter == _EPS


class _GenerateSpy:
    def __init__(self, inner) -> None:
        self._inner, self.requests = inner, []

    def generate(self, request, *a, **k):
        self.requests.append(request)
        return self._inner.generate(request, *a, **k)

    def __getattr__(self, name):
        return getattr(self._inner, name)


def test_합성_루트의_generate_는_설정값을_싣는다() -> None:
    """`build_orchestrator` 가 와이어 변환에 설정값을 넘기지 않으면 운다."""
    from datetime import date

    from tests.test_schedule_fixed_poi_index import _client, _request as _wire_request

    with _client() as client:
        orch = client.app.state.orchestrator
        spy = orch._orchestrator = _GenerateSpy(orch._orchestrator)
        response = client.post("/ai/v1/itinerary/generate",
                               json=_wire_request((date(2026, 10, 25),), []))
    assert response.status_code == 200, response.text
    assert [r.diversity_jitter for r in spy.requests] == [_EPS]


def test_replan_경로는_지터를_켜지_않는다() -> None:
    app, spy = _app_with_spy()
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post("/ai/v1/planb/replan", json=_body())
    assert len(spy.tasks) == 1
    assert spy.tasks[0].request.diversity_jitter == 0.0
