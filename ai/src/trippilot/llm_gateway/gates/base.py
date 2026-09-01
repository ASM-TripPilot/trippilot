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
    explanation=tuple[PoiExplanation,...], reflection_template=TemplateCandidate, …).
    - value 거짓값 + error 없음 = **성공·0건**. 빈 결과가 정상인 feature(추출 계열)의
      모양이다 — 게이트웨이는 error 유무만 보므로 폴백으로 뒤집지 않는다 (TRIP-260 #5).
    - 빈 결과가 실패인 feature는 게이트가 **스스로** error를 설정한다
      (`empty_result_error`) — "empty가 실패인가"는 feature 의미론이라 게이트 소유다.
    - drop_event는 드롭이 1건이라도 있을 때만 (부분 생존 포함)
    """

    value: object
    drop_event: GateDropEvent | None
    error: str | None

    def __post_init__(self) -> None:
        if self.error is not None and self.value:
            raise ValueError("error가 있으면 value는 비어야 함 (검증 실패 = 결과 없음)")


def empty_result_error(value: object, drop_event: GateDropEvent | None) -> str | None:
    """빈 결과가 **실패**인 게이트의 공통 사유 라벨 (TRIP-260 #5).

    이 함수를 부르는 게이트 = "0건은 쓸 수 없다"는 feature (scoring·explanation·
    alternative_selection·paraphrase·reflection_nudge). 추출 계열(place·event)은
    부르지 않는다 — "그 기간 그 지역에 행사가 없음"이 정상 결과다.

    라벨 2종 구분은 보존한다 (2026-08-25 사고): `gate_dropped_all`은 게이트 규칙·LLM
    환각을 보라는 신호고, `llm_empty_result`는 프롬프트·입력을 보라는 신호다. 한때
    같은 라벨이라 행사 수집에서 대전이 6회 연속 0건일 때 게이트를 의심하느라 3단계
    추론이 필요했고 실제 원인은 LLM 무결과였다. 판별 근거는 GateDropEvent 유무 —
    게이트는 dropped_count가 0이면 이벤트를 만들지 않으므로, 그 부재가 곧 "게이트는
    아무것도 안 버렸다"는 증거다.
    """
    if value:
        return None
    return "gate_dropped_all" if drop_event is not None else "llm_empty_result"


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
