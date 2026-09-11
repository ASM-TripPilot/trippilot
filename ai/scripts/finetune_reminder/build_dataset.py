"""리마인드 문구 학습 데이터 생성 — 교사 호출 → 결정론 필터 → JSONL.

**CI 밖 수동 실행**이다. 교사는 오픈 웨이트 모델만 쓴다(Qwen3-235B, Apache-2.0):
Anthropic·OpenAI 이용약관은 그 출력물로 **어떤 모델이든** 사전 승인 없이 학습하는
것을 금지한다 — 경쟁 여부와 무관하다. 심판 LLM 은 완성품 평가에만 쓰고 **데이터
선별에는 쓰지 않는다**(선별에 개입하면 그 출력이 학습에 흘러든다).

필터는 서빙 게이트를 그대로 부른다 — 규칙 이중 구현 금지.

사용:
    export OPENROUTER_API_KEY=...
    python build_dataset.py --scenarios scenarios.json --out dataset.jsonl --per-scenario 3
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from trippilot.domain.common import TraceId  # noqa: E402
from trippilot.domain.llm import LlmFeature  # noqa: E402
from trippilot.llm_gateway.gates.reminder_copy import (  # noqa: E402
    ReminderCopyContext,
    ReminderCopyGate,
)
from trippilot.llm_gateway.prompts import PromptRegistry  # noqa: E402

TEACHER_MODEL = "qwen/qwen3-235b-a22b-instruct"  # 오픈 웨이트(Apache-2.0)
OPENROUTER_URL = "https://openrouter.ai/api/v1"
_NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def filter_samples(raw: Iterable[dict]) -> tuple[list[dict], dict[str, int]]:
    """게이트를 통과한 샘플만 남긴다. 반환: (통과분, {"kept": n, "dropped": n})."""
    gate = ReminderCopyGate()
    kept: list[dict] = []
    dropped = 0
    for sample in raw:
        payload = json.dumps(
            {
                "title": sample.get("title", ""),
                "body": sample.get("body", ""),
                "places": sample.get("places", []),
            },
            ensure_ascii=False,
        )
        ctx = ReminderCopyContext(
            allowed=tuple(sample.get("slot_names", ())),
            forbidden=tuple(sample.get("other_names", ())),
        )
        outcome = gate.apply(
            payload,
            ctx,
            feature=LlmFeature.REMINDER_COPY,
            trace_id=TraceId("finetune"),
            now=_NOW,
        )
        if outcome.value is None:
            dropped += 1
            continue
        kept.append(sample)
    return kept, {"kept": len(kept), "dropped": dropped}


def _call_teacher(client, prompt: str, temperature: float) -> str:
    response = client.chat.completions.create(
        model=TEACHER_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        max_tokens=300,
    )
    return response.choices[0].message.content or ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenarios", required=True, help="시나리오 JSON (일정 샘플 목록)")
    parser.add_argument("--out", required=True, help="출력 JSONL")
    parser.add_argument("--per-scenario", type=int, default=3, help="시나리오당 생성 수")
    parser.add_argument("--temperature", type=float, default=1.0, help="다양성 확보용 — 높게")
    args = parser.parse_args()

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("OPENROUTER_API_KEY 미설정", file=sys.stderr)
        return 2

    import openai

    from trippilot.llm_gateway.workers.reminder_copy import (
        ReminderCopyItem,
        build_reminder_copy_vars,
    )

    client = openai.OpenAI(api_key=api_key, base_url=OPENROUTER_URL)
    prompts_dir = Path(__file__).resolve().parents[2] / "prompts"
    registry = PromptRegistry(prompts_dir)
    scenarios = json.loads(Path(args.scenarios).read_text(encoding="utf-8"))

    total_attempts = 0
    call_failed = 0
    gate_dropped = 0
    duplicate_dropped = 0
    written = 0
    seen: set[tuple[str, str]] = set()

    with Path(args.out).open("w", encoding="utf-8") as f:
        for scenario in scenarios:
            item = ReminderCopyItem(
                schedule_key=scenario["schedule_key"],
                kind=scenario["kind"],
                date_label=scenario["date"],
                slot_names=tuple(scenario["slot_names"]),
                slot_categories=tuple(scenario.get("slot_categories", ())),
            )
            vars_dict = build_reminder_copy_vars(item, scenario.get("trip_title", ""))
            prompt, _ref = registry.render(LlmFeature.REMINDER_COPY, vars_dict)

            for _ in range(args.per_scenario):
                total_attempts += 1
                try:
                    response_text = _call_teacher(client, prompt, args.temperature)
                    parsed = json.loads(response_text)
                except (ValueError, KeyError, json.JSONDecodeError) as e:
                    call_failed += 1
                    print(f"skip: {e}", file=sys.stderr)
                    continue
                except Exception as e:
                    # 네트워크 오류 등 API 호출 실패 — 이 샘플을 스킵하고 계속
                    call_failed += 1
                    print(f"skip call: {type(e).__name__}: {e}", file=sys.stderr)
                    continue

                sample = {
                    "prompt": prompt,
                    "slot_names": list(scenario["slot_names"]),
                    "other_names": list(scenario.get("other_names", [])),
                    "title": parsed.get("title", ""),
                    "body": parsed.get("body", ""),
                    "places": parsed.get("places", []),
                }

                # 게이트로 필터링
                kept, stats = filter_samples([sample])
                if not kept:
                    gate_dropped += 1
                    continue

                # 중복 제거 후 저장
                key = (sample["title"], sample["body"])
                if key in seen:
                    duplicate_dropped += 1
                    continue
                seen.add(key)

                record = {
                    "messages": [
                        {"role": "user", "content": prompt},
                        {
                            "role": "assistant",
                            "content": json.dumps(
                                {
                                    "title": sample["title"],
                                    "body": sample["body"],
                                    "places": sample["places"],
                                },
                                ensure_ascii=False,
                            ),
                        },
                    ]
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
                written += 1

    print(
        f"시도 {total_attempts} · 호출실패 {call_failed} · 게이트탈락 {gate_dropped} · "
        f"중복탈락 {duplicate_dropped} · 저장 {written}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
