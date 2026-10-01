"""INTENT 출구 게이트 (정본 §2.4 + intent-matching-design §2 [3차]·§7).

3차 LLM 직접 분류의 산출물을 `IntentDraft`로 조립한다 — **라벨 closed-set 보장이
게이트의 존재 이유**다 (INV-1과 동형: §7 "parse_intent는 라우팅 테이블 라벨만 반환 가능").
`Intent` enum 밖 문자열은 조립 자체가 불가능하므로 명령 전체를 드롭한다.

분류 결과는 **1건**이라 항목 격리(place_extraction 선례)가 성립하지 않는다 —
슬롯 일부만 살리면 의도의 세부가 조용히 달라지므로 위반은 전량 드롭이다
(edit_translation 선례와 같은 판단).

검증 5종:
  ① intent ∈ Intent (closed-set — enum 밖 라벨은 드롭)
  ② slots 값의 모양은 **표가 정한다** — 기본은 스칼라, `multiple=True` 인 인자는 스칼라 목록.
     중첩 객체·목록 속 목록으로 검사를 우회하지 못한다 (형식이 깨진 것이라 전량 드롭)
  ⑥ ENUM 인자의 **값**은 그 어휘 안 — 밖이면 그 칸만 버린다. 프롬프트가 enum 을 광고하므로
     검사도 같은 표를 본다. 틀린 어휘는 없는 것보다 나쁘다(하류가 엉뚱한 분기를 탄다).
  ⑤ slots 의 **키**는 그 의도의 인자표 안 (`asked_argument_names`) — 밖이면 그 키만 버린다.
     3차 프롬프트가 인자표에서 생성한 의도별 스키마를 싣게 되면서(prompts/intent.yaml v0.2.0)
     비로소 대조할 정본이 생겼다. 그전에는 의도 무관 3칸(`date`·`category`·`constraint`)을
     받아 **아무 키나 통과**시켰고, 그 키들은 인자표 어디에도 없어 **하류에서 전부 버려졌다** —
     1·2차가 규칙 추출기로 표에 맞는 인자를 내는 동안 3차만 다른 모양을 내고 있었다.
  ③ confidence는 [0,1] 유한수 또는 부재. **범위 밖은 클램프하지 않고 드롭**한다:
     place_extraction은 항목 격리라 클램프가 안전하지만, 여기 confidence는 라우팅
     신뢰도로 그대로 쓰인다 — "87"을 1.0으로 접으면 과신을 만들어낸다 (침묵 수정 금지).
     부재는 정상 — 라우터가 설정 기본값으로 대체한다.
  ④ 분류 불가(`{"intent": null}`)는 성공으로 위장하지 않고 폴백 신호로 낸다 (INV-4).

산출이 **1건**이라 "빈 결과"라는 상태가 없다 — IntentDraft가 성립하거나 error다
(TRIP-260 #5의 empty 정책이 적용될 자리가 아니다).

`OUT_OF_SCOPE`는 enum 안이라 게이트를 통과한다 — 위임 가능 라벨인지의 판정은
라우터 몫(`intent_not_routable` 사유로 폴백)이라 여기서 선점하지 않는다.
"""

from __future__ import annotations

import json
import math
from datetime import datetime

from trippilot.llm_gateway.gates.base import GateOutcome, strip_code_fence
from trippilot.domain.common import TraceId
from trippilot.domain.dialogue import asked_argument_names, asked_specs_of
from trippilot.domain.intent import Intent, IntentDraft
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent

_SCALAR = (str, int, float, bool)


def _within(value: object, choices: tuple[str, ...]) -> bool:
    """어휘 안인가. `multiple` 이면 **전부** 안에 있어야 한다."""
    items = value if isinstance(value, tuple) else (value,)
    return all(v in choices for v in items)


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
            draft, seen, dropped = self._parse(raw_text)
        except ValueError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")
        drop_event = (
            GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                # 인자 이름 드롭은 풀 ID 가 아니다 — 환각률 지표 순수성 (nudge·paraphrase 선례)
                dropped_ids=(),
                total_count=seen,
                dropped_count=dropped,
            )
            if dropped else None
        )
        return GateOutcome(value=draft, drop_event=drop_event, error=None)

    @staticmethod
    def _parse(raw_text: str) -> tuple[IntentDraft, int, int]:
        try:
            # Claude(haiku-4-5)가 정답을 ```json 펜스로 감싸 보낸다(2026-09-02 smoke_llm 실측)
            # — 공용 제거 후 전체 검증. 이 한 줄이 없어서 "정답인데 전패"였다.
            data = json.loads(strip_code_fence(raw_text))
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
        slots, seen, dropped = IntentGate._parse_slots(data.get("slots"), intent)
        return (
            IntentDraft(
                intent=intent,
                slots=slots,
                confidence=IntentGate._parse_confidence(data.get("confidence")),
            ),
            seen,
            dropped,
        )

    @staticmethod
    def _parse_slots(raw: object, intent: Intent) -> tuple[dict, int, int]:
        """② 값 모양 강제 + ⑤ 인자 이름 closed-set.

        **값 모양은 표가 정한다.** 대부분은 스칼라지만 `multiple=True` 인 인자는 **목록**이다
        — 표에 그렇게 적힌 이유가 있다(`REPLAN.reason` → `ReplanRequest.reasons: list[str]`;
        한 칸으로 받으면 복수 사유가 조용히 잘린다). 프롬프트 스키마도 같은 표에서 나와
        그 인자를 배열로 광고하므로, 게이트가 스칼라만 받으면 **모델이 시킨 대로 했는데
        전량 드롭**이 난다 — 실측으로 그렇게 됐다(2026-09-22 평가셋: REPLAN 3건이
        `parse_error: slots['reason']가 평면 스칼라가 아님` 으로 폴백). 광고와 검사는 한 표를 본다.

        중첩 객체와 목록 속 목록은 여전히 **전량 드롭**이다 — 형식 자체가 깨진 것이라
        나머지도 믿을 수 없다.

        이름은 다르다. 표 밖 키는 **그 키만 버리고 의도는 살린다**. 라벨 하나가 라우팅을
        결정하고(게이트의 존재 이유가 그 closed-set 이다) 인자는 덧붙는 값이라, 곁가지 키
        하나 때문에 맞는 의도를 폴백으로 보내면 사용자가 "기본 응답 + 수동 편집 안내"를
        받는다. 못 채운 인자는 `missing_arguments()` 가 이미 다루는 길이 있다 —
        형제 게이트(explanation·alternative_selection)의 "문장만 버리고 항목은 살린다"와 같은 판단.

        **조용히 버리지는 않는다.** 버린 칸 수를 `GateDropEvent` 로 내보낸다(호출측이 조립).
        이름이 밖이든 어휘가 밖이든 뜻은 하나다 — **광고한 스키마와 모델 산출이 어긋났다.**
        늘고 있으면 프롬프트와 표가 갈라졌다는 신호이고, 그건 보여야 한다.
        """
        if raw is None:
            return {}, 0, 0
        if not isinstance(raw, dict):
            raise ValueError("slots가 객체가 아님")
        by_name = {s.name: s for s in asked_specs_of(intent)}
        plural = {n for n, s in by_name.items() if s.multiple}
        for key, value in raw.items():
            if key in plural:
                if not isinstance(value, list) or not all(
                    isinstance(v, _SCALAR) for v in value
                ):
                    raise ValueError(f"slots[{key!r}]가 스칼라 목록이 아님")
            elif not isinstance(value, _SCALAR):
                raise ValueError(f"slots[{key!r}]가 평면 스칼라가 아님")
        kept: dict = {}
        for key, value in raw.items():
            spec = by_name.get(key)
            if spec is None:  # ⑤ 표 밖 이름
                continue
            value = tuple(value) if spec.multiple else value
            # ⑥ 어휘 closed-set — 프롬프트가 enum 을 광고했으면 게이트도 그 목록으로 본다.
            # 어긴 값은 **그 칸만** 버린다: 틀린 어휘는 없는 것보다 나쁘다(하류가 엉뚱한
            # 분기를 타거나 변환에서 죽는다). 1·2차의 `extract_enum` 도 표준값만 내므로
            # 세 경로의 산출이 같은 어휘 위에 선다.
            if spec.choices and not _within(value, spec.choices):
                continue
            kept[key] = value
        return kept, len(raw), len(raw) - len(kept)

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
