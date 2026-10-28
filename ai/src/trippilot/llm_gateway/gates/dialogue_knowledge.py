"""DIALOGUE_KNOWLEDGE 출구 게이트 — 여행 일반 지식 즉답 문장 (assistant-orchestrator BR-AO-32, 2026-10-23).

모양·표시 안전성은 답변 게이트(`DialogueAnswerGate` — 길이·줄 수·시간 표현·링크·연락처·주입 꼴)를 그대로 거친다. 그 위에
지식 답만의 규칙 하나: **바뀌는 구체 값을 말하지 않는다**(사용자 결정 — "날짜·가격 같은 구체 값은 막는다"). 기억에서 나온
일반 지식이라 맞는지 아무도 확인하지 않았다:
  ⑥ 가격·요금 — 숫자 + 원(`1,500원`·`3만 원`·`2만5천원`) · 한글 수 + 원(`삼만 원`·`만 원`) · 숫자 + 만·천(`1인 2만`) · 외화·통화
     기호(`1만 엔`·`10달러`·`₩15,000`·`15,000 KRW`)
  ⑦ 특정 날짜 — `10월 3일`·`10월 3–5일`·`10월 3·4일`·`10/3`·`3일부터 5일까지`(달만 쓴 "4~5월"·"10월 초"는 시기 답의 알맹이라 통과,
     "2박 3일"은 날짜가 아니다)
  ⑧ 연도 — `2025년`·`'25년`·`25년부터`·`2025 기준`("10년 넘게" 같은 기간은 통과)
  ⑨ 거리 — `4km`·`약 400킬로`·`해발 1,950m`(사실 칸이 없는 답의 거리는 전부 지어낸 것 — 답변의 거리는 Facts 에서만)
  ⑩ 노선·출구 번호 — `2호선`·`140번 버스`·`3번 출구`(교통 질문을 지식 답이 받으면서 — 바뀌는 값이고 틀리면 사용자가 엉뚱한 곳으로 간다)
흔한 꼴 몇이 빠져 확인 안 된 값이 그대로 화면에 나갔다(2026-10-23 리뷰 재현) — 놓친 꼴은 게이트 테스트에 매개변수로 고정했다.
등록되지 않은 장소 이름·새로 만든 시각은 이 게이트가 아니라 오케스트레이터가 스냅샷과 대조해 막는다(장소 목록은 여기서 모른다).

`{"text": null}` 은 **성공·0건** — 모델이 "모르거나 여행 지식이 아니다"라고 판단한 답이다(DIALOGUE_SQL 의 sql=null 선례). 실패가
아니라서 폴백 이벤트가 없고, 호출측은 종전 범위 밖 카드로 간다. 위반은 통째로 드롭(`gate_dropped_all`) — 문장 일부만 지우면
뜻이 바뀐다.
"""

from __future__ import annotations

import json
import re
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.llm_gateway.gates.base import GateOutcome, empty_result_error, strip_code_fence
from trippilot.llm_gateway.gates.dialogue_answer import DialogueAnswerGate

_RANGE = r"[~∼\-–—～〜,·]"  # 범위·목록 구분자 — GPT 는 범위에 en dash 를 자주 쓴다
_PRICE = re.compile(  # ⑥
    r"\d[\d,]*\s*(?:만|천|백)?(?:\s*\d[\d,]*\s*(?:천|백)?)?\s*원"  # "1만 5천 원"·"15,000원이에요"
    r"|(?<![가-힣])(?:몇|수)?\s*[일이삼사오육칠팔구십]*\s*[백천만]\s*(?:[일이삼사오육칠팔구십]*\s*[백천]\s*)?원"  # "삼만 원"·"몇천 원" — "온천원"·"사원"은 아니다
    r"|\d[\d,]*\s*[만천](?![가-힣])"  # "1인 2만"·"2만~3만 선" — 원을 뺀 가격(방문객 수 같은 다른 구체 값도 걸린다)
    r"|\d[\d,.]*\s*(?:엔|달러|유로|위안|바트)|[₩$¥€£]\s*\d|\d[\d,.]*\s*(?:KRW|USD|JPY|EUR|CNY)")
_DAY = re.compile(  # ⑦
    r"\d{1,2}\s*월\s*\d{1,2}\s*(?:" + _RANGE + r"\s*\d{1,2}\s*)*일"  # "10월 3일"·"10월 3–5일"·"10월 3·4일"
    r"|\d{1,2}\s*일\s*부터\s*\d{1,2}\s*일"  # "3일부터 5일까지"
    r"|(?<!\d)(?:1[0-2]|0?[1-9])/(?:3[01]|[12]\d|0?[1-9])(?!\d)")  # "10/3" — "24/7" 은 달이 아니다
_YEAR = re.compile(  # ⑧
    r"(?:19|20)\d{2}\s*년|'\d{2}\s*년|(?:19|20)\d{2}(?=\s*(?:기준|시즌|년도))|(?<![\d'])\d{2}\s*년\s*(?:부터|까지|기준)")


_DISTANCE = re.compile(r"\d[\d,.]*\s*(?:km|㎞|킬로(?:미터)?|미터|m)(?![A-Za-z])")  # ⑨
_ROUTE = re.compile(r"\d+\s*호선|\d+\s*번\s*(?:버스|출구|게이트|승강장)|(?:버스|출구|게이트|승강장)\s*\d+\s*번")  # ⑩


def has_specific_value(text: str) -> bool:
    """가격·특정 날짜·연도·거리·노선 번호 꼴이 있는가 — 지식 답에서는 확인하지 않은 값이다."""
    return any(p.search(text) for p in (_PRICE, _DAY, _YEAR, _DISTANCE, _ROUTE))


class DialogueKnowledgeGate:
    """{"text": str|null, "footnote": str|null} → `DialogueAnswerDraft` | None(모른다고 닫음). 각주는 호출측이 결정론으로 단다."""

    def __init__(self) -> None:
        self._answer = DialogueAnswerGate()

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
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict) and "text" in data and data["text"] is None:
            return GateOutcome(value=None, drop_event=None, error=None)  # 판단한 0건 — 폴백 아님
        out = self._answer.apply(raw_text, pool, feature=feature, trace_id=trace_id, now=now)
        if out.error is not None or not has_specific_value(out.value.text):
            return out
        drop = GateDropEvent(trace_id=trace_id, occurred_at=now, component="c1.gate", feature=feature.value,
                             dropped_ids=(), total_count=1, dropped_count=1)
        return GateOutcome(value=None, drop_event=drop, error=empty_result_error(None, drop))
