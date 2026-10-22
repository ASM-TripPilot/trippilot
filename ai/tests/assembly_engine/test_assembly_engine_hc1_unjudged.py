"""HC1 미판정 — `check_hc1` 이 '정보 없음 → 미적용'으로 통과시키는 슬롯을 따로 센다 (상황 감지 INV-SA-2).

검증 응답의 `unverified_slots`(HOURS_UNKNOWN)가 이것을 싣는다. 위반 0 만으로는 '영업시간 통과'와 '못 봄'이
구별되지 않아, 원문이 있는데 해석하지 못한 곳(공유본 실측 8.5%)이 장소 감지에서 '확인'으로 접혔다.

증명하는 것:
  ① 영업정보가 없는 등록 POI 는 미판정 — 영업정보가 있는 POI·인덱스 밖 POI 는 아니다(인덱스 밖은 경계가 따로 낸다)
  ② 휴일 규칙이 그 날을 닫으면 판정한 것이다(HC1 HOLIDAY) — 모드 off·달력 실패·다른 날은 미판정
  ③ 첫 등장 순·중복 없음 — 여러 날 중 하루라도 못 봤으면 싣는다
  ④ PBT — 하루짜리 해에서 미판정 POI 와 HC1 위반 POI 는 겹치지 않는다(같은 술어 `open_windows_on`)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.assembly_engine.constraints import check_hc1, hc1_unjudged
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId
from trippilot.domain.itinerary import DaySolution, ItinerarySolution, SolveMode, VisitSlot
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

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
    assert hc1_unjudged(holiday, index, {}) == [PoiId("x")]  # 달력 실패 — 태그 규칙은 못 본다
    assert hc1_unjudged(weekday, index, _CAL) == [PoiId("x")]


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
    holidays = draw(st.sampled_from((None, {}, _CAL)))
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
