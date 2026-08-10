"""EditTranslationWorker — 편집 발화 → EditCommand 초안 번역 (경량 티어).

EditAgent 전속 도구 `llm.translate_edit` (BR-AF-08). **이미 EDIT_SCHEDULE로 확정된**
의도의 세부만 번역한다 — 라우팅 재해석이 아니다 (DL-3·BR-AF-02).
context_refs 재조회(D31)는 봉투 프로토콜상 EditAgent가 이미 수행하므로, 워커는
확정된 입력(발화·날짜·현재 슬롯·후보 풀)만 받는다 — 여기서 개인 데이터를 다시 끌어오지 않는다.

실패·게이트 드롭이면 폴백 TypedResult를 그대로 반환 (BR-U4-09) — 수동 편집 안내 등
후속 처리는 호출측(EditAgent) 몫이고, 침묵 실패는 없다 (INV-4).
실제 반영·솔버 검증은 이 티켓 범위 밖 (INV-2 — 시각·순서는 솔버가 확정).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.edit import EditOp
from trippilot.domain.llm import CandidatePool, LlmFeature, TypedResult


@dataclass(frozen=True, slots=True)
class EditTranslationInput:
    """번역 입력 — 발화는 뉘앙스 참고 전용(재해석 금지, DL-3)."""

    utterance: str
    target_date: str  # 서버 확정 표시 문자열 (예: "2026-08-10")
    current_slots: tuple[PoiId, ...]  # 현재 일정 순서 (poiId만)


def build_edit_translation_vars(
    pool: CandidatePool, inp: EditTranslationInput
) -> dict[str, str]:
    """값 전부 str·결정론(후보는 poi_id 정렬)·좌표 미포함 (G181, PROMPT-P1 계열).

    현재 슬롯 id가 풀 밖이면 호출측 버그다 — 게이트가 affectedSlots를 풀로 교차하므로
    풀 밖 슬롯에 대한 편집은 어차피 전량 드롭된다 (explanation 워커와 동일한 전제).
    """
    by_id = {p.poi_id: p for p in pool.pois}
    slot_lines = []
    for order, pid in enumerate(inp.current_slots, start=1):
        poi = by_id.get(pid)
        if poi is None:
            raise ValueError(f"현재 슬롯 poi_id가 풀 밖: {pid} (호출측 버그)")
        slot_lines.append(f"{order}. {poi.poi_id} | {poi.category.value} | {poi.name}")
    in_use = set(inp.current_slots)
    candidate_lines = [
        f"- {p.poi_id} | {p.category.value} | {p.name}"
        for p in sorted(pool.pois, key=lambda p: str(p.poi_id))
        if p.poi_id not in in_use
    ]
    return {
        "utterance": inp.utterance.strip() or "(발화 없음)",
        "target_date": inp.target_date or "미지정",
        # 편집 op closed-set을 서버가 주입 (정본 §2.4) — enum 순서라 결정론
        "edit_ops": ", ".join(op.value for op in EditOp),
        "slots": "\n".join(slot_lines) or "(슬롯 없음)",
        "candidates": "\n".join(candidate_lines) or "(후보 없음)",
    }


class EditTranslationWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def translate(
        self,
        pool: CandidatePool,
        inp: EditTranslationInput,
        trace_id: TraceId,
        now: datetime,
    ) -> TypedResult:
        return self._gateway.call(
            LlmFeature.EDIT_TRANSLATION,
            build_edit_translation_vars(pool, inp),
            pool,  # affectedSlots 풀 교차 대상 (INV-1)
            trace_id,
            now,
        )
