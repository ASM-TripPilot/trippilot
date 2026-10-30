"""챗봇의 해석 확인 — 날마다 동네 (orchestrator/edit_day_areas.py, spec 004 FR-003).

오케스트레이터 관통(분류가 칸을 뭉갠 턴·다른 의도·보류 답)은 `test_dialogue_orchestrator.py` 의 day_area 테스트가 본다.
"""

from __future__ import annotations

from datetime import date, time, timedelta

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.orchestrator.dialogue_handlers import DayView, SlotView, TripInfo, TurnSnapshot
from trippilot.orchestrator.edit_day_areas import MAX_LABEL, check_day_areas

D1, D2 = date(2026, 10, 24), date(2026, 10, 25)
BEFORE = date(2026, 10, 22)


def _snap(*, regions=("서울",), days=(D1, D2), phase: str = "PLANNING") -> TurnSnapshot:
    views = tuple(DayView(d, (SlotView.from_wire(f"{d.isoformat()}#00000000-0000-4000-8000-00000000000{i}", f"곳{i}",
                                                  time(10), "명소"),)) for i, d in enumerate(days))
    return TurnSnapshot("ITINERARY", TripInfo("t-1", tuple(regions), days[0], days[-1], phase), (), "PLANNED", views)


def test_verified_pairs_become_frame_arguments() -> None:
    got = check_day_areas("지금 짜여진 일정 변경하고 싶은데, 1일차는 종로 2일차는 강남구쪽으로 일정을 바꾸어줘", _snap(), BEFORE)
    assert got is not None and got.code == "verified" and got.table_only
    assert got.arguments == {"day": "2026-10-24", "day_areas": "2026-10-24=종로;2026-10-25=강남구"}


def test_not_this_shape_or_nothing_to_edit_is_none() -> None:
    assert check_day_areas("2일차는 카페 위주로 바꿔줘", _snap(), BEFORE) is None
    no_trip = TurnSnapshot("HOME", None, (), None, ())
    assert check_day_areas("1일차는 종로로 바꿔줘", no_trip, BEFORE) is None


def test_day_outside_the_trip_asks_with_complete_commands() -> None:
    got = check_day_areas("3일차는 종로 쪽으로 바꿔줘", _snap(), BEFORE)
    assert got is not None and got.arguments is None and got.code == "day_out_of_trip"
    assert got.question == "이번 여행은 2일차까지예요. 어느 날을 종로 쪽으로 바꿀까요?"
    assert got.options == ("1일차는 종로 쪽으로 바꿔줘", "2일차는 종로 쪽으로 바꿔줘")  # 누르면 그대로 다음 발화다


def test_past_day_offers_only_days_left() -> None:
    got = check_day_areas("1일차는 종로로 바꿔줘", _snap(phase="IN_TRIP"), D2)
    assert got is not None and got.code == "past_day"
    assert got.question.startswith("1일차는 이미 지났어요")
    assert got.options == ("2일차는 종로 쪽으로 바꿔줘",)  # '종로로'의 '로'는 조사 — 보일 땐 뗀다


def test_same_day_twice_asks_which_area() -> None:
    got = check_day_areas("1일차는 종로로 하고 첫날은 강남으로 해줘", _snap(), BEFORE)
    assert got is not None and got.code == "duplicate_day"
    assert set(got.options) == {"1일차는 종로 쪽으로 바꿔줘", "1일차는 강남 쪽으로 바꿔줘"}
    one = check_day_areas("24일 토요일은 종로로 바꿔줘", _snap(), BEFORE)  # 한 날을 두 말로 — 같은 동네면 묻지 않는다
    assert one is not None and one.arguments == {"day": "2026-10-24", "day_areas": "2026-10-24=종로"}


def test_options_keep_the_other_clause_and_skip_its_day() -> None:
    """3일 여행 '1일차는 종로 4일차는 강남으로' — 보기를 누르면 1일차 종로도 함께 간다, 1일차는 보기에 없다(2026-10-23 리뷰)."""
    three = _snap(days=(D1, D2, date(2026, 10, 26)))
    got = check_day_areas("1일차는 종로 4일차는 강남으로 바꿔줘", three, BEFORE)
    assert got is not None and got.code == "day_out_of_trip"
    assert got.options == ("1일차는 종로, 2일차는 강남 쪽으로 바꿔줘", "1일차는 종로, 3일차는 강남 쪽으로 바꿔줘")


def test_nothing_left_to_change_is_left_alone() -> None:
    """끝난 여행 — 고를 날이 없으면 답할 수 없는 되묻기 대신 종전 경로."""
    after = date(2026, 10, 27)
    assert check_day_areas("1일차는 종로로 바꿔줘", _snap(phase="ENDED"), after) is None


def test_areas_far_from_the_trip_region_are_left_to_the_edit_agent() -> None:
    """서울 '성산동'을 제주 '성산'으로 읽어 거짓 '멀어요'를 냈다(2026-10-23 리뷰) — 먼지는 편집이 받은 풀로 가린다."""
    got = check_day_areas("1일차는 성산동 쪽으로 바꿔줘", _snap(), BEFORE)
    assert got is not None and got.arguments == {"day": "2026-10-24", "day_areas": "2026-10-24=성산동"}


def test_unknown_area_is_left_to_the_edit_agent() -> None:
    """표에 없는 동네('쪽'으로 동네라고 말함)는 여기서 판정하지 않는다 — 편집이 받은 풀 안 이름으로 찾는다(대화엔 좌표가 없다)."""
    got = check_day_areas("1일차는 롯데월드 쪽으로 바꿔줘", _snap(), BEFORE)
    assert got is not None and got.arguments == {"day": "2026-10-24", "day_areas": "2026-10-24=롯데월드"}
    assert not got.table_only  # 분류가 다른 의도면 고치지 않는다


@settings(max_examples=100, deadline=None)
@given(area=st.text(alphabet="가나다라마바사아자차카타파하종로강남구동", min_size=2, max_size=15),
       n=st.integers(3, 9))
def test_labels_and_questions_fit_the_wire(area: str, n: int) -> None:
    """BE 되묻기 상한(질문 ≤80·보기 ≤30자·≤4개)을 어떤 동네 말로도 넘지 않는다."""
    got = check_day_areas(f"{n}일차는 {area} 쪽으로 바꿔줘", _snap(), BEFORE)
    if got is None or got.arguments is not None:
        return
    assert len(got.question or "") <= 80
    assert len(got.options) <= 4 and all(len(o) <= MAX_LABEL for o in got.options)


@settings(max_examples=150, deadline=None)
@given(bad=st.integers(4, 7), good=st.integers(1, 3), other=st.sampled_from(("종로", "강남구", "롯데월드 쪽", "성수동", "경복궁 근처")),
       area=st.sampled_from(("홍대", "잠실", "국립현대미술관서울관 근처", "망원동")))
def test_every_option_reads_back_as_the_whole_request(bad: int, good: int, other: str, area: str) -> None:
    """보기는 그 자체로 완결된 명령문이다 — 누르면 해석기가 다른 절까지 그대로 다시 읽는다(2026-10-23 2차 리뷰: 꼬리를 떼서 되읽히지 않았다)."""
    three = _snap(days=(D1, D2, date(2026, 10, 26)))
    asked = check_day_areas(f"{good}일차는 {other}으로, {bad}일차는 {area}으로 바꿔줘", three, BEFORE)
    if asked is None or asked.arguments is not None:
        return
    for option in asked.options:
        again = check_day_areas(option, three, BEFORE)
        assert again is not None and again.arguments is not None, option
        assert f"{(D1 + timedelta(days=good - 1)).isoformat()}=" in again.arguments["day_areas"], option


def test_a_mix_of_table_and_tail_only_areas_is_not_table_only() -> None:
    got = check_day_areas("1일차는 종로, 2일차는 롯데월드 쪽으로 바꿔줘", _snap(), BEFORE)
    assert got is not None and got.arguments is not None and not got.table_only  # 분류가 편집일 때만 맡는다
