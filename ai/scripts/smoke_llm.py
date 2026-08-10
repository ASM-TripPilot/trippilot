"""실모델 LLM 스모크 — 어댑터 실 호출 1건 수동 도구 (TRIP-340, K-2).

INTENT 프롬프트 렌더(PromptRegistry) → 어댑터 실 호출 → IntentGate 파싱까지의
한 사이클을 실모델로 확인한다. **pytest 대상이 아니다** — CI 실 호출 0건(D37)은
그대로 유지되고, 이 스크립트는 사람이 손으로만 실행한다.

사용법:
    cd ai

    # OpenAI 호환 (멘토 제공 GPT-5.6 — 개발·검증용, AI-D06 부기)
    LLM_PROVIDER=openai \
    OPENAI_API_KEY=... \
    OPENAI_BASE_URL=https://... \
    OPENAI_MODEL=gpt-5.6 \
    uv run python scripts/smoke_llm.py

    # Anthropic (프로덕션 기본 — 결제 승인 후 K-1)
    LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... \
    uv run python scripts/smoke_llm.py

환경변수:
    LLM_PROVIDER       openai | anthropic (기본 openai)
    OPENAI_API_KEY     openai 제공자 필수
    OPENAI_BASE_URL    선택 — OpenAI 호환 게이트웨이 엔드포인트 (미설정 시 표준 api.openai.com)
    OPENAI_MODEL       기본 "gpt-5.6"
    ANTHROPIC_API_KEY  anthropic 제공자 필수
    ANTHROPIC_MODEL    기본 "claude-haiku-4-5"
    SMOKE_UTTERANCE    기본 "내일 오후에 비 오면 실내 일정으로 바꿔줘"
    SMOKE_TIMEOUT_SEC  기본 "30" (운영 2.5s와 달리 스모크는 관대하게)
    SMOKE_MAX_TOKENS   기본 "2048" (GPT-5 계열은 reasoning 토큰도 여기서 소모)
    SMOKE_TEMPERATURE  기본 "1.0" (GPT-5 계열은 기본값 외 temperature를 거부)

종료 코드: 0 = 호출·게이트 파싱까지 성공, 1 = 어느 단계든 실패 (원인 출력).
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from trippilot.c1.gates.intent import IntentGate
from trippilot.c1.prompts import PromptRegistry
from trippilot.domain.common import TraceId
from trippilot.domain.intent import ROUTABLE_INTENTS
from trippilot.domain.llm import LlmFeature
from trippilot.ports.llm_port import LlmPort, LlmRequest, LlmTimeoutError

_PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"환경변수 {name} 필요 (사용법: 스크립트 docstring)")
    return value


def _build_adapter() -> tuple[LlmPort, str]:
    """제공자 선택 + 어댑터 조립. 반환: (어댑터, model_id)."""
    provider = os.environ.get("LLM_PROVIDER", "openai")
    if provider == "openai":
        import openai

        from trippilot.c1.adapters.openai_adapter import OpenAIAdapter

        client = openai.OpenAI(
            api_key=_require("OPENAI_API_KEY"),
            base_url=os.environ.get("OPENAI_BASE_URL"),  # None → 표준 엔드포인트
        )
        return OpenAIAdapter(client), os.environ.get("OPENAI_MODEL", "gpt-5.6")
    if provider == "anthropic":
        import anthropic

        from trippilot.c1.adapters.anthropic_adapter import AnthropicAdapter

        client = anthropic.Anthropic(api_key=_require("ANTHROPIC_API_KEY"))
        return AnthropicAdapter(client), os.environ.get(
            "ANTHROPIC_MODEL", "claude-haiku-4-5"
        )
    raise SystemExit(f"LLM_PROVIDER는 openai|anthropic 중 하나: {provider!r}")


def main() -> int:
    adapter, model_id = _build_adapter()
    utterance = os.environ.get("SMOKE_UTTERANCE", "내일 오후에 비 오면 실내 일정으로 바꿔줘")

    # 1) 렌더 — 운영 경로(intent_router._classify)와 같은 변수 구성
    registry = PromptRegistry(_PROMPTS_DIR)
    prompt, ref = registry.render(
        LlmFeature.INTENT,
        {
            "utterance": utterance,
            "intents": ", ".join(sorted(i.value for i in ROUTABLE_INTENTS)),
        },
    )
    print(f"[smoke] provider={os.environ.get('LLM_PROVIDER', 'openai')} model={model_id}")
    print(f"[smoke] prompt={ref.prompt_id}@{ref.version} utterance={utterance!r}")

    # 2) 실 호출 1건
    request = LlmRequest(
        model_id=model_id,
        prompt=prompt,
        prompt_ref=ref,
        max_tokens=int(os.environ.get("SMOKE_MAX_TOKENS", "2048")),
        temperature=float(os.environ.get("SMOKE_TEMPERATURE", "1.0")),
        timeout_sec=float(os.environ.get("SMOKE_TIMEOUT_SEC", "30")),
    )
    try:
        response = adapter.invoke(request)
    except LlmTimeoutError as e:
        print(f"[smoke] FAIL 타임아웃: {e}")
        return 1
    except Exception as e:  # 벤더 예외는 계약상 그대로 새어 나온다 — 여기서 보고
        print(f"[smoke] FAIL 벤더 예외: {type(e).__name__}: {e}")
        return 1
    print(
        f"[smoke] ok latency={response.latency_ms}ms "
        f"tokens(in/out)={response.input_tokens}/{response.output_tokens} "
        f"model={response.model_id}"
    )
    print(f"[smoke] raw_text={response.raw_text!r}")

    # 3) 게이트 파싱 — closed-set 강제까지 통과해야 성공
    outcome = IntentGate().apply(
        response.raw_text,
        None,
        feature=LlmFeature.INTENT,
        trace_id=TraceId("smoke-llm"),
        now=datetime.now(UTC),
    )
    if outcome.error is not None:
        print(f"[smoke] FAIL 게이트 드롭: {outcome.error}")
        return 1
    draft = outcome.value
    print(
        f"[smoke] PASS intent={draft.intent.value} "
        f"slots={draft.slots} confidence={draft.confidence}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
