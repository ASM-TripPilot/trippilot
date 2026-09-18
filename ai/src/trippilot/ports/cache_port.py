"""CachePort — TTL 캐시 콘센트 (business-logic-model.md §2.5).

value는 직렬화된 dict만 (도메인 타입은 to_dict 후 저장).
가격 필드 저장 금지는 정책 규칙 (Poi.to_cacheable_dict가 avg_cost 제외, business-rules.md §6).
"""

from __future__ import annotations

from typing import Protocol


class CachePort(Protocol):
    def get(self, key: str) -> dict | None: ...
    def set(self, key: str, value: dict, ttl_sec: int) -> None: ...
