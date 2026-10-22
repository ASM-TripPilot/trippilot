"""HC1 미판정 — `check_hc1` 이 '정보 없음 → 미적용'으로 통과시키는 슬롯을 따로 센다 (상황 감지 INV-SA-2).

검증 응답의 `unverified_slots`(HOURS_UNKNOWN)가 이것을 싣는다. 위반 0 만으로는 '영업시간 통과'와 '못 봄'이
구별되지 않아, 원문이 있는데 해석하지 못한 곳(공유본 실측 8.5%)이 장소 감지에서 '확인'으로 접혔다.

증명하는 것:
  ① 영업정보가 없는 등록 POI 는 미판정 — 영업정보가 있는 POI·인덱스 밖 POI 는 아니다(인덱스 밖은 경계가 따로 낸다)
  ② 휴일 규칙이 그 날을 닫으면 판정한 것이다(HC1 HOLIDAY) — 모드 off·달력 실패·다른 날은 미판정
  ②′ 달력을 못 읽으면(실패·키 미등록 — `UNREAD_CALENDAR`) 태그형 휴일 규칙이 있는 곳은 영업 창으로 통과해도
     미판정이다(G-SA-22). 위반·날짜 명시형만 있는 곳·규칙 없는 곳·성공한 빈 달력·모드 off 는 종전대로
  ③ 첫 등장 순·중복 없음 — 여러 날 중 하루라도 못 봤으면 싣는다
  ④ PBT — 하루짜리 해에서 미판정 POI 와 HC1 위반 POI 는 겹치지 않는다(같은 술어 `open_windows_on`). 달력을 못 읽으면
     태그형 규칙이 있는 곳은 위반이거나 미판정이고, 위반 목록은 빈 달력과 같다(생성·조립은 그대로 짠다)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.assembly_engine.constraints import check_hc1, hc1_unjudged
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId
from trippilot.domain.itinerary import DaySolution, ItinerarySolution, SolveMode, VisitSlot
from trippilot.domain.poi import HOLIDAY_TAGS, UNREAD_CALENDAR, DataQuality, OpenHour, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_HANGUL = date(2026, 10, 9)  # 한글날 — 금요일
_THU = date(2026, 10, 8)
_CAL = {_HANGUL: frozenset({"PUBLIC"})}
_NINE_TO_SIX = tuple(OpenHour(d, 540, 1080) for d in range(7))


def _poi(pid: str, hours=(), rules=frozenset()) -> Poi:
    return Poi(poi_id=PoiId(pid), name=pid, category=PoiCategory.SIGHT, coord=GeoPoint(37.5, 127.0),
               open_hours=hours, avg_cost=None, rating=None, quality=DataQuality.FULL,
               source=PoiSource.SEED, confidence=None, holiday_rules=frozenset(rules))


def _slot(pid: str, day: date, h: int) -> VisitSlot:
    start = datetime(day.year, day.month, day.day, h, tzinfo=_KST)
    return VisitSlot(poi_id=PoiId(pid), start_at=start, end_at=start + timedelta(hours=1),
                     stay_min=60, score=0.5, is_llm_score=False)


def _sol(*days: tuple[date, tuple[VisitSlot, ...]]) -> ItinerarySolution:
    return ItinerarySolution(schedule_id=ScheduleId("u"), days=tuple(DaySolution(d, s, ()) for d, s in days),
                             is_fallback=False, solve_mode=SolveMode.OR_TOOLS, assembly_run=None)


def _index(*pois: Poi) -> dict[PoiId, Poi]:
    return {p.poi_id: p for p in pois}


# ── ① 무엇이 미판정인가 ─────────────────────────────────────────────


def test_영업정보가_없는_등록_POI_만_미판정이다() -> None:
    sol = _sol((_THU, (_slot("blank", _THU, 10), _slot("known", _THU, 12), _slot("ghost", _THU, 14))))
    index = _index(_poi("blank"), _poi("known", hours=_NINE_TO_SIX))  # ghost 는 인덱스 밖

    assert hc1_unjudged(sol, index) == [PoiId("blank")]
    assert check_hc1(sol, index) == []  # 셋 다 위반은 없다 — 위반 0 만으로는 이 차이가 안 보인다


def test_창_밖이어도_영업정보가_있으면_판정한_것이다() -> None:
    sol = _sol((_THU, (_slot("known", _THU, 20),)))
    index = _index(_poi("known", hours=_NINE_TO_SIX))

    assert hc1_unjudged(sol, index) == []
    assert [v.reason_code for v in check_hc1(sol, index)] == ["OUT_OF_HOURS"]


# ── ② 휴일 규칙 ────────────────────────────────────────────────────


def test_휴일_규칙이_그날을_닫으면_판정이고_아니면_미판정이다() -> None:
    index = _index(_poi("x", rules={"PUBLIC"}))
    holiday = _sol((_HANGUL, (_slot("x", _HANGUL, 10),)))
    weekday = _sol((_THU, (_slot("x", _THU, 10),)))

    assert hc1_unjudged(holiday, index, _CAL) == []  # 휴무가 증명됐다 — HC1 HOLIDAY 위반으로 나간다
    assert [v.reason_code for v in check_hc1(holiday, index, _CAL)] == ["HOLIDAY"]
    assert hc1_unjudged(holiday, index) == [PoiId("x")]      # 모드 off — 공휴일을 보지 않는다
    assert hc1_unjudged(holiday, index, UNREAD_CALENDAR) == [PoiId("x")]  # 달력 실패 — 태그 규칙은 못 본다
    assert hc1_unjudged(weekday, index, _CAL) == [PoiId("x")]


# ── ②′ 달력을 못 읽었을 때 (G-SA-22) ──────────────────────────────────


def test_달력을_못_읽으면_태그형_규칙이_있는_곳은_영업_창으로_통과해도_미판정이다() -> None:
    """빈 달력으로 판정하면 태그형 규칙이 그 날을 닫는지 모르는데, 주간 영업 창이 있으면 HC1 이 통과시켜 흔적이 없었다 —
    진짜 공휴일 휴무가 장소 감지에서 '확인'으로 접힐 수 있었다(INV-SA-2). 날짜 명시형은 달력 없이 판정한다."""
    index = _index(_poi("tagged", hours=_NINE_TO_SIX, rules={"PUBLIC"}),
                   _poi("dated", hours=_NINE_TO_SIX, rules={"01-01"}), _poi("plain", hours=_NINE_TO_SIX))
    sol = _sol((_HANGUL, (_slot("tagged", _HANGUL, 10), _slot("dated", _HANGUL, 12), _slot("plain", _HANGUL, 14))))

    assert hc1_unjudged(sol, index, UNREAD_CALENDAR) == [PoiId("tagged")]
    assert check_hc1(sol, index, UNREAD_CALENDAR) == []  # 위반은 빈 달력과 같다 — 미판정 보고만 다르다
    assert hc1_unjudged(sol, index, {}) == []    # 성공한 빈 달력 — 그 날 공휴일이 없다고 안다
    assert hc1_unjudged(sol, index, _CAL) == []  # 공휴일이라고 안다 — tagged 는 HC1 HOLIDAY 위반(판정)
    assert hc1_unjudged(sol, index) == []        # 모드 off — 공휴일을 보지 않는다(종전)


def test_달력을_못_읽어도_영업_창이나_날짜_명시형이_낸_위반은_판정이다() -> None:
    """휴일 규칙은 닫기만 한다 — 이미 위반인 슬롯은 달력이 무엇을 말하든 위반이다(미판정과 겹치지 않는다)."""
    fri_only = (OpenHour(_HANGUL.weekday(), 540, 1080),)
    index = _index(_poi("x", hours=fri_only, rules={"PUBLIC"}),
                   _poi("hangul", hours=_NINE_TO_SIX, rules={"PUBLIC", "10-09"}))
    late = _sol((_HANGUL, (_slot("x", _HANGUL, 20),)))        # 창 밖
    thu = _sol((_THU, (_slot("x", _THU, 10),)))               # 목요일엔 창이 없다 — 정기 휴무
    dated = _sol((_HANGUL, (_slot("hangul", _HANGUL, 10),)))  # '10월 9일 휴관' — 달력 없이 닫는다

    for sol, code in ((late, "OUT_OF_HOURS"), (thu, "CLOSED_DAY"), (dated, "HOLIDAY")):
        assert hc1_unjudged(sol, index, UNREAD_CALENDAR) == []
        assert [v.reason_code for v in check_hc1(sol, index, UNREAD_CALENDAR)] == [code]


# ── ③ 순서·중복·여러 날 ─────────────────────────────────────────────


def test_첫_등장_순이고_중복이_없고_하루라도_못_봤으면_싣는다() -> None:
    index = _index(_poi("a"), _poi("b"), _poi("x", rules={"PUBLIC"}))
    thu = (_THU, (_slot("b", _THU, 9), _slot("a", _THU, 11), _slot("b", _THU, 13)))
    hangul = (_HANGUL, (_slot("x", _HANGUL, 10),))  # 한글날엔 휴무로 판정한다
    next_thu = _THU + timedelta(days=7)

    assert hc1_unjudged(_sol(thu, hangul), index, _CAL) == [PoiId("b"), PoiId("a")]
    # 다음 주 목요일의 x 는 못 봤다 — 한글날에 판정했어도 싣는다
    assert hc1_unjudged(_sol(thu, hangul, (next_thu, (_slot("x", next_thu, 10),))), index, _CAL) == [
        PoiId("b"), PoiId("a"), PoiId("x")]


# ── ④ PBT ─────────────────────────────────────────────────────────


@st.composite
def _one_day(draw):
    """하루짜리 해 — POI 마다 영업정보 유무·휴일 규칙을 섞고, 일부는 인덱스에서 뺀다."""
    day = draw(st.sampled_from((_HANGUL, _THU)))
    n = draw(st.integers(1, 6))
    pois, starts = [], []
    for i in range(n):
        hours = draw(st.sampled_from(((), _NINE_TO_SIX, (OpenHour(day.weekday(), 600, 720),))))
        rules = draw(st.sampled_from((frozenset(), frozenset({"PUBLIC"}))))
        if draw(st.booleans()) or i == 0:
            pois.append(_poi(f"p{i}", hours=hours, rules=rules))
        starts.append((draw(st.integers(0, 22)), f"p{i}"))
    holidays = draw(st.sampled_from((None, {}, UNREAD_CALENDAR, _CAL)))
    slots = tuple(_slot(pid, day, h) for h, pid in sorted(starts))  # 하루 안 시간순(DaySolution 불변식)
    return _sol((day, slots)), _index(*pois), holidays


@settings(max_examples=200, deadline=None)
@given(case=_one_day())
def test_PBT_미판정과_HC1_위반은_겹치지_않는다(case) -> None:
    sol, index, holidays = case
    unjudged = set(hc1_unjudged(sol, index, holidays))
    violated = {v.slot_ref for v in check_hc1(sol, index, holidays)}

    assert unjudged.isdisjoint(violated)
    assert unjudged <= set(index)  # 인덱스 밖은 경계가 NOT_REGISTERED·UNMAPPABLE 로 따로 낸다


@settings(max_examples=200, deadline=None)
@given(case=_one_day())
def test_PBT_달력을_못_읽으면_태그형_규칙이_있는_곳은_통과로_남지_않는다(case) -> None:
    """거짓 '통과' 금지(INV-SA-2) — 태그형 규칙이 있는 곳은 위반이거나 미판정이다. 위반 목록은 빈 달력과 같다."""
    sol, index, _ = case
    unjudged = set(hc1_unjudged(sol, index, UNREAD_CALENDAR))
    violations = check_hc1(sol, index, UNREAD_CALENDAR)
    tagged = {s.poi_id for d in sol.days for s in d.slots
              if s.poi_id in index and index[s.poi_id].holiday_rules & HOLIDAY_TAGS}

    assert tagged <= unjudged | {v.slot_ref for v in violations}
    assert violations == check_hc1(sol, index, {})  # 판정은 빈 달력과 같다 — 생성·조립은 그대로 짠다
