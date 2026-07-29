"""SpyCache — set 호출을 기록하는 CachePort fake (CACHE-P1 단언용)."""

from __future__ import annotations

from tests.fakes.in_memory_cache import InMemoryCache


class SpyCache(InMemoryCache):
    def __init__(self) -> None:
        super().__init__()
        self.set_calls: list[tuple[str, dict]] = []

    def set(self, key: str, value: dict, ttl_sec: int) -> None:
        self.set_calls.append((key, value))
        super().set(key, value, ttl_sec)
