"""ReplanCompositionWorker — 다시 짜기에서 남은 하루의 방문 목록을 고른다 (상위 티어).

재계획 경계(`api/wiring.replan`)가 PlanB(상황 추천) 다음에 부른다. 기존 일정·사유·요청·상황
추천·취향을 한 프롬프트에 싣고, 후보 목록(닫힌 집합) 안에서 갈 곳을 순서대로 받는다.

출력·게이트는 ALTERNATIVE_SELECTION 과 같다(`{"selections": [{"poiId", "reason"}]}`,
`AlternativeSelectionGate`) — poiId ⊆ 후보 교차(INV-1), 이유의 시간 표현은 비운다(INV-3).
고른 순서는 제안이다 — 시각·순서는 어셈블리가 정하고 검증한다(INV-2).
실패·게이트 드롭이면 폴백 `TypedResult` 그대로 — 호출측이 종전 재계획으로 진행한다(INV-4).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime

from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, TypedResult
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.workers.alternative_selection import _category_label


@dataclass(frozen=True, slots=True)
class ScheduleLine:
    """기존 일정 한 줄 — 상호명은 제3자 문자열이라 렌더 때 한 줄로 누른다."""

    time: str  # "09:19~10:34" (시각 미정이면 "시간 미정")
    category: str
    name: str
    status: str  # 다녀옴(유지) · 고정(유지) · 남은 일정 · 제외 요청


@dataclass(frozen=True, slots=True)
class ComposeDayInput:
    date: str  # "2026-10-14 (수)"
    window: str  # "11:32~21:00"
    weather: str
    reasons: tuple[str, ...]
    directives: tuple[str, ...]
    user_request: str
    schedule: tuple[ScheduleLine, ...]
    planb_picks: tuple[str, ...]  # 상황 추천 상호명(순서 = PlanB 랭킹)
    persona: str
    max_visits: int
    distance_km: Mapping[PoiId, float] = field(default_factory=dict)
    hours: Mapping[PoiId, str] = field(default_factory=dict)  # 그날 영업시간 문구

    def __post_init__(self) -> None:
        if self.max_visits < 1:
            raise ValueError("max_visits ≥ 1")


def _bullets(items: tuple[str, ...], empty: str) -> str:
    return "\n".join(f"- {inline(i)}" for i in items) or f"- {empty}"


def build_compose_vars(pool: CandidatePool, inp: ComposeDayInput) -> dict[str, str]:
    """값 전부 str·결정론(후보는 poi_id 정렬). 후보 목록 = 게이트 대조 집합(같은 `pool`)."""
    candidates = "\n".join(
        f"- {p.poi_id} | {_category_label(p)} | {inline(p.name)}"
        f" | {_km(inp.distance_km.get(p.poi_id))} | {inp.hours.get(p.poi_id, '정보 없음')}"
        for p in sorted(pool.pois, key=lambda p: str(p.poi_id))
    )
    schedule = "\n".join(
        f"- {s.time} | {s.category} | {inline(s.name)} | {s.status}" for s in inp.schedule
    )
    return {
        "date": inp.date,
        "window": inp.window,
        "weather": inp.weather,
        "reasons": _bullets(inp.reasons, "특별한 사유 없음 — 일정을 새로 짜 보고 싶음"),
        "directives": _bullets(inp.directives, "(없음)"),
        "user_request": inline(inp.user_request).strip() or "(없음)",
        "schedule": schedule or "- (기존 일정 없음)",
        "planb_picks": _bullets(inp.planb_picks, "(없음)"),
        "persona": inline(inp.persona).strip() or "(정보 없음)",
        "candidates": candidates or "(후보 없음)",
        "max_visits": str(inp.max_visits),
    }


def _km(value: float | None) -> str:
    return f"약 {value:.1f}km" if value is not None else "거리 정보 없음"


class ReplanCompositionWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def compose(
        self,
        pool: CandidatePool,
        inp: ComposeDayInput,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult:
        """`timeout_sec` 는 호출측이 재계획 시한에서 떼어 넘긴다(TRIP-376 관통)."""
        return self._gateway.call(
            LlmFeature.REPLAN_COMPOSITION,
            build_compose_vars(pool, inp),
            pool,  # selections 풀 교차 대상 (INV-1)
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
