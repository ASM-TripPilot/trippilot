"""DIALOGUE_MEMORY 출구 게이트 — 세션 기억 요약 줄 묶음 (assistant-orchestrator FD DE §2.6·§2.10, BR-AO-09).

산출물은 `tuple[str, ...]` 다. 다음 턴의 분류·답변 프롬프트에 `$memory` 로 되돌아가고, 내보내기 경계
(`GET /ai/v1/dialogue/memory`)로 사용자에게도 보인다. poi 선택이 없어 후보 풀과 무관하고, 스키마 +
줄 단위 안전성만 강제한다 (paraphrase 게이트와 같은 형).

항목 격리(paraphrase·place_extraction 선례) — 한 줄이 나쁘다고 요약 전체를 버리지 않는다. 남은 줄로도
기억은 성립한다.

정리 — 위반 줄은 **그 줄만** 드롭(GateDropEvent 로 계측):
  ① 문자열 아님·공백뿐
  ② 길이 > `_MAX_LINE_CHARS` — 자르지 않는다. 잘린 사실은 다른 사실이 된다
  ③ 시간 표현(`reflection_template._TIME_EXPR`) — 소요시간은 INV-3, 시각은 스냅샷만 말한다(INV-2).
     다음 턴 프롬프트에 되돌아가는 값이라 여기서 끊어야 전파가 멎는다
  ④ 링크·연락처 꼴(`has_contact_like`) — 최근 턴에 실린 제3자 문자열이 요약으로 굳는 것을 막는다
  ⑤ 중복(첫 등장 유지)
  ⑥ 개수 상한 `_MAX_LINES` — 초과분도 드롭으로 계측
**빈 결과 = 실패** (TRIP-260 #5): 남은 줄이 없으면 오케스트레이터가 결정론 압축(compress_fallback)으로
전진한다(INV-4). 성공·0건으로 두면 "기억 없음"이 조용히 저장된다.

"error 있으면 value 비움" 불변식은 base.GateOutcome 이 강제한다.
"""

from __future__ import annotations

from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    _load_json_object,
    empty_result_error,
    has_contact_like,
)
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR

# 요약 상한 (FD DE §2.6 — ≤20줄 · 줄 ≤120자). 프롬프트의 "최대 20줄"·"120자 이내"와 같은 값(테스트가 고정).
# ponytail: 오케스트레이터 config(summary_max_lines·summary_line_chars)와 같은 값을 따로 둔다 —
# 게이트는 raw_text 만 받아 설정을 모른다(paraphrase 선례). 갈라지면 공유 상수로 승격.
_MAX_LINES = 20
_MAX_LINE_CHARS = 120


class DialogueMemoryGate:
    """DIALOGUE_MEMORY 출구 게이트 — {"lines": [str]} → tuple[str, ...]."""

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
            items = _load_json_object(raw_text, "lines")
            if not isinstance(items, list):
                raise ValueError("lines가 배열이 아님")
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        survivors: list[str] = []
        dropped_count = 0
        for item in items:
            line = item.strip() if isinstance(item, str) else ""
            if (
                not line  # ①
                or len(line) > _MAX_LINE_CHARS  # ②
                or _TIME_EXPR.search(line) is not None  # ③ (INV-3·INV-2)
                or has_contact_like(line)  # ④
                or line in survivors  # ⑤
                or len(survivors) >= _MAX_LINES  # ⑥
            ):
                dropped_count += 1
                continue
            survivors.append(line)

        drop_event = (
            GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=(),  # 줄 드롭은 풀 ID가 아님 — 환각률 지표 순수성 (paraphrase 선례)
                total_count=len(items),
                dropped_count=dropped_count,
            )
            if dropped_count
            else None
        )
        return GateOutcome(
            value=tuple(survivors),
            drop_event=drop_event,
            error=empty_result_error(survivors, drop_event),
        )
