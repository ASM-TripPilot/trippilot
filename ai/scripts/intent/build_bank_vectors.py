"""질문뱅크 벡터를 미리 계산해 `data/intent_question_bank.vectors.json.gz` 로 저장한다 (TRIP-1410).

AI 는 기동 때 이 파일을 읽어 질문뱅크를 색인한다 — 원격 임베딩을 안 부른다. 없거나 뱅크·모델이 다르면 종전처럼
원격 색인으로 기동한다(틀린 벡터는 싣지 않는다). 그래서 **질문뱅크를 고친 뒤에는 이 스크립트를 다시 돌린다** —
잊으면 `test_committed_vectors_match_current_bank` 가 빨개진다.

벡터 공간은 **배포 임베딩 서비스와 같은 경로**로 만든다(`ai/embedding/app.py` sentence-transformers 백엔드 —
DEV 가 이것이다): KURE-v1 가중치를 fp16 으로 반올림한 뒤 fp32 로 연산, normalize. 끝에 BR-MLO-05 게이트
(문장별 코사인 ≥ 0.9999 · 질의별 top-4 동일)를 원본 fp32 가중치 경로와 대조해 확인하고 결과를 파일 머리에 남긴다.

실행:
    cd ai && uv run python scripts/intent/build_bank_vectors.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

_AI_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI_ROOT / "scripts" / "measure"))

from embedding_ab_gate import COSINE_FLOOR, TOP_K  # noqa: E402 — 게이트 상수 한 벌
from trippilot.orchestrator.question_bank import dump_bank_vectors, load_bank_file  # noqa: E402

_BANK = _AI_ROOT / "data" / "intent_question_bank.yaml"
_OUT = _BANK.with_name("intent_question_bank.vectors.json.gz")
_MODEL = "nlpai-lab/KURE-v1"
_GATE_QUERIES = ("내일 부산 날씨 어때?", "거리 얼마나 돼?", "오늘 일정 보여줘", "둘째 날 카페 다른 데로 바꿔줘",
                 "여기서 숙소까지 얼마나 걸려?", "비 오면 갈 만한 데 추천해줘", "일정 다시 짜줘", "오늘 저녁 뭐 먹지",
                 "이 식당 몇 시까지 해?", "회고 써줘")


def _hf_revision(model: str) -> str:
    """로컬 HF 캐시가 가리키는 스냅샷 커밋 — 실제로 쓴 가중치의 리비전(BR-MLO 모델 동일성 근거)."""
    from huggingface_hub.constants import HF_HUB_CACHE

    ref = Path(HF_HUB_CACHE) / f"models--{model.replace('/', '--')}" / "refs" / "main"
    return ref.read_text().strip() if ref.exists() else "unknown"


def _cos(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / ((sum(x * x for x in a) ** 0.5) * (sum(y * y for y in b) ** 0.5))


def main() -> int:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise SystemExit("sentence-transformers 미설치 — `uv pip install sentence-transformers`")

    entries = load_bank_file(_BANK, yaml.safe_load)
    questions = [e.question for e in entries]

    serving = SentenceTransformer(_MODEL, device="cpu")
    serving[0].auto_model.half().float()  # 서빙 이미지: 구운 fp16 가중치 → fp32 연산(ai/embedding/app.py)
    vectors = serving.encode(questions, normalize_embeddings=True, show_progress_bar=False)

    # BR-MLO-05 — 다른 엔진(원본 fp32 가중치) 벡터와 같은 공간인가
    reference = SentenceTransformer(_MODEL, device="cpu")
    ref = reference.encode(questions, normalize_embeddings=True, show_progress_bar=False)
    min_cos = min(_cos(a, b) for a, b in zip(vectors, ref))
    qv = serving.encode(list(_GATE_QUERIES), normalize_embeddings=True, show_progress_bar=False)
    rank_diff = sum(
        sorted(range(len(entries)), key=lambda i: -_cos(q, vectors[i]))[:TOP_K]
        != sorted(range(len(entries)), key=lambda i: -_cos(q, ref[i]))[:TOP_K]
        for q in qv
    )
    if min_cos < COSINE_FLOOR or rank_diff:
        raise SystemExit(f"BR-MLO-05 미달 — 코사인 최소 {min_cos:.6f}, top-{TOP_K} 불일치 {rank_diff}")

    dump_bank_vectors(_OUT, entries, _MODEL, len(vectors[0]), vectors, provenance={
        "engine": "sentence-transformers fp16 가중치 → fp32 연산, normalize (ai/embedding/app.py 기본 백엔드)",
        "model_revision": _hf_revision(_MODEL),
        "gate": f"BR-MLO-05 vs fp32 가중치: 코사인 최소 {min_cos:.6f}, top-{TOP_K} 불일치 0/{len(_GATE_QUERIES)}",
    })
    print(f"{len(entries)}문장 → {_OUT.relative_to(_AI_ROOT)} ({_OUT.stat().st_size // 1024}KB) · "
          f"게이트 코사인 최소 {min_cos:.6f}, top-{TOP_K} 불일치 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
