"""INTENT 출구 게이트 (정본 §2.4 + intent-matching-design §2 [3차]·§7).

3차 LLM 직접 분류의 산출물을 `IntentDraft`로 조립한다 — **라벨 closed-set 보장이
게이트의 존재 이유**다 (INV-1과 동형: §7 "parse_intent는 라우팅 테이블 라벨만 반환 가능").
`Intent` enum 밖 문자열은 조립 자체가 불가능하므로 명령 전체를 드롭한다.

분류 결과는 **1건**이라 항목 격리(place_extraction 선례)가 성립하지 않는다 —
슬롯 일부만 살리면 의도의 세부가 조용히 달라지므로 위반은 전량 드롭이다
(edit_translation 선례와 같은 판단).

검증 4종:
  ① intent ∈ Intent (closed-set — enum 밖 라벨은 드롭)
  ② slots는 평면 객체 (키 str · 값 스칼라) — 중첩으로 검사를 우회하지 못한다
  ③ confidence는 [0,1] 유한수 또는 부재. **범위 밖은 클램프하지 않고 드롭**한다:
     place_extraction은 항목 격리라 클램프가 안전하지만, 여기 confidence는 라우팅
     신뢰도로 그대로 쓰인다 — "87"을 1.0으로 접으면 과신을 만들어낸다 (침묵 수정 금지).
     부재는 정상 — 라우터가 설정 기본값으로 대체한다.
  ④ 분류 불가(`{"intent": null}`)는 성공으로 위장하지 않고 폴백 신호로 낸다 (INV-4).

`OUT_OF_SCOPE`는 enum 안이라 게이트를 통과한다 — 위임 가능 라벨인지의 판정은
라우터 몫(`intent_not_routable` 사유로 폴백)이라 여기서 선점하지 않는다.
"""

from __future__ import annotations

import json
import math
from datetime import datetime

from trippilot.llm_gateway.gates.base import GateOutcome
from trippilot.domain.common import TraceId
from trippilot.domain.intent import Intent, IntentDraft
from trippilot.domain.llm import CandidatePool, LlmFeature

_SCALAR = (str, int, float, bool)


class IntentGate:
    """INTENT 출구 게이트 — {"intent": str|null, "slots": {...}, "confidence": number?} 강제.

    후보 풀과 무관하다 (poi 선택이 아니라 라벨 분류 — reflection 게이트와 같은 스키마형).
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
        try:
            draft = self._parse(raw_text)
        except ValueError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")
        return GateOutcome(value=draft, drop_event=None, error=None)

    @staticmethod
    def _parse(raw_text: str) -> IntentDraft:
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON 아님: {e.msg}") from e
        if not isinstance(data, dict):
            raise ValueError("최상위가 객체가 아님")
        if "intent" not in data:
            raise ValueError('최상위가 {"intent": ...} 형태가 아님')
        label = data["intent"]
        if label is None:
            # 분류 불가를 성공으로 위장하지 않는다 — 폴백 신호 (INV-4)
            raise ValueError("not_classifiable: 의도 분류 불가")
        # ① closed-set (INV-1 동형) — enum 밖 라벨은 존재할 수 없는 의도다
        try:
            intent = Intent(label)
        except (ValueError, TypeError):
            raise ValueError(f"closed_set_violation: 라벨이 Intent 밖: {label!r}") from None
        return IntentDraft(
            intent=intent,
            slots=IntentGate._parse_slots(data.get("slots")),
            confidence=IntentGate._parse_confidence(data.get("confidence")),
        )

    @staticmethod
    def _parse_slots(raw: object) -> dict:
        """② 평면 강제 — 키는 str(JSON 객체라 자동), 값은 스칼라만."""
        if raw is None:
            return {}
        if not isinstance(raw, dict):
            raise ValueError("slots가 객체가 아님")
        for key, value in raw.items():
            if not isinstance(value, _SCALAR):
                raise ValueError(f"slots[{key!r}]가 평면 스칼라가 아님")
        return dict(raw)

    @staticmethod
    def _parse_confidence(raw: object) -> float | None:
        """③ [0,1] 유한수 또는 부재. bool ⊂ int라 명시 배제 (True가 1.0이 되는 경로 차단)."""
        if raw is None:
            return None
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise ValueError(f"confidence가 숫자가 아님: {raw!r}")
        value = float(raw)
        if not math.isfinite(value) or not 0.0 <= value <= 1.0:
            raise ValueError(f"confidence가 [0,1] 밖: {raw!r}")
        return value
