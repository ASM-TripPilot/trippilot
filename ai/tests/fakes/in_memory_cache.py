"""InMemoryCache — CachePort의 논리 시계 기반 fake (business-logic-model.md §3).

실시간 sleep 금지 — advance(ticks)로 시간 경과를 시뮬레이션 (결정론).
"""

from __future__ import annotations


class InMemoryCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[dict, int | None]] = {}
        self._now: int = 0  # 논리 시계 (초 단위 tick)

    def advance(self, ticks: int) -> None:
        """실시간 대신 논리 시계를 진행 — TTL 만료를 결정론적으로 테스트."""
        self._now += ticks

    def get(self, key: str) -> dict | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at is not None and self._now >= expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: dict, ttl_sec: int) -> None:
        expires_at = self._now + ttl_sec if ttl_sec > 0 else None
        self._store[key] = (value, expires_at)
