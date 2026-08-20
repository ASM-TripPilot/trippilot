"""게이트 공통 계약 — GateOutcome·ExitGate·공통 파서 (U4 FD §1).

feature별 게이트는 gates/<feature>.py 신규 파일로 추가한다 ("추가 = 새 파일" —
공유 파일 append로 인한 병렬 쓰기 충돌 방지, TRIP-258). __init__은 문서만.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent


@dataclass(frozen=True, slots=True)
class GateOutcome:
    """파서+게이트의 단일 결과. error가 있으면 value는 비어 있다.

    value의 실체는 feature별 게이트가 정의 (scoring=tuple[ScoredPoi,...],
    explanation=tuple[PoiExplanation,...], reflection=ReflectionDraft, …).
    - value 거짓값 + error 없음 = 전량 드롭/무결과 (게이트웨이가 폴백 전환)
    - drop_event는 드롭이 1건이라도 있을 때만 (부분 생존 포함)
    """

    value: object
    drop_event: GateDropEvent | None
    error: str | None

    def __post_init__(self) -> None:
        if self.error is not None and self.value:
            raise ValueError("error가 있으면 value는 비어야 함 (검증 실패 = 결과 없음)")


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


def _strip_code_fence(raw_text: str) -> str:
    """마크다운 코드 펜스(```json … ```) 제거 — GPT-5.6 실측 (2026-08-20 첫
    행사 수집 배치에서 parse_error 재현). json.loads가 뒤에서 여전히 전체를
    검증하므로 관대화가 아니라 포장 제거다."""
    text = raw_text.strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines[1:])  # 첫 줄(``` 또는 ```json) 제거


def _load_json_object(raw_text: str, root_key: str) -> object:
    """공통: JSON 로드 + 최상위 {root_key: ...} 강제. 위반은 ValueError."""
    try:
        data = json.loads(_strip_code_fence(raw_text))
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 아님: {e.msg}") from e
    if not isinstance(data, dict) or root_key not in data:
        raise ValueError(f'최상위가 {{"{root_key}": ...}} 형태가 아님')
    return data[root_key]
