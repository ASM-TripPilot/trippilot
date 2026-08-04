"""ExplanationWorker — 슬롯별 추천 이유 생성, 상위 티어·비동기 (정본 §2.2).

확정 일정 슬롯(순서·poiId·카테고리·상호명)과 취향 요약을 조립해 호출.
실패 시 폴백 TypedResult 그대로 — 해당 슬롯 reason=null 처리는 호출측 몫.
"""

from __future__ import annotations

from datetime import datetime

from trippilot.c1.context import ContextResolver
from trippilot.c1.gateway import GatewayFacade
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.context import Principal, ResourceRef
from trippilot.domain.llm import CandidatePool, LlmFeature, TypedResult
from trippilot.domain.persona import PersonaSummary


def build_explanation_vars(
    pool: CandidatePool, ordered_poi_ids: tuple[PoiId, ...], persona: PersonaSummary
) -> dict[str, str]:
    """방문 순서 보존 슬롯 문자열화 — 좌표 미포함 (G181). id ∉ pool은 호출측 버그."""
    by_id = {p.poi_id: p for p in pool.pois}
    lines = []
    for order, pid in enumerate(ordered_poi_ids, start=1):
        poi = by_id.get(pid)
        if poi is None:
            raise ValueError(f"슬롯 poi_id가 풀 밖: {pid} (호출측 버그)")
        lines.append(f"{order}. {poi.poi_id} | {poi.category.value} | {poi.name}")
    return {
        "taste_tags": ", ".join(t.value for t in persona.taste_tags) or "미설정",
        "companion": persona.companion.value,
        "slots": "\n".join(lines) or "(슬롯 없음)",
    }


class ExplanationWorker:
    def __init__(self, gateway: GatewayFacade, resolver: ContextResolver) -> None:
        self._gateway = gateway
        self._resolver = resolver

    def explain(
        self,
        pool: CandidatePool,
        ordered_poi_ids: tuple[PoiId, ...],
        persona_ref: ResourceRef,
        principal: Principal,
        trace_id: TraceId,
        now: datetime,
    ) -> TypedResult:
        persona = self._resolver.resolve(principal, persona_ref)
        if not isinstance(persona, PersonaSummary):
            raise TypeError(
                f"persona_ref 재조회 결과가 PersonaSummary 아님: {type(persona).__name__}"
            )
        return self._gateway.call(
            LlmFeature.EXPLANATION,
            build_explanation_vars(pool, ordered_poi_ids, persona),
            pool,
            trace_id,
            now,
        )
