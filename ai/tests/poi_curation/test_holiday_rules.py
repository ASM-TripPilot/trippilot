"""휴무 원문 → 휴일 규칙 (`sourcing.holiday_rules`, 상황 감지 H1 · BR-SA-17).

표본은 전부 공유본(`data/collected_pois.json` 휴무 원문)에 실제로 나온 문구다 — 어휘를 감으로 넓히지 않는다
(mapping.py `_NOT_OPEN_SEGMENT` 의 교훈). 빈도는 PR 본문·모듈 독스트링.

증명하는 것:
  ① 명절 — 한정자 그대로 읽는다: 연휴 = 세 날, 전날·당일·다음날 = 그 자리, **맨 이름 = 당일만**.
     쉼표로 떨어진 한정자 절(`설·추석 전날, 당일`)은 앞 명절에 붙는다.
  ② 공휴일 낱말 → PUBLIC, 날짜·이름 있는 날 → "MM-DD", 부처님 오신날 → BUDDHA.
  ③ 함정 — 뜻이 뒤집히거나 넓어지는 문구는 규칙이 없다: `공휴일 다음날`(PUBLIC 아님), `공휴일 정상 운영`,
     괄호·※ 조건 단서, 임시 휴무·지정한 날·월 n회·기간, 모르는 한정자(`오전`), `시설`의 설.
     단 괄호가 휴무일 목록 자체면 읽는다. 구분자로 떨어진 여는 절(`공휴일/정상운영`)·여는 말로 끝나는 괄호가
     붙은 절(`공휴일(단, 어린이날은 개관)`)·시설 머리가 여럿인 원문(`- 전망대 (…)- 홍보관 (…)`)도 모른다.
  ④ 영업 원문 안의 휴무 줄도 같은 규칙 — 시각 범위가 있는 줄(`주말·공휴일 10:00~18:00`)은 여는 날이다.
  ⑤ 어떤 글을 넣어도 예외 없이 닫힌 집합만 낸다(PBT) — 도메인 `Poi` 가 그대로 받는다.
"""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.poi_curation.sourcing.holiday_rules import parse_holiday_rules

SEOL = frozenset({"SEOLLAL_EVE", "SEOLLAL_DAY", "SEOLLAL_NEXT"})
CHU = frozenset({"CHUSEOK_EVE", "CHUSEOK_DAY", "CHUSEOK_NEXT"})
DAYS = frozenset({"SEOLLAL_DAY", "CHUSEOK_DAY"})
EVE_DAY = frozenset({"SEOLLAL_EVE", "SEOLLAL_DAY", "CHUSEOK_EVE", "CHUSEOK_DAY"})


# ── ① 명절 ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(("rest", "expected"), [
    ("설·추석 연휴", SEOL | CHU),
    ("명절 연휴", SEOL | CHU),
    ("명절연휴", SEOL | CHU),
    ("설날 및 추석 연휴", SEOL | CHU),           # 한정자는 이름 목록 전체에 걸린다
    ("설·추석 연휴(대체공휴일 포함)", SEOL | CHU),  # 괄호 단서는 걷어 낸다
    ("추석 연휴", CHU),
    ("설·추석 당일", DAYS),
    ("설∙추석 당일", DAYS),
    ("설날ㆍ추석 당일", DAYS),
    ("명절 당일", DAYS),
    ("명절당일휴무", DAYS),
    ("추석 당일만 휴무", frozenset({"CHUSEOK_DAY"})),
    ("설·추석 전날 및 당일", EVE_DAY),
    ("설·추석 전일 및 당일", EVE_DAY),          # 실물 표기 `전일` = 전날
    ("설·추석 전날·당일", EVE_DAY),
    ("설·추석 전날, 당일", EVE_DAY),            # 쉼표로 떨어진 한정자 절 — 앞 명절에 붙는다
    ("매주 월요일 / 설·추석 전날, 당일, 다음날", SEOL | CHU),
    ("설·추석 당일 및 다음날", frozenset({"SEOLLAL_DAY", "SEOLLAL_NEXT", "CHUSEOK_DAY", "CHUSEOK_NEXT"})),
    ("명절 당일 및 명절 전날", EVE_DAY),
])
def test_명절은_한정자대로_읽는다(rest: str, expected: frozenset[str]) -> None:
    assert parse_holiday_rules(rest) == expected


@pytest.mark.parametrize(("rest", "expected"), [
    ("명절", DAYS),
    ("명절 휴무", DAYS),
    ("설·추석", DAYS),
    ("설날", frozenset({"SEOLLAL_DAY"})),
    ("추석", frozenset({"CHUSEOK_DAY"})),
    ("매주 월요일 / 1월 1일 / 설날 / 추석", frozenset({"01-01", "SEOLLAL_DAY", "CHUSEOK_DAY"})),
    ("추석 명절 휴무", frozenset({"CHUSEOK_DAY"})),  # 이름 뒤 `명절` 은 같은 날을 다시 부른 것
])
def test_한정자_없는_맨_명절은_당일만이다(rest: str, expected: frozenset[str]) -> None:
    """원문이 말한 날만 — `명절` 을 연휴로 넓혀 읽으면 열린 날에 일정을 막는다."""
    assert parse_holiday_rules(rest) == expected


# ── ② 공휴일·날짜 ──────────────────────────────────────────────────


@pytest.mark.parametrize("rest", [
    "공휴일", "법정공휴일", "법정 공휴일", "국경일", "관공서 공휴일", "관공서의 공휴일",
    "정부지정 공휴일", "정부 지정 공휴일", "국가지정 공휴일", "국정공휴일", "법정공휴일 휴무",
    "주말 및 공휴일", "매주 토요일, 일요일 / 법정공휴일", "매주 일요일 / 공휴일",
    "법정공휴일 및 대체공휴일", "공휴일 및 일요일",
])
def test_공휴일_낱말은_PUBLIC(rest: str) -> None:
    assert parse_holiday_rules(rest) == frozenset({"PUBLIC"})


@pytest.mark.parametrize(("rest", "expected"), [
    ("1월 1일", {"01-01"}),
    ("1월1일", {"01-01"}),
    ("매년 1월 1일", {"01-01"}),
    ("신정", {"01-01"}),
    ("성탄절", {"12-25"}),
    ("12월 31일", {"12-31"}),
    ("근로자의 날", {"05-01"}),
    ("근로자의 날(5월 1일)", {"05-01"}),
    ("삼일절, 광복절, 명절 전날, 명절 당일", {"03-01", "08-15", *EVE_DAY}),
    ("부처님 오신날", {"BUDDHA"}),
    ("1월 1일 / 부처님 오신날 / 성탄절 / 설·추석 연휴", {"01-01", "BUDDHA", "12-25", *SEOL, *CHU}),
    ("매주 월요일 / 1월 1일 / 설·추석 당일", {"01-01", *DAYS}),
    ("매주 일요일 / 월요일 / 설∙추석∙어린이날∙성탄절 당일", {"05-05", "12-25", *DAYS}),
    ("창립기념일 (12월 9일)", {"12-09"}),       # 괄호가 휴무일 그 자체다
])
def test_날짜와_이름_있는_날은_날짜_명시형(rest: str, expected: set[str]) -> None:
    assert parse_holiday_rules(rest) == frozenset(expected)


def test_괄호가_휴무일_목록이면_읽는다() -> None:
    assert parse_holiday_rules("휴관일(1월 1일, 설날·추석 당일)") == frozenset({"01-01", *DAYS})
    assert parse_holiday_rules("매주 월요일, 신정, 명절(설·추석) 휴무") == frozenset({"01-01", *DAYS})


# ── ③ 함정 ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("rest", [
    "공휴일 다음날",
    "법정공휴일 다음날",
    "법정 공휴일 다음날",
    "법정공휴일 다음 평일 휴관",
    "관공서의 공휴일 다음날",
])
def test_공휴일_다음날은_PUBLIC_이_아니다(rest: str) -> None:
    """뜻이 뒤집힌다 — 공휴일엔 열고 그 다음날 닫는다. 실물 20건 남짓(공휴일 규칙의 약 5%)이라 태그를 두지 않는다."""
    assert parse_holiday_rules(rest) == frozenset()


def test_공휴일_다음날이_섞여도_다른_절은_읽는다() -> None:
    assert parse_holiday_rules("매주 월요일 / 설·추석 당일 / 공휴일 다음날") == DAYS


@pytest.mark.parametrize("rest", [
    "공휴일 정상 운영",
    "공휴일 정상영업",
    "공휴일 개관",
    "매주 월요일 (단, 월요일이 공휴일인 경우 정상 영업)",
    "매주 월요일 (단, 월요일이 공휴일인 경우 다음날 휴관)",
    "매주 월요일 (단, 월요일이 공휴일인 경우 그 다음 평일 휴관)",
    "매주 월요일 (단, 공휴일과 일요일이 겹칠 경우 휴관)",
    "매주 월요일 / ※ 단, 월요일이 공휴일인 경우 개방하며, 그 다음 첫 번째 평일에 휴관",
    "매주 월요일- 월요일이 공휴일인 경우 화요일 휴무",
    "법정 공휴일이 일요일이면 휴관",
    "연중무휴※ 설·추석 연휴 휴무 가능성 있으므로 방문 전 전화 문의 요망",
    "매월 첫째 화요일※ 국경일, 명절일 경우 정상 운영",
])
def test_조건_단서는_규칙이_아니다(rest: str) -> None:
    assert parse_holiday_rules(rest) == frozenset()


@pytest.mark.parametrize("rest", [
    "임시 휴무",
    "기타 관장이 지정한 날",
    "월 1회",
    "명절은 별도 공지",
    "11월 1일 ~ 3월 31일 휴장",
    "매년 12월 30일~31일",
    "설·추석 오전",               # 반나절 — 하루를 닫는 규칙으로 못 쓴다
    "명절연휴 다음날",             # 연휴가 끝난 다음날 — 세 날 중 어느 것도 아니다
    "설·추석 연휴 중 2일 휴무",
    "명절 전날부터 3일간 휴무",
    "시설 별로 상이함",            # `시설` 의 설은 설날이 아니다
    "연중무휴",
    "대체공휴일",                  # 대체공휴일만 닫는다 — PUBLIC 으로 넓히지 않는다
    "일요일을 제외한 법정공휴일",   # 넓혀 읽지 않는다
    "평일 법정공휴일",
    "연휴 및 공휴일",              # 무슨 연휴인지 모른다
    "[야외전시원 및 산책로]연중무휴[실내시설]설·추석 당일",  # 어느 시설 것인지 모른다
    "(전쟁박물관은 매주 월요일, 1월 1일, 설날 및 추석 당일 휴무)",  # 괄호 안이 딴 시설 이야기
    "-",
])
def test_해석_못_하는_문구는_규칙_없음(rest: str) -> None:
    assert parse_holiday_rules(rest) == frozenset()


@pytest.mark.parametrize("rest", [
    "공휴일/정상운영",
    "공휴일, 정상 운영",
    "월요일/공휴일/정상 영업",
])
def test_구분자로_떨어진_여는_절이_있으면_원문_전체를_모른다(rest: str) -> None:
    """`공휴일 정상 운영` 은 규칙 없음인데 구분자가 끼면 `공휴일` 절만 남아 PUBLIC 으로 뒤집혔다(리뷰 재현).
    여는 말이 어느 절을 여는지 모르므로 원문 전체를 모른다 — 공유본에는 0건이라 잃는 규칙이 없다."""
    assert parse_holiday_rules(rest) == frozenset()


@pytest.mark.parametrize(("rest", "expected"), [
    ("매주 월요일 / 법정공휴일 (단, 어린이날은 개관)", set()),            # 실물 tourapi-1622558
    ("매주 주말 / 공휴일(단, 3·1절과 광복절은 운영)", set()),             # 실물 tourapi-3041546
    ("매주 월요일, 주말 / 공휴일(공연 및 대관일은 운영)", set()),         # 실물 tourapi-1279232
    ("매주 월요일 / 1월 1일 / 공휴일(단, 어린이날은 개관)", {"01-01"}),   # 그 절만 모른다 — 다른 절은 산다
    # 요일 절에 붙은 여는 단서는 그 절의 몫이다 — 휴일 규칙은 그대로(실물 다수, 예 tourapi-2513889)
    ("매주 월요일 (단, 월요일이 공휴일인 경우 정상 개관) / 1월 1일 / 설·추석 연휴", {"01-01", *SEOL, *CHU}),
    ("1월 1일 / 설·추석 연휴 (단, 체육관의 운영 상황에 따라 휴관일을 사전에 공지)", {"01-01", *SEOL, *CHU}),
    ("개관기념일 (4월 10일)", {"04-10"}),                                # `개관` 이 들어도 여는 말이 아니다
])
def test_여는_말로_끝나는_괄호가_붙은_절은_모른다(rest: str, expected: set[str]) -> None:
    """괄호 예외가 그 절의 휴무를 좁힌다 — 괄호만 버리고 절을 읽으면 어린이날·3·1절에 연 곳을 닫았다(리뷰 재현)."""
    assert parse_holiday_rules(rest) == frozenset(expected)


@pytest.mark.parametrize("rest", [
    "- 전망대 (연중무휴)- 홍보관 (1월 1일 / 설날·추석 당일)",                    # 실물 tourapi-2767585
    "- 공원 : 연중무휴<br>- 감락원 : 매주 월요일 / 1월 1일 / 설·추석 당일",        # 실물 tourapi-2763768
    "- 자영영당 : 연중무휴 - 의병전시관 : 매주 월요일 / 1월 1일 / 설·추석 당일",   # 실물 tourapi-1627353
])
def test_시설_머리가_여럿이면_어느_시설의_휴무인지_모른다(rest: str) -> None:
    """`[A] … [B] …` 와 같다 — 홍보관의 1월 1일 휴관을 연중무휴 전망대 전체의 휴무로 읽었다(리뷰 재현)."""
    assert parse_holiday_rules(rest) == frozenset()


def test_휴일_이름_글머리표는_시설_머리가_아니다() -> None:
    assert parse_holiday_rules("- 설날 (당일)<br>- 추석 (당일)") == DAYS


def test_없음은_빈_규칙() -> None:
    assert parse_holiday_rules(None) == frozenset()
    assert parse_holiday_rules("") == frozenset()
    assert parse_holiday_rules(None, None) == frozenset()


def test_명절일_뿐인_다른_절이_있어도_명절은_읽는다() -> None:
    assert parse_holiday_rules("명절, 월1회 월요일") == DAYS


# ── ④ 영업 원문 안의 휴무 줄 ───────────────────────────────────────


def test_영업_원문의_휴무_줄도_읽는다() -> None:
    hours = "09:00~18:00<br>매주 월요일 휴관 (월요일이 공휴일인 경우 다음날 휴관), 설날·추석 당일 휴관"
    assert parse_holiday_rules(None, hours) == DAYS


def test_시각이_있는_공휴일_줄은_여는_날이다() -> None:
    assert parse_holiday_rules(None, "평일 09:00~18:00<br>주말·공휴일 10:00~18:00") == frozenset()
    assert parse_holiday_rules("공휴일", "평일 09:00~18:00") == frozenset({"PUBLIC"})


# ── ⑤ 닫힌 집합 (PBT) ───────────────────────────────────────────────

_PIECES = st.sampled_from([
    "설", "설날", "추석", "명절", "연휴", "당일", "전날", "전일", "다음날", "공휴일", "법정", "국경일",
    "1월 1일", "12월 25일", "13월 40일", "2월 30일", "신정", "성탄절", "근로자의 날", "부처님 오신날",
    "매주", "월요일", "주말", "및", "·", ",", "/", "(", ")", "단,", "경우", "※", "<br>", "~", " ", "시설", "휴무",
])


@given(rest=st.one_of(st.none(), st.text(max_size=40), st.lists(_PIECES, max_size=12).map("".join)),
       hours=st.one_of(st.none(), st.text(max_size=40), st.lists(_PIECES, max_size=12).map("".join)))
def test_어떤_글이든_예외_없이_닫힌_집합만_낸다(rest, hours) -> None:
    rules = parse_holiday_rules(rest, hours)
    Poi(poi_id=PoiId("p"), name="p", category=PoiCategory.SIGHT, coord=GeoPoint(37.5, 127.0),
        open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL, source=PoiSource.SEED,
        confidence=None, holiday_rules=rules)  # 도메인 닫힌 집합 검증을 통과한다
