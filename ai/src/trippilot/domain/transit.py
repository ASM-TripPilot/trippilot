"""Transit 도메인 타입 (agent-io-contracts §5, TRIP-410).

v2 4상자 파이프라인에서 TransitProvider(2단)의 입출력 계약.
- TransitRequest: Orchestrator InfoCollector가 수집 지시할 때 보내는 요청
- TransitInfo: TransitProvider가 반환하는 이동 정보 응답
- DelayTrigger: 지연 트리거 판정 결과 (예정 대비 30분+)
- Confidence: 어댑터 신뢰도 등급

INV-3 준수: internal_minutes는 내부 판정용. to_public_dict()에서 구조적으로 제외.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.freshness import FreshnessMeta
from trippilot.domain.serialization import from_iso, to_iso


class TransitPurpose(Enum):
    """조회 목적 — InfoCollector가 정보 요구표에 따라 지정."""

    INFO_DISPLAY = "info_display"  # 사용자에게 거리 표시
    DELAY_CHECK = "delay_check"  # 지연 트리거 판정
    MATRIX = "matrix"  # 다중 경로 배치 조회


class Confidence(Enum):
    """어댑터 신뢰도 등급 (agent-hierarchy-design §3.3)."""

    HIGH = "HIGH"  # 실경로 API (TMAP, 카카오모빌리티)
    MID = "MID"  # 보조 API (네이버 등)
    LOW = "LOW"  # 직선거리×우회계수 추정


@dataclass(frozen=True, slots=True)
class TransitRequest:
    """TransitProvider 요청 — InfoCollector가 조립.

    expected_minutes: 지연 판정용 (없으면 트리거 미판정).
    """

    origin: GeoPoint
    destination: GeoPoint
    mode: TransportMode
    purpose: TransitPurpose
    now: datetime
    expected_minutes: int | None = None

    def __post_init__(self) -> None:
        if self.now.tzinfo is None:
            raise ValueError("TransitRequest.now은 tz-aware만")
        if self.expected_minutes is not None and self.expected_minutes < 0:
            raise ValueError(
                f"expected_minutes 음수: {self.expected_minutes}"
            )

    def to_dict(self) -> dict:
        return {
            "origin": self.origin.to_dict(),
            "destination": self.destination.to_dict(),
            "mode": self.mode.value,
            "purpose": self.purpose.value,
            "now": to_iso(self.now),
            "expected_minutes": self.expected_minutes,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TransitRequest":
        return cls(
            origin=GeoPoint.from_dict(d["origin"]),
            destination=GeoPoint.from_dict(d["destination"]),
            mode=TransportMode(d["mode"]),
            purpose=TransitPurpose(d["purpose"]),
            now=from_iso(d["now"]),
            expected_minutes=d.get("expected_minutes"),
        )


@dataclass(frozen=True, slots=True)
class DelayTrigger:
    """지연 트리거 판정 결과 (규칙 로직, LLM 0회).

    delay_minutes: 예정 대비 초과분.
    threshold_minutes: 트리거 임계값 (기본 30).
    """

    delay_minutes: int
    threshold_minutes: int = 30

    def __post_init__(self) -> None:
        if self.delay_minutes < 0:
            raise ValueError(f"delay_minutes 음수: {self.delay_minutes}")
        if self.threshold_minutes <= 0:
            raise ValueError(
                f"threshold_minutes는 양수만: {self.threshold_minutes}"
            )

    def to_dict(self) -> dict:
        return {
            "delay_minutes": self.delay_minutes,
            "threshold_minutes": self.threshold_minutes,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "DelayTrigger":
        return cls(
            delay_minutes=d["delay_minutes"],
            threshold_minutes=d.get("threshold_minutes", 30),
        )


@dataclass(frozen=True, slots=True)
class TransitInfo:
    """TransitProvider 응답 — 이동 정보 + 지연 판정 (agent-io-contracts §5).

    INV-3 준수: internal_minutes는 트리거 판정·캘리브레이션 내부용.
    to_public_dict()에서 구조적으로 제외 — 사용자 노출 경로에 포함 불가.
    """

    distance_m: int  # 미터 단위 거리
    distance_range: str  # 표시용 문자열 ("약 1.2km")
    internal_minutes: int  # 내부용 — 화면·public 직렬화 금지 (INV-3)
    confidence: Confidence  # HIGH(실 API) / MID(보조) / LOW(추정)
    source: str  # haversine_x_detour | tmap_car | tmap_pedestrian | tmap_transit
    delay_trigger: DelayTrigger | None  # 지연 판정 결과 (없으면 미판정)
    freshness: FreshnessMeta

    def __post_init__(self) -> None:
        if self.distance_m < 0:
            raise ValueError(f"distance_m 음수: {self.distance_m}")
        if self.internal_minutes < 0:
            raise ValueError(f"internal_minutes 음수: {self.internal_minutes}")

    # ── 내부/전체 직렬화 (저장·로깅용, internal_minutes 포함) ──
    def to_dict(self) -> dict:
        return {
            "distance_m": self.distance_m,
            "distance_range": self.distance_range,
            "internal_minutes": self.internal_minutes,
            "confidence": self.confidence.value,
            "source": self.source,
            "delay_trigger": (
                self.delay_trigger.to_dict() if self.delay_trigger else None
            ),
            "freshness": self.freshness.to_dict(),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TransitInfo":
        return cls(
            distance_m=d["distance_m"],
            distance_range=d["distance_range"],
            internal_minutes=d["internal_minutes"],
            confidence=Confidence(d["confidence"]),
            source=d["source"],
            delay_trigger=(
                DelayTrigger.from_dict(d["delay_trigger"])
                if d.get("delay_trigger") is not None
                else None
            ),
            freshness=FreshnessMeta.from_dict(d["freshness"]),
        )

    # ── 공개 직렬화 (화면·API용) — INV-3: internal_minutes 제외, 거리만 ──
    def to_public_dict(self) -> dict:
        return {
            "distance_m": self.distance_m,
            "distance_range": self.distance_range,
            "confidence": self.confidence.value,
            "source": self.source,
        }
