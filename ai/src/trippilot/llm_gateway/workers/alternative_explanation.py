"""AlternativeExplanationWorker — 슬롯별 차선책의 "대신 골라도 좋은 이유" 1문장 (TRIP-887).

EXPLANATION 워커와 형제이지만 feature·프롬프트가 다르다: 그쪽은 "확정된 일정의 각 장소"를
설명하고, 여기는 "이 자리 대신 넣을 수 있는 선택지"를 설명한다 — 같은 프롬프트에 섞으면
모델에게 확정되지 않은 장소를 확정된 것처럼 말하게 된다. 출구 게이트는 `ExplanationGate` 를
쓰되 feature 로 갈라 본다 — EXPLANATION 은 tags(해시태그), 이쪽은 text 문장 그대로(closed-set 교차, INV-1).

문장은 **선택지 POI 당 1개**다(취향 기준 근거라 어느 슬롯의 선택지든 같다). 같은 POI 가
여러 슬롯의 선택지면 첫 쌍의 확정 장소만 컨텍스트에 싣는다. 실패 시 폴백 TypedResult
그대로 — 템플릿 rationale(TRIP-871)을 유지하는 것은 호출측 몫.
"""

from __future__ import annotations

from datetime import datetime
from typing import Sequence

# 제3자 문자열(웹 수집 상호명·위키 발췌·네이버 스니펫)은 줄에 넣기 전에 한 줄로 누른다 —
# 줄바꿈이 남으면 우리 프롬프트 골격을 위조한다 (inline() docstring 에 실측).
from trippilot.llm_gateway.prompts import inline
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, TypedResult
from trippilot.domain.persona import PersonaSummary
from trippilot.llm_gateway.gateway import GatewayFacade

# (확정 슬롯 POI, 선택지 POI)
AlternativePair = tuple[PoiId, PoiId]


def build_alternative_explanation_vars(
    pool: CandidatePool,
    pairs: Sequence[AlternativePair],
    persona: PersonaSummary,
) -> dict[str, str]:
    """쌍 → 프롬프트 변수. 좌표 미포함(G181). 같은 선택지는 첫 쌍만.

    선택지 id ∉ pool 은 호출측 버그(풀 밖 장소를 설명하게 두면 INV-1 우회). 확정 슬롯 POI 는
    컨텍스트일 뿐이라 풀 밖(미등록·고정 블록 유래)이면 이름 대신 "(미등록 장소)" — 지어내지 않는다.
    """
    by_id = {p.poi_id: p for p in pool.pois}
    lines: list[str] = []
    seen: set[PoiId] = set()
    for slot_id, alt_id in pairs:
        if alt_id in seen:
            continue
        alt = by_id.get(alt_id)
        if alt is None:
            raise ValueError(f"선택지 poi_id가 풀 밖: {alt_id} (호출측 버그)")
        slot = by_id.get(slot_id)
        seen.add(alt_id)
        lines.append(
            f"{len(lines) + 1}. {alt.poi_id} | {alt.category.value} | {inline(alt.name)}"
            f" | 대신: {inline(slot.name) if slot is not None else '(미등록 장소)'}"
        )
    return {
        "taste_tags": ", ".join(t.value for t in persona.taste_tags) or "미설정",
        "companion": persona.companion.value,
        "alternatives": "\n".join(lines) or "(선택지 없음)",
    }


class AlternativeExplanationWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def explain(
        self,
        pool: CandidatePool,
        pairs: Sequence[AlternativePair],
        persona: PersonaSummary,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult:
        if not isinstance(persona, PersonaSummary):
            raise TypeError(f"persona가 PersonaSummary 아님: {type(persona).__name__}")
        return self._gateway.call(
            LlmFeature.ALTERNATIVE_EXPLANATION,
            build_alternative_explanation_vars(pool, pairs, persona),
            pool,
            trace_id,
            now,
            timeout_sec=timeout_sec,  # 호출측 잔여 예산 관통 (TRIP-381 과 동형)
        )
