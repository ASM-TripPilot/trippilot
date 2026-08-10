"""PREFERENCE_SCORING 출구 게이트 — 스키마 파서 + closed-set 교차 (정본 §2.1)."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from trippilot.llm_gateway.gates.base import GateOutcome
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, ScoredPoi
from trippilot.domain.observability import GateDropEvent


@dataclass(frozen=True, slots=True)
class RawScore:
    """LLM raw JSON의 중간 표현 — c1 내부 타입, 도메인 아님 (FD domain-entities §4).

    게이트 통과 후에만 ScoredPoi로 승격. reason은 표시용 원문 보존
    (현 도메인 ScoredPoi에는 없음 — 승격 시 버려진다).
    """

    poi_id_str: str
    score: float
    reason: str


def _parse_scores(raw_text: str) -> tuple[RawScore, ...]:
    """OutputSchema(ai-prompt-design §2.1) 강제 파서 — 위반은 ValueError.

    {"scores": [{"poiId": str, "score": number, "reason": str}]}
    poiId(비어있지 않은 str)·score(유한 number)는 필수, reason 누락은 ""로 허용.
    score의 0.0~1.0 클램프는 승격 시(§3) — 파서는 형태만 본다.
    """
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 아님: {e.msg}") from e
    if not isinstance(data, dict) or not isinstance(data.get("scores"), list):
        raise ValueError('최상위가 {"scores": [...]} 형태가 아님')
    raws: list[RawScore] = []
    for i, item in enumerate(data["scores"]):
        if not isinstance(item, dict):
            raise ValueError(f"scores[{i}]가 객체가 아님")
        poi_id = item.get("poiId")
        score = item.get("score")
        if not isinstance(poi_id, str) or not poi_id:
            raise ValueError(f"scores[{i}].poiId가 비어있지 않은 문자열이 아님")
        if isinstance(score, bool) or not isinstance(score, (int, float)):
            raise ValueError(f"scores[{i}].score가 숫자가 아님")
        if not math.isfinite(score):
            raise ValueError(f"scores[{i}].score가 유한하지 않음")
        reason = item.get("reason", "")
        if not isinstance(reason, str):
            raise ValueError(f"scores[{i}].reason이 문자열이 아님")
        raws.append(RawScore(poi_id_str=poi_id, score=float(score), reason=reason))
    return tuple(raws)


class ClosedSetGate:
    """closed-set 출구 게이트 — 4겹 제한 장치의 4겹 (INV-1, BR-U4-01).

    파서 통과분을 풀과 교차: 풀 밖 poi_id 드롭 + GateDropEvent 재료화.
    중복 poiId는 첫 등장만 채택 (결정론). 드롭/생존 판정은 pool.contains O(1).
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
            # 풀 없이 게이트를 통과시킬 수 없다 — 조용한 통과 대신 폴백 신호 (INV-1)
            return GateOutcome(value=(), drop_event=None, error="gate_error: 후보 풀 없음")
        try:
            raws = _parse_scores(raw_text)
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        seen: set[str] = set()
        survivors: list[ScoredPoi] = []
        dropped: list[PoiId] = []
        for rs in raws:
            if rs.poi_id_str in seen:
                continue  # 중복 — 첫 등장 채택 (드롭 계수에 미포함)
            seen.add(rs.poi_id_str)
            poi_id = PoiId(rs.poi_id_str)
            if pool.contains(poi_id):
                survivors.append(
                    ScoredPoi(
                        poi_id=poi_id,
                        score=min(1.0, max(0.0, rs.score)),  # 0.0~1.0 클램프 (§3)
                        is_llm_score=True,
                    )
                )
            else:
                dropped.append(poi_id)

        drop_event = (
            GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=tuple(dropped),
                total_count=len(seen),
                dropped_count=len(dropped),
            )
            if dropped
            else None
        )
        return GateOutcome(value=tuple(survivors), drop_event=drop_event, error=None)
