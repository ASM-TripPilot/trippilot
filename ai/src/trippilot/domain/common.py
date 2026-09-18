"""공통 도메인 타입 (domain-entities.md §0).

domain 계층은 외부 의존 0 — 표준 라이브러리만 사용.
모든 값 타입은 frozen + slots, 검증은 __post_init__에서 (business-rules.md §2).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import NewType

# ID 타입 — NewType 문자열. 교차 대입은 타입 체커가 차단 (business-rules.md §2)
PoiId = NewType("PoiId", str)
ScheduleId = NewType("ScheduleId", str)
UserId = NewType("UserId", str)
TraceId = NewType("TraceId", str)


class TransportMode(Enum):
    """이동 수단. radius_km = 후보 풀 반경 기준 (domain-entities.md §0)."""

    WALK = "WALK"
    PUBLIC = "PUBLIC"
    CAR = "CAR"

    @property
    def radius_km(self) -> float:
        return {
            TransportMode.WALK: 2.0,
            TransportMode.PUBLIC: 10.0,
            TransportMode.CAR: 20.0,
        }[self]


class BudgetLevel(Enum):
    """예산 등급 — 소프트 제약 (필터·가중치 입력, HC 아님. business-rules.md §6)."""

    LOW = "LOW"
    MID = "MID"
    HIGH = "HIGH"


@dataclass(frozen=True, slots=True)
class GeoPoint:
    """좌표. 범위를 벗어난 인스턴스는 생성 자체가 불가능."""

    lat: float
    lng: float

    def __post_init__(self) -> None:
        if not -90.0 <= self.lat <= 90.0:
            raise ValueError(f"lat out of range [-90, 90]: {self.lat}")
        if not -180.0 <= self.lng <= 180.0:
            raise ValueError(f"lng out of range [-180, 180]: {self.lng}")

    def to_dict(self) -> dict:
        return {"lat": self.lat, "lng": self.lng}

    @classmethod
    def from_dict(cls, d: dict) -> "GeoPoint":
        return cls(lat=d["lat"], lng=d["lng"])


# 경계 어휘 → 도메인 enum 번역표 (결정론 — 소프트 입력이라 미인식은 기본값 폴백).
#
# 백엔드 `preference_set.budget_tier` 의 정본 어휘는 **저가·중간·고급·럭셔리 4종**이고
# (`V1.5__profile.sql` CHECK), 접지 않고 그대로 와이어에 실린다
# (`ReplanFacadeService`: `budgetLevel = prefs.budgetTier`). 그러니 넷이 전부 여기
# 있어야 한다 — 빠진 값은 거절되는 것이 아니라 **조용히 MID** 가 된다(아래 폴백).
BUDGET_TOKENS: dict[str, BudgetLevel] = {
    "LOW": BudgetLevel.LOW, "저렴": BudgetLevel.LOW, "낮음": BudgetLevel.LOW,
    "저가": BudgetLevel.LOW,
    "MID": BudgetLevel.MID, "MIDDLE": BudgetLevel.MID,
    "중간": BudgetLevel.MID, "보통": BudgetLevel.MID,
    "HIGH": BudgetLevel.HIGH, "높음": BudgetLevel.HIGH,
    "고급": BudgetLevel.HIGH, "프리미엄": BudgetLevel.HIGH,
    # 럭셔리는 **임시로** HIGH 다 — 접는 것이 옳아서가 아니라 MID 로 떨어지는 것보다
    # 나아서다. 정식 값은 TRIP-434 에서 온다(결정: 등급을 구간으로 — 상한만이 아니라
    # 하한을 도입한다). `M7Config.budget_limit` 의 HIGH 가 지금 `None`(상한 없음)이라
    # 그 위에 값을 그냥 얹으면 둘 다 무제한이라 구분이 안 되기 때문이고, 임계표를
    # 같이 고치는 것이 그 작업의 본체다. 여기 한 줄은 그때까지의 지혈이다.
    "럭셔리": BudgetLevel.HIGH,
}
