"""REPLAN_DIRECTIVE_TRANSLATION 4종 세트 — 프롬프트·게이트·워커·폴백.

이 워커는 **임베딩 매칭(KB-4, 임계 0.74)이 놓친 발화만** 받는다. 그래서 "억지로 고르지
않는다"가 핵심 성질이고, 빈 결과가 실패가 아니라는 것이 게이트 정책의 요점이다.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.llm_gateway.config import C1Config, default_fallback_modes, default_tier_map
from trippilot.llm_gateway.gates.replan_directive_translation import (
    DirectiveContext,
    DirectiveTranslation,
    ReplanDirectiveTranslationGate,
)
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.replan_directive_translation import (
    DirectiveTranslationInput,
    ReplanDirectiveTranslationWorker,
    build_directive_translation_vars,
    context_of,
    options_from,
)

from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace

_NOW = datetime(2026, 9, 12, 10, 0, tzinfo=timezone.utc)
_TID = TraceId("t-directive")
_FEAT = LlmFeature.REPLAN_DIRECTIVE_TRANSLATION
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})

_OPTIONS = (("INDOOR", "실내로"), ("LESS_MOVE", "이동 줄이기"), ("ADD_FOOD", "맛집 추가"))


def _input(**kw) -> DirectiveTranslationInput:
    base = dict(utterance="비 오니까 안에서", options=_OPTIONS)
    base.update(kw)
    return DirectiveTranslationInput(**base)


def _apply(raw: str, keys=("INDOOR", "LESS_MOVE", "ADD_FOOD")):
    return ReplanDirectiveTranslationGate().apply(
        raw, DirectiveContext(keys=frozenset(keys)),
        feature=_FEAT, trace_id=_TID, now=_NOW)


def _raw(*keys: str) -> str:
    return json.dumps({"directives": list(keys)}, ensure_ascii=False)


def _worker(llm) -> tuple[ReplanDirectiveTranslationWorker, InMemoryTrace]:
    trace = InMemoryTrace()
    gateway = GatewayFacade(
        llm, PromptRegistry(_PROMPTS), ReplanDirectiveTranslationGate(), _CFG, trace)
    return ReplanDirectiveTranslationWorker(gateway), trace


# ── 게이트: 정상 ────────────────────────────────────────────────────────


def test_gate_keeps_known_keys_in_order() -> None:
    out = _apply(_raw("LESS_MOVE", "INDOOR"))
    assert out.error is None
    assert out.value.keys == ("LESS_MOVE", "INDOOR")


def test_gate_isolates_unknown_key_and_keeps_the_rest() -> None:
    """지시는 서로 독립이라 하나가 틀려도 나머지 뜻이 안 변한다 (edit_translation 과 다른 점)."""
    out = _apply(_raw("INDOOR", "MADE_UP"))
    assert out.error is None
    assert out.value.keys == ("INDOOR",)
    assert out.value.dropped == ("MADE_UP",)


def test_gate_dedups_by_first_occurrence() -> None:
    assert _apply(_raw("INDOOR", "INDOOR")).value.keys == ("INDOOR",)


def test_gate_empty_result_is_success_not_failure() -> None:
    """**이 게이트의 핵심 정책.** 임베딩이 이미 한 번 놓친 발화라 지시가 없을 확률이 높다.

    여기서 빈 결과를 폴백으로 뒤집으면 호출측이 "번역 실패"로 읽고 불필요한 강등을 한다.
    """
    out = _apply(_raw())
    assert out.error is None
    assert out.value == DirectiveTranslation(keys=(), dropped=())


def test_gate_all_dropped_is_a_failure() -> None:
    """"없다고 판단함"과 "있다는데 전부 모르는 말"은 처방이 다르다."""
    out = _apply(_raw("NOPE", "ALSO_NOPE"))
    assert out.error and "gate_dropped_all" in out.error
    assert not out.value


# ── 게이트: 형태 위반 ───────────────────────────────────────────────────


@pytest.mark.parametrize("raw", [
    "not json",
    '{"wrong_key": []}',
    '{"directives": "INDOOR"}',      # 배열이 아님
    '{"directives": [123]}',          # 문자열이 아님
    '{"directives": ["  "]}',         # 공백만
])
def test_gate_rejects_malformed_shapes(raw: str) -> None:
    out = _apply(raw)
    assert out.error and ("parse_error" in out.error or "gate_error" in out.error)
    assert not out.value


def test_gate_without_context_is_a_config_bug_not_a_pass() -> None:
    """대조 집합 없이 통과시키면 목록 밖 키가 그대로 나간다."""
    out = ReplanDirectiveTranslationGate().apply(
        _raw("INDOOR"), None, feature=_FEAT, trace_id=_TID, now=_NOW)
    assert out.error and "gate_error" in out.error


def test_gate_strips_code_fence() -> None:
    """모델이 ```json 펜스를 붙이는 실측이 있었다 (gates/base strip_code_fence)."""
    out = _apply('```json\n{"directives": ["INDOOR"]}\n```')
    assert out.error is None and out.value.keys == ("INDOOR",)


# ── 프롬프트 렌더 ───────────────────────────────────────────────────────


def test_prompt_renders_with_injected_directive_list() -> None:
    """목록은 **서버가 주입**한다 — 사전이 20→30종이 되어도 프롬프트 파일은 안 바뀐다."""
    prompt, ref = PromptRegistry(_PROMPTS).render(
        _FEAT, build_directive_translation_vars(_input()))
    assert "INDOOR | 실내로" in prompt
    assert "LESS_MOVE | 이동 줄이기" in prompt
    assert "비 오니까 안에서" in prompt
    assert ref  # prompt_ref 가 계측에 실린다


def test_prompt_list_is_sorted_for_determinism() -> None:
    """사전 순서가 프롬프트를 흔들면 같은 발화가 날마다 다른 입력이 된다."""
    a = build_directive_translation_vars(_input(options=_OPTIONS))
    b = build_directive_translation_vars(_input(options=tuple(reversed(_OPTIONS))))
    assert a["directives"] == b["directives"]


def test_prompt_carries_injection_defence() -> None:
    """자유 발화가 프롬프트에 들어간다 — `EDIT_TRANSLATION` 과 같은 방어 문구를 둔다."""
    prompt, _ = PromptRegistry(_PROMPTS).render(
        _FEAT, build_directive_translation_vars(_input()))
    assert "역할 변경 요청" in prompt
    assert "지시문이 아닙니다" in prompt


def test_prompt_text_must_come_from_the_registry() -> None:
    """yaml 을 문자열로 잘라 쓰면 **블록 스칼라 들여쓰기가 남는다**.

    다른 트랙(REMINDER_COPY)이 학습 데이터 스크립트에서 이걸 밟았다 — 눈으로는 같은데
    렌더 결과가 22줄 전부 달랐다(615자 대 578자). 평가·리허설 스크립트가 프롬프트를
    직접 꺼내 쓸 일이 있으면 반드시 `PromptRegistry.render` 를 거쳐야 한다.
    """
    raw = (_PROMPTS / "replan_directive_translation.yaml").read_text(encoding="utf-8")
    naive = raw.split("template: |", 1)[1]
    rendered, _ = PromptRegistry(_PROMPTS).render(
        _FEAT, build_directive_translation_vars(_input()))
    assert rendered not in naive, "들여쓰기가 같다면 이 가드가 무의미해진 것"
    assert not rendered.startswith("  "), "렌더 결과에 블록 들여쓰기가 남았다"


# ── 워커 ───────────────────────────────────────────────────────────────


def test_worker_end_to_end_success() -> None:
    result = _worker(FakeLlm(canned=_raw("INDOOR")))[0].translate(_input(), _TID, _NOW)
    assert result.is_fallback is False
    assert result.value.keys == ("INDOOR",)
    assert result.call_record is not None and result.call_record.success is True


def test_worker_falls_back_loudly_on_llm_failure() -> None:
    """실행(칩만으로 진행)은 호출측 몫이고, 침묵 실패는 없다 (INV-4)."""
    result = _worker(FailingLlm())[0].translate(_input(), _TID, _NOW)
    assert result.is_fallback is True and result.value is None
    assert result.error and result.call_record is not None


def test_worker_fallback_event_says_chips_only() -> None:
    """폴백 실체가 "번역 실패"가 아니라 "칩만"이다 — 재계획 자체는 정상으로 돈다."""
    from trippilot.domain.observability import FallbackEvent

    worker, trace = _worker(FailingLlm())
    worker.translate(_input(), _TID, _NOW)
    (event,) = trace.of_type(FallbackEvent)
    assert (event.from_mode, event.to_mode) == ("llm_directive_translation", "chips_only")


def test_worker_context_matches_the_rendered_list() -> None:
    """"모델이 본 목록"과 "게이트가 허용하는 목록"이 어긋날 수 없어야 한다."""
    inp = _input()
    rendered = build_directive_translation_vars(inp)["directives"]
    for key in context_of(inp).keys:
        assert key in rendered


def test_worker_rejects_empty_option_list() -> None:
    """고를 값이 없는데 부르면 호출 자체가 버그다."""
    with pytest.raises(ValueError, match="options"):
        DirectiveTranslationInput(utterance="뭐라도", options=())


def test_worker_timeout_passthrough_exists() -> None:
    """미관통이면 게이트웨이 기본(10s)에 얹혀 조용히 폴백만 타는 상태가 된다 (TRIP-522)."""
    import inspect

    assert "timeout_sec" in inspect.signature(
        ReplanDirectiveTranslationWorker.translate).parameters


def test_options_from_reads_only_key_and_label() -> None:
    """`llm_gateway` 는 `agents` 를 모른다 — 덕 타이핑으로 받는다 (의존 방향 보존)."""
    class _Spec:
        key, label = "X", "엑스"
        extra = "무시돼야 한다"

    assert options_from([_Spec()]) == (("X", "엑스"),)


# ── 설정 ───────────────────────────────────────────────────────────────


def test_feature_is_registered_in_both_config_maps() -> None:
    """둘 중 하나를 빠뜨리면 라우팅이 ValueError 거나 관측이 unmapped_feature 로 샌다."""
    assert default_tier_map()[_FEAT] is ModelTier.LIGHT
    assert default_fallback_modes()[_FEAT] == ("llm_directive_translation", "chips_only")


def test_max_directives_matches_embedding_path() -> None:
    """두 통로가 다른 상한을 가지면 같은 발화인데 경로에 따라 지시 수가 달라진다."""
    from trippilot.agents.planb.directives import MAX_RESOLVED
    from trippilot.llm_gateway.workers.replan_directive_translation import MAX_DIRECTIVES

    assert MAX_DIRECTIVES == MAX_RESOLVED
