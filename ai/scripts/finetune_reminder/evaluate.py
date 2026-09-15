"""완성품 평가 — 학생 vs 교사 vs 기존 상수 블라인드 비교 (심판 Sonnet).

**CI 밖 수동 실행, 평가 전용이다.** 이 점수는 학습 데이터 선별에도, 재학습 루프에도
들어가지 않는다(약관 — 심판 출력의 학습 유입 0, `build_dataset.py` 모듈 docstring과
같은 근거). 산출은 발표 자료용 표 하나다.

세 입력 파일은 **같은 홀드아웃 시나리오 집합을 같은 순서로** 담아야 한다(줄 단위로
zip 해서 짝짓는다) — 만드는 방법은 `README.md` §5 참고. 한 줄 스키마:

    {"body": "...", "slot_names": ["성산일출봉", "우도"]}

`slot_names` 는 프롬프트 표시용이라 없어도 채점은 되지만(빈 배열로 대체), 사람이
결과를 눈검수할 때 어느 일정인지 알 길이 없어진다.

사용:
    export ANTHROPIC_API_KEY=...
    uv run python scripts/finetune_reminder/evaluate.py \\
        --student student.jsonl --teacher teacher.jsonl --baseline baseline.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

JUDGE_MODEL = "claude-sonnet-5"
RUBRIC = """다음은 여행 알림 문구 후보 3개다. 같은 일정에 대한 것이다.
자연스러움·구체성·알림으로서의 유용성만 보고 가장 좋은 것 하나를 고르라.
이유는 쓰지 말고 A, B, C 중 한 글자만 출력하라.

일정: {slots}
A: {a}
B: {b}
C: {c}"""


def _load(path: str) -> list[dict]:
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as e:
        print(f"입력 파일을 읽을 수 없다: {path} ({e})", file=sys.stderr)
        raise SystemExit(2) from e
    rows = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as e:
            print(f"{path}:{lineno} JSON 파싱 실패 — {e}", file=sys.stderr)
            raise SystemExit(2) from e
        if not isinstance(row, dict) or not isinstance(row.get("body"), str) or not row["body"]:
            print(f"{path}:{lineno} \"body\" 문자열 필드가 없다 — {row!r}", file=sys.stderr)
            raise SystemExit(2)
        rows.append(row)
    if not rows:
        print(f"{path} 에 유효한 줄이 없다", file=sys.stderr)
        raise SystemExit(2)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--student", required=True, help="학생(파인튜닝) 모델 출력 JSONL")
    parser.add_argument("--teacher", required=True, help="교사 모델 출력 JSONL")
    parser.add_argument("--baseline", required=True, help="기존 하드코딩 상수 JSONL")
    parser.add_argument("--seed", type=int, default=42, help="위치 편향 제거용 셔플 시드")
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY 미설정", file=sys.stderr)
        return 2

    student_rows = _load(args.student)
    teacher_rows = _load(args.teacher)
    baseline_rows = _load(args.baseline)
    lengths = {len(student_rows), len(teacher_rows), len(baseline_rows)}
    if len(lengths) != 1:
        print(
            "student/teacher/baseline 줄 수가 다르다 — 같은 홀드아웃 시나리오를 같은 "
            f"순서로 맞춰야 짝이 맞는다 (student={len(student_rows)} "
            f"teacher={len(teacher_rows)} baseline={len(baseline_rows)})",
            file=sys.stderr,
        )
        return 2

    import anthropic

    client = anthropic.Anthropic()
    rng = random.Random(args.seed)
    rows = list(zip(student_rows, teacher_rows, baseline_rows))
    wins = {"student": 0, "teacher": 0, "baseline": 0}

    for i, (student, teacher, baseline) in enumerate(rows):
        labeled = [("student", student), ("teacher", teacher), ("baseline", baseline)]
        rng.shuffle(labeled)  # 위치 편향 제거
        prompt = RUBRIC.format(
            slots=" / ".join(student.get("slot_names", [])),
            a=labeled[0][1]["body"],
            b=labeled[1][1]["body"],
            c=labeled[2][1]["body"],
        )
        try:
            message = client.messages.create(
                model=JUDGE_MODEL,
                max_tokens=4,
                messages=[{"role": "user", "content": prompt}],
            )
        except anthropic.APIError as e:
            print(f"{i}번째 판정 호출 실패 — {type(e).__name__}: {e}", file=sys.stderr)
            return 3
        choice = (message.content[0].text or "").strip().upper()[:1]
        index = {"A": 0, "B": 1, "C": 2}.get(choice)
        if index is None:
            continue
        wins[labeled[index][0]] += 1

    total = sum(wins.values()) or 1
    print(f"표본 {len(rows)}건 · 유효 판정 {total}건")
    for name, count in sorted(wins.items(), key=lambda kv: -kv[1]):
        print(f"  {name:9s} {count:4d}건 ({count / total:.1%})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
