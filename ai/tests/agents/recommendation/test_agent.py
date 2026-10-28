"""RecommendationAgent — 추천의 고르기 판단(2026-10-23 사용자 결정 "추천 관련한 것은 recommendation agent 가"). 핸들러 답의 모양은
`tests/orchestrator/test_dialogue_handlers.py` 가 그대로 지킨다 — 여기서는 판단만: 쓸 후보 묶음·순서·개수, 지역·근거·되묻기, 예외 수렴."""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.recommendation.agent import PLACES, REGIONS, RecommendationAgent, RecommendOutcome, RecommendTask
from trippilot.domain.region_recommend import preference_weights, recommend_regions

_AGENT = RecommendationAgent()
_RADIUS = ({"name": "반경 A", "reason": None}, {"name": "반경 B", "reason": "요즘 인기"})
_SQL = ({"name": "SQL 가", "reason": None}, {"name": "SQL 나", "reason": "요즘 인기"}, {"name": "SQL 다", "reason": None},
        {"name": "SQL 라", "reason": "요즘 인기"})


@pytest.mark.parametrize(("said", "count"), [(None, 3), ("1", 1), ("5", 5), ("0", 3), ("6", 3), ("두", 3), ("", 3)])
def test_count_is_the_said_number_from_one_to_five_or_three(said, count: int) -> None:
    assert _AGENT.run(RecommendTask(PLACES, said, radius=_RADIUS)).count == count


def test_the_radius_pool_wins_in_its_own_order_when_it_has_candidates() -> None:
    """반경 풀은 이미 요즘 인기 → 저장 수 → 별점 순이다 — 다시 세우지 않는다. NL2SQL 행의 인기 신호는 태그 하나라 고르기로 약하다."""
    out = _AGENT.run(RecommendTask(PLACES, None, radius=_RADIUS, sql=_SQL))
    assert out.source == "radius" and out.candidates == _RADIUS


def test_without_radius_the_sql_rows_go_popular_first_and_keep_sql_order_otherwise() -> None:
    out = _AGENT.run(RecommendTask(PLACES, "2", sql=_SQL))
    assert out.source == "sql" and [c["name"] for c in out.candidates] == ["SQL 나", "SQL 라", "SQL 가", "SQL 다"]
    assert out.count == 2  # 자르지 않는다 — 카드·버튼과 함께 핸들러가 자른다


def test_nothing_to_pick_from_is_an_empty_choice() -> None:
    assert _AGENT.run(RecommendTask(PLACES)) == RecommendOutcome()


def test_regions_come_from_taste_and_the_said_wish_with_the_basis_named() -> None:
    out = _AGENT.run(RecommendTask(REGIONS, "2", styles=("자연",), activities=("액티비티",), theme="바다 보러"))
    assert out.basis == "말한 바람과 취향" and 1 <= len(out.regions) <= 2 and not out.ask_taste
    assert _AGENT.run(RecommendTask(REGIONS, theme="역사 여행")).basis == "말한 바람"
    assert _AGENT.run(RecommendTask(REGIONS, styles=("미식",))).basis == "저장된 취향"


@pytest.mark.parametrize(("styles", "activities", "theme", "n"), [
    (("자연",), ("액티비티",), "바다 보러", 2),  # 두 축 + 바람
    (("자연",), ("테마파크",), None, 2),  # 활동 축이 결과를 바꾼다(빼면 다른 지역)
    (("자연",), (), "맛집 투어", 3),  # 한 축 + 바람
    (("휴양",), (), "역사 여행", 3),
    ((), (), "역사 여행", 1),  # 바람만
])
def test_regions_are_the_table_pick_for_both_taste_axes_and_the_wish(styles, activities, theme, n: int) -> None:
    """고르기의 알맹이 — 취향 두 축 + 말한 바람의 가중치로 성격표 상위 n 곳(`domain.region_recommend` 그대로). 바람을 버리거나 활동 축을
    버리면 지역이 달라진다(2026-10-23 리뷰 실측) — 개수·근거만 보던 테스트로는 못 잡았다."""
    out = _AGENT.run(RecommendTask(REGIONS, str(n), styles=styles, activities=activities, theme=theme))
    assert out.regions == tuple(recommend_regions(preference_weights(styles, activities, theme), n)) and out.count == n
    taste = bool(styles or activities)
    assert out.basis == ("말한 바람과 취향" if theme and taste else "말한 바람" if theme else "저장된 취향")


def test_no_taste_and_no_wish_asks_instead_of_picking() -> None:
    out = _AGENT.run(RecommendTask(REGIONS, "3", styles=("모르는 취향",)))
    assert out.ask_taste is True and out.regions == () and out.count == 3


def test_a_bad_material_shape_is_a_failure_with_its_reason_not_an_empty_choice(caplog) -> None:
    """계약 밖 재료(후보가 dict 가 아니다)여도 예외를 밖으로 내지 않는다(DL-5) — 다만 "고를 것 없음"과 갈라 사유를 싣는다. 같은 모양이면
    핸들러가 고르지 않은 SQL 순서 그대로 추천했다(2026-10-23 리뷰 재현). 핸들러가 이것을 턴 실패로 올려 보고한다."""
    out = _AGENT.run(RecommendTask(PLACES, "2", sql=("문자열 후보",)))  # .get 이 없다
    assert out == RecommendOutcome(error="AttributeError") and out.source is None and out.candidates == ()
    assert any("run_failed" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize("count", [["2"], {"n": 2}, 2])
def test_the_said_count_must_be_a_string(count) -> None:
    """게이트는 인자를 문자열로만 넘긴다 — 그 밖은 버그라 과제를 만들 때 막는다(해시할 수 없는 값이 run() 밖으로 TypeError 를 냈다)."""
    with pytest.raises(ValueError):
        RecommendTask(PLACES, count)


@pytest.mark.parametrize("kind", ["PLACE", "", "REGION"])
def test_task_kind_is_closed(kind: str) -> None:
    with pytest.raises(ValueError):
        RecommendTask(kind)


@pytest.mark.parametrize("kwargs", [{"count": 0}, {"count": 6}, {"source": "web"}, {"ask_taste": True, "regions": ("x",)},
                                    {"error": "KeyError", "source": "sql"}, {"error": "KeyError", "ask_taste": True},
                                    {"error": "KeyError", "basis": "저장된 취향"}])
def test_outcome_shapes_cannot_lie(kwargs: dict) -> None:
    with pytest.raises(ValueError):
        RecommendOutcome(**kwargs)


@settings(max_examples=100, deadline=None)
@given(reasons=st.lists(st.sampled_from([None, "요즘 인기", "저장 많음"]), max_size=12))
def test_pbt_sql_ranking_is_a_stable_popular_first_permutation(reasons: list) -> None:
    rows = tuple({"name": f"곳 {i}", "reason": r} for i, r in enumerate(reasons))
    out = _AGENT.run(RecommendTask(PLACES, sql=rows))
    got = list(out.candidates)
    assert sorted(c["name"] for c in got) == sorted(c["name"] for c in rows)  # 순열이다 — 빠지거나 더해지지 않는다
    popular = [c for c in rows if c["reason"] == "요즘 인기"]
    assert got[:len(popular)] == popular and got[len(popular):] == [c for c in rows if c["reason"] != "요즘 인기"]
