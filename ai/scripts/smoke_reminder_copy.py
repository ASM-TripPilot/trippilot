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


class ServedModelMismatch(RuntimeError):
    """서버가 요청할 모델을 그 이름으로 서빙하고 있지 않다."""


_LOCAL_PREFIX = "local"


def assert_served_model(client, model_id: str) -> None:
    """답을 받기 전에 **누가 답할 것인지** 확인한다.

    병합이 안 된 베이스 모델이 서빙돼도 그럴듯한 답이 나오므로 결과만 보고는 모른다
    (런북 §4 배포 후 대조 검증). 이름 단계에서 먼저 막는다.

    - 배정 이름이 `local` 로 시작하지 않으면 앱은 로컬 라우트를 아예 안 만든다
      (`main.py::_local_route`) — 예외 없이 외부 벤더로 나가므로 여기서 끊는다.
    - 목록 조회 실패를 "해당 없음"으로 읽지 않는다. 도구가 거부한 결과를 부재로
      읽는 것은 이 리포가 안티패턴으로 적어 둔 사고다.
    """
    if not model_id.startswith(_LOCAL_PREFIX):
        raise ServedModelMismatch(
            f"모델명 {model_id!r} 이 {_LOCAL_PREFIX!r} 로 시작하지 않는다 — "
            "앱이 로컬 라우트를 안 켜고 외부 벤더로 나간다(main.py::_local_route)."
        )
    try:
        served = [model.id for model in client.models.list().data]
    except Exception as e:
        raise ServedModelMismatch(
            f"서빙 중인 모델을 확인할 수 없다({type(e).__name__}: {e}) — "
            "조회 실패를 '해당 없음'으로 읽지 않는다."
        ) from e
    if model_id not in served:
        raise ServedModelMismatch(
            f"서버가 {model_id!r} 를 서빙하지 않는다. 서빙 중: {served!r}. "
            "vLLM `--served-model-name`(또는 Triton 모델 디렉토리명)과 "
            "`AI_LLM_FEATURE_MODELS` 배정값이 전부 같아야 한다."
        )


def main() -> int:
    base_url = os.environ.get("TRIPPILOT_LOCAL_LLM_BASE_URL")
    model_id = os.environ.get("TRIPPILOT_LOCAL_LLM_MODEL")
    if not base_url or not model_id:
        print("TRIPPILOT_LOCAL_LLM_BASE_URL·TRIPPILOT_LOCAL_LLM_MODEL 필요", file=sys.stderr)
        return 2

    import openai

    from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter

    client = openai.OpenAI(
        api_key=os.environ.get("TRIPPILOT_LOCAL_LLM_API_KEY") or "local",
        base_url=base_url,
        max_retries=0,
    )
    try:
        assert_served_model(client, model_id)
    except ServedModelMismatch as e:
        # 여기서 막지 않으면 A/B 의 한쪽이 다른 모델 성적이 된다.
        print(f"[smoke] FAIL {e}", file=sys.stderr)
        return 2
    adapter = OpenAIAdapter(client, api="chat")

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
