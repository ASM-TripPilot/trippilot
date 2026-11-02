"""이동 추정 도메인 타입 (domain-entities.md §3).

INV-3 (소요시간 미표시)의 타입 레벨 강제 지점.
`internal_minutes`는 계산·트리거 판정 내부용이며,
사용자에게 나가는 `to_public_dict()`에는 구조적으로 포함되지 않는다.
직렬화 경로가 분리되어 있어 실수로 노출하는 것이 불가능하다 (business-rules.md §1).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TravelEstimate:
    """지점 간 이동 추정.

    거리는 단일값이 아닌 범위로 표현 (ADR-0009).
    """

    distance_km_range: tuple[float, float]
    internal_minutes: int  # 내부용 — 화면·public 직렬화에 절대 노출 금지 (INV-3)
    is_estimated: bool
    source: str
    # 운전 구간에 붙은 걷는 꼬리(도로 km) — 자차 여행의 주차 거점 오가기(assembly_engine/parking). 거리 범위에 이미 들어
    # 있고, 화면 문구가 "(주차장 도보 0.4km 포함)"으로 따로 보여 준다. 시간이 아니라 거리라 INV-3 과 무관하다.
    walk_km: float = 0.0

    def __post_init__(self) -> None:
        low, high = self.distance_km_range
        if low < 0:
            raise ValueError(f"거리 범위 하한 음수: {low}")
        if low > high:
            raise ValueError(f"거리 범위 역전: low={low} > high={high}")
        if self.internal_minutes < 0:
            raise ValueError(f"internal_minutes 음수: {self.internal_minutes}")
        if self.walk_km < 0:
            raise ValueError(f"walk_km 음수: {self.walk_km}")

    # ── 내부/전체 직렬화 (저장·전송용, internal_minutes 포함) ──
    def to_dict(self) -> dict:
        return {
            "distance_km_range": list(self.distance_km_range),
            "internal_minutes": self.internal_minutes,
            "is_estimated": self.is_estimated,
            "source": self.source,
            "walk_km": self.walk_km,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TravelEstimate":
        low, high = d["distance_km_range"]
        return cls(
            distance_km_range=(low, high),
            internal_minutes=d["internal_minutes"],
            is_estimated=d["is_estimated"],
            source=d["source"],
            walk_km=d.get("walk_km", 0.0),
        )

    # ── 공개 직렬화 (화면·API용) — INV-3: internal_minutes 제외, 거리만 ──
    def to_public_dict(self) -> dict:
        return {
            "distance_km_range": list(self.distance_km_range),
            "is_estimated": self.is_estimated,
            "source": self.source,
        }
