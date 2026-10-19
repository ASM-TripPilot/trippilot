"""공휴일 휴무 — 그 날 영업 창 헬퍼 `open_windows_on` (상황 감지 H1, BR-SA-17).

증명하는 것:
  ① 모드 off(holidays=None)는 종전 요일 판정과 **완전히 같다** — 임의 POI·날짜(PBT).
  ② 휴일 규칙이 없으면 달력이 무엇이든 종전과 같다(PBT) — 규칙 없는 POI 는 공휴일에 닫히지 않는다.
  ③ 태그 규칙은 달력 태그와 겹칠 때만, 날짜 명시형은 빈 달력(실패·미등록)에서도 그 날을 닫는다.
  ④ 휴일 규칙으로 닫힌 날은 주간 영업정보가 없어도 () — 휴무 원문이 그 날 닫는다고 말했다.
  ⑤ 규칙 토큰은 닫힌 집합 — 모르는 토큰·없는 날짜는 생성 거부.
  ⑥ 직렬화 — 규칙이 없으면 키를 싣지 않는다(수집 제안 문서 = 백엔드 수신 와이어가 이 직렬화를 그대로
     싣는다), 있으면 왕복, 키 없는 옛 직렬화본도 읽힌다.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import (
    HOLIDAY_TAGS,
    DataQuality,
    OpenHour,
    Poi,
    PoiCategory,
    PoiSource,
    closed_by_holiday,
    open_windows_on,
)

from tests.generators.poi import open_hours, pois

_MON = date(2026, 10, 5)      # 대체공휴일(개천절) — 월요일
_FRI = date(2026, 10, 9)      # 한글날 — 금요일
_NEW_YEAR = date(2027, 1, 1)  # 금요일


def _poi(hours: tuple[OpenHour, ...] = (), rules: frozenset[str] = frozenset()) -> Poi:
    return Poi(poi_id=PoiId("p"), name="박물관", category=PoiCategory.CULTURE,
               coord=GeoPoint(37.5, 127.0), open_hours=hours, avg_cost=None, rating=None,
               quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None,
               holiday_rules=rules)


def _week(lo: int = 540, hi: int = 1080, closed: tuple[int, ...] = ()) -> tuple[OpenHour, ...]:
    return tuple(OpenHour(d, lo, hi) for d in range(7) if d not in closed)


def _old(poi: Poi, day: date) -> tuple[OpenHour, ...] | None:
    """종전 식 — 이 PR 전 모든 적용 지점이 복사해 쓰던 요일 판정."""
    return None if not poi.open_hours else tuple(
        oh for oh in poi.open_hours if oh.day_of_week == day.weekday())


_RULES = st.frozensets(st.sampled_from(sorted(HOLIDAY_TAGS) + ["01-01", "05-01", "10-09", "12-25"]))
_CAL = st.dictionaries(
    st.dates(min_value=date(2026, 1, 1), max_value=date(2027, 12, 31)),
    st.frozensets(st.sampled_from(sorted(HOLIDAY_TAGS)), min_size=1), max_size=6)


@st.composite
def _ruled_pois(draw) -> Poi:
    return replace(draw(pois()), holiday_rules=draw(_RULES))


# ── ①·② 종전 동치 (PBT) ─────────────────────────────────────────────


@given(poi=_ruled_pois(), day=st.dates(min_value=date(2020, 1, 1), max_value=date(2030, 12, 31)))
def test_모드_off_면_규칙이_있어도_종전_요일_판정과_같다(poi: Poi, day: date) -> None:
    assert open_windows_on(poi, day) == _old(poi, day)
    assert open_windows_on(poi, day, None) == _old(poi, day)
    assert closed_by_holiday(poi, day, None) is False


@given(hours=st.lists(open_hours(), max_size=4), cal=_CAL,
       day=st.dates(min_value=date(2026, 1, 1), max_value=date(2027, 12, 31)))
def test_규칙이_없으면_달력이_무엇이든_종전과_같다(hours, cal, day: date) -> None:
    poi = _poi(tuple(hours))
    assert open_windows_on(poi, day, cal) == _old(poi, day)
    assert closed_by_holiday(poi, day, cal) is False


@given(poi=_ruled_pois(), cal=_CAL,
       day=st.dates(min_value=date(2026, 1, 1), max_value=date(2027, 12, 31)))
def test_닫히지_않는_날은_종전과_같고_닫히는_날은_빈_창이다(poi: Poi, cal, day: date) -> None:
    got = open_windows_on(poi, day, cal)
    if closed_by_holiday(poi, day, cal):
        assert got == ()
    else:
        assert got == _old(poi, day)


# ── ③·④ 단위 사례 ──────────────────────────────────────────────────


def test_공휴일_태그는_달력의_그_날에만_닫는다() -> None:
    poi = _poi(_week(), frozenset({"PUBLIC"}))
    cal = {_MON: frozenset({"PUBLIC"}), _FRI: frozenset({"PUBLIC"})}
    assert open_windows_on(poi, _MON, cal) == ()
    assert open_windows_on(poi, _FRI, cal) == ()
    tue = _MON + timedelta(days=1)
    assert open_windows_on(poi, tue, cal) == (OpenHour(1, 540, 1080),)


def test_설날_당일_규칙은_설날_당일만_닫는다() -> None:
    poi = _poi(_week(), frozenset({"SEOLLAL_DAY"}))
    eve, day, nxt = date(2027, 2, 6), date(2027, 2, 7), date(2027, 2, 8)
    cal = {eve: frozenset({"PUBLIC", "SEOLLAL_EVE"}), day: frozenset({"PUBLIC", "SEOLLAL_DAY"}),
           nxt: frozenset({"PUBLIC", "SEOLLAL_NEXT"})}
    assert open_windows_on(poi, day, cal) == ()
    assert open_windows_on(poi, eve, cal) == (OpenHour(5, 540, 1080),)
    assert open_windows_on(poi, nxt, cal) == (OpenHour(0, 540, 1080),)


def test_날짜_명시형은_빈_달력에서도_닫는다() -> None:
    """달력 실패·키 미등록 = 빈 매핑 — 태그 규칙은 못 보지만 '1월 1일 휴관'은 달력이 없어도 안다."""
    poi = _poi(_week(), frozenset({"01-01", "PUBLIC"}))
    assert open_windows_on(poi, _NEW_YEAR, {}) == ()
    assert closed_by_holiday(poi, _NEW_YEAR, {}) is True
    assert open_windows_on(poi, _FRI, {}) == (OpenHour(4, 540, 1080),)  # 한글날인데 달력이 없다


def test_영업정보가_없어도_휴일_규칙으로_닫히는_날은_빈_창이다() -> None:
    poi = _poi((), frozenset({"PUBLIC"}))
    assert open_windows_on(poi, _FRI, {_FRI: frozenset({"PUBLIC"})}) == ()
    assert open_windows_on(poi, _FRI, {}) is None  # 그 밖에는 여전히 모름
    assert open_windows_on(poi, _FRI) is None


def test_정기_휴무일은_공휴일과_무관하게_빈_창이다() -> None:
    poi = _poi(_week(closed=(4,)), frozenset())  # 금요일 휴무
    assert open_windows_on(poi, _FRI, {_FRI: frozenset({"PUBLIC"})}) == ()
    assert closed_by_holiday(poi, _FRI, {_FRI: frozenset({"PUBLIC"})}) is False


# ── ⑤ 닫힌 집합 ─────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", ["HOLIDAY", "public", "13-01", "02-30", "1-1", "PUBLIC_NEXT"])
def test_모르는_규칙_토큰은_거부한다(bad: str) -> None:
    with pytest.raises(ValueError):
        _poi(rules=frozenset({bad}))


def test_윤일과_태그는_받는다() -> None:
    assert _poi(rules=frozenset({"02-29", *HOLIDAY_TAGS})).holiday_rules >= {"02-29"}


# ── ⑥ 직렬화 ─────────────────────────────────────────────────────────


def test_규칙이_없으면_직렬화에_키가_없다() -> None:
    """수집 제안 문서(`pipeline.to_output_document` → 백엔드 `PoiProposalDocument`)가 `Poi.to_dict()` 를
    그대로 싣는다 — 규칙은 런타임 적재만 채우므로 와이어 모양이 바뀌지 않는다."""
    assert "holiday_rules" not in _poi(_week()).to_dict()


@given(poi=_ruled_pois())
def test_규칙은_직렬화를_왕복한다(poi: Poi) -> None:
    assert Poi.from_dict(poi.to_dict()) == poi
    assert Poi.from_dict({**poi.to_cacheable_dict(), "avg_cost": None}).holiday_rules == poi.holiday_rules


def test_키_없는_옛_직렬화본도_읽힌다() -> None:
    d = _poi(_week(), frozenset({"PUBLIC"})).to_dict()
    del d["holiday_rules"]
    assert Poi.from_dict(d).holiday_rules == frozenset()
