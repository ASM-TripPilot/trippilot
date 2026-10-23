"""HolidayCalendarPort — 특일 달력 (상황 감지 H1 · BR-SA-17).

공휴일 휴무 판정의 재료 — 날짜 → 그 날 태그(`domain.poi.HOLIDAY_TAGS`). 어댑터는 공공데이터포털 특일정보
(`poi_curation/adapters/kasi_holiday_calendar.py`). None = 실패(키 미등록·인증 오류·불통·형식 깨짐)다 —
어댑터는 예외를 던지지 않는다.

`HolidaySource` 가 `HOLIDAY_CLOSURE_MODE` 를 진입점에 내리는 한 곳이다 — 진입점(생성·재계획·검증·수리·편집)이
요청당 1회 부르고, 그 매핑을 `ItineraryProblem.holidays` 로 조립·검증에 함께 넘긴다(조립 루프는 I/O 를 타지
않는다).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from trippilot.domain.poi import UNREAD_CALENDAR, HolidayCalendar


class HolidayCalendarPort(Protocol):
    def holidays_between(self, start: date, end: date) -> Mapping[date, frozenset[str]] | None:
        """[start, end] 안의 공휴일 → 그 날 태그. 공휴일이 없으면 빈 매핑(성공), 실패면 None."""
        ...


@dataclass(frozen=True)
class HolidaySource:
    """off(기본) → None: 공휴일 규칙 없음, 달력 조회 0회(종전과 같다).

    on → 달력 매핑. 달력이 없거나(키 미등록) 실패하면 **빈 매핑** — 날짜 명시형 규칙("1월 1일 휴관")만 산다.
    그 빈 매핑은 `UNREAD_CALENDAR` 다 — 성공한 빈 달력과 갈라, 검증이 태그형 규칙을 못 본 슬롯을 미판정으로 싣는다
    (G-SA-22). 생성·재계획은 빈 매핑으로 읽어 종전대로 짠다.
    정기 규칙(요일 휴무) 판정은 모드와 무관하게 그대로다.
    """

    enabled: bool = False
    calendar: HolidayCalendarPort | None = None

    def between(self, start: date, end: date) -> HolidayCalendar | None:
        if not self.enabled:
            return None
        got = self.calendar.holidays_between(start, end) if self.calendar is not None else None
        return got if got is not None else UNREAD_CALENDAR
