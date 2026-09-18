"""행사(축제·공연·전시) 도메인 타입 (agent-structure-v2 Provider 5종, TRIP-421).

EventProvider가 수집해 InfoPacket.data에 싣는 단위 — JSON-safe 직렬화 왕복을
갖춘다 (InfoPacket data 계약). 행사는 **기간 달린 정보이지 POI가 아니다** —
후보 풀에 들어가지 않고(INV-1), 풀 안 POI에 근접 보너스로만 반영된다
(orchestrator/event_affinity.py). 시각(시·분)은 다루지 않는다 — 기간(일 단위)
겹침 판정용이고, 사용자 표시 시각·순서는 언제나 어셈블리 몫이다 (INV-2).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum

from trippilot.domain.common import GeoPoint


class EventType(Enum):
    """행사 유형 — 취향 적합 조견표(event_affinity)의 키. 분류 불가는 OTHER."""

    FESTIVAL = "FESTIVAL"      # 축제
    PERFORMANCE = "PERFORMANCE"  # 공연
    EXHIBITION = "EXHIBITION"  # 전시
    OTHER = "OTHER"


@dataclass(frozen=True, slots=True)
class EventInfo:
    """행사 1건 — 좌표 없는 행사(주소만 있는 등록)도 유효하다 (근접 부착만 제외)."""

    event_id: str  # 출처 식별자 (수집 파이프라인이 부여)
    name: str
    event_type: EventType
    start: date
    end: date
    coord: GeoPoint | None
    address: str | None

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ValueError(f"기간 역전: {self.start} > {self.end}")

    def overlaps(self, days: tuple[date, ...]) -> bool:
        """여행 날짜와 하루라도 겹치는가 — Provider 필터의 판정 단위."""
        return any(self.start <= d <= self.end for d in days)

    def to_dict(self) -> dict:
        return {
            "event_id": self.event_id,
            "name": self.name,
            "event_type": self.event_type.value,
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "coord": (
                {"lat": self.coord.lat, "lng": self.coord.lng}
                if self.coord is not None else None
            ),
            "address": self.address,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EventInfo":
        coord = d.get("coord")
        return cls(
            event_id=d["event_id"],
            name=d["name"],
            event_type=EventType(d["event_type"]),
            start=date.fromisoformat(d["start"]),
            end=date.fromisoformat(d["end"]),
            coord=GeoPoint(coord["lat"], coord["lng"]) if coord else None,
            address=d.get("address"),
        )
