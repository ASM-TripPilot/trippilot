"""PreferenceScoringWorker — 취향 점수화, 경량 티어·전 일자 공용 1회 (U4 FD §3).

점수는 수치만 산출한다 — 표시용 설명은 배치된 슬롯에 한해 EXPLANATION 워커
소유 (TRIP-374, ai-prompt-design.md §2.2).

흐름: ContextResolver 권한 재조회(D31) → 프롬프트 변수 조립(필드 최소화 G181,
좌표 미포함) → gateway.call. 폴백이면 TypedResult(is_fallback=True)를 그대로
반환 — 규칙 점수 실행은 호출측(U5)의 몫 (BR-U4-09).
"""

from __future__ import annotations

from datetime import datetime

from trippilot.llm_gateway.context import ContextResolver
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.context import Principal, ResourceRef
from trippilot.domain.llm import CandidatePool, LlmFeature, ScoredPoi, TypedResult
from trippilot.domain.persona import PersonaSummary


def build_prompt_vars(pool: CandidatePool, persona: PersonaSummary) -> dict[str, str]:
    """프롬프트 변수 문자열화 — 결정론(poi_id 정렬), 좌표 미포함 (G181, PROMPT-P1).

    후보는 poi_id·카테고리·상호명만 — Poi의 coord·avg_cost 등은 넣지 않는다.
    """
    candidates = "\n".join(
        f"- {p.poi_id} | {p.category.value} | {p.name}"
        for p in sorted(pool.pois, key=lambda p: str(p.poi_id))
    )
    return {
        "taste_tags": ", ".join(t.value for t in persona.taste_tags) or "미설정",
        "companion": persona.companion.value,
        "budget": persona.budget.value,
        "candidates": candidates or "(후보 없음)",
    }


class PreferenceScoringWorker:
    def __init__(self, gateway: GatewayFacade, resolver: ContextResolver) -> None:
        self._gateway = gateway
        self._resolver = resolver

    def score(
        self,
        pool: CandidatePool,
        persona_ref: ResourceRef,
        principal: Principal,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult[tuple[ScoredPoi, ...]]:
        # 권한 위반은 폴백이 아니라 즉시 예외 (D31 — 부분 성공 0)
        persona = self._resolver.resolve(principal, persona_ref)
        if not isinstance(persona, PersonaSummary):
            raise TypeError(
                f"persona_ref 재조회 결과가 PersonaSummary 아님: {type(persona).__name__}"
            )
        return self._gateway.call(
            LlmFeature.PREFERENCE_SCORING,
            build_prompt_vars(pool, persona),
            pool,
            trace_id,
            now,
            # 호출측 단계 예산이 호출 타임아웃까지 관통 (TRIP-376) — 미지정이면
            # 게이트웨이 기본(2.5s)이라 실호출 바닥 ~3s에서 항상 잘린다.
            timeout_sec=timeout_sec,
        )
