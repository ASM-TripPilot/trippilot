"""TRIP-313 — IntentRouter 2·3차 활성화: INTENT·PARAPHRASE 프롬프트 yaml + 출구 게이트 2종.

TRIP-242 시점에는 프롬프트 yaml과 게이트가 없어 `PromptRegistry.render`가 ValueError를 냈고,
라우터가 그걸 폴백으로 흡수해 2·3차가 사실상 비활성이었다. 이 파일은 그 배선이 실제로
살아났는지를 **실물 레지스트리 + 실물 게이트 + FakeLlm(D37 — 실 API 호출 0)**으로 검증한다.

핵심 회귀(§배선 e2e): 2차·3차 호출의 `LlmCallRecord.success == True` ∧
`prompt_ref.prompt_id == "prompts/{intent,paraphrase}.yaml"` — 폴백으로 흡수되면
success=False + FallbackEvent가 남으므로 이 단언이 곧 "활성화됨"의 증거다.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.intent import IntentGate, _within
from trippilot.llm_gateway.gates.paraphrase import ParaphraseGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.domain.common import TraceId
from trippilot.domain.dialogue import specs_of, tool_specs, tool_specs_json
from trippilot.domain.intent import ROUTABLE_INTENTS, Intent, IntentDraft, MatchRoute
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.observability import FallbackEvent, GateDropEvent, LlmCallRecord
from trippilot.orchestrator.intent_router import IntentRouter
from trippilot.orchestrator.question_bank import BANK_COLLECTION
from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.fakes.in_memory_vector_store import InMemoryVectorStore

_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_BANK_YAML = Path(__file__).resolve().parent.parent / "data" / "intent_question_bank.yaml"
_NOW = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)
_TID = TraceId("t-313")
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
# 3차 프롬프트에 실리는 것 — 라우터가 실제로 넘기는 값과 **같은 함수**에서 나온다.
# 손으로 라벨을 나열하면 프롬프트가 무엇을 받는지 테스트만 다르게 믿는다.
_INTENTS = tool_specs_json()


def _intent(raw: str) -> object:
    return IntentGate().apply(raw, None, feature=LlmFeature.INTENT, trace_id=_TID, now=_NOW)


def _paraphrase(raw: str) -> object:
    return ParaphraseGate().apply(
        raw, None, feature=LlmFeature.PARAPHRASE, trace_id=_TID, now=_NOW
    )


# ── 프롬프트 yaml ───────────────────────────────────────────────────────


def test_intent_prompt_loads_with_semver_and_injected_closed_set() -> None:
    prompt, ref = PromptRegistry(_PROMPTS).render(
        LlmFeature.INTENT, {"utterance": "내일 뭐 하지", "intents": _INTENTS}
    )
    assert ref.prompt_id == "prompts/intent.yaml" and ref.version == "0.2.0"
    assert ref.feature == "INTENT"
    for intent in ROUTABLE_INTENTS:  # 13종 전부 프롬프트에 실린다 (서버 주입 closed-set)
        assert intent.value in prompt
    assert "목록 밖 라벨 생성 금지" in prompt  # INV-1 동형
    assert '{"intent": null}' in prompt  # 분류 불가 = 지어내기 금지 (INV-4 폴백 신호)


def test_intent_prompt_carries_per_intent_arguments_not_three_generic_slots() -> None:
    """v0.2.0 의 핵심 — 의도별 인자가 실리고, 의도 무관 3칸은 사라졌다 (FD §7).

    옛 스키마(`date`·`category`·`constraint`)는 인자표 어디에도 없는 이름이라
    **하류에서 전부 버려졌다**. 그 이름이 프롬프트에 남아 있으면 모델은 계속 그걸 채운다.
    """
    prompt, _ = PromptRegistry(_PROMPTS).render(
        LlmFeature.INTENT, {"utterance": "내일 뭐 하지", "intents": _INTENTS}
    )
    # 의도별 인자가 실린다 — 표에서 나온 이름들
    assert "target_date" in prompt and "budget_level" in prompt and "replacement" in prompt
    # enum 어휘도 함께 — "발화 표현을 그대로 옮기지 말라"는 규칙의 대조군이다
    assert "MULTIGEN" in prompt and "REORDER_DAY" not in prompt  # op 은 묻지 않는다
    # 옛 3칸의 흔적이 없다
    assert '"category"' not in prompt and '"constraint"' not in prompt


def test_schema_omits_arguments_nobody_asks_for() -> None:
    """`lands_in is None`(버려짐)·`asked_by_router=False`(주인이 따로) 는 싣지 않는다.

    물으면 토큰을 쓰고 모델에게 지어낼 자리를 주는데 결과는 쓰이지 않는다.

    **의도별로** 본다 — 같은 이름이 한 의도에서는 버려지고 다른 의도에서는 쓰인다
    (`region` 은 GENERATE_SCHEDULE 에선 소비자가 0건이고 TRIP_SUMMARY 에선 실제로 쓰인다).
    프롬프트 문자열 전체에 대고 "이 이름이 없다"를 재면 그 구분이 지워진다.
    """
    by_name = {t["name"]: t["parameters"]["properties"] for t in tool_specs()}
    omitted = 0
    for intent in ROUTABLE_INTENTS:
        props = by_name[intent.value]
        for spec in specs_of(intent):
            if spec.asked():
                assert spec.name in props, f"{intent.value}.{spec.name} 가 빠졌다"
            else:
                omitted += 1
                assert spec.name not in props, f"{intent.value}.{spec.name} 를 묻고 있다"
    assert omitted == 10  # 표 40칸 중 10칸 — 줄면 근거를 확인하고 이 수를 고칠 것


def test_paraphrase_prompt_loads_with_semver_and_meaning_preservation_rule() -> None:
    prompt, ref = PromptRegistry(_PROMPTS).render(
        LlmFeature.PARAPHRASE, {"utterance": "내일 뭐 하지", "count": "3"}
    )
    assert ref.prompt_id == "prompts/paraphrase.yaml" and ref.version == "0.1.0"
    assert ref.feature == "PARAPHRASE"
    # 의도가 바뀐 변형은 투표를 오염시킨다 — 프롬프트 최우선 규칙
    assert "의도가 완전히 같은" in prompt and "바꾸지 마세요" in prompt
    assert "questions" in prompt and "3" in prompt


def test_prompt_render_is_deterministic() -> None:
    reg = PromptRegistry(_PROMPTS)
    variables = {"utterance": "일정 좀 바꿔줘", "intents": _INTENTS}
    assert reg.render(LlmFeature.INTENT, variables)[0] == reg.render(
        LlmFeature.INTENT, variables
    )[0]


def test_prompt_labels_match_question_bank_labels() -> None:
    """프롬프트에 실리는 라벨 집합 = 뱅크의 **위임 대상** 라벨 집합 (드리프트 차단).

    거부 앵커(OUT_OF_SCOPE)는 뱅크에 있지만 프롬프트에는 싣지 않는다 — 3차는 "이 중 하나를 골라라"
    이고, 고를 수 없는 라벨을 목록에 넣으면 모델이 그걸 고른다. 분류 불가는 `{"intent": null}` 로
    받는다(intent.yaml 의 기존 규약).
    """
    bank = yaml.safe_load(_BANK_YAML.read_text(encoding="utf-8"))
    bank_labels = {entry["intent"] for entry in bank["intents"]}
    assert bank_labels - {"OUT_OF_SCOPE"} == {i.value for i in ROUTABLE_INTENTS}


# ── INTENT 게이트 ───────────────────────────────────────────────────────


def test_intent_gate_builds_draft() -> None:
    outcome = _intent(
        json.dumps({"intent": "GET_WEATHER", "slots": {"date": "내일"}, "confidence": 0.8})
    )
    assert outcome.error is None and outcome.drop_event is None
    assert outcome.value == IntentDraft(Intent.GET_WEATHER, {"date": "내일"}, 0.8)


def test_intent_gate_allows_absent_slots_and_confidence() -> None:
    outcome = _intent('{"intent": "SHOW_SCHEDULE"}')
    assert outcome.value == IntentDraft(Intent.SHOW_SCHEDULE, {}, None)


def test_intent_gate_strips_code_fence() -> None:
    """Claude(haiku-4-5) 실측 — 정답을 ```json 펜스로 감싸 보낸다 (2026-09-02 smoke_llm).

    공용 `strip_code_fence`(base.py, GPT-5.6 실측으로 기존재)를 IntentGate 만 우회해
    "정답인데 전패"가 났다. 포장 제거는 관대화가 아니다 — 내용은 여전히 전체 검증된다.
    """
    outcome = _intent(
        '```json\n{\n  "intent": "GENERATE_REFLECTION",\n  "slots": {},\n  "confidence": 0.95\n}\n```'
    )
    assert outcome.error is None
    assert outcome.value == IntentDraft(Intent.GENERATE_REFLECTION, {}, 0.95)


@pytest.mark.parametrize(
    "raw, needle",
    [
        ("JSON 아님", "JSON 아님"),
        ("[1, 2]", "최상위가 객체가 아님"),
        ('{"slots": {}}', '{"intent": ...}'),
        ('{"intent": null}', "not_classifiable"),  # 분류 불가 = 폴백 신호 (INV-4)
        ('{"intent": "MAKE_COFFEE"}', "closed_set_violation"),  # INV-1 동형 — 라벨 오염
        ('{"intent": 3}', "closed_set_violation"),
        ('{"intent": "GET_WEATHER", "slots": []}', "slots가 객체가 아님"),
        # 중첩으로 검사를 우회하지 못한다 (평면 강제)
        ('{"intent": "GET_WEATHER", "slots": {"a": {"b": 1}}}', "평면 스칼라가 아님"),
        ('{"intent": "GET_WEATHER", "slots": {"a": [1]}}', "평면 스칼라가 아님"),
        ('{"intent": "GET_WEATHER", "confidence": "높음"}', "숫자가 아님"),
        ('{"intent": "GET_WEATHER", "confidence": true}', "숫자가 아님"),  # bool ⊂ int 차단
        ('{"intent": "GET_WEATHER", "confidence": 87}', "[0,1] 밖"),  # 백분율 오해 = 과신 방지
        ('{"intent": "GET_WEATHER", "confidence": -0.1}', "[0,1] 밖"),
    ],
)
def test_intent_gate_rejects_and_keeps_value_empty(raw: str, needle: str) -> None:
    outcome = _intent(raw)
    assert outcome.error is not None and needle in outcome.error
    assert not outcome.value  # "error 있으면 value 비움" 불변식


def test_intent_gate_passes_out_of_scope_to_router() -> None:
    """OUT_OF_SCOPE은 enum 안이라 게이트는 통과 — 위임 가능 여부 판정은 라우터 몫."""
    outcome = _intent('{"intent": "OUT_OF_SCOPE"}')
    assert outcome.error is None
    assert outcome.value.intent is Intent.OUT_OF_SCOPE


# ── ⑤ 인자 이름 closed-set ──────────────────────────────────────────────


def test_intent_gate_drops_argument_names_outside_the_table() -> None:
    """표 밖 키는 **그 키만** 버린다 — 의도는 살린다.

    라벨 하나가 라우팅을 결정하고 인자는 덧붙는 값이다. 곁가지 키 하나로 맞는 의도를
    폴백으로 보내면 사용자가 "기본 응답 + 수동 편집 안내"를 받는다.
    """
    outcome = _intent(json.dumps({
        "intent": "GET_WEATHER",
        "slots": {"date": "내일", "category": "카페", "constraint": "실내"},
    }))
    assert outcome.error is None
    assert outcome.value.intent is Intent.GET_WEATHER  # 의도는 살았다
    assert outcome.value.slots == {"date": "내일"}  # 표에 있는 것만


def test_intent_gate_reports_dropped_argument_names() -> None:
    """조용히 버리지 않는다 — 표 밖 키가 늘면 프롬프트와 표가 갈라졌다는 신호다."""
    outcome = _intent(json.dumps({
        "intent": "GET_WEATHER",
        "slots": {"date": "내일", "category": "카페", "constraint": "실내"},
    }))
    assert isinstance(outcome.drop_event, GateDropEvent)
    assert (outcome.drop_event.total_count, outcome.drop_event.dropped_count) == (3, 2)
    assert outcome.drop_event.dropped_ids == ()  # 풀 ID 가 아니다 — 환각률 지표 순수성


def test_intent_gate_emits_no_drop_event_when_every_name_is_known() -> None:
    outcome = _intent(json.dumps({"intent": "GET_WEATHER", "slots": {"date": "내일"}}))
    assert outcome.drop_event is None


def test_argument_names_are_scoped_to_the_intent() -> None:
    """같은 이름이 다른 의도에서는 표 밖이다 — 전역 허용 집합이 아니다.

    `budget_level` 은 GENERATE_SCHEDULE 의 인자이고 GET_WEATHER 의 인자가 아니다.
    한 벌로 합쳐 두면 "아무 의도에나 아무 인자"가 통과한다.
    """
    ok = _intent(json.dumps({
        "intent": "GENERATE_SCHEDULE", "slots": {"budget_level": "LOW"}}))
    assert ok.value.slots == {"budget_level": "LOW"}

    out = _intent(json.dumps({
        "intent": "GET_WEATHER", "slots": {"budget_level": "LOW"}}))
    assert out.value.intent is Intent.GET_WEATHER and out.value.slots == {}


def test_intent_gate_drops_handler_owned_argument() -> None:
    """`op` 은 표에 있지만 **묻지 않는 인자**다 — 주인이 핸들러라 받아도 쓰지 않는다."""
    outcome = _intent(json.dumps({
        "intent": "EDIT_SCHEDULE", "slots": {"day": "2일차", "op": "REMOVE_SLOT"}}))
    assert outcome.value.slots == {"day": "2일차"}


def test_plural_argument_arrives_as_a_list() -> None:
    """표가 `multiple=True` 라 적은 인자는 **목록**으로 받는다.

    스키마가 배열로 광고하는데 게이트가 스칼라만 받으면 **모델이 시킨 대로 했는데
    전량 드롭**이 난다 — 실측으로 그랬다(2026-09-22 평가셋 REPLAN 3건이
    `parse_error: slots['reason']가 평면 스칼라가 아님`). 광고와 검사는 한 표를 본다.
    """
    outcome = _intent(json.dumps({
        "intent": "REPLAN", "slots": {"reason": ["WEATHER", "CLOSED"]}}))
    assert outcome.error is None
    assert outcome.value.slots == {"reason": ("WEATHER", "CLOSED")}


def test_plural_argument_rejects_a_bare_scalar() -> None:
    """복수 사유가 조용히 한 건으로 잘리는 것을 막는다 (`ReplanRequest.reasons`)."""
    outcome = _intent(json.dumps({"intent": "REPLAN", "slots": {"reason": "WEATHER"}}))
    assert outcome.error is not None and "스칼라 목록이 아님" in outcome.error


def test_singular_argument_still_rejects_a_list() -> None:
    """`multiple` 이 아닌 칸에 목록이 오면 여전히 드롭 — 표에 없는 모양이다."""
    outcome = _intent(json.dumps({"intent": "GET_WEATHER", "slots": {"date": ["내일"]}}))
    assert outcome.error is not None and "평면 스칼라가 아님" in outcome.error


def test_plural_argument_rejects_nested_lists() -> None:
    outcome = _intent(json.dumps({"intent": "REPLAN", "slots": {"reason": [["W"]]}}))
    assert outcome.error is not None and "스칼라 목록이 아님" in outcome.error


# ── ⑥ 어휘 closed-set ───────────────────────────────────────────────────


def test_enum_value_outside_the_vocabulary_is_dropped() -> None:
    """프롬프트가 enum 을 광고하므로 검사도 같은 표를 본다.

    틀린 어휘는 없는 것보다 나쁘다 — 하류가 엉뚱한 분기를 타거나 변환에서 죽는다.
    의도는 살리고 그 칸만 버린다.
    """
    outcome = _intent(json.dumps({
        "intent": "GENERATE_SCHEDULE",
        "slots": {"budget_level": "가성비", "start_date": "내일"},
    }))
    assert outcome.value.intent is Intent.GENERATE_SCHEDULE
    assert outcome.value.slots == {"start_date": "내일"}  # 어휘 밖 칸만 빠졌다


def test_enum_value_inside_the_vocabulary_survives() -> None:
    outcome = _intent(json.dumps({
        "intent": "GENERATE_SCHEDULE", "slots": {"budget_level": "LOW"}}))
    assert outcome.value.slots == {"budget_level": "LOW"}


def test_plural_vocabulary_requires_every_member_inside() -> None:
    """목록이면 **전부** 어휘 안이어야 한다 — 하나가 오염되면 그 칸을 믿을 수 없다.

    지금 표에는 "복수 + 어휘"인 인자가 없다(`REPLAN.reason` 은 복수지만 `choices` 가 비어
    있다 — 표 규약상 "아직 타입이 아님"). 그래서 게이트를 통해 재지 않고 판정 함수를
    직접 본다. 둘 중 하나가 생기는 날 이 테스트가 그 자리를 이미 지키고 있다.
    """
    assert _within(("WEATHER", "CLOSED"), ("WEATHER", "CLOSED"))
    assert not _within(("WEATHER", "그냥"), ("WEATHER", "CLOSED"))


def test_argument_without_a_vocabulary_is_not_value_checked() -> None:
    """`choices` 가 비면 어휘 검사를 하지 않는다 — "아직 타입이 아니다"는 뜻이다.

    `REPLAN.reason` 이 그 자리다: 종류는 ENUM 인데 코드에 enum 이 없고 주석 어휘뿐이라
    표가 빈 `choices` 로 그 사실을 적어 뒀다. 없는 어휘로 값을 거르면 전부 버린다.
    """
    outcome = _intent(json.dumps({
        "intent": "REPLAN", "slots": {"reason": ["날씨"], "free_text": "실내 위주로"}}))
    assert outcome.value.slots == {"reason": ("날씨",), "free_text": "실내 위주로"}


# ── PARAPHRASE 게이트 ───────────────────────────────────────────────────


def test_paraphrase_gate_returns_string_tuple() -> None:
    outcome = _paraphrase(json.dumps({"questions": ["내일 날씨 어때", " 내일 비 와? "]}))
    assert outcome.value == ("내일 날씨 어때", "내일 비 와?")  # 좌우 공백 정리
    assert outcome.error is None and outcome.drop_event is None


def test_paraphrase_gate_isolates_bad_items_and_reports_drop() -> None:
    outcome = _paraphrase(json.dumps({"questions": ["질문A", "  ", 7, None, "질문A", "질문B"]}))
    assert outcome.value == ("질문A", "질문B")  # 중복·빈값·비문자만 격리 (부분 생존)
    assert outcome.error is None
    assert isinstance(outcome.drop_event, GateDropEvent)
    assert outcome.drop_event.total_count == 6 and outcome.drop_event.dropped_count == 4
    assert outcome.drop_event.dropped_ids == ()  # 풀 ID가 아님 — 환각률 지표 오염 금지


def test_paraphrase_gate_caps_count() -> None:
    outcome = _paraphrase(json.dumps({"questions": [f"질문{i}" for i in range(20)]}))
    assert len(outcome.value) == 8 and outcome.drop_event.dropped_count == 12


@pytest.mark.parametrize(
    "raw, needle",
    [
        ("JSON 아님", "JSON 아님"),
        ('{"items": []}', '{"questions": ...}'),
        ('{"questions": "내일 날씨"}', "배열이 아님"),
    ],
)
def test_paraphrase_gate_parse_failures_keep_value_empty(raw: str, needle: str) -> None:
    outcome = _paraphrase(raw)
    assert outcome.error is not None and needle in outcome.error
    assert not outcome.value


def test_paraphrase_gate_all_dropped_is_dropped_not_parse_error() -> None:
    """전량 소멸은 파싱 실패가 아니라 '전량 드롭' — 사유 라벨이 그 둘을 가른다.

    변형 0개면 2차 투표가 성립하지 않으므로 실패다(TRIP-260 #5) — 라우터는 이
    신호로 3차 LLM 직접 분류로 승급한다.
    """
    outcome = _paraphrase(json.dumps({"questions": ["", "  ", 1]}))
    assert outcome.value == () and outcome.error == "gate_dropped_all"
    assert outcome.drop_event.dropped_count == 3


def test_paraphrase_gate_empty_list_is_llm_empty_result() -> None:
    """드롭 0건인데 결과가 비면 프롬프트·입력을 보라는 신호다 (2026-08-25 회귀)."""
    outcome = _paraphrase(json.dumps({"questions": []}))
    assert outcome.value == () and outcome.error == "llm_empty_result"
    assert outcome.drop_event is None


# ── 게이트웨이 e2e (실물 레지스트리·게이트, LLM만 fake) ─────────────────


def _gateway(canned: str, gate, trace: InMemoryTrace) -> GatewayFacade:
    return GatewayFacade(FakeLlm(canned=canned), PromptRegistry(_PROMPTS), gate, _CFG, trace)


def test_intent_gateway_call_succeeds_end_to_end() -> None:
    trace = InMemoryTrace()
    result = _gateway(
        json.dumps(
            {"intent": "REPLAN", "slots": {"target_date": "오늘"}, "confidence": 0.9}
        ),
        IntentGate(),
        trace,
    ).call(
        LlmFeature.INTENT, {"utterance": "오늘 비 오는데", "intents": _INTENTS}, None, _TID, _NOW
    )
    assert result.is_fallback is False and result.error is None
    # 인자 이름이 **의도별**이다 — REPLAN 의 날짜 칸은 `target_date` 이고 `date` 가 아니다
    assert result.value == IntentDraft(Intent.REPLAN, {"target_date": "오늘"}, 0.9)
    assert result.call_record.prompt_ref.prompt_id == "prompts/intent.yaml"
    assert result.call_record.model_id == "m-l"  # LIGHT 티어 (config 주입 — 하드코딩 없음)
    assert trace.of_type(FallbackEvent) == []


def test_paraphrase_gateway_call_succeeds_end_to_end() -> None:
    trace = InMemoryTrace()
    result = _gateway(
        json.dumps({"questions": ["일정 수정해줘", "스케줄 바꿔줘"]}), ParaphraseGate(), trace
    ).call(
        LlmFeature.PARAPHRASE, {"utterance": "일정 좀 갈아엎자", "count": "3"}, None, _TID, _NOW
    )
    assert result.is_fallback is False
    assert result.value == ("일정 수정해줘", "스케줄 바꿔줘")
    assert result.call_record.prompt_ref.prompt_id == "prompts/paraphrase.yaml"
    assert trace.of_type(FallbackEvent) == []


def test_gateway_fallback_is_signalled_not_silent() -> None:
    """게이트 거부 → 폴백 TypedResult + FallbackEvent (INV-4 침묵 실패 금지)."""
    trace = InMemoryTrace()
    result = _gateway('{"intent": "MAKE_COFFEE"}', IntentGate(), trace).call(
        LlmFeature.INTENT, {"utterance": "커피", "intents": _INTENTS}, None, _TID, _NOW
    )
    assert result.is_fallback is True and "closed_set_violation" in result.error
    assert len(trace.of_type(FallbackEvent)) == 1


# ── 라우터 배선 e2e — 2·3차가 폴백으로 흡수되지 않는다 (이 티켓의 핵심) ──
#
# 대본 뱅크(각도로 코사인 조준): W1/W2 GET_WEATHER, D1 GET_DISTANCE.
# "애매한 질문"은 top1·top2 의도가 갈려 2차로, "생소한 질문"은 T_mid 미달로 3차로 간다.

_BANK = {"W1": (0.00, Intent.GET_WEATHER), "W2": (0.30, Intent.GET_WEATHER),
         "D1": (0.35, Intent.GET_DISTANCE)}
_ANGLES = {"애매한 질문": 0.32, "생소한 질문": 2.50, "날씨 변형A": 0.00, "날씨 변형B": 0.30}


class _ScriptedEmbedding:
    dim = 2
    model_id = "scripted-angles"  # 실모델과 collection 이 갈리게

    def embed(self, text: str) -> tuple[float, ...]:
        theta = _ANGLES.get(text, 2.5)
        return (math.cos(theta), math.sin(theta))

    def embed_batch(self, texts):
        return tuple(self.embed(t) for t in texts)


def _router(*, intent_trace: InMemoryTrace, paraphrase_trace: InMemoryTrace) -> IntentRouter:
    store = InMemoryVectorStore()
    for item_id, (theta, intent) in _BANK.items():
        store.upsert(
            BANK_COLLECTION, item_id, (math.cos(theta), math.sin(theta)),
            {"intent": intent.value, "question": item_id},
        )
    return IntentRouter(
        _ScriptedEmbedding(),
        store,
        intent_gateway=_gateway(
            json.dumps({"intent": "GENERATE_SCHEDULE", "slots": {"start_date": "내일"},
                        "confidence": 0.77}),
            IntentGate(),
            intent_trace,
        ),
        paraphrase_gateway=_gateway(
            json.dumps({"questions": ["날씨 변형A", "날씨 변형B", "날씨 변형A"]}),
            ParaphraseGate(),
            paraphrase_trace,
        ),
    )


def test_second_stage_vote_runs_on_real_prompt_and_gate() -> None:
    """2차 활성화 — 유사질문이 실제 프롬프트·게이트를 통과해 투표를 확정한다."""
    intent_trace, paraphrase_trace = InMemoryTrace(), InMemoryTrace()
    match = _router(intent_trace=intent_trace, paraphrase_trace=paraphrase_trace).route(
        "애매한 질문", _TID, _NOW
    )
    assert match.match_route is MatchRoute.VOTED  # 폴백으로 흡수되지 않았다
    assert match.intent is Intent.GET_WEATHER

    records = paraphrase_trace.of_type(LlmCallRecord)
    assert len(records) == 1 and records[0].success is True
    assert records[0].prompt_ref.prompt_id == "prompts/paraphrase.yaml"
    assert records[0].prompt_ref.version == "0.1.0"
    assert paraphrase_trace.of_type(FallbackEvent) == []
    assert intent_trace.events == []  # 2차에서 끝났으니 3차는 호출되지 않는다


def test_third_stage_classification_runs_on_real_prompt_and_gate() -> None:
    """3차 활성화 — 뱅크 미달 발화가 실제 프롬프트·게이트를 통과해 라벨을 확정한다."""
    intent_trace, paraphrase_trace = InMemoryTrace(), InMemoryTrace()
    match = _router(intent_trace=intent_trace, paraphrase_trace=paraphrase_trace).route(
        "생소한 질문", _TID, _NOW
    )
    assert match.match_route is MatchRoute.LLM_DIRECT  # 폴백으로 흡수되지 않았다
    assert match.intent is Intent.GENERATE_SCHEDULE
    assert match.slots == {"start_date": "내일"} and math.isclose(match.confidence, 0.77)
    assert "below_t_mid" in match.reason  # 승격 사유는 남는다

    records = intent_trace.of_type(LlmCallRecord)
    assert len(records) == 1 and records[0].success is True
    assert records[0].prompt_ref.prompt_id == "prompts/intent.yaml"
    assert records[0].prompt_ref.version == "0.2.0"
    assert intent_trace.of_type(FallbackEvent) == []


def test_router_variable_names_match_prompt_placeholders() -> None:
    """회귀 방어: 라우터가 넘기는 변수명이 곧 템플릿 플레이스홀더 — 어긋나면 render가
    ValueError를 내고 2·3차가 통째로 폴백된다 (TRIP-313 이전 상태)."""
    trace = InMemoryTrace()
    router = IntentRouter(
        _ScriptedEmbedding(),
        InMemoryVectorStore(),  # 빈 뱅크 → 곧장 3차
        intent_gateway=_gateway('{"intent": "SHOW_SCHEDULE"}', IntentGate(), trace),
    )
    match = router.route("아무 발화", _TID, _NOW)
    assert match.match_route is MatchRoute.LLM_DIRECT
    assert trace.of_type(LlmCallRecord)[0].success is True
