"""ReflectionWorker — 당일 회고 초안 생성, 상위 티어·일자 경계 트리거 (정본 §2.3).

입력은 서버 기록(방문·거리·사진·변경 이력·날씨) — 실패 시 FallbackCard
(visitCount·distanceKm·photoCount) 구성은 호출측 몫 (BR-U4-09 경계 동일).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult


@dataclass(frozen=True, slots=True)
class ReflectionInput:
    """회고 입력 요약 — 실제 기록만 (지어내기 금지 가드의 입력측 전제)."""

    visited: tuple[str, ...]  # "장소명 (체류 n분)" 형태의 표시 문자열
    distance_km: float
    photo_count: int
    planb_applied: bool
    weather: str


def build_reflection_vars(inp: ReflectionInput) -> dict[str, str]:
    return {
        "visited": " / ".join(inp.visited) or "(방문 기록 없음)",
        "distance_km": f"{inp.distance_km:.1f}",
        "photo_count": str(inp.photo_count),
        "planb": "있음" if inp.planb_applied else "없음",
        "weather": inp.weather or "정보 없음",
    }


class ReflectionWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def reflect(
        self, inp: ReflectionInput, trace_id: TraceId, now: datetime
    ) -> TypedResult:
        return self._gateway.call(
            LlmFeature.REFLECTION, build_reflection_vars(inp), None, trace_id, now
        )
