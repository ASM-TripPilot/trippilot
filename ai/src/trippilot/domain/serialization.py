"""직렬화 공통 헬퍼 (domain-entities.md §직렬화 규칙, business-rules.md §2).

계약: 모든 도메인 타입은 `to_dict()` / `from_dict()`를 가지며
`from_dict(to_dict(x)) == x` (U5-P10, PBT로 검증).

변환 규칙:
- datetime → ISO 8601 문자열(오프셋 포함), 역변환은 fromisoformat
- Enum → `.value`
- frozenset/tuple → list

datetime 헬퍼는 itinerary/observability 등 tz-aware 타입이 공유한다.
"""

from __future__ import annotations

from datetime import datetime


def to_iso(dt: datetime) -> str:
    """tz-aware datetime → ISO 8601 문자열. naive는 거부 (business-rules.md §2)."""
    if dt.tzinfo is None:
        raise ValueError("naive datetime은 직렬화 불가 — tz-aware만 허용")
    return dt.isoformat()


def from_iso(s: str) -> datetime:
    """ISO 8601 문자열 → tz-aware datetime."""
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        raise ValueError(f"오프셋 없는 문자열: {s!r}")
    return dt
