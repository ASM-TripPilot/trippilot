"""EXPLANATION 출구 게이트 (정본 §2.2)."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    has_contact_like,
    _load_json_object,
    empty_result_error,
)
from trippilot.domain.common import PoiId, TraceId
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR
from trippilot.domain.llm import CandidatePool, LlmFeature, PoiExplanation
from trippilot.domain.observability import GateDropEvent


class ExplanationGate:
    """EXPLANATION 출구 게이트 (정본 §2.2) — poiId ⊆ 풀 교차 (INV-1).

    {"explanations": [{"poiId": str, "text": str}]} 강제. 중복 첫 등장 채택.

    **빈 결과 = 실패** (TRIP-260 #5): 설명 0건은 "설명 없음"과 같아 보이지만,
    호출측(orchestrator `_explain`·wiring `explanations`)은 그 둘을 다르게 보고한다
    — 폴백 사유를 실어야 사용자에게 "왜 설명이 없는지"가 남는다 (INV-4).
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
            items = _load_json_object(raw_text, "explanations")
            if not isinstance(items, list):
                raise ValueError("explanations가 배열이 아님")
            parsed: list[tuple[str, str]] = []
            for i, item in enumerate(items):
                if not isinstance(item, dict):
                    raise ValueError(f"explanations[{i}]가 객체가 아님")
                poi_id, text = item.get("poiId"), item.get("text")
                if not isinstance(poi_id, str) or not poi_id:
                    raise ValueError(f"explanations[{i}].poiId 비정상")
                if not isinstance(text, str) or not text.strip():
                    raise ValueError(f"explanations[{i}].text 비정상")
                parsed.append((poi_id, text))
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        seen: set[str] = set()
        survivors: list[PoiExplanation] = []
        dropped: list[PoiId] = []
        for pid_str, text in parsed:
            if pid_str in seen:
                continue
            seen.add(pid_str)
            pid = PoiId(pid_str)
            if pool.contains(pid):
                # 형제 게이트(alternative_selection)와 같은 처리 — 문장만 버리고 슬롯은 살린다.
                # ⑴ 시간·소요시간 표현: 이 text 는 백엔드 `visit_slot.placement_reason` 과
                #    리비전 스냅샷에 **영속된다**. 걸러 내지 않으면 INV-3 위반이 화면과 DB
                #    양쪽에 남는다. 정규식은 reflection_template 것을 **공유**한다 —
                #    두 벌을 두면 한쪽만 고쳐진다(alternative_selection 의 같은 주석 참조).
                # ⑵ 링크·연락처 꼴: 프롬프트에 실린 제3자 문자열(웹 수집 상호명 등)이 유도한
                #    유인 문구를 앱이 자기 목소리로 말하지 않게 한다.
                safe = "" if (_TIME_EXPR.search(text) or has_contact_like(text)) else text
                survivors.append(PoiExplanation(poi_id=pid, text=safe))
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
