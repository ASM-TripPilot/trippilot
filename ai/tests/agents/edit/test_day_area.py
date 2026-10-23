"""날마다 동네 — 말 읽기·날 확인 (agents/edit/day_area.py, spec 004 FR-001·002).

경계 관통(재구성 콘센트·조립·검증)은 `tests/api/test_api_edit_day_area.py`, 대화 쪽 확인은 `tests/orchestrator/test_edit_day_areas.py` 가 본다.
"""

from __future__ import annotations

import time
from datetime import date, timedelta

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.edit.day_area import (
    DayArea,
    DayAreaIssue,
    DayClause,
    as_params,
    encode,
    from_params,
    parse_day_areas,
    resolve_day_areas,
    table_key,
)
from trippilot.agents.planb.request_verification import KNOWN_AREAS

K = tuple(KNOWN_AREAS)  # 대화·편집이 넘기는 것과 같은 동네 표

D1, D2, D3 = date(2026, 10, 24), date(2026, 10, 25), date(2026, 10, 26)  # 토·일·월
BEFORE = date(2026, 10, 22)


@pytest.mark.parametrize("utterance, expected", [
    ("지금 짜여진 일정 변경하고 싶은데, 1일차는 종로 2일차는 강남구쪽으로 일정을 바꾸어줘",
     [(("1일차",), "종로"), (("2일차",), "강남구")]),  # 사용자 원문(2026-10-22)
    ("1일차는 종로 쪽으로, 2일차는 강남으로 바꿔줘", [(("1일차",), "종로"), (("2일차",), "강남")]),
    ("2일차 일정을 강남구 쪽으로 바꿔줘", [(("2일차",), "강남구")]),
    ("첫째 날은 북촌 위주로, 둘째 날은 성수 위주로 다시 짜줘", [(("첫째 날",), "북촌"), (("둘째 날",), "성수")]),
    ("내일은 홍대 쪽으로 바꿔줘", [(("내일",), "홍대")]),
    ("1일차 종로, 2일차 강남으로 일정 바꿔줘", [(("1일차",), "종로"), (("2일차",), "강남")]),
    ("1일차랑 2일차는 종로로 바꿔줘", [(("1일차", "2일차"), "종로")]),  # 두 날이 한 동네 — 표 이름 뒤 '로'는 조사
    ("1일차는 종로 말고 강남으로 바꿔줘", [(("1일차",), "강남")]),
    ("토요일은 성수 쪽으로 바꿔 줄래?", [(("토요일",), "성수")]),
    ("1일차는 종로로 하고 2일차는 강남으로 해줘", [(("1일차",), "종로"), (("2일차",), "강남")]),
    ("둘째 날 일정을 성수동 쪽으로 옮겨줘", [(("둘째 날",), "성수동")]),
    ("10월 24일은 종로 쪽으로 바꿔주세요", [(("10월 24일",), "종로")]),
    ("1일차 일정 종로로 다시 짜줘", [(("1일차",), "종로")]),
    ("1일차는 을지로 2일차는 대학로로 바꿔줘", [(("1일차",), "을지로"), (("2일차",), "대학로")]),  # 이름의 '로'는 남긴다
    ("1일차를 종로로 바꿔줘", [(("1일차",), "종로")]),
    ("1일차에 종로 쪽으로 다시 짜줘", [(("1일차",), "종로")]),
    ("1일차는 종로로 바꿨으면 좋겠어", [(("1일차",), "종로")]),
    ("1일차는 강남역 쪽으로 바꿔 주실래요?", [(("1일차",), "강남역")]),
    ("1일차는 롯데월드 쪽으로 바꿔줘", [(("1일차",), "롯데월드")]),   # 표에 없어도 '쪽'으로 동네라고 말했다
    ("1일차는 망원동으로 바꿔줘", [(("1일차",), "망원동")]),
    ("1일차는 홍대입구로 바꿔줘ㅎㅎ", [(("1일차",), "홍대입구")]),
    ("24일 토요일은 종로로 바꿔줘", [(("24일", "토요일"), "종로")]),
    ("1일차는 종로 쪽으로 다시 짜줄래?", [(("1일차",), "종로")]),
    ("1일차는 강남을 중심으로 바꿔줘", [(("1일차",), "강남")]),   # '을'을 떼야 표 이름이다
    ("1일차는 마포구로 바꿔줘", [(("1일차",), "마포구")]),
    ("1일차는 망원동 위주로 바꿔줘", [(("1일차",), "망원동")]),
    ("1일차는 종로 2일차는 강남 3일차는 홍대 쪽으로 바꿔줘",
     [(("1일차",), "종로"), (("2일차",), "강남"), (("3일차",), "홍대")]),
])
def test_reads_day_area_clauses(utterance: str, expected: list) -> None:
    got = parse_day_areas(utterance, K)
    assert got is not None
    assert [(c.days, c.area) for c in got] == expected


@pytest.mark.parametrize("utterance", [
    "2일차는 카페 위주로 바꿔줘",            # 종류 조건 — 동네가 아니다(번역기 몫)
    "2일차에 강남 쪽 카페 하나 넣어줘",      # 더하기 — 사이 넣기·번역기 몫
    "1일차 일정 다시 짜줘",                  # 동네 없음('다시'는 동네가 아니다)
    "1일차는 종로에서 놀고 싶어",            # 바꾸기 말 없음 — 바람
    "비 오니까 2일차는 실내 위주로 바꿔줘",  # 상황 + 종류 — 다시 짜기·번역기 몫
    "1일차 경복궁을 2일차로 옮겨줘",          # 날 사이 옮기기(MOVE) — '2일차로'는 동네가 아니다
    "1일차 경복궁 빼고 2일차는 강남으로 바꿔줘",  # 빼기가 섞였다
    "1일차는 종로",                          # 바꾸기 말 없음
    "2일차 강남 쪽 맛집 알려줘",             # 묻는 말
    "내일 일정 보여줘",
    "오늘 날씨 어때",
    "1일차 몇 시에 시작해?",
    "종로 쪽으로 바꿔줘",                    # 날 없음 — 어느 날인지 넘겨짚지 않는다
    "2일차는 강남 쪽 카페로 바꿔줘",         # 동네 + 종류 — 남는 말이 뜻을 바꾼다
    "1일차는 여기 쪽으로 바꿔줘",            # 지시어
    # 2026-10-23 리뷰 — 표 이름도 꼬리도 아닌 낱말을 동네로 읽어 한 곳 바꾸기·순서·추천을 가로챘다
    "2일차 순서 바꿔줘", "1일차 점심 바꿔줘", "1일차 일정 취소 해줘", "2일차 일정 한번 다시 짜줘", "2일차 일정 여유롭게 바꿔줘",
    "오늘 추천 좀 해줘", "오늘 요약 좀 해줘", "내일 완전히 다시 짜줘", "1일차 이동 바꿔줘", "1일차 지역 바꿔줘",
    "2일차는 카페로 바꿔줘", "1일차 일정 밤으로 바꿔줘", "2일차는 실내로 바꿔줘",   # '로'가 종류 말 금지를 비켜 가지 않는다
    "1일차 경복궁 바꿔줘", "1일차 경복궁 대신 창덕궁으로 바꿔줘", "1일차 경복궁 말고 종로로 바꿔줘",  # 한 곳 바꾸기 — 번역기 몫
    "1일차는 명동교자로 바꿔줘",            # 가게 이름에 동네 이름이 들었을 뿐
    "1일차 말고 2일차는 강남으로 바꿔줘",   # 배제 말
    "1일차는 종로로 바꿨어?", "1일차는 종로로 바꿨는데 2일차는 강남으로",  # 지난 일 — 요청이 아니다
    # 2026-10-23 2차 리뷰 — 공간 꼬리 아닌 '위주·중심', 꾸밈말, 종류 말이 든 말, 합성어 행정 꼴, 숙소, 지난 일
    "1일차는 가까운 쪽으로 바꿔줘", "1일차는 다른 쪽으로 바꿔줘", "2일차는 한옥 위주로 바꿔줘", "2일차는 브런치 위주로 바꿔줘",
    "1일차는 역사 중심으로 바꿔줘", "1일차는 감성카페 쪽으로 바꿔줘", "1일차 동선 짧은 쪽으로 바꿔줘", "2일차는 야외활동으로 바꿔줘",
    "1일차는 자유행동으로 바꿔줘", "2일차 게스트하우스 근처로 바꿔줘", "1일차는 종로로 바꿔줬어?", "1일차는 종로로 변경했어?",
    "1일차는 종로 쪽으로 바꿔놨어",
])
def test_leaves_everything_else_alone(utterance: str) -> None:
    assert parse_day_areas(utterance, K) is None


def test_parse_is_bounded_on_long_input() -> None:
    t0 = time.monotonic()
    assert parse_day_areas("1일차는" + "가" * 5_000 + " 바꿔줘", K) is None
    assert parse_day_areas(("1일차는 종로 " * 400) + "바꿔줘", K) is not None  # 같은 날 400번 — 확인 단계가 막는다
    assert time.monotonic() - t0 < 1.0


def _clauses(*pairs: tuple[str, str]) -> tuple[DayClause, ...]:
    return tuple(DayClause((d,), a) for d, a in pairs)


def test_resolves_ordinal_relative_date_and_weekday() -> None:
    days = (D1, D2, D3)
    assert resolve_day_areas(_clauses(("1일차", "종로"), ("둘째 날", "강남")), days, BEFORE) == (
        DayArea(D1, "종로"), DayArea(D2, "강남"))
    assert resolve_day_areas(_clauses(("마지막 날", "홍대")), days, BEFORE) == (DayArea(D3, "홍대"),)
    assert resolve_day_areas(_clauses(("일요일", "성수")), days, BEFORE) == (DayArea(D2, "성수"),)
    assert resolve_day_areas(_clauses(("25일", "성수")), days, BEFORE) == (DayArea(D2, "성수"),)
    assert resolve_day_areas(_clauses(("10월 26일", "성수")), days, BEFORE) == (DayArea(D3, "성수"),)
    assert resolve_day_areas(_clauses(("내일", "성수")), days, D1) == (DayArea(D2, "성수"),)
    assert resolve_day_areas(_clauses(("오늘", "성수")), days, D2) == (DayArea(D2, "성수"),)
    # 두 날이 한 동네
    both = (DayClause(("1일차", "2일차"), "종로"),)
    assert resolve_day_areas(both, days, BEFORE) == (DayArea(D1, "종로"), DayArea(D2, "종로"))


@pytest.mark.parametrize("said, today, code", [
    ("4일차", BEFORE, "day_out_of_trip"),
    ("월요일", BEFORE, "day_out_of_trip"),   # 여행 날에 월요일이 없다(토·일)
    ("내일", D2, "day_out_of_trip"),          # 여행이 끝난 다음 날
    ("1일차", D2, "past_day"),               # 여행 중 — 지난 날은 바꾸지 않는다
])
def test_issues_instead_of_guessing(said: str, today: date, code: str) -> None:
    got = resolve_day_areas(_clauses((said, "종로")), (D1, D2), today)
    assert isinstance(got, DayAreaIssue) and got.code == code and got.said == said


def test_same_day_twice_and_ambiguous_weekday_are_issues() -> None:
    twice = resolve_day_areas(_clauses(("1일차", "종로"), ("첫날", "강남")), (D1, D2), BEFORE)
    assert isinstance(twice, DayAreaIssue) and twice.code == "duplicate_day"
    long_trip = tuple(D1 + timedelta(days=i) for i in range(9))  # 토요일이 두 번
    sat = resolve_day_areas(_clauses(("토요일", "종로")), long_trip, BEFORE)
    assert isinstance(sat, DayAreaIssue) and sat.code == "ambiguous_day"


def test_wire_forms_round_trip() -> None:
    pairs = (DayArea(D1, "종로"), DayArea(D2, "강남구"))
    assert encode(pairs) == "2026-10-24=종로;2026-10-25=강남구"
    assert from_params(as_params(pairs)) == pairs
    assert from_params({"2026-13-01": "종로"}) is None
    assert from_params({"2026-10-24": ""}) is None
    assert from_params({}) is None


# ── 속성: 만든 말을 그대로 읽는다 / 낯선 말이 끼면 맡지 않는다 ─────────────────────

_AREAS = ("종로", "강남", "성수", "홍대", "북촌", "잠실", "강남구", "성수동")
_KO = ("첫째 날", "둘째 날", "셋째 날", "넷째 날")


@st.composite
def _ask(draw):
    n_days = draw(st.integers(2, 4))
    start = date(2026, 11, 1) + timedelta(days=draw(st.integers(0, 60)))
    days = tuple(start + timedelta(days=i) for i in range(n_days))
    picked = draw(st.lists(st.integers(0, n_days - 1), min_size=1, max_size=n_days, unique=True))
    areas = [draw(st.sampled_from(_AREAS)) for _ in picked]
    parts = []
    for i, area in zip(picked, areas):
        day = draw(st.sampled_from((f"{i + 1}일차는", f"{_KO[i]}은")))
        tail = draw(st.sampled_from(("", " 쪽으로", " 위주로", "쪽으로")))
        parts.append(f"{day} {area}{tail}")
    sep = draw(st.sampled_from((" ", ", ")))
    head = draw(st.sampled_from(("", "지금 짜여진 일정 변경하고 싶은데, ", "혹시 ")))
    verb = draw(st.sampled_from((" 바꿔줘", " 일정을 바꾸어줘", " 다시 짜줘", " 바꿔 줄래?")))
    return head + sep.join(parts) + verb, days, [(days[i], a) for i, a in zip(picked, areas)]


@settings(max_examples=200, deadline=None)
@given(_ask())
def test_reads_back_what_was_said(case) -> None:
    utterance, days, expected = case
    clauses = parse_day_areas(utterance, K)
    assert clauses is not None, utterance
    got = resolve_day_areas(clauses, days, days[0] - timedelta(days=3))
    assert got == tuple(sorted((DayArea(d, a) for d, a in expected), key=lambda x: x.day)), utterance


@settings(max_examples=200, deadline=None)
@given(_ask(), st.sampled_from(("카페", "하나", "빼고", "비 와서", "맛집", "넣어", "말해")), st.data())
def test_a_stray_word_hands_it_back(case, stray: str, data) -> None:
    utterance, _, _ = case
    words = utterance.split(" ")
    at = data.draw(st.integers(0, len(words)))
    assert parse_day_areas(" ".join([*words[:at], stray, *words[at:]]), K) is None


def test_table_names_match_with_admin_or_station_forms_only() -> None:
    assert table_key("강남구", K) == ("강남", "강남구") and table_key("홍대입구역", K) == ("홍대", "홍대입구역")
    assert table_key("종로로", K) == ("종로", "종로") and table_key("을지로", K) == ("을지로", "을지로")
    assert table_key("명동교자", K) is None and table_key("강남스타일", K) is None


_NOT_AREAS = ("순서", "점심", "취소", "추천", "한번", "여유롭게", "완전히", "아예", "통째로", "경복궁", "창덕궁", "명동교자",
              "카페로", "실내로", "밤으로", "이동", "지역", "친구", "그대로", "말고", "새로")


@settings(max_examples=200, deadline=None)
@given(st.integers(1, 4), st.sampled_from(_NOT_AREAS), st.sampled_from(("는 {w} 바꿔줘", " {w} 다시 짜줘", " 일정 {w} 바꿔줘",
                                                                        "는 {w} 바꿔 줄래?", "는 종로, 2일차는 {w} 바꿔줘")))
def test_a_word_that_is_not_an_area_hands_it_back(n: int, word: str, tail: str) -> None:
    """동네 자리를 표 이름도 꼬리('쪽'·'근처'·'구·동·역')도 아닌 낱말로 두면 맡지 않는다 — 그 말은 한 곳 바꾸기·순서·추천일 수
    있다(번역기·분류 몫). 꼬리를 붙여 동네라고 말한 것은 받는다(그 이름으로 동네를 찾지 못하면 편집이 사유를 단다)."""
    utterance = f"{n}일차" + tail.format(w=word)
    assert parse_day_areas(utterance, K) is None, utterance
