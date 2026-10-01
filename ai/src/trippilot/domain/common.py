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
class Pace(Enum):
    """여행 속도 — 하루를 얼마나 빽빽하게 채울 것인가.

    백엔드 `PreferenceSet.PACES`(느긋하게·균형있게·알차게) 정본과 1:1 이다.
    **미설정이 표현 가능한 축이다**(백엔드가 null 을 그대로 낸다) — 그래서 소비측은
    `Pace | None` 을 받고 None 은 무보정이지 BALANCED 가 아니다. 중립값으로 채우면
    "고르지 않은 사람"과 "균형을 고른 사람"이 구분되지 않는다.
    """

    SLOW = "SLOW"          # 느긋하게
    BALANCED = "BALANCED"  # 균형있게
    PACKED = "PACKED"      # 알차게


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


# 속도 어휘 — 정본은 백엔드 `PreferenceSet.PACES` 3종. 미인식·미지정은 거절이 아니라
# **None(무보정)** 이다. 예산(BUDGET_TOKENS)이 MID 로 떨어지는 것과 다른데, 그쪽은
# `BudgetLevel` 에 '미설정'이 없어 어쩔 수 없었던 예외다(backend_persona 주석 참조).
PACE_TOKENS: dict[str, Pace] = {
    "느긋하게": Pace.SLOW, "여유롭게": Pace.SLOW, "SLOW": Pace.SLOW,
    "균형있게": Pace.BALANCED, "보통": Pace.BALANCED, "BALANCED": Pace.BALANCED,
    "알차게": Pace.PACKED, "빡빡하게": Pace.PACKED, "PACKED": Pace.PACKED,
}


class RejectionKind(Enum):
    """사용자가 그 장소를 밀어낸 **방식** — 크기가 아니라 종류만 경계로 온다.

    크기(강등 폭)는 `OrchestratorConfig` 가 갖는다. 백엔드가 가중치를 실어 보내면
    비율을 조정할 때마다 백엔드 재배포가 필요하고, 두 서비스가 같은 숫자를 각자
    갖게 된다 — 조정은 AI 쪽 한 곳에서 한다(팀 결정 2026-09-26).
    """

    #: 슬롯 후보 패널에서 다른 곳으로 **교체**해 빠졌다. 그 자리를 보고 바꾼 것이라
    #: 가장 명확한 거절 신호다 — 강등도 이쪽이 크다.
    SWAPPED_OUT = "SWAPPED_OUT"
    #: **재생성** 직전 일정에 배치돼 있었다. "이 장소가 싫다"보다 "이 구성이 싫다"에
    #: 가까워 약하게 본다 — 맘에 들었던 곳까지 함께 걸리기 때문이다.
    REGENERATED = "REGENERATED"


@dataclass(frozen=True, slots=True)
class Rejection:
    """거절 이력 한 줄 (TRIP-964). 백엔드가 여행 단위로 누적해 요청에 싣는다.

    `count` 가 필요한 이유 — **같은 곳을 또 거절하면 더 크게 내린다**(팀 결정). 집합만
    받으면 "처음 밀어냄"과 "세 번째 밀어냄"이 구분되지 않는다. 수명은 여행이 끝날
    때까지이고, 계정 전역으로 남기지 않는다.
    """

    poi_id: PoiId
    kind: RejectionKind
    count: int = 1

    def __post_init__(self) -> None:
        if self.count < 1:
            raise ValueError(f"count ≥ 1 — 거절이 0 번이면 이력이 아니다: {self.count}")
