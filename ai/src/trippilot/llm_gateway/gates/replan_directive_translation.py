"""REPLAN_DIRECTIVE_TRANSLATION 출구 게이트 — 자유 발화 → 지시 키 (재계획 연동 설계 §3).

`alternative_selection` 과 같은 모양의 **항목 격리** 게이트다: 사전 밖 키는 그 항목만
드롭하고 나머지는 통과시킨다. `edit_translation` 처럼 전체를 버리지 않는 이유는 산출의
성격이 달라서다 — 편집 명령은 한 덩어리라 일부만 살리면 의미가 바뀌지만, 지시는 서로
독립이라 "실내로 + (모르는 키)" 에서 앞엣것을 살려도 뜻이 안 변한다.

**빈 결과는 실패가 아니다** (TRIP-260 #5 정책의 반대편). `{"directives": []}` 는
"이 발화에는 지시가 없다"는 **정상 판정**이다 — 이 워커는 임베딩 매칭이 이미 한 번
놓친 발화만 받으므로, 지시가 아예 없을 확률이 애초에 높다. 여기서 빈 결과를 폴백으로
뒤집으면 호출측이 "번역 실패"로 읽고 불필요한 강등을 한다. 사유(reason)와 칩 선택분은
이 경로와 무관하게 그대로 살아 있어, 지시 0건이어도 재계획은 정상 진행된다.

전량 드롭(모델이 목록 밖 키만 낸 경우)은 다르다 — 그건 모델이 지시 어휘를 못 맞춘
것이라 `gate_dropped_all` 로 드러낸다. "없다고 판단함"과 "있다는데 전부 모르는 말"은
처방이 다르다(전자는 정상, 후자는 사전·프롬프트를 봐야 한다).
"""

from __future__ import annotations

from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.gates.base import GateOutcome, _load_json_object


@dataclass(frozen=True, slots=True)
class DirectiveTranslation:
    """게이트를 통과한 산출 — 살아남은 키와 **버린 키를 함께** 나른다.

    버린 키를 값에 싣는 이유: `GateDropEvent` 는 `dropped_ids: tuple[PoiId, ...]` 로
    **INV-1 환각률 지표 전용**이다(도메인 docstring). 지시 키 드롭을 거기 섞으면 그
    지표가 오염된다 — 후보 환각과 어휘 불일치는 다른 사건이고 처방도 다르다.
    대신 호출측이 `resolve_chips` 의 unknown 과 같은 목록으로 합쳐 응답에 싣는다
    (조용한 무시 금지).
    """

    keys: tuple[str, ...]
    dropped: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DirectiveContext:
    """게이트 대조 집합 — 프롬프트에 렌더한 지시 키 그대로.

    `CandidatePool` 자리에 들어가는 feature 전용 컨텍스트다(`EditTranslationContext`
    선례). 워커가 프롬프트에 실은 목록과 **같은 값**을 넘기므로 "모델이 본 목록"과
    "게이트가 허용하는 목록"이 어긋날 수 없다.
    """

    keys: frozenset[str]


class ReplanDirectiveTranslationGate:
    """`{"directives": ["KEY", ...]}` 강제. 사전 밖 키는 항목 격리로 드롭."""

    def apply(
        self,
        raw_text: str,
        context: object,
        *,
        feature: LlmFeature,  # noqa: ARG002 — 게이트웨이 계약상 받는다
        trace_id: TraceId,  # noqa: ARG002
        now: datetime,  # noqa: ARG002
    ) -> GateOutcome:
        allowed = _allowed_keys(context)
        if allowed is None:
            # 설정 버그 — 대조 집합 없이 통과시키면 목록 밖 키가 그대로 나간다.
            return GateOutcome(value=(), drop_event=None, error="gate_error: 지시 목록 없음")
        try:
            items = _load_json_object(raw_text, "directives")
            if not isinstance(items, list):
                raise ValueError("directives 가 배열이 아님")
            parsed: list[str] = []
            for i, item in enumerate(items):
                if not isinstance(item, str) or not item.strip():
                    raise ValueError(f"directives[{i}] 가 비어있거나 문자열이 아님")
                parsed.append(item.strip())
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        survivors: list[str] = []
        dropped: list[str] = []
        seen: set[str] = set()
        for key in parsed:
            if key in seen:
                continue
            seen.add(key)
            (survivors if key in allowed else dropped).append(key)

        if parsed and not survivors:
            # 모델이 지시가 있다고 했는데 전부 모르는 말 — 사전·프롬프트를 봐야 한다.
            return GateOutcome(
                value=(), drop_event=None,
                error=f"gate_dropped_all: 사전 밖 키만 반환됨 ({', '.join(dropped)})")
        # 빈 결과(`parsed == []`)는 여기로 온다 — **성공·0건**이다 (모듈 docstring).
        return GateOutcome(
            value=DirectiveTranslation(keys=tuple(survivors), dropped=tuple(dropped)),
            drop_event=None,
            error=None,
        )


def _allowed_keys(context: object) -> AbstractSet[str] | None:
    if isinstance(context, DirectiveContext):
        return context.keys
    return None
