"""IntentRouter 3단 매칭 발화 러너 — LangSmith 로 임계값 튜닝 (TRIP-653). CI 밖 수동 실행 전용.

IntentRouter 는 아직 엔드포인트에 배선돼 있지 않다(TRIP-529) — 이 스크립트가 발화를 넣어 주면
라우터 단계 함수의 `@traceable` 이 발화 1건 = 트리 1개(1차 top-k 점수 · 2차 유사질문/득표율 ·
3차 판정, 루트 metadata 에 임계값 3종)를 LangSmith 에 남긴다. 임계값을 인자로 바꿔 같은 발화를
다시 돌리면 metadata 가 다른 트리가 쌓여 경로 비중(CONFIDENT/VOTED/LLM_DIRECT/FALLBACK)을
나란히 비교할 수 있다.

질문뱅크(reviewed: false)는 **메모리 스토어에만** 올린다 — 검수 전 뱅크의 실 DB 편입 금지
(ai/data/README.md)를 건드리지 않는다. 실행마다 다시 임베딩한다(local KURE 로 수 초).

실행:
    cd ai
    # LangSmith — 개인 발급 키라 .env.example 에 넣지 않는다.
    #   smith.langchain.com → Settings → API Keys → Create API Key
    export LANGSMITH_TRACING=true LANGSMITH_API_KEY=lsv2_... LANGSMITH_PROJECT=trippilot-intent
    # 임베딩은 local KURE(measure_kb_topk.py 와 같은 규칙), LLM 은 smoke_llm.py 와 같은 변수
    LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... \
        uv run python scripts/trace_intents.py "내일 비 온다는데 일정 어떡하지" "제주 3박4일 일정 짜줘"
    # 파일(한 줄 1발화) + 임계값 덮어쓰기
    uv run python scripts/trace_intents.py --file utterances.txt --t-high 0.85 --t-mid 0.70

환경변수:
    LANGSMITH_TRACING / LANGSMITH_API_KEY / LANGSMITH_PROJECT
                               미설정이면 콘솔 출력만 되고 아무것도 전송되지 않는다(경고 1줄)
    TRIPPILOT_EMBEDDING_MODEL  기본 nlpai-lab/KURE-v1 (sentence-transformers 필요:
                               `uv pip install sentence-transformers`, uv sync 하면 다시 지워진다)
    LLM_PROVIDER + 제공자별 키  smoke_llm.py docstring 참조. 운영 기본 `mixed` 는 미지원 — INTENT·
                               PARAPHRASE 에 실제로 쓰는 벤더 하나를 지정한다(openai 또는 anthropic)
    TRACE_LLM_TIMEOUT_SEC      기본 30 — 운영값 2.5s 로 재면 타임아웃 폴백이 점수 분포를 가린다

출력(콘솔, 발화당 1줄): 경로  의도  confidence  발화  ← 사유(있으면)
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import yaml
from langsmith.run_helpers import tracing_context

_AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_AI_ROOT))  # tests.fakes 의 메모리 스토어·트레이스 재사용 (수동 스크립트 한정)
sys.path.insert(0, str(_AI_ROOT / "scripts"))

from smoke_llm import _build_adapter  # noqa: E402 — 제공자 선택·재시도 0 정책을 스모크와 공유
from tests.fakes.in_memory_trace import InMemoryTrace  # noqa: E402
from tests.fakes.in_memory_vector_store import InMemoryVectorStore  # noqa: E402
from trippilot.domain.common import TraceId  # noqa: E402
from trippilot.domain.llm import ModelTier  # noqa: E402
from trippilot.domain.observability import LlmCallRecord  # noqa: E402
from trippilot.llm_gateway.config import C1Config  # noqa: E402
from trippilot.llm_gateway.gates.intent import IntentGate  # noqa: E402
from trippilot.llm_gateway.gates.paraphrase import ParaphraseGate  # noqa: E402
from trippilot.llm_gateway.gateway import GatewayFacade  # noqa: E402
from trippilot.llm_gateway.prompts import PromptRegistry  # noqa: E402
from trippilot.orchestrator.intent_router import IntentRouter, IntentRouterConfig  # noqa: E402
from trippilot.orchestrator.question_bank import index_bank, load_bank_file  # noqa: E402

_BANK = _AI_ROOT / "data" / "intent_question_bank.yaml"
_PROMPTS = _AI_ROOT / "prompts"


def _embedding():
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise SystemExit("sentence-transformers 미설치 — `uv pip install sentence-transformers`")
    from trippilot.llm_gateway.adapters.sentence_transformer_embedding import (
        DEFAULT_MODEL,
        SentenceTransformerEmbeddingAdapter,
    )

    model = os.environ.get("TRIPPILOT_EMBEDDING_MODEL") or DEFAULT_MODEL
    return SentenceTransformerEmbeddingAdapter(SentenceTransformer(model), model_id=model)


def _parse_args() -> argparse.Namespace:
    default = IntentRouterConfig()
    p = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    p.add_argument("utterances", nargs="*", help="발화 (여러 개 가능)")
    p.add_argument("--file", type=Path, help="한 줄에 발화 1개인 텍스트 파일")
    p.add_argument("--t-high", type=float, default=default.t_high)
    p.add_argument("--t-mid", type=float, default=default.t_mid)
    p.add_argument("--vote-ratio", type=float, default=default.vote_ratio)
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    utterances = list(args.utterances)
    if args.file:
        lines = args.file.read_text(encoding="utf-8").splitlines()
        utterances += [line.strip() for line in lines if line.strip()]
    if not utterances:
        raise SystemExit("발화가 없다 — 인자로 주거나 --file")
    if not os.environ.get("LANGSMITH_TRACING"):
        print("[주의] LANGSMITH_TRACING 미설정 — 트레이스는 전송되지 않는다(콘솔 출력만)",
              file=sys.stderr)

    cfg = IntentRouterConfig(t_high=args.t_high, t_mid=args.t_mid, vote_ratio=args.vote_ratio)
    embedding = _embedding()
    store = InMemoryVectorStore()
    bank_size = index_bank(load_bank_file(_BANK, yaml.safe_load), embedding, store,
                           allow_unreviewed=True)  # 평가 목적 — 메모리에만, 실 DB 편입 아님
    llm, model_id = _build_adapter()
    c1 = C1Config(
        model_ids={ModelTier.LIGHT: model_id, ModelTier.HEAVY: model_id},
        timeout_sec=float(os.environ.get("TRACE_LLM_TIMEOUT_SEC") or 30),
    )
    renderer, trace = PromptRegistry(_PROMPTS), InMemoryTrace()
    router = IntentRouter(
        embedding, store,
        intent_gateway=GatewayFacade(llm, renderer, IntentGate(), c1, trace),
        paraphrase_gateway=GatewayFacade(llm, renderer, ParaphraseGate(), c1, trace),
        config=cfg,
    )
    # 임계값 외의 비교 축도 metadata 로 — 뱅크가 검수로 바뀌거나 모델이 바뀐 전후 트리가
    # 같은 임계값 아래 섞이지 않게 한다(라우터의 임계값 metadata 와 병합된다).
    run_meta = {
        "llm_model": model_id,
        "embedding_model": os.environ.get("TRIPPILOT_EMBEDDING_MODEL") or "nlpai-lab/KURE-v1",
        "bank_sha": hashlib.sha256(_BANK.read_bytes()).hexdigest()[:12],
    }
    print(f"뱅크 {bank_size}문장({run_meta['bank_sha']}) · 모델 {model_id} · "
          f"t_high {cfg.t_high} · t_mid {cfg.t_mid} · vote_ratio {cfg.vote_ratio}")
    with tracing_context(metadata=run_meta):
        for i, text in enumerate(utterances, 1):
            m = router.route(text, TraceId(f"trace-intents-{i}"), datetime.now(UTC))
            reason = f"  ← {m.reason}" if m.reason else ""
            print(f"{m.match_route.value:10} {m.intent.value:22} {m.confidence:.3f}  {text}{reason}",
                  flush=True)

    calls = trace.of_type(LlmCallRecord)
    if calls:  # 타임아웃·폴백이 많으면 점수 분포가 아니라 LLM 상태를 먼저 의심해야 한다
        failed = sum(1 for c in calls if not c.success)
        avg_ms = sum(c.latency_ms for c in calls) / len(calls)
        print(f"LLM 호출 {len(calls)}회 · 실패 {failed}회 · 평균 {avg_ms:.0f}ms", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
