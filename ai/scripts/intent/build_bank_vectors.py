"""질문뱅크 벡터를 미리 계산해 `data/intent_question_bank.vectors.json.gz` 로 저장한다 (TRIP-1410).

AI 는 기동 때 이 파일을 읽어 질문뱅크를 색인한다 — 원격 임베딩을 안 부른다. 없거나 뱅크·모델이 다르면 종전처럼
원격 색인으로 기동한다(틀린 벡터는 싣지 않는다). 그래서 **질문뱅크를 고친 뒤에는 이 스크립트를 다시 돌린다** —
잊어도 고장은 아니고, 기동마다 임베딩을 수 분 독점하던 원래 비용이 돌아올 뿐이다.

모델은 배포 임베딩 서비스와 같은 KURE-v1(로컬 sentence-transformers). 서비스는 같은 가중치의 ONNX 판이라 벡터
차이는 반정밀도 저장 오차(코사인 1e-4)보다 작다.

실행:
    cd ai && uv run python scripts/intent/build_bank_vectors.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

_AI_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI_ROOT / "scripts"))

from local_embedding import build_local_embedding  # noqa: E402 — 라우터와 같은 임베딩 규칙
from trippilot.orchestrator.question_bank import (  # noqa: E402
    dump_bank_vectors,
    load_bank_file,
)

_BANK = _AI_ROOT / "data" / "intent_question_bank.yaml"
_OUT = _BANK.with_name("intent_question_bank.vectors.json.gz")


def main() -> int:
    entries = load_bank_file(_BANK, yaml.safe_load)
    embedding = build_local_embedding()
    vectors = embedding.embed_batch([e.question for e in entries])
    dump_bank_vectors(_OUT, entries, embedding.model_id, embedding.dim, vectors)
    print(f"{len(entries)}문장 → {_OUT.relative_to(_AI_ROOT)} ({_OUT.stat().st_size // 1024}KB, {embedding.model_id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
