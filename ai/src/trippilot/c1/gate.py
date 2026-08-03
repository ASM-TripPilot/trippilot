"""출구 검증 seam — 파이프라인 5·6단(스키마 파서 + ClosedSetGate)의 계약.

ClosedSetGate 본체(raw JSON 파싱·풀 교차·RawScore)는 U4-02에서 구현.
게이트웨이는 이 Protocol만 알고, 검증 전 데이터가 도메인 타입이 되는 것을
GateOutcome 경계로 차단한다 (FD domain-entities §4).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, ScoredPoi
from trippilot.domain.observability import GateDropEvent


@dataclass(frozen=True, slots=True)
class GateOutcome:
    """파서+게이트의 단일 결과. error가 있으면 scored는 비어 있다.

    - scored 비어 있음 + error 없음 = 전량 드롭 (GATE-P2 → 폴백)
    - drop_event는 드롭이 1건이라도 있을 때만 (부분 생존 포함)
    """

    scored: tuple[ScoredPoi, ...]
    drop_event: GateDropEvent | None
    error: str | None

    def __post_init__(self) -> None:
        if self.error is not None and self.scored:
            raise ValueError("error가 있으면 scored는 비어야 함 (검증 실패 = 결과 없음)")


class ExitGate(Protocol):
    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome: ...
