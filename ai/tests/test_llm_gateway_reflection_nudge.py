"""TRIP-347 — REFLECTION_NUDGE 4종 세트: 프롬프트·게이트·워커·PBT.

증명하는 것:
  ① 게이트 통과 문구는 항상 상한(60자) 이내 + 금지 토큰(분·시간·시각·duration) 없음 +
     비어 있지 않음 — 위반은 error가 아니라 드롭(GateDropEvent)으로 계측 (INV-3)
  ② 파싱 실패·형태 위반은 조용히 넘기지 않고 error로 수렴 → 게이트웨이가 폴백 전환 (INV-4)
  ③ 프롬프트 렌더 결정론 + 규칙 문구(1문장·60자·시간 언급 금지·이모지 0~1) 탑재
  ④ 워커는 폴백 TypedResult를 그대로 반환 (BR-U4-09) — 기본 폴백 문구
     FALLBACK_NUDGE_MESSAGE는 게이트 규칙을 스스로 만족한다 (INV-4의 마지막 계단)
  ⑤ PBT — 임의 LLM 응답에서 예외 0: 산출은 항상 제약 안이거나 폴백으로 수렴

범위 밖: 알림 발송은 백엔드 notification(FCM) 소유 — 라우트·오케스트레이터 연결 없음.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.reflection_nudge import (
    _FORBIDDEN_TOKENS,
    _MAX_LENGTH,
    ReflectionNudgeGate,
)
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.reflection_nudge import (
    FALLBACK_NUDGE_MESSAGE,
    ReflectionNudgeInput,
    ReflectionNudgeWorker,
    build_reflection_nudge_vars,
)
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, ModelTier

from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace

_NOW = datetime(2026, 8, 11, 9, 0, tzinfo=timezone.utc)
_TID = TraceId("t-u6-nudge")
_FEAT = LlmFeature.REFLECTION_NUDGE
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})


def _raw(message: str) -> str:
    return json.dumps({"message": message}, ensure_ascii=False)


def _apply(raw: str):
    return ReflectionNudgeGate().apply(raw, None, feature=_FEAT, trace_id=_TID, now=_NOW)


def _input(**overrides) -> ReflectionNudgeInput:
    base = dict(
        destination="제주",
        duration_days=3,
        persona_summary="자연·카페 선호, 느긋한 일정",
        highlight_places=("성산일출봉", "을지로 카페"),
    )
    base.update(overrides)
    return ReflectionNudgeInput(**base)


# ── 게이트: 정상 ─────────────────────────────────────────────


def test_gate_passes_valid_message_stripped() -> None:
    out = _apply(_raw("  제주에서의 사흘, 한 줄로 남겨볼까요? ✈️  "))
    assert out.error is None and out.drop_event is None
    assert out.value == "제주에서의 사흘, 한 줄로 남겨볼까요? ✈️"


# ── 게이트: 드롭 (①, INV-3) ─────────────────────────────────


@pytest.mark.parametrize(
    "message",
    [
        "",  # 빈 문자열
        "   ",  # 공백뿐
        "가" * (_MAX_LENGTH + 1),  # 길이 상한 초과
        "도착까지 30분이면 충분해요",  # 금지 토큰: 분
        "이동시간이 짧았던 여행이었죠",  # 금지 토큰: 시간
        "그 시각의 노을을 기록해보세요",  # 금지 토큰: 시각
        "Duration was short but sweet",  # 금지 토큰: duration (대소문자 무시)
    ],
)
def test_gate_drops_unsafe_message_with_event(message: str) -> None:
    out = _apply(_raw(message))
    assert out.value is None and out.error is None  # 드롭은 error가 아니다
    assert out.drop_event is not None
    assert out.drop_event.total_count == 1 and out.drop_event.dropped_count == 1
    assert out.drop_event.dropped_ids == ()  # 문구 드롭은 풀 ID가 아님
    assert out.drop_event.feature == "REFLECTION_NUDGE"


def test_gate_boundary_length_passes() -> None:
    out = _apply(_raw("가" * _MAX_LENGTH))
    assert out.error is None and out.value == "가" * _MAX_LENGTH


# ── 게이트: 파싱 실패·구조 위반 (②) ──────────────────────────


def test_gate_parse_failures() -> None:
    assert _apply("이건 JSON이 아니다").error.startswith("parse_error:")
    assert _apply(json.dumps({"text": "다른 키"})).error.startswith("parse_error:")
    assert _apply(json.dumps(["message"])).error.startswith("parse_error:")
    assert _apply(json.dumps({"message": 3})).error.startswith("parse_error:")
    assert _apply(json.dumps({"message": None})).error.startswith("parse_error:")


# ── PBT (①②⑤) ──────────────────────────────────────────────


@given(raw=st.one_of(st.text(max_size=120), st.just("{}"), st.just("[]")))
def test_pbt_gate_never_raises_and_survivors_inside_constraints(raw: str) -> None:
    """① 임의 응답에도 예외 없이 GateOutcome으로 수렴하고, 통과분은 항상 제약 안."""
    out = _apply(raw)
    if out.error is not None:
        assert not out.value  # error 있으면 value 비움 (base 불변식)
    elif out.value is not None:
        assert isinstance(out.value, str)
        assert 0 < len(out.value) <= _MAX_LENGTH
        assert not any(t in out.value.lower() for t in _FORBIDDEN_TOKENS)
    else:
        assert out.drop_event is not None  # 무결과는 반드시 드롭 계측


_safe_messages = st.text(max_size=_MAX_LENGTH).filter(
    lambda s: s.strip()
    and len(s.strip()) <= _MAX_LENGTH
    and not any(t in s.lower() for t in _FORBIDDEN_TOKENS)
)


@given(message=_safe_messages)
def test_pbt_gate_accepts_every_constraint_satisfying_message(message: str) -> None:
    out = _apply(_raw(message))
    assert out.error is None and out.value == message.strip()


# ── 프롬프트 (③) ────────────────────────────────────────────


def test_prompt_renders_deterministically() -> None:
    reg = PromptRegistry(_PROMPTS)
    p1, ref = reg.render(_FEAT, build_reflection_nudge_vars(_input()))
    p2, _ = reg.render(_FEAT, build_reflection_nudge_vars(_input()))
    assert p1 == p2  # 결정론
    assert ref.prompt_id == "prompts/reflection_nudge.yaml" and ref.version == "0.1.0"
    assert ref.feature == "REFLECTION_NUDGE"
    assert "제주" in p1 and "3일" in p1
    assert "성산일출봉 / 을지로 카페" in p1


def test_prompt_states_length_and_no_duration_rules() -> None:
    """1문장·60자 상한(게이트 상한과 동일 값)·시간 언급 금지(INV-3)·이모지 규칙 문구가 실린다."""
    prompt, _ = PromptRegistry(_PROMPTS).render(
        _FEAT, build_reflection_nudge_vars(_input())
    )
    assert "1문장" in prompt and f"{_MAX_LENGTH}자 이내" in prompt
    assert "소요시간·시각·이동시간을 언급하지 마세요" in prompt
    assert "단정 금지" in prompt and "지어내지 마세요" in prompt
    assert "이모지는 0~1개" in prompt


def test_build_vars_stringifies_everything_with_placeholders() -> None:
    variables = build_reflection_nudge_vars(
        _input(destination=" ", persona_summary="", highlight_places=())
    )
    assert all(isinstance(v, str) for v in variables.values())
    assert variables["destination"] == "이번 여행지"
    assert variables["persona_summary"] == "(요약 없음)"
    assert variables["highlight_places"] == "(정보 없음)"
    assert variables["duration_days"] == "3"


def test_input_validation() -> None:
    with pytest.raises(ValueError):
        _input(duration_days=0)
    with pytest.raises(ValueError):
        _input(highlight_places=("a", "b", "c"))  # 최대 2곳


# ── 워커 e2e (실물 레지스트리·게이트, ④) ────────────────────


def _worker(llm) -> ReflectionNudgeWorker:
    gateway = GatewayFacade(
        llm, PromptRegistry(_PROMPTS), ReflectionNudgeGate(), _CFG, InMemoryTrace()
    )
    return ReflectionNudgeWorker(gateway)


def test_worker_end_to_end_success() -> None:
    canned = _raw("제주에서의 사흘, 한 줄로 남겨볼까요? ✈️")
    result = _worker(FakeLlm(canned=canned)).nudge(_input(), _TID, _NOW)
    assert result.is_fallback is False
    assert result.value == "제주에서의 사흘, 한 줄로 남겨볼까요? ✈️"
    assert result.call_record is not None and result.call_record.success is True
    assert result.call_record.model_id == "m-l"  # LIGHT 티어 (TRIP-347)


def test_worker_falls_back_loudly_on_llm_failure() -> None:
    """④ INV-4 — 침묵 실패 없음: 폴백 표시 + 사유. 기본 문구 사용은 호출측 몫."""
    result = _worker(FailingLlm()).nudge(_input(), _TID, _NOW)
    assert result.is_fallback is True and result.value is None
    assert result.error and result.call_record is not None


def test_worker_falls_back_when_gate_drops_message() -> None:
    result = _worker(FakeLlm(canned=_raw("무려 40분이나 걸린 이동"))).nudge(
        _input(), _TID, _NOW
    )
    assert result.is_fallback is True and result.value is None
    assert "gate_dropped_all" in result.error


def test_fallback_message_satisfies_gate_constraints() -> None:
    """④ 마지막 계단의 자기 정합 — 기본 폴백 문구가 게이트 규칙을 스스로 만족한다."""
    out = _apply(_raw(FALLBACK_NUDGE_MESSAGE))
    assert out.error is None and out.value == FALLBACK_NUDGE_MESSAGE


@given(raw=st.one_of(st.text(max_size=120), st.just('{"message": ""}')))
@settings(max_examples=60, deadline=None)
def test_pbt_worker_converges_for_any_llm_text(raw: str) -> None:
    """⑤ 어떤 LLM 응답이 와도: 예외 없음 ∧ (제약 안 문구 or 폴백) — 알림은 항상 성립 (INV-4)."""
    result = _worker(FakeLlm(canned=raw)).nudge(_input(), _TID, _NOW)
    if result.is_fallback:
        assert result.value is None and result.error
        # 이 시점의 표시 문구는 FALLBACK_NUDGE_MESSAGE — 항상 게이트 규칙 안 (④가 고정)
    else:
        assert isinstance(result.value, str)
        assert 0 < len(result.value) <= _MAX_LENGTH
        assert not any(t in result.value.lower() for t in _FORBIDDEN_TOKENS)
