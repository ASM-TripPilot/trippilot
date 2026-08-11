"""REFLECTION_NUDGE 출구 게이트 (TRIP-347 — 회고 유도 푸시 문구 1문장).

산출물은 사용자에게 표시되는 **알림 문구 문자열**(str)이다. poi 선택이 없어
후보 풀과 무관하고, 스키마 + 표시 안전성만 강제한다 (paraphrase 게이트와 같은 형).

정리 3종 — 위반은 error가 아니라 **드롭**(GateDropEvent):
  ① 빈 문자열·공백뿐 — 빈 알림은 보낼 수 없다
  ② 길이 상한 `_MAX_LENGTH` 초과 — 푸시 문구는 잘리면 의미가 깨진다
  ③ 금지 토큰(`_FORBIDDEN_TOKENS` — 분·시간·시각·duration류) 포함 (INV-3)
드롭이면 value 비움 + error=None — 게이트웨이가 폴백으로 전환하고, 알림 자체는
호출측이 결정론 기본 문구(workers.reflection_nudge.FALLBACK_NUDGE_MESSAGE)로
보장한다 (INV-4, 침묵 실패 금지). "분" 같은 넓은 토큰이 정상 문구를 과잉 드롭해도
폴백 문구로 수렴할 뿐이라 fail-safe다.

"error 있으면 value 비움" 불변식은 base.GateOutcome이 강제한다.
"""

from __future__ import annotations

from datetime import datetime

from trippilot.llm_gateway.gates.base import GateOutcome, _load_json_object
from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent

# 푸시 알림 1문장 상한 (TRIP-347 규칙 — 프롬프트의 "60자 이내"와 동일 값)
_MAX_LENGTH = 60

# 소요시간·시각 계열 표시 금지 (INV-3). 부분 문자열 매칭 — 과잉 드롭은 폴백으로 안전.
_FORBIDDEN_TOKENS = ("분", "시간", "시각", "duration")


class ReflectionNudgeGate:
    """REFLECTION_NUDGE 출구 게이트 — {"message": str} → str."""

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
            message = _load_json_object(raw_text, "message")
            if not isinstance(message, str):
                raise ValueError("message가 문자열이 아님")
        except ValueError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")

        message = message.strip()
        dropped = (
            not message  # ①
            or len(message) > _MAX_LENGTH  # ②
            or any(t in message.lower() for t in _FORBIDDEN_TOKENS)  # ③ (INV-3)
        )
        if dropped:
            return GateOutcome(
                value=None,
                drop_event=GateDropEvent(
                    trace_id=trace_id,
                    occurred_at=now,
                    component="c1.gate",
                    feature=feature.value,
                    dropped_ids=(),  # 문구 드롭은 풀 ID가 아님 — 환각률 지표 순수성 (paraphrase 선례)
                    total_count=1,
                    dropped_count=1,
                ),
                error=None,
            )
        return GateOutcome(value=message, drop_event=None, error=None)
