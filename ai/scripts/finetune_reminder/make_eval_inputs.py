"""평가 입력 3종(student·teacher·baseline)을 **행을 맞춰서** 만든다.

`evaluate.py` 는 세 파일의 n번째 줄을 같은 시나리오의 세 후보로 보고 채점한다.
그래서 한 줄이라도 어긋나면 심판이 엉뚱한 짝을 비교하고, 그 결과는 틀렸다는
티도 안 난다 — 숫자는 나오는데 의미가 없다.

런북의 복붙 절차는 교사·학생 호출이 스킵될 때 사람이 세 파일에서 그 시나리오를
빼 맞추라고 한다. 그 손작업을 없앤다: **셋이 모두 성공한 시나리오만** 내보낸다.

사용:
    export OPENROUTER_API_KEY=...            # 교사
    export TRIPPILOT_LOCAL_LLM_BASE_URL=...  # 학생(서빙 중이어야 한다)
    export TRIPPILOT_LOCAL_LLM_MODEL=local-reminder-qwen3-4b-v1
    uv run python scripts/finetune_reminder/make_eval_inputs.py \
        --scenarios scenarios_eval.json --out-dir eval/
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_dataset import OPENROUTER_URL, TEACHER_MODEL, _call_teacher  # noqa: E402
from trippilot.domain.common import TraceId  # noqa: E402
from trippilot.domain.llm import LlmFeature  # noqa: E402
from trippilot.llm_gateway.gates.reminder_copy import (  # noqa: E402
    ReminderCopyContext,
    ReminderCopyGate,
)
from trippilot.llm_gateway.prompts import PromptRegistry  # noqa: E402
from trippilot.llm_gateway.workers.reminder_copy import (  # noqa: E402
    ReminderCopyItem,
    build_reminder_copy_vars,
)

# 지금 발화 중인 하드코딩 상수 — 백엔드 NotificationSchedule.body() 와 같은 문자열.
# 개인화가 없는 것이 이 비교의 요점이다(학생이 이것보다 나은가).
BASELINE = {
    "TRIP_DAY": "오늘 어디를 가는지 확인해 보세요.",
    "TRIP_PRE": "출발 전에 일정을 한 번 확인해 보세요.",
}


def _item(scenario: dict) -> ReminderCopyItem:
    return ReminderCopyItem(
        schedule_key=scenario["schedule_key"],
        kind=scenario["kind"],
        date_label=scenario["date"],
        slot_names=tuple(scenario["slot_names"]),
        slot_categories=tuple(scenario.get("slot_categories", ())),
    )


def _gate_body(raw: str, scenario: dict) -> str | None:
    """게이트를 통과한 본문만 평가에 올린다 — 서빙에서 사용자에게 갈 것과 같은 기준."""
    outcome = ReminderCopyGate().apply(
        raw,
        ReminderCopyContext(
            allowed=tuple(scenario["slot_names"]),
            forbidden=tuple(scenario.get("other_names", ())),
        ),
        feature=LlmFeature.REMINDER_COPY,
        trace_id=TraceId("eval"),
        now=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
    )
    return outcome.value.body if outcome.value is not None else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenarios", required=True)
    parser.add_argument("--out-dir", default="eval")
    parser.add_argument("--limit", type=int, default=0, help="시나리오 상한(0=전부)")
    args = parser.parse_args()

    teacher_key = os.environ.get("OPENROUTER_API_KEY")
    student_url = os.environ.get("TRIPPILOT_LOCAL_LLM_BASE_URL")
    student_model = os.environ.get("TRIPPILOT_LOCAL_LLM_MODEL")
    missing = [
        n
        for n, v in [
            ("OPENROUTER_API_KEY", teacher_key),
            ("TRIPPILOT_LOCAL_LLM_BASE_URL", student_url),
            ("TRIPPILOT_LOCAL_LLM_MODEL", student_model),
        ]
        if not v
    ]
    if missing:
        print(f"환경변수 미설정: {', '.join(missing)}", file=sys.stderr)
        print("학생 모델이 서빙 중이어야 한다(런북 §4).", file=sys.stderr)
        return 2

    import openai

    teacher = openai.OpenAI(api_key=teacher_key, base_url=OPENROUTER_URL)
    student = openai.OpenAI(api_key="local", base_url=student_url)
    registry = PromptRegistry(Path(__file__).resolve().parents[2] / "prompts")

    scenarios = json.loads(Path(args.scenarios).read_text(encoding="utf-8"))
    if args.limit:
        scenarios = scenarios[: args.limit]

    rows: list[tuple[dict, str, str, str]] = []
    skipped = 0
    for scenario in scenarios:
        prompt, _ref = registry.render(
            LlmFeature.REMINDER_COPY,
            build_reminder_copy_vars(_item(scenario), scenario.get("trip_title", "")),
        )
        try:
            t_body = _gate_body(_call_teacher(teacher, prompt, 1.0), scenario)
            s_raw = student.chat.completions.create(
                model=student_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=300,
            )
            s_body = _gate_body(s_raw.choices[0].message.content or "", scenario)
        except Exception as e:  # 한 시나리오 실패가 전체를 버리지 않게
            print(f"skip: {type(e).__name__}: {e}", file=sys.stderr)
            skipped += 1
            continue
        if not t_body or not s_body:
            skipped += 1  # 셋이 다 있어야 같은 줄에 설 수 있다
            continue
        rows.append((scenario, s_body, t_body, BASELINE[scenario["kind"]]))

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, index in (("student", 1), ("teacher", 2), ("baseline", 3)):
        with (out / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(
                    json.dumps(
                        {"body": row[index], "slot_names": row[0]["slot_names"]},
                        ensure_ascii=False,
                    )
                    + "\n"
                )
    print(
        f"시나리오 {len(scenarios)} · 정렬된 비교쌍 {len(rows)} · 스킵 {skipped} → {out}/"
    )
    print("다음: uv run python scripts/finetune_reminder/evaluate.py "
          f"--student {out}/student.jsonl --teacher {out}/teacher.jsonl --baseline {out}/baseline.jsonl")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
