"""FakeClock — ClockPort fake (U2 FD §3). sleep 없이 시간 경과 시뮬레이션 (DL-3)."""

from __future__ import annotations


class FakeClock:
    def __init__(self, start_ms: int = 0) -> None:
        self._now = start_ms

    def monotonic_ms(self) -> int:
        return self._now

    def advance(self, ms: int) -> None:
        self._now += ms
