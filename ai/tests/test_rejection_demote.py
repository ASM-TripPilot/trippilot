"""거절 이력이 선호 점수를 깎는다 (TRIP-964).

사용자 요청: "생성된 일정이 있는데도 다시 짜달라고 하면, 거절 이력을 추가해서
preference score 에 반영해서 새로 짜게 하자."

**배제가 아니라 강등**이다. 하드 제외(`excluded_poi_ids`)로 처리하면 두세 번 누를 때
후보 풀이 말라 일정이 비고, 사용자가 마음을 바꿔도 되돌아갈 길이 없다.

팀 결정 셋이 이 파일의 단언이다 (2026-09-26).
  ⓐ 종류별로 크기가 다르다 — 슬롯 교체 > 재생성
  ⓑ 또 거절하면 더 크게 — 다만 **상한 안에서 계단**
  ⓒ PlanB 랭크 가산과 겹치면 **검색이 조금 이긴다** — 반복 횟수와 무관하게

증명하는 것 (실 LLM·실 API 0 — D37):
  ① 강등이 **실제로 배치를 바꾼다** — 점수에 닿아야 어셈블리까지 간다(TRIP-898 재발 방지)
  ② 빈 이력은 무영향 — generate 경로가 종전과 한 글자도 다르지 않다
  ③ 계단 — 1회 < 2회 < 3회, 표를 넘으면 마지막에서 멈춘다
  ④ 종류 — 같은 횟수면 교체가 재생성보다 크다
  ⑤ 합산 상한 — 두 종류에 다 걸려도 상한에서 잘린다
  ⑥ ⓒ 불변식 — 최대로 거절해도 랭크 1위면 점수가 **오른다**
  ⑦ 설정이 ⓒ 를 강제한다 — 상한 ≥ 가산이면 기동 자체가 거부된다
  ⑧ 중복 줄이 와도 두 배로 깎이지 않는다 (경계가 흘려도 안전)
  ⑨ 풀 밖 이력은 무해 — 후보가 늘거나 사라지지 않는다 (INV-1)
  ⑩ 배선 — 와이어 `rejections` 가 도메인 요청까지 온다(generate·replan 양쪽)
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime

import pytest

from trippilot.agents.schedule.agent import (
    demote_rejected,
    lift_planb_ranked,
    rejection_penalty,
)
from trippilot.agents.schedule.budget import OrchestratorConfig
from trippilot.domain.common import PoiId, Rejection, RejectionKind
from trippilot.domain.llm import ScoredPoi

from tests.test_replan_via_planb import _agent, _case, _placed
from tests.test_schedule_agent import _task

_CFG = OrchestratorConfig()
_SWAP = RejectionKind.SWAPPED_OUT
_REGEN = RejectionKind.REGENERATED


def _pen(*rows: Rejection) -> dict[PoiId, float]:
    return rejection_penalty(
        rows,
        swapped=_CFG.rejection_demote_swapped,
        regenerated=_CFG.rejection_demote_regenerated,
        cap=_CFG.rejection_demote_cap,
    )


def _r(poi: str, kind: RejectionKind = _SWAP, count: int = 1) -> Rejection:
    return Rejection(PoiId(poi), kind, count)


def _run(rejections: tuple[Rejection, ...] = ()):
    """`test_replan_via_planb` 와 같은 케이스 — p1..p6 동률 0.9, 창 09–12 → 2건 배치."""
    pool, req = _case()
    agent, trace = _agent()
    task = _task(pool, request=replace(req, rejections=rejections))
    return agent.run(task), trace


# ── ① 강등이 실제로 배치를 바꾼다 (이 파일의 핵심 단언) ─────────────────


def test_rejection_changes_the_itinerary() -> None:
    """배치됐던 곳을 거절하면 그 자리가 다른 곳으로 넘어간다.

    이 단언이 없으면 "점수는 깎았는데 일정은 그대로"가 된다 — TRIP-898 이 정확히 그
    모양이었다(풀 순서만 바꿔 아무도 안 읽었다). 점수여야 어셈블리에 닿는다.
    """
    base, _ = _run()
    placed = _placed(base)
    assert len(placed) == 2, placed  # 전제 — 동률이라 앞의 둘이 들어간다

    # 배치된 둘을 최대 강도로 거절한다(교체 3회 = 상한).
    outcome, trace = _run(tuple(_r(p, _SWAP, 3) for p in placed))
    after = _placed(outcome)

    assert after != placed, "거절이 배치를 바꾸지 못했다 — 점수가 어셈블리에 안 닿는다"
    assert not set(after) & set(placed), after  # 거절한 둘이 빠졌다
    assert after, "전부 빠졌다 — 강등이 아니라 배제로 변질됐다"
    # 자리 수까지는 고정하지 않는다: 여기 데모 후보는 거리가 오름차순이라(p1 이 가장
    # 가깝다) 가까운 둘을 내리면 남는 후보가 멀어져 창 09–12 에 한 곳만 들어가는 것이
    # **정상**이다. 강등은 "무엇을 고르나"를 바꾸지 "몇 개를 넣나"를 보장하지 않는다.
    # 침묵 금지 — 몇 건이 깎였는지 남는다
    assert any("rejection_demoted:2/2" in str(e) for e in trace.events), trace.events


def test_rejected_poi_can_still_be_placed_when_nothing_else_remains() -> None:
    """강등이지 배제가 아니다 — 후보가 그것뿐이면 거절한 곳도 다시 나온다.

    하드 제외였다면 여기서 일정이 **비었다**. 사용자가 마음을 바꿀 길을 남기는 것이
    소프트 강등을 고른 이유다.
    """
    pool, req = _case()
    every = tuple(_r(f"p{i}", _SWAP, 3) for i in range(1, 7))
    agent, _ = _agent()
    outcome = agent.run(_task(pool, request=replace(req, rejections=every)))
    assert len(_placed(outcome)) == 2  # 전부 거절해도 빈 일정이 되지 않는다


# ── ② 빈 이력 = 종전 동작 ────────────────────────────────────────────


def test_no_rejections_is_byte_identical() -> None:
    """generate 경로(이력 없음)가 종전과 같다 — additive 필드의 조건이다."""
    a, trace = _run()
    b, _ = _run(())
    assert _placed(a) == _placed(b)
    assert not [e for e in trace.events if "rejection" in str(e)]


# ── ③④⑤ 계단·종류·상한 (팀 결정 ⓐⓑ) ──────────────────────────────


def test_repeat_demotes_more_and_then_stops() -> None:
    """또 거절하면 더 내려간다 — 표를 넘으면 마지막 값에서 멈춘다(무한히 안 커진다)."""
    one, two, three = (_pen(_r("p1", _SWAP, n))[PoiId("p1")] for n in (1, 2, 3))
    assert one < two < three
    assert three == _pen(_r("p1", _SWAP, 9))[PoiId("p1")] == _CFG.rejection_demote_swapped[-1]


def test_swap_is_stronger_than_regenerate_at_every_step() -> None:
    """같은 횟수면 교체가 재생성보다 크다 — 신호의 세기가 다르다."""
    for n in (1, 2, 3, 9):
        assert _pen(_r("p1", _SWAP, n))[PoiId("p1")] > _pen(_r("p1", _REGEN, n))[PoiId("p1")]


def test_two_kinds_sum_then_cap() -> None:
    """한 곳이 두 종류에 다 걸리면 더한 뒤 상한에서 자른다."""
    both = _pen(_r("p1", _SWAP, 3), _r("p1", _REGEN, 3))[PoiId("p1")]
    assert both == _CFG.rejection_demote_cap
    # 약한 것 둘만으로는 상한에 못 닿는 구간도 있어야 한다 — 상한이 모든 값을 삼키면
    # 계단이 무의미해진다.
    weak = _pen(_r("p2", _REGEN, 1))[PoiId("p2")]
    assert 0 < weak < _CFG.rejection_demote_cap


# ── ⑥⑦ PlanB 와의 합성 (팀 결정 ⓒ) ─────────────────────────────────


def test_planb_lift_still_wins_at_max_rejection() -> None:
    """최대로 거절한 곳이라도 랭크 1위면 점수가 **오른다** — 결정 ⓒ 의 본체다.

    반복 횟수와 무관하게 성립해야 한다: 상한이 가산보다 작기 때문이고, 그 관계는
    설정이 강제한다(아래 테스트).
    """
    pid = PoiId("p1")
    before = (ScoredPoi(poi_id=pid, score=0.5, is_llm_score=True),)
    lifted = lift_planb_ranked(before, [pid], _CFG.planb_rank_lift)
    both = demote_rejected(lifted, _pen(_r("p1", _SWAP, 9), _r("p1", _REGEN, 9)))
    assert both[0].score > before[0].score, "겹쳤는데 PlanB 가 이기지 못했다"


def test_config_enforces_cap_below_lift() -> None:
    """숫자를 베껴 적는 대신 **관계로** 강제한다 — 누가 상한을 올리면 기동이 막힌다."""
    with pytest.raises(ValueError, match="rejection_demote_cap"):
        OrchestratorConfig(rejection_demote_cap=OrchestratorConfig().planb_rank_lift)


def test_config_rejects_decreasing_ladder() -> None:
    """또 거절했는데 덜 내려가는 표는 규칙이 뒤집힌 것이다."""
    with pytest.raises(ValueError, match="비감소"):
        OrchestratorConfig(rejection_demote_swapped=(0.2, 0.1))


# ── ⑧⑨ 경계가 흘려도 안전 ───────────────────────────────────────────


def test_duplicate_rows_do_not_double_demote() -> None:
    """같은 (poi, kind) 가 여러 줄로 와도 가장 큰 count 하나만 읽는다."""
    once = _pen(_r("p1", _SWAP, 2))[PoiId("p1")]
    thrice = _pen(_r("p1", _SWAP, 1), _r("p1", _SWAP, 2), _r("p1", _SWAP, 2))[PoiId("p1")]
    assert once == thrice


def test_out_of_pool_rejection_is_harmless() -> None:
    """풀 밖 POI 이력은 후보를 늘리거나 없애지 않는다 (INV-1)."""
    before = (ScoredPoi(poi_id=PoiId("p1"), score=0.5, is_llm_score=True),)
    after = demote_rejected(before, _pen(_r("유령", _SWAP, 3)))
    assert after == before


def test_count_must_be_positive() -> None:
    """0 번 거절은 이력이 아니다 — 경계가 흘리면 도메인이 거부한다."""
    with pytest.raises(ValueError, match="count"):
        Rejection(PoiId("p1"), _SWAP, 0)


# ── ⑩ 배선 — 와이어에서 도메인까지 ───────────────────────────────────


def test_wire_rejections_reach_the_domain_request() -> None:
    """경계가 받은 `rejections` 가 도메인 요청에 실린다.

    이 단언이 없으면 배선을 끊어도 스위트가 초록이다 — 이 리포에서 같은 모양으로
    세 번 겪었다(anti-patterns "배선한 인자를 끊어도 초록"). generate·replan 둘 다 본다.
    """
    from trippilot.api import schemas
    from trippilot.api.wiring import _domain_rejections

    rows = [
        schemas.RejectionSchema(poi_id="p1", kind="SWAPPED_OUT", count=2),
        schemas.RejectionSchema(poi_id="p2", kind="REGENERATED"),
    ]
    got = _domain_rejections(rows)
    assert got == (
        Rejection(PoiId("p1"), _SWAP, 2),
        Rejection(PoiId("p2"), _REGEN, 1),  # count 기본값 1
    )


@pytest.mark.parametrize("field", ["generate", "replan"])
def test_both_request_schemas_carry_rejections(field: str) -> None:
    """두 경로 모두 계약에 필드가 있다 — '다시 짜줘'는 replan, 처음부터는 generate 다."""
    from trippilot.api import schemas

    model = (
        schemas.GenerateItineraryRequest if field == "generate" else schemas.ReplanRequest
    )
    assert "rejections" in model.model_fields
    assert model.model_fields["rejections"].is_required() is False  # additive
