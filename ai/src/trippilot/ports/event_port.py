"""EventPort — 행사 정보 조회 콘센트 (TRIP-421).

조회 전용 — 쓰기 메서드를 추가하지 않는다. 기간은 [start, end] 폐구간이며,
어댑터는 그 기간과 겹칠 **가능성이 있는** 행사들을 돌려준다 — 정밀한 날짜
겹침·거리 필터는 Provider의 규칙 로직 소관(수집과 판정의 분리, v2 §2).

반환이 상한(1페이지)에 걸려 잘렸을 수 있으면 truncated=True — 소비측이
LOW 상태값으로 승격한다 (침묵 절단 금지).
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from trippilot.domain.event import EventInfo


class EventError(Exception):
    """행사 조회 실패 (HTTP 오류·비정상 응답 봉투). 호출측이 상태값으로 강등(INV-4)."""


class EventPort(Protocol):
    def search_events(
        self, start: date, end: date
    ) -> tuple[tuple[EventInfo, ...], bool]:
        """기간과 겹칠 수 있는 행사들 → (목록, truncated)."""
        ...
