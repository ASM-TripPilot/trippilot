"""신선도 메타 + 정보 패킷 타입 (agent-foundation FD domain-entities §3, S1.6).

Provider 응답은 예외가 아니라 상태값으로 수렴한다 (IO-7):
- OK·LOW = 성공(LOW는 부분 성공/충분성 신호) → FreshnessMeta 필수 (BR-AF-06, IO-6)
- 그 외(NO_CANDIDATES 등) = 실패 상태값 → freshness None 허용

대형 데이터(후보 풀)는 InfoBundle.pool_ref 참조 키만 담는다 (DL-2, BR-AF-13).
Provider별 data 상세 스키마는 agent-io-contracts §5 — 정식 dataclass 승격은 U5·U6.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from trippilot.domain.serialization import from_iso, to_iso


class ProviderKind(Enum):
    PLACE = "PLACE"
    WEATHER = "WEATHER"
    TRANSIT = "TRANSIT"
    PERSONA = "PERSONA"
    EVENT = "EVENT"


class ProviderStatus(Enum):
    """OK·LOW 외는 전부 실패 상태값 (IO-7 — 예외 던지기 금지, BR-AF-04와 동형)."""

    OK = "OK"
    LOW = "LOW"
    NO_CANDIDATES = "NO_CANDIDATES"
    WEATHER_UNKNOWN = "WEATHER_UNKNOWN"
    COLD_START = "COLD_START"
    UNAVAILABLE = "UNAVAILABLE"


_FRESHNESS_REQUIRED = frozenset({ProviderStatus.OK, ProviderStatus.LOW})


@dataclass(frozen=True, slots=True)
class FreshnessMeta:
    """패킷 단일 source의 신선도 (집계형은 미결 #7 — 본 타입 소관 아님)."""

    source: str  # KMA | KAKAO_MOBILITY | NAVER | M7_CACHE | PGVECTOR | …
    fetched_at: datetime  # tz-aware 강제
    cache_hit: bool
    ttl_sec: int  # ≥ 0
    stale: bool  # TTL 초과분을 폴백으로 반환했는가

    def __post_init__(self) -> None:
        if self.fetched_at.tzinfo is None:
            raise ValueError("FreshnessMeta.fetched_at은 tz-aware만")
        if self.ttl_sec < 0:
            raise ValueError(f"ttl_sec 음수: {self.ttl_sec}")

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "fetched_at": to_iso(self.fetched_at),
            "cache_hit": self.cache_hit,
            "ttl_sec": self.ttl_sec,
            "stale": self.stale,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "FreshnessMeta":
        return cls(
            source=d["source"],
            fetched_at=from_iso(d["fetched_at"]),
            cache_hit=d["cache_hit"],
            ttl_sec=d["ttl_sec"],
            stale=d["stale"],
        )


@dataclass(frozen=True, slots=True)
class InfoPacket:
    """Provider 응답 1건. status ∈ {OK, LOW}면 freshness 필수 (BR-AF-06, ENV-P4)."""

    provider: ProviderKind
    status: ProviderStatus
    data: dict  # JSON-safe — 상세 스키마는 agent-io-contracts §5 (판정 필드는 미결 #2)
    freshness: FreshnessMeta | None

    def __post_init__(self) -> None:
        if self.status in _FRESHNESS_REQUIRED and self.freshness is None:
            raise ValueError(
                f"status={self.status.value}는 FreshnessMeta 필수 (BR-AF-06)"
            )

    def to_dict(self) -> dict:
        return {
            "provider": self.provider.value,
            "status": self.status.value,
            "data": self.data,
            "freshness": self.freshness.to_dict() if self.freshness else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "InfoPacket":
        return cls(
            provider=ProviderKind(d["provider"]),
            status=ProviderStatus(d["status"]),
            data=d["data"],
            freshness=(
                FreshnessMeta.from_dict(d["freshness"])
                if d["freshness"] is not None
                else None
            ),
        )


@dataclass(frozen=True, slots=True)
class InfoBundle:
    """Orchestrator 수집분 동봉 봉투. 소형 패킷 직접 + 후보 풀은 참조 키만 (DL-2)."""

    packets: tuple[InfoPacket, ...]
    pool_ref: str | None  # 세션 캐시 키 — 스킴은 U5 소유 (미결 #3, opaque str)

    def to_dict(self) -> dict:
        return {
            "packets": [p.to_dict() for p in self.packets],
            "pool_ref": self.pool_ref,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "InfoBundle":
        return cls(
            packets=tuple(InfoPacket.from_dict(p) for p in d["packets"]),
            pool_ref=d["pool_ref"],
        )
