"""TravelTimePort — 실경로 이동시간 조회 콘센트 (TRIP-382).

TravelPort(추정: 하버사인×우회계수)와 **별개 계약** — 이쪽은 외부 경로 API의
실측이다. 조회 전용(쓰기 없음): 확정 일정 인접 슬롯의 추정 오차를 축적하는
검증(2단계 캘리브레이션 재료)에만 쓰이고, 솔버 경로에는 주입되지 않는다 —
사용자 노출 시간·순서는 여전히 솔버 검증값만 (INV-2), 소요시간 미표시 (INV-3).

Protocol(구조적 타이핑) — 어댑터는 상속 없이 시그니처만 맞추면 된다.
실패는 TravelTimeError로 승격(침묵 금지, INV-4) — 호출측(리허설 스크립트)이
"검증 생략"으로 리허설 성패와 분리 처리한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from trippilot.domain.common import GeoPoint, TransportMode


class TravelTimeError(Exception):
    """실경로 조회 실패 — HTTP·응답 형식·좌표 문제. 원인은 __cause__로 보존."""


@dataclass(frozen=True, slots=True)
class MeasuredTravel:
    """좌표쌍 1건의 실경로 실측값.

    real_minutes 는 오차 축적 **내부용** — 화면·public 직렬화 금지 (INV-3).
    approximated: 요청 수단을 다른 수단 API로 근사했으면 True
    (예: PUBLIC을 보행 경로로 근사 — 어댑터 주석 참조).
    """

    real_minutes: float
    distance_km: float
    source: str
    approximated: bool

    def __post_init__(self) -> None:
        if self.real_minutes < 0:
            raise ValueError(f"real_minutes 음수: {self.real_minutes}")
        if self.distance_km < 0:
            raise ValueError(f"distance_km 음수: {self.distance_km}")


class TravelTimePort(Protocol):
    def measure(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> MeasuredTravel: ...
