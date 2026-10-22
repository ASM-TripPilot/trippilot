"""ReplanCompositionWorker — 다시 짜기에서 남은 하루의 방문 목록을 고른다 (상위 티어).

재계획 경계(`api/wiring.replan`)가 PlanB(상황 추천) 다음에 부른다. 기존 일정·사유·요청·상황
추천·취향을 한 프롬프트에 싣고, 후보 목록(닫힌 집합) 안에서 갈 곳을 순서대로 받는다.

후보는 UUID 대신 **번호**로 싣는다(0.7.0 — 출력 글자의 36%가 UUID 베끼기였다, `ai/docs/서빙-최적화-실적.md` §8).
출구는 `NumberedSelectionGate` — 번호를 poi_id 로 되돌린 뒤 ALTERNATIVE_SELECTION 과 같은 검사(poiId ⊆ 후보 교차 INV-1,
이유의 시간 표현 비움 INV-3).
고른 순서는 제안이다 — 시각·순서는 어셈블리가 정하고 검증한다(INV-2).
실패·게이트 드롭이면 폴백 `TypedResult` 그대로 — 호출측이 종전 재계획으로 진행한다(INV-4).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime

from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, TypedResult
from trippilot.llm_gateway.gates.numbered_selection import numbered
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline
from trippilot.llm_gateway.workers.alternative_selection import _category_label


@dataclass(frozen=True, slots=True)
class ScheduleLine:
    """기존 일정 한 줄 — 상호명은 제3자 문자열이라 렌더 때 한 줄로 누른다."""

    time: str  # "09:19~10:34" (시각 미정이면 "시간 미정")
    category: str
    name: str
    status: str  # 다녀옴(유지) · 고정(유지) · 진행 중(유지) · 남은 일정 · 제외 요청 · 요청과 안 맞음(교체) · 확정(유지)(1회 수리)


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
    change_rule: str  # 얼마나 바꿀지 — `composition.change_rule` (TRIP-1394)
    distance_km: Mapping[PoiId, float] = field(default_factory=dict)
    hours: Mapping[PoiId, str] = field(default_factory=dict)  # 그날 영업시간 문구
    # 이 날짜의 최근 변경(TRIP-975) — "같은 제안 반복 방지". 비면 "(없음)".
    recent_changes: tuple[str, ...] = ()
    # 1회 수리(배선 `_repair_day`)만 채운다 — 못 넣은 곳("상호명 | 카테고리 | 까닭")과 빈 시간 줄.
    # 비면 `$repair` 가 빈 문자열이라 1차 프롬프트는 0.5.0 과 바이트 동일하다.
    unplaced: tuple[str, ...] = ()
    gaps: tuple[str, ...] = ()
    # KB-5 장소 지식 `{source_ref: 문서}` — 있는 후보만 줄 끝에 붙는다(0.8.0). 대체지 선택과 같은 키·같은 문서.
    place_knowledge: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.max_visits < 1:
            raise ValueError("max_visits ≥ 1")


def _bullets(items: tuple[str, ...], empty: str) -> str:
    return "\n".join(f"- {inline(i)}" for i in items) or f"- {empty}"


def build_compose_vars(pool: CandidatePool, inp: ComposeDayInput) -> dict[str, str]:
    """값 전부 str·결정론. 후보 번호 = `numbered(pool)` 순서(게이트가 같은 함수로 되돌린다)."""
    candidates = "\n".join(
        f"- {n} | {_category_label(p)} | {inline(p.name)}"
        f" | {_km(inp.distance_km.get(p.poi_id))} | {inline(inp.hours.get(p.poi_id, '정보 없음'))}"
        + _doc(inp.place_knowledge.get(p.source_ref or "", ""))
        for n, p in enumerate(numbered(pool), 1)
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
        "change_rule": inp.change_rule,
        "recent_changes": _bullets(inp.recent_changes, "(없음)"),
        # 늘 싣는다 — `Template.substitute` 는 없는 변수에 죽는다(1차 전부가 `llm_compose_error`).
        "repair": "" if not inp.unplaced else (
            "[못 넣은 곳] (방금 고른 곳 중 동선·영업시간 검증에서 빠진 곳과 까닭 — 후보에서 뺐습니다)\n"
            + _bullets(inp.unplaced, "(없음)") + "\n\n"
            "[빈 시간] (지금 일정에서 비어 있는 때 — 빈 시간 하나에 한 곳만. 아래 후보 거리는 그 후보가 들어갈"
            " 빈 시간의 앞 장소(맨 앞 빈 시간이면 뒤 장소)에서 잰 값)\n"
            + _bullets(inp.gaps, "(없음)") + "\n\n"),
    }


def _doc(text: str) -> str:
    """설명이 없는 후보는 칸을 만들지 않는다 — 빈 칸을 "부적합"으로 읽지 않게(대체지 선택과 같다).
    문서는 제3자 글이라 한 줄로 누른다(줄바꿈이 후보 목록의 다음 줄을 흉내 내지 못하게)."""
    return f" | {inline(text)}" if text else ""


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
        """`timeout_sec` 는 호출측이 재계획 시한에서 떼어 넘긴다(TRIP-376 관통).

        1회 수리(`inp.unplaced`)가 실패하면 실제로 일어나는 일은 "1차 일정 그대로"다 — 설정 매핑의
        "점수 경로로"(`scored_assembly`)를 실으면 지어낸 폴백 실체다(TRIP-260 #4).
        """
        return self._gateway.call(
            LlmFeature.REPLAN_COMPOSITION,
            build_compose_vars(pool, inp),
            pool,  # selections 풀 교차 대상 (INV-1)
            trace_id,
            now,
            timeout_sec=timeout_sec,
            fallback_modes=("llm_compose_repair", "llm_compose_day") if inp.unplaced else None,
        )
