"""리마인드 문구 실스택 스모크 — 로컬 서빙 모델 1회 호출 + 게이트 통과 확인.

CI 밖 수동 실행. smoke_llm.py(INTENT 전용)와 같은 형이고, 다른 것은 셋뿐이다:
어댑터가 로컬 OpenAI 호환 서버를 보고, 프롬프트가 REMINDER_COPY 이고, 게이트가
장소 대조 컨텍스트를 받는다.

사용:
    export TRIPPILOT_LOCAL_LLM_BASE_URL=http://127.0.0.1:8080/v1
    export TRIPPILOT_LOCAL_LLM_MODEL=local-reminder-qwen3-4b-v1
    python scripts/smoke_reminder_copy.py
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.gates.reminder_copy import ReminderCopyContext, ReminderCopyGate
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.reminder_copy import (
    ReminderCopyItem,
    build_reminder_copy_vars,
)
from trippilot.ports.llm_port import LlmRequest

_PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"
_SLOTS = ("성산일출봉", "우도")


def main() -> int:
    base_url = os.environ.get("TRIPPILOT_LOCAL_LLM_BASE_URL")
    model_id = os.environ.get("TRIPPILOT_LOCAL_LLM_MODEL")
    if not base_url or not model_id:
        print("TRIPPILOT_LOCAL_LLM_BASE_URL·TRIPPILOT_LOCAL_LLM_MODEL 필요", file=sys.stderr)
        return 2

    import openai

    from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter

    adapter = OpenAIAdapter(
        openai.OpenAI(
            api_key=os.environ.get("TRIPPILOT_LOCAL_LLM_API_KEY") or "local",
            base_url=base_url,
            max_retries=0,
        ),
        api="chat",
    )

    item = ReminderCopyItem(
        schedule_key="smoke", kind="TRIP_DAY", date_label="2026-09-13", slot_names=_SLOTS
    )
    prompt, ref = PromptRegistry(_PROMPTS_DIR).render(
        LlmFeature.REMINDER_COPY, build_reminder_copy_vars(item, "제주 3일")
    )
    print(f"[smoke] model={model_id} prompt={ref.prompt_id}@{ref.version}")

    try:
        response = adapter.invoke(
            LlmRequest(
                model_id=model_id,
                prompt=prompt,
                prompt_ref=ref,
                max_tokens=300,
                timeout_sec=float(os.environ.get("SMOKE_TIMEOUT_SEC", "60")),
            )
        )
    except Exception as e:  # 벤더 예외는 그대로 새어 나온다 — 여기서 보고
        print(f"[smoke] FAIL {type(e).__name__}: {e}")
        return 1

    print(f"[smoke] latency={response.latency_ms}ms raw={response.raw_text!r}")
    outcome = ReminderCopyGate().apply(
        response.raw_text,
        ReminderCopyContext(allowed=_SLOTS, forbidden=("한라산",)),
        feature=LlmFeature.REMINDER_COPY,
        trace_id=TraceId("smoke-reminder"),
        now=datetime.now(UTC),
    )
    if outcome.value is None:
        print(f"[smoke] FAIL 게이트 드롭: {outcome.error}")
        return 1
    print(f"[smoke] PASS title={outcome.value.title!r} body={outcome.value.body!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
