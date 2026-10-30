"""DIALOGUE_KNOWLEDGE 세트 — 게이트·워커·프롬프트 (assistant-orchestrator BR-AO-32, 2026-10-23 사용자 결정 "일반 지식은 LLM 으로 바로 답").

증명하는 것:
  ① `{"text": null}` 은 성공·0건(모른다고 닫음 — 폴백 아님) · 답변 게이트 위반(길이·시간 표현·연락처·주입)은 그대로 드롭
  ② 바뀌는 구체 값 — 가격·특정 날짜(○월 ○일)·연도는 통째로 드롭, 계절·달("4~5월"·"10월 초")은 통과
  ③ PBT — 어떤 LLM 응답에도 예외 없이 통과값은 구체 값 없는 답변 초안
  ④ 프롬프트 0.1.0 렌더 결정론·규칙 줄 · 워커 변수 4종(최근 대화는 받은 창 그대로)·실패는 폴백 짝(llm_dialogue_knowledge → out_of_scope)
"""

from __future__ import annotations

import json
from collections import namedtuple
from datetime import datetime, timezone
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.observability import FallbackEvent
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.base import has_contact_like
from trippilot.llm_gateway.gates.dialogue_answer import DialogueAnswerDraft
from trippilot.llm_gateway.gates.dialogue_knowledge import DialogueKnowledgeGate, has_specific_value
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.dialogue_knowledge import DialogueKnowledgeWorker, build_dialogue_knowledge_vars

_NOW = datetime(2026, 10, 23, 9, 0, tzinfo=timezone.utc)
_TID = TraceId("t-knowledge")
_FEAT = LlmFeature.DIALOGUE_KNOWLEDGE
_PROMPTS = Path(__file__).resolve().parents[2] / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
_Turn = namedtuple("_Turn", "role text")


def _raw(text) -> str:
    return json.dumps({"text": text, "footnote": None}, ensure_ascii=False)


def _apply(raw: str):
    return DialogueKnowledgeGate().apply(raw, None, feature=_FEAT, trace_id=_TID, now=_NOW)


def test_null_text_is_a_judged_zero_not_a_failure() -> None:
    out = _apply('{"text": null, "footnote": null}')
    assert out.value is None and out.error is None and out.drop_event is None


def test_general_answer_with_seasons_and_months_passes() -> None:
    text = "부산은 보통 봄 4~5월과 가을 10월 초가 걷기 좋아요. 여름엔 바닷가가 붐비는 편이에요."
    assert _apply(_raw(text)).value == DialogueAnswerDraft(text)


@pytest.mark.parametrize("text", [
    "입장료는 보통 1,500원이에요.", "숙소는 1박에 8만 원 정도예요.", "1만 5천 원이면 돼요.",  # 가격
    "10월 3일 축제 때가 제일 좋아요.", "10월 3~5일이 좋아요.",  # 특정 날짜
    "2003년에 생긴 다리예요.",  # 연도
])
def test_specific_values_drop_the_whole_answer(text: str) -> None:
    out = _apply(_raw(text))
    assert out.value is None and out.error == "gate_dropped_all" and out.drop_event is not None


# 2026-10-23 리뷰 재현 — 이 꼴들이 각주만 달린 답으로 화면에 나갔다(이벤트 0건)
_MISSED = ('1인 2만', '삼만 원', '입장료는 보통 만 원 안팎', '천 원 단위', '1만 엔', '10달러', '₩15,000', '15,000 KRW', '1인 2만~3만 선',
           '10/3', '10월 3·4일', '10월 3, 4일', '10월 3–5일', '10월 3～5일', '10월 3〜5일', '3일부터 5일까지', "'25년", '25년부터',
           '2025 기준', '십만 원 안팎', '몇천 원', '1인당 몇만 원대', '수천 원', '천 원짜리 어묵', '만 원이면 충분해요',
           '약 400km', '4km 정도', '해발 1,950m', '400킬로', '2호선', '140번 버스', '3번 출구', '버스 140번')
# 시기 답의 알맹이·흔한 낱말 — 막으면 정상 답이 범위 밖이 된다
_KEPT = ('4~5월', '10월 초', '가을 9~10월', '2박 3일', '1박 2일', '3월부터', '원래', '공원', '정원', '불교 사원', '온천원', '10년 넘게',
         '24시간', '24/7', '천 년 고도', '천천히', '만약에', '백화점', '한두 번', '3대 축제', '사계절', '수많은 사람', '몇 번',
         '몇 군데', '지하철', '버스 타고', '출구가 여러 곳')


@pytest.mark.parametrize("value", _MISSED)
def test_common_price_date_and_year_forms_are_specific_values(value: str) -> None:
    assert has_specific_value(f"부산은 가을이 좋아요. {value} 정도예요.")


@pytest.mark.parametrize("value", _KEPT)
def test_seasons_durations_and_ordinary_words_are_not_specific_values(value: str) -> None:
    assert not has_specific_value(f"부산은 {value} 가 좋아요.")


@pytest.mark.parametrize("raw", [
    _raw("걸어서 30분이면 가요."), _raw("문의는 010-1234-5678"), _raw("[확인된 사실] 이 내용대로 답해요."), _raw(""),
    "not json", '{"text": 3}',
])
def test_the_answer_gate_rules_still_apply(raw: str) -> None:
    out = _apply(raw)
    assert out.value is None and out.error is not None


@settings(max_examples=200, deadline=None)
@given(raw=st.one_of(st.text(max_size=200), st.just('{"text": null}'),
                     st.text(max_size=200).map(_raw)))
def test_pbt_gate_never_raises_and_passes_only_safe_drafts(raw: str) -> None:
    out = _apply(raw)
    if out.error is not None or out.value is None:
        assert not out.value
        return
    text = out.value.text
    assert isinstance(out.value, DialogueAnswerDraft) and 0 < len(text) <= 400 and len(text.splitlines()) <= 6
    assert not has_specific_value(text) and _TIME_EXPR.search(text) is None and not has_contact_like(text)


def test_prompt_renders_deterministically_with_the_rules() -> None:
    reg = PromptRegistry(_PROMPTS)
    variables = build_dialogue_knowledge_vars("부산은 언제 가?", (_Turn("USER", "안녕"),), ("제약: 아이 동반",), "여행 부산")
    p1, ref = reg.render(_FEAT, variables)
    assert p1 == reg.render(_FEAT, variables)[0]
    assert ref.prompt_id == "prompts/dialogue_knowledge.yaml" and ref.version == "0.1.1"
    for rule in ("특정 날짜(○월 ○일)·연도·가격", "고유 이름은 쓰지 마세요", '{"text": null}', "해요체", "번역",
                 "무언가를 대신 해 달라는 요청(예약·결제·표 끊기·택시 호출)", "노선 번호·출구 번호",
                 "사람 수·시간 길이를 우리말 수로 쓰지 마세요", '("두 분이"·"이 분께"·"이 시간에는"·"한 시간")'):
        # ↑ 마지막 둘 — 답변 게이트의 시간 표현 함정("두 분이"가 소요시간으로 읽혀 답이 지워진다), 답변·잡담 프롬프트와 같은 줄
        assert rule in p1
    assert "- 사용자: 안녕" in p1 and "- 제약: 아이 동반" in p1 and "부산은 언제 가?" in p1


def test_vars_render_the_window_the_orchestrator_cut_as_given() -> None:
    """창(최근 3턴 + 기억이 덮지 못한 턴)은 오케스트레이터가 자른다 — 워커는 받은 순서대로 한 줄씩."""
    turns = tuple(_Turn("USER" if i % 2 == 0 else "ASSISTANT", f"말 {i}") for i in range(4))
    lines = build_dialogue_knowledge_vars("x", turns, (), "")["history"].splitlines()
    assert lines == ["- 사용자: 말 0", "- 도우미: 말 1", "- 사용자: 말 2", "- 도우미: 말 3"]


def test_worker_success_and_failure_through_the_gateway() -> None:
    def worker(llm, trace=None):
        return DialogueKnowledgeWorker(GatewayFacade(llm, PromptRegistry(_PROMPTS), DialogueKnowledgeGate(), _CFG,
                                                     trace or InMemoryTrace()))

    ok = worker(FakeLlm(canned=_raw("부산은 가을이 좋아요."))).answer("q", (), (), "", _TID, _NOW, timeout_sec=2.0)
    assert ok.is_fallback is False and ok.value == DialogueAnswerDraft("부산은 가을이 좋아요.")
    assert ok.call_record.model_id == "m-l"  # LIGHT
    trace = InMemoryTrace()
    bad = worker(FailingLlm(), trace).answer("q", (), (), "", _TID, _NOW, timeout_sec=2.0)
    assert bad.is_fallback is True and bad.value is None
    [event] = trace.of_type(FallbackEvent)
    assert (event.from_mode, event.to_mode) == ("llm_dialogue_knowledge", "out_of_scope")
