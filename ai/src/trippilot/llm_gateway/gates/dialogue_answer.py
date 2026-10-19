"""DIALOGUE_ANSWER 출구 게이트 (assistant-orchestrator FD domain-entities §2.3 — 도우미 답변 문장).

산출물은 사용자에게 **그대로 보이는 답변 문장**(`DialogueAnswerDraft(text, footnote)`)이다. 시각·거리·
장소는 코드가 모은 Facts 에서 오고 LLM 은 문장만 쓰므로 후보 풀과 무관하고, 스키마 + 표시 안전성만
강제한다 (reflection_nudge 게이트와 같은 형, 키가 둘인 점은 reminder_copy 선례).

정리 — 위반은 **드롭**(GateDropEvent) + 사유 `gate_dropped_all`:
  ① text 빈 문자열·공백뿐 — 보일 문장이 없다
  ② text 길이 > `_MAX_LENGTH`(400) 또는 줄 수 > `_MAX_LINES`(6) — 도우미 시트 한 말풍선의 상한
     (와이어 스키마 600·DB 2000 보다 작게 두어 뒤 단계가 자르지 않게 한다)
  ③ 시간 표현(`reflection_template._TIME_EXPR` — 수량+분·시간, 시각 표기, 소요 연어, duration) 포함 (INV-3·INV-2).
     facts 의 시각은 "HH:MM" 표기라 그대로 인용하면 걸리지 않고, 모델이 "오후 3시"처럼 **새로 만든** 시각만 걸린다
  ④ 링크·연락처 꼴(`has_contact_like`) 포함 — 프롬프트 인젝션 산출물 방어. 발화·최근 대화·기억(우리 자신의
     앞선 LLM 출력)이 프롬프트에 실리는 기능이라 그 자리가 실재한다
  ⑤ 지시 주입·프롬프트 골격 꼴(`has_injection_like`) — "[확인된 사실]" 같은 칸 머리·"시스템 프롬프트"가 답에 섞이면
     프롬프트가 새어 나온 것이다. 오케스트레이터는 같은 술어로 그런 발화를 LLM 앞에서 범위 밖으로 돌린다
  footnote 는 None 허용, 있으면 ≤ `_MAX_FOOTNOTE`(120) + ③④ 같은 검사 (FD DE §2.3 표).
  text·footnote 는 한 덩이다 — **어느 쪽이 어겨도 통째로 드롭**한다. 통과값은 그래서 항상 `DialogueAnswer`
  post-init(같은 검사)을 그대로 통과한다.

**빈 결과 = 실패** (TRIP-260 #5): 보일 문장이 없으면 답을 못 만든다. 게이트가 사유를 직접 실어 폴백 신호를
내고, 문장 자체는 호출측이 결정론 템플릿(workers.dialogue_answer.fallback_answer_text)으로 보장한다 (INV-4).

"error 있으면 value 비움" 불변식은 base.GateOutcome 이 강제한다.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    empty_result_error,
    has_contact_like,
    has_injection_like,
    strip_code_fence,
)
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR

# 프롬프트의 "400자 이내, 6줄 이내"·"120자 이내" 와 동일 값 (테스트가 고정)
_MAX_LENGTH = 400
_MAX_LINES = 6
_MAX_FOOTNOTE = 120


@dataclass(frozen=True, slots=True)
class DialogueAnswerDraft:
    """게이트 통과값 — LLM 이 만든 문장 두 칸. 나머지(kind·payload·next_actions)는 Facts 가 정한다."""

    text: str
    footnote: str | None = None


# ③′ 영문 소요시간 단위(INV-3) — `_TIME_EXPR` 는 한글 단위만 본다("차로 20min 이면 가요"가 통과했다, 2026-10-18 리뷰 재현).
# reflection·nudge 게이트가 같은 `_TIME_EXPR` 를 쓰므로 그쪽을 넓히지 않고 여기에만 둔다.
_DURATION_EN = re.compile(r"\d+\s*(?:min(?:ute)?s?|hrs?|hours?|h)\b|\b(?:half an|an|one) hour\b", re.IGNORECASE)
# 시계 시각(INV-2) — 문장 속 시각은 Facts 에 실린 값이어야 한다. `_TIME_EXPR` 는 `HH:MM` 을 일부러 통과시키므로("10:00" 복사),
# 오케스트레이터가 `clock_times` 로 꺼내 Facts 와 대조한다. 숫자 꼴은 정규화해 대조하고, 대조할 수 없는 한글 시각
# ("오후 세 시"·"정오"·"자정"·"세 시 반")은 있는 것만으로 템플릿 사유다.
_CLOCK = re.compile(r"(?<!\d)([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)(?!\d)(\s*[AaPp]\.?\s?[Mm]\.?)?")
_KO_HOUR = r"(?:열한|열두|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)"
_UNVERIFIABLE_CLOCK = re.compile(
    rf"정오|자정|(?:오전|오후|새벽|아침|저녁|밤|낮)\s*{_KO_HOUR}\s*시|{_KO_HOUR}\s*시\s*(?:반|정각|쯤|에|부터|까지|경)"
)


def clock_spans(text: str) -> list[tuple[int, int, str]]:
    """문장 속 숫자 꼴 시계 시각의 (시작, 끝, 정규화 `HH:MM`) — am/pm 은 24시로 접는다."""
    spans = []
    for m in _CLOCK.finditer(text):
        hour, minute, meridiem = m.group(1), m.group(2), (m.group(3) or "").strip()
        h = int(hour) % 12 + (12 if meridiem.lower().startswith("p") else 0) if meridiem else int(hour)
        spans.append((m.start(), m.end(), f"{h:02d}:{minute}"))
    return spans


def clock_times(text: str) -> tuple[frozenset[str], bool]:
    """문장 속 시계 시각 → (정규화한 `HH:MM` 집합, 대조할 수 없는 한글 시각이 있는가)."""
    return frozenset(t for _, _, t in clock_spans(text)), _UNVERIFIABLE_CLOCK.search(text) is not None


def _violates(text: str, max_length: int) -> bool:
    return (
        not text  # ①
        or len(text) > max_length  # ②
        or len(text.splitlines()) > _MAX_LINES  # ②
        or _TIME_EXPR.search(text) is not None  # ③ (INV-3)
        or _DURATION_EN.search(text) is not None  # ③′ (INV-3 영문 단위)
        or has_contact_like(text)  # ④
        or has_injection_like(text)  # ⑤
    )


class DialogueAnswerGate:
    """DIALOGUE_ANSWER 출구 게이트 — {"text": str, "footnote": str|null} → DialogueAnswerDraft."""

    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        try:
            data = json.loads(strip_code_fence(raw_text))
            if not isinstance(data, dict):
                raise ValueError("최상위가 객체가 아님")
            text = data["text"]
            footnote = data.get("footnote")
            if not isinstance(text, str):
                raise ValueError("text 가 문자열이 아님")
            if footnote is not None and not isinstance(footnote, str):
                raise ValueError("footnote 가 문자열·null 이 아님")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")

        text = text.strip()
        footnote = (footnote or "").strip() or None
        dropped = _violates(text, _MAX_LENGTH) or (
            footnote is not None and _violates(footnote, _MAX_FOOTNOTE)
        )
        if dropped:
            drop_event = GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=(),  # 문구 드롭은 풀 ID가 아님 — 환각률 지표 순수성 (nudge·paraphrase 선례)
                total_count=1,
                dropped_count=1,
            )
            return GateOutcome(
                value=None,
                drop_event=drop_event,
                error=empty_result_error(None, drop_event),
            )
        return GateOutcome(
            value=DialogueAnswerDraft(text=text, footnote=footnote), drop_event=None, error=None
        )
