"""미확인 칸 웹 확인 값 → 결정론 폴백 문장(`dialogue_handlers._web_sentence`)이 답변 검사를 넘는다 (INV-4 마지막 계단).

UnknownHandlingAgent 테스트(`tests/agents/unknown_handling/`)에서 떼어 왔다 — 검사 대상이 에이전트가 아니라 핸들러 문장이다."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.gates.place_fact import PlaceFactGate
from trippilot.orchestrator import dialogue_handlers as dh

_NOW = datetime(2026, 10, 22, 6, 0, tzinfo=timezone.utc)
_VALUES = st.one_of(st.none(), st.text(max_size=30), st.sampled_from([
    "09:00~18:00", "9:00 - 24:00", "17:00", "매주 월요일, 화요일", "매월 마지막째 주 일요일", "연중무휴", "무료", "29000원"]))


@given(raw=st.fixed_dictionaries({f: _VALUES for f in ("hours", "last_entry", "closed", "fee")}), fee_unknown=st.booleans())
@settings(max_examples=300, deadline=None)
def test_pbt_any_gate_accepted_facts_make_a_fallback_sentence_that_passes_the_answer_gate(raw: dict, fee_unknown: bool) -> None:
    """게이트가 통과시킨 칸이면 어떤 조합이든 결정론 문장이 답변 검사(시각·소요·연락처·주입·길이)를 넘는다."""
    out = PlaceFactGate().apply(json.dumps(raw, ensure_ascii=False), ("https://royal.khs.go.kr/a",),
                                feature=LlmFeature.PLACE_FACT_LOOKUP, trace_id=TraceId("t"), now=_NOW)
    if out.value is not None:
        sentence = dh._web_sentence(out.value, fee_unknown)
        if sentence:
            dh.validate_answer_text(sentence)  # 던지면 실패
