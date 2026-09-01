"""ALTERNATIVE_SELECTION 출구 게이트 (planb-rag-design §6 — closed-set 안 선택 + 이유)."""

from __future__ import annotations

from datetime import datetime

from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    _load_json_object,
    empty_result_error,
)
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import AlternativePick, CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent


class AlternativeSelectionGate:
    """ALTERNATIVE_SELECTION 출구 게이트 — poiId ⊆ 풀 교차 (INV-1, explanation 선례).

    {"selections": [{"poiId": str, "reason": str}]} 강제. 중복 첫 등장 채택,
    풀 밖 항목만 드롭(항목 격리)하고 생존분은 LLM이 낸 선호 순서 그대로 통과 —
    이 순서는 제안일 뿐, 배치·시각 확정은 솔버 몫이다 (INV-2).
    스키마에 시각·소요시간 자리가 아예 없다 (INV-3).
    **빈 결과 = 실패** (TRIP-260 #5): "적합 후보 없음"은 지어내기 금지의 결과지
    사용자에게 줄 대안이 아니다 — 호출측(planb rag `_select`)에 규칙 랭킹이라는
    온전한 대체 경로가 있으므로 폴백 신호를 낸다. 파싱 실패가 아니라 무결과라는
    구분은 사유 라벨(llm_empty_result)이 유지한다.
    """

    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if pool is None:
            return GateOutcome(value=(), drop_event=None, error="gate_error: 후보 풀 없음")
        try:
            items = _load_json_object(raw_text, "selections")
            if not isinstance(items, list):
                raise ValueError("selections가 배열이 아님")
            parsed: list[tuple[str, str]] = []
            for i, item in enumerate(items):
                if not isinstance(item, dict):
                    raise ValueError(f"selections[{i}]가 객체가 아님")
                poi_id, reason = item.get("poiId"), item.get("reason")
                if not isinstance(poi_id, str) or not poi_id:
                    raise ValueError(f"selections[{i}].poiId 비정상")
                if not isinstance(reason, str) or not reason.strip():
                    raise ValueError(f"selections[{i}].reason 비정상")
                parsed.append((poi_id, reason))
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        seen: set[str] = set()
        survivors: list[AlternativePick] = []
        dropped: list[PoiId] = []
        for pid_str, reason in parsed:
            if pid_str in seen:
                continue
            seen.add(pid_str)
            pid = PoiId(pid_str)
            if pool.contains(pid):
                survivors.append(AlternativePick(poi_id=pid, reason=reason))
            else:
                dropped.append(pid)
        drop_event = (
            GateDropEvent(
                trace_id=trace_id, occurred_at=now, component="c1.gate",
                feature=feature.value, dropped_ids=tuple(dropped),
                total_count=len(seen), dropped_count=len(dropped),
            )
            if dropped else None
        )
        return GateOutcome(
            value=tuple(survivors),
            drop_event=drop_event,
            error=empty_result_error(survivors, drop_event),
        )
