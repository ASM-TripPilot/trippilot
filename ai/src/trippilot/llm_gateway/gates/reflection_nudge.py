"""REFLECTION_NUDGE 출구 게이트 (TRIP-347 — 회고 유도 푸시 문구 1문장).

산출물은 사용자에게 표시되는 **알림 문구 문자열**(str)이다. poi 선택이 없어
후보 풀과 무관하고, 스키마 + 표시 안전성만 강제한다 (paraphrase 게이트와 같은 형).

정리 3종 — 위반은 **드롭**(GateDropEvent) + 사유 `gate_dropped_all`:
  ① 빈 문자열·공백뿐 — 빈 알림은 보낼 수 없다
  ② 길이 상한 `_MAX_LENGTH` 초과 — 푸시 문구는 잘리면 의미가 깨진다
  ③ 시간 표현(`reflection_template._TIME_EXPR` — 수량+분·시간, 시각 표기, 소요 연어,
     duration) 포함 (INV-3). 설명·차선책·공유 카드 게이트와 같은 정규식을 쓴다.
  ④ 링크·연락처 꼴(`has_contact_like`) 포함 — 프롬프트 인젝션 산출물 방어
**빈 결과 = 실패** (TRIP-260 #5): 보낼 문구가 없으면 알림을 못 만든다. 게이트가
사유를 직접 실어 폴백 신호를 내고, 알림 자체는 호출측이 결정론 기본 문구
(workers.reflection_nudge.FALLBACK_NUDGE_MESSAGE)로 보장한다 (INV-4, 침묵 실패
금지).

③ 은 원래 부분 문자열(`분`·`시간`·`시각`)이었다. 장소명이 문구에 실리는 기능이라
"오뚜기분식" 같은 이름이 든 여행은 모델과 무관하게 **매번** 폴백으로 떨어졌다
(2026-10-14 실측: 12표본 중 1표본이 4개 조합 전부 드롭). 폴백은 안전하지만 그 여행의
넛지 기능은 꺼진 셈이라, 판정을 "시간이 화면에 뜨는가"에 맞춘 공용 정규식으로 옮겼다.

"error 있으면 value 비움" 불변식은 base.GateOutcome이 강제한다.
"""

from __future__ import annotations

from datetime import datetime

from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    has_contact_like,
    _load_json_object,
    empty_result_error,
)
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR
from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent

# 푸시 알림 1문장 상한 (TRIP-347 규칙 — 프롬프트의 "60자 이내"와 동일 값)
_MAX_LENGTH = 60


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
            or _TIME_EXPR.search(message) is not None  # ③ (INV-3)
            # ④ 이 문구는 **잠금화면에 앱 이름과 함께** 뜬다 — 앱이 보증하는 것처럼
            # 보이는 자리다. 프롬프트에 실리는 장소명은 웹 수집분이라(누구나 편집)
            # 링크를 심을 수 있고, 60자 상한도 `evil.io` 한 조각은 막지 못한다.
            or has_contact_like(message)
        )
        if dropped:
            drop_event = GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=(),  # 문구 드롭은 풀 ID가 아님 — 환각률 지표 순수성 (paraphrase 선례)
                total_count=1,
                dropped_count=1,
            )
            return GateOutcome(
                value=None,
                drop_event=drop_event,
                error=empty_result_error(None, drop_event),
            )
        return GateOutcome(value=message, drop_event=None, error=None)
