"""질문뱅크 검수 보조 — 의도 간 중복(≥ 0.90) 검사 + 문장별 최근접 타 의도 (intent-matching-design §3.3, TRIP-678).

검수 절차(ai/data/README.md)의 기계 검사 부분만 맡는다: "뱅크 편입 시 타 의도 엔트리와 유사도
≥ 0.90 중복 검사 통과 필수". 사람 판단(경계 문장 제거)의 재료로 문장별 최근접 타 의도 문장과
점수도 같이 낸다 — 0.80~0.90 대역이 경계 후보다. 실 LLM 호출 0, 임베딩(local KURE)만 쓴다.

실행:
    cd ai && uv run python scripts/check_intent_bank.py            # 요약 + 위반·경계 후보
    cd ai && uv run python scripts/check_intent_bank.py --all      # 문장 전부의 최근접 타 의도

종료 코드: 위반(≥ 0.90) 있으면 1.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

_AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_AI_ROOT / "scripts"))

from local_embedding import build_local_embedding  # noqa: E402 — 라우터와 같은 임베딩 규칙
from trippilot.orchestrator.question_bank import load_bank_file  # noqa: E402

_BANK = _AI_ROOT / "data" / "intent_question_bank.yaml"
_DUP = 0.90  # §3.3 위반선
_WARN = 0.80  # 경계 후보선 — 실측(TRIP-657)에서 범위 밖 발화가 0.783 으로 걸렸다


def _cosine(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    p.add_argument("--all", action="store_true", help="문장 전부의 최근접 타 의도를 출력")
    args = p.parse_args()

    entries = load_bank_file(_BANK, yaml.safe_load)
    vectors = build_local_embedding().embed_batch([e.question for e in entries])
    nearest = []  # (score, i, j) — i 의 최근접 타 의도 문장 j
    for i, ei in enumerate(entries):
        best = (-1.0, -1)
        for j, ej in enumerate(entries):
            if ei.intent is ej.intent:
                continue
            s = _cosine(vectors[i], vectors[j])
            if s > best[0]:
                best = (s, j)
        nearest.append((best[0], i, best[1]))

    violations = [t for t in nearest if t[0] >= _DUP]
    warnings = [t for t in nearest if _WARN <= t[0] < _DUP]
    print(f"뱅크 {len(entries)}문장 · 의도 간 ≥{_DUP} 위반 {len(violations)}건 · "
          f"{_WARN}~{_DUP} 경계 후보 {len(warnings)}건")
    rows = nearest if args.all else violations + warnings
    for s, i, j in sorted(rows, key=lambda t: -t[0]):
        tag = "위반" if s >= _DUP else ("경계" if s >= _WARN else "    ")
        print(f"{tag} {s:.3f}  [{entries[i].intent.value}] {entries[i].question!r}"
              f"  ~  [{entries[j].intent.value}] {entries[j].question!r}")
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
