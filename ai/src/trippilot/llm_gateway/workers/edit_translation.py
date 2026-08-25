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

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime

from trippilot.llm_gateway.gates.edit_translation import EditTranslationContext
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.edit import EditOp
from trippilot.domain.llm import CandidatePool, LlmFeature, TypedResult
from trippilot.domain.poi import Poi


@dataclass(frozen=True, slots=True)
class EditTranslationInput:
    """번역 입력 — 발화는 뉘앙스 참고 전용(재해석 금지, DL-3)."""

    utterance: str
    target_date: str  # 서버 확정 표시 문자열 (예: "2026-08-10")
    current_slots: tuple[PoiId, ...]  # 현재 일정 순서 (poiId만)
    # 현재 슬롯의 표시 정보 — 호출측이 이미 들고 있는 등록 POI(백엔드 find_by_ids).
    # 풀에서 찾지 않는 이유는 TRIP-527: 풀은 요청마다 잘리는 조각이라 현재 슬롯이
    # 풀 밖일 수 있다. 없는 슬롯은 이름을 지어내지 않고 "(정보 없음)"으로 남는다.
    slot_pois: Mapping[PoiId, Poi] = field(default_factory=dict)


def build_edit_translation_vars(
    pool: CandidatePool, inp: EditTranslationInput
) -> dict[str, str]:
    """값 전부 str·결정론(후보는 poi_id 정렬)·좌표 미포함 (G181, PROMPT-P1 계열).

    현재 슬롯 렌더는 풀이 아니라 **호출측이 넘긴 슬롯 정보**를 쓴다 (TRIP-527) —
    풀은 요청마다 잘리는 조각이라 원 일정의 슬롯이 풀 밖인 것은 정상이고, 그걸
    호출측 버그로 보고 raise 하면 편집 경계가 422로 죽는다(백엔드는 4xx를 최소본
    폴백 신호로 쓴다). 이름·카테고리를 모르면 지어내지 않고 "(정보 없음)".
    """
    by_id = {p.poi_id: p for p in pool.pois}
    by_id.update(inp.slot_pois)  # 호출측 정보 우선 — 슬롯의 등록 원본
    slot_lines = []
    for order, pid in enumerate(inp.current_slots, start=1):
        poi = by_id.get(pid)
        slot_lines.append(
            f"{order}. {pid} | {poi.category.value} | {poi.name}"
            if poi is not None
            else f"{order}. {pid} | (정보 없음)"
        )
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
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult:
        # 호출측 예산이 게이트웨이 타임아웃까지 **관통** (TRIP-381 — 점수·설명과 동형).
        # 미관통이면 기본 2.5s가 실호출(바닥 ~3s)을 항상 잘라 자연어 편집이 전멸한다
        # (TRIP-431 실측: 직접 호출 성공 · 경계 호출 TRANSLATION_FAILED).
        return self._gateway.call(
            LlmFeature.EDIT_TRANSLATION,
            build_edit_translation_vars(pool, inp),
            # pool 자리 = 게이트 대조 집합 2종 (TRIP-527): 새로 넣는 POI는 풀(INV-1),
            # 기존 슬롯 지목은 현재 슬롯. 프롬프트에 렌더한 목록 그대로 넘기므로
            # "모델이 본 슬롯"과 "게이트가 허용하는 슬롯"이 어긋날 수 없다.
            EditTranslationContext(
                pool=pool, current_slots=frozenset(inp.current_slots)),
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
