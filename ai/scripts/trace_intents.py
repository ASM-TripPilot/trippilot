"""IntentRouter 3단 매칭 발화 러너 — LangSmith 로 임계값 튜닝 + §6 평가 채점 (TRIP-653·678). CI 밖 수동 실행 전용.

IntentRouter 는 아직 엔드포인트에 배선돼 있지 않다(TRIP-529) — 이 스크립트가 발화를 넣어 주면
라우터 단계 함수의 `@traceable` 이 발화 1건 = 트리 1개(1차 top-k 점수 · 2차 유사질문/득표율 ·
3차 판정, 루트 metadata 에 임계값 3종)를 LangSmith 에 남긴다. 임계값을 인자로 바꿔 같은 발화를
다시 돌리면 metadata 가 다른 트리가 쌓여 경로 비중(CONFIDENT/VOTED/LLM_DIRECT/FALLBACK)을
나란히 비교할 수 있다.

`--eval <yaml>` 을 주면 라벨 평가셋(data/intent_eval_set.yaml)을 돌려 §6 지표 — 정확도(전체/의도별)
· 혼동쌍 · 경로 비중 · FALLBACK율 · 비거절 폴백(인프라·LLM 출력 실패) · p95 — 를 찍는다. 이 도구는 **측정 도구 단계**다:
실 LLM 을 부르는 수동 실행이고, §6 이 말하는 CI 게이트(LLM 기록 재생, accuracy 회귀 시 머지 불가)는
후속이다.

**leak 검사(§6 "뱅크 미포함 질문으로 구성")**: 평가 문장이 뱅크 문장과 유사도 ≥ 0.90 이면 경고한다.
뱅크의 `{장소}`·`{지역}` 자리표시자는 그대로 임베딩되면 실명 발화와 0.2~0.35 낮게 나와 사각지대가
된다 — 그래서 자리표시자를 대표 실명으로 채운 변형도 같이 색인해 **둘 중 큰 값**으로 판정한다
(TRIP-678 리뷰에서 평가 발화의 일반화형이 0.96 으로 숨어 있던 실측).

`--fill-bank N`(TRIP-840 실험 A): 자리표시자 문장을 대표 실명 N 세트로 채운 변형까지 뱅크에 색인한다.
**실측 결과 효과 없음**(2026-09-12, 평가셋 88 × 운영 배정 · KURE-v1): 1차 미달 32건이 N=0/1/3 에서 전부 32,
채운 변형이 top1 인 발화 3/88, 원문 대비 이득 +0.003~0.04. 미달 22건(범위 밖 10 제외)의 원인은 자리표시자가
아니라 **어휘·구조 차이**("몇 시까지 열어" ↔ "영업시간 알려줘", "싹 다 다시 만들어줘" ↔ "통째로 다시 짜주면
안 돼?") — 해법은 설계 §3.2 ② Augment(seed 변형 확장)이지 정규화가 아니다. 옵션은 임베딩 모델을 바꿨을 때
재검증용으로만 남긴다.

질문뱅크(reviewed: false)는 **메모리 스토어에만** 올린다 — 검수 전 뱅크의 실 DB 편입 금지
(ai/data/README.md)를 건드리지 않는다. 실행마다 다시 임베딩한다(local KURE 로 수 초).

실행:
    cd ai
    # LangSmith — 개인 발급 키라 .env.example 에 넣지 않는다.
    #   smith.langchain.com → Settings → API Keys → Create API Key
    export LANGSMITH_TRACING=true LANGSMITH_API_KEY=lsv2_... LANGSMITH_PROJECT=trippilot-intent
    # 운영과 같은 배정(mixed + AI_LLM_FEATURE_MODELS)으로 평가셋 채점 — 권장
    LLM_PROVIDER=mixed uv run --env-file ../.env python scripts/trace_intents.py --eval data/intent_eval_set.yaml
    # 발화 몇 개만 / 단일 벤더 / 임계값 덮어쓰기
    LLM_PROVIDER=anthropic uv run python scripts/trace_intents.py "내일 비 온다는데 일정 어떡하지"
    uv run python scripts/trace_intents.py --file utterances.txt --t-high 0.85 --vote-ratio 0.75

환경변수:
    LANGSMITH_TRACING / LANGSMITH_API_KEY / LANGSMITH_PROJECT
                               미설정이면 콘솔 출력만 되고 아무것도 전송되지 않는다(경고 1줄)
    TRIPPILOT_EMBEDDING_MODEL  기본 nlpai-lab/KURE-v1 (scripts/local_embedding.py)
    LLM_PROVIDER               openai | anthropic | azure | mixed — smoke_llm._build_adapter 와 동일 조립
    TRIPPILOT_LLM_FEATURE_MODELS  기능별 배정(운영 정본 이름). 없으면 .env 의 compose 별칭
                               AI_LLM_FEATURE_MODELS 를 같은 값으로 읽는다(출처를 헤더에 찍는다).
                               단일 벤더면 그 벤더로 못 가는 배정(예: openai 인데 claude*)만 경고 후 제외
    TRACE_LLM_TIMEOUT_SEC      기본 30 — 운영값 2.5s 로 재면 타임아웃 폴백이 점수 분포를 가린다

출력(콘솔, 발화당 1줄): 경로  의도  confidence  발화  ← 사유(있으면).  --eval 이면 라벨 불일치에 ✗ 표시 + 요약표.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import yaml
from langsmith.run_helpers import tracing_context

_AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_AI_ROOT))  # tests.fakes 의 메모리 스토어·트레이스 재사용 (수동 스크립트 한정)
sys.path.insert(0, str(_AI_ROOT / "scripts"))

from local_embedding import build_local_embedding  # noqa: E402
from smoke_llm import _build_adapter  # noqa: E402 — 제공자 선택·mixed·재시도 0 정책을 스모크와 공유
from tests.fakes.in_memory_trace import InMemoryTrace  # noqa: E402
from tests.fakes.in_memory_vector_store import InMemoryVectorStore  # noqa: E402
from trippilot.domain.common import TraceId  # noqa: E402
from trippilot.domain.intent import Intent  # noqa: E402
from trippilot.domain.llm import LlmFeature, ModelTier  # noqa: E402
from trippilot.domain.observability import LlmCallRecord  # noqa: E402
from trippilot.llm_gateway.config import C1Config  # noqa: E402
from trippilot.llm_gateway.feature_model_env import ENV_VAR, feature_models_from_env  # noqa: E402
from trippilot.llm_gateway.gates.intent import IntentGate  # noqa: E402
from trippilot.llm_gateway.gates.paraphrase import ParaphraseGate  # noqa: E402
from trippilot.llm_gateway.gateway import GatewayFacade  # noqa: E402
from trippilot.llm_gateway.prompts import PromptRegistry  # noqa: E402
from trippilot.orchestrator.intent_eval import Sample, format_report, score  # noqa: E402
from trippilot.orchestrator.intent_router import IntentRouter, IntentRouterConfig  # noqa: E402
from trippilot.orchestrator.question_bank import (  # noqa: E402
    BANK_COLLECTION,
    index_bank,
    load_bank_file,
)

_BANK = _AI_ROOT / "data" / "intent_question_bank.yaml"
_PROMPTS = _AI_ROOT / "prompts"
_LEAK_THRESHOLD = 0.90  # intent-matching-design §3.3 중복 판정과 같은 값 — 평가셋 leak 판정에도 쓴다
_FILLED_COLLECTION = "intent_bank_filled"  # leak 검사 전용 — 자리표시자를 채운 뱅크 변형
# 자리표시자 대표값 세트 — 평가셋에 쓰인 실명·기간·날짜와 일부러 다르게 고른다(같은 토큰이면 그것만으로
# 점수가 올라 구조 유사도가 아니라 이름 일치를 재게 된다). 평가셋에 새 실명을 넣을 때 여기와 겹치지 않게.
# 첫 세트는 leak 검사용, `--fill-bank N` 은 앞 N 세트로 뱅크를 확장 색인한다(TRIP-840 실험 A).
_FILL_SETS = (
    {"{장소}": "경복궁", "{지역}": "여수", "{날짜}": "글피", "{기간}": "4박 5일"},
    {"{장소}": "불국사", "{지역}": "통영", "{날짜}": "다음 주 화요일", "{기간}": "나흘"},
    {"{장소}": "남이섬", "{지역}": "안동", "{날짜}": "이번 달 말", "{기간}": "일주일"},
)
_FILLS = _FILL_SETS[0]


def _fill(text: str, fills: dict[str, str] = _FILLS) -> str:
    for key, value in fills.items():
        text = text.replace(key, value)
    return text


def _expand_bank(entries, embedding, store, n_sets: int) -> int:
    """자리표시자 문장을 대표 실명 세트로 채운 변형을 **라우팅 컬렉션에** 추가 색인 (실험 A).

    가설: 실명 발화가 자리표시자 원문과는 0.5~0.7 대, 채운 변형과는 0.9 대로 붙는다(TRIP-678 leak 검사에서
    구조가 같은 문장끼리 관측). **실측으로 기각됨** — 모듈 docstring 참조. 구조까지 같아야 0.9 가 나오고,
    평가셋 미달은 구조가 다른 문장들이었다. payload(intent·slot_pattern)는 원문 것 그대로. 반환: 추가 건수.
    """
    added = 0
    for e in entries:
        for i, fills in enumerate(_FILL_SETS[:n_sets]):
            filled = _fill(e.question, fills)
            if filled == e.question:
                break  # 자리표시자 없는 문장은 세트를 바꿔도 같다 — 한 번만 판단
            store.upsert(BANK_COLLECTION, f"{e.entry_id}~f{i}", embedding.embed(filled), e.payload())
            added += 1
    return added


def _build_llm(provider: str):
    """(LlmPort, 기본 model_id, feature_models, 배정 출처). 조립은 smoke_llm 과 동일(mixed 포함).

    기능별 배정은 운영(main.py)처럼 provider 와 무관하게 적용한다 — 단일 벤더에서 그 벤더로 갈 수 없는
    배정(openai 인데 claude*, anthropic 인데 gpt*)만 경고 후 제외한다(넣어 두면 벤더 404 → 폴백으로
    측정이 오염된다). 환경변수 정본은 TRIPPILOT_LLM_FEATURE_MODELS; 로컬 .env 는 compose 별칭
    AI_LLM_FEATURE_MODELS 만 가지므로 같은 값으로 읽되 출처를 남긴다.
    """
    llm, model_id = _build_adapter(provider)
    if os.environ.get(ENV_VAR):
        source, raw = ENV_VAR, os.environ[ENV_VAR]
    else:
        source, raw = "AI_LLM_FEATURE_MODELS", os.environ.get("AI_LLM_FEATURE_MODELS")
    feature_models = dict(feature_models_from_env(raw)) if raw else {}
    if provider != "mixed":
        def _reachable(model: str) -> bool:
            is_claude = model.lower().startswith("claude")
            return is_claude if provider == "anthropic" else not is_claude
        dropped = {f: m for f, m in feature_models.items() if not _reachable(m)}
        for f, m in dropped.items():
            print(f"[배정 제외] {f.value}={m} — LLM_PROVIDER={provider} 로는 못 간다(mixed 로 돌려야 운영 조건)",
                  file=sys.stderr)
        feature_models = {f: m for f, m in feature_models.items() if f not in dropped}
    return llm, model_id, feature_models, source if raw else "(배정 없음)"


def _load_eval(path: Path) -> tuple[str, list[tuple[Intent, str]]]:
    """평가셋 yaml → (version, [(라벨, 발화)]). 라벨은 closed-set 강제(오타 = 즉시 실패)."""
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    cases = []
    for case in data["cases"]:
        label = Intent(case["intent"])  # ValueError 면 라벨 오타 — 조용히 넘기지 않는다
        for utterance in case["utterances"]:
            cases.append((label, str(utterance)))
    return str(data.get("version", "?")), cases


def _leak_check(labeled, entries, embedding, store) -> int:
    """평가 문장 × (뱅크 원문 ∪ 자리표시자 채운 변형) 최대 유사도 ≥ 0.90 을 보고. 반환: 건수."""
    for e in entries:
        filled = _fill(e.question)
        if filled != e.question:
            store.upsert(_FILLED_COLLECTION, e.entry_id, embedding.embed(filled), {"q": filled})
    leaks = []
    for _, text in labeled:
        vec = embedding.embed(text)
        best = max(
            (h for c in (BANK_COLLECTION, _FILLED_COLLECTION) for h in store.search(c, vec, 1)),
            key=lambda h: h.score, default=None,
        )
        if best is not None and best.score >= _LEAK_THRESHOLD:
            leaks.append((text, best.item_id, best.score))
    for text, entry, sim in leaks:
        print(f"[leak ≥{_LEAK_THRESHOLD}] {text!r} ~ 뱅크 {entry} ({sim:.3f})", file=sys.stderr)
    if leaks:
        print(f"[leak] {len(leaks)}건 — 평가셋에서 바꿔야 한다(§6)", file=sys.stderr)
    return len(leaks)


def _parse_args() -> argparse.Namespace:
    default = IntentRouterConfig()
    p = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    p.add_argument("utterances", nargs="*", help="발화 (여러 개 가능)")
    p.add_argument("--file", type=Path, help="한 줄에 발화 1개인 텍스트 파일")
    p.add_argument("--eval", type=Path, help="라벨 평가셋 yaml — §6 지표를 채점한다")
    p.add_argument("--leak-only", action="store_true",
                   help="--eval 의 leak 검사만 하고 라우팅(LLM 호출)은 하지 않는다 — 평가셋 작성 중 반복용")
    p.add_argument("--fill-bank", type=int, default=0, metavar="N",
                   help="자리표시자 문장을 대표 실명 N 세트로 채운 변형까지 뱅크에 색인 (TRIP-840 실험 A, 0=끔)")
    p.add_argument("--t-high", type=float, default=default.t_high)
    p.add_argument("--t-mid", type=float, default=default.t_mid)
    p.add_argument("--vote-ratio", type=float, default=default.vote_ratio)
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    labeled: list[tuple[Intent | None, str]] = [(None, u) for u in args.utterances]
    if args.file:
        lines = args.file.read_text(encoding="utf-8").splitlines()
        labeled += [(None, line.strip()) for line in lines if line.strip()]
    eval_version = None
    if args.eval:
        eval_version, cases = _load_eval(args.eval)
        labeled += cases
    if not labeled:
        raise SystemExit("발화가 없다 — 인자, --file 또는 --eval")
    if not os.environ.get("LANGSMITH_TRACING"):
        print("[주의] LANGSMITH_TRACING 미설정 — 트레이스는 전송되지 않는다(콘솔 출력만)",
              file=sys.stderr)

    cfg = IntentRouterConfig(t_high=args.t_high, t_mid=args.t_mid, vote_ratio=args.vote_ratio)
    embedding = build_local_embedding()
    store = InMemoryVectorStore()
    entries = load_bank_file(_BANK, yaml.safe_load)
    bank_size = index_bank(entries, embedding, store,
                           allow_unreviewed=True)  # 평가 목적 — 메모리에만, 실 DB 편입 아님
    expanded = _expand_bank(entries, embedding, store, args.fill_bank) if args.fill_bank else 0
    if args.eval and args.leak_only:  # 임베딩만 — LLM 키 없이도 평가셋 작성 중 반복할 수 있게
        return 1 if _leak_check(labeled, entries, embedding, store) else 0
    provider = os.environ.get("LLM_PROVIDER", "openai")
    llm, model_id, feature_models, assignment_source = _build_llm(provider)
    c1 = C1Config(
        model_ids={ModelTier.LIGHT: model_id, ModelTier.HEAVY: model_id},
        feature_models=feature_models,
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
        "provider": provider,
        "llm_intent": feature_models.get(LlmFeature.INTENT, model_id),
        "llm_paraphrase": feature_models.get(LlmFeature.PARAPHRASE, model_id),
        "openai_api": os.environ.get("OPENAI_API") or "chat",
        "embedding_model": embedding.model_id,
        "bank_version": entries[0].bank_version if entries else "?",
        "bank_sha": hashlib.sha256(_BANK.read_bytes()).hexdigest()[:12],
        "bank_fill_sets": args.fill_bank,
        "eval_version": eval_version or "-",
    }
    # 이 한 줄이 재현 정보다 — 실측을 어디에 적든 이 줄을 그대로 옮긴다
    print(f"뱅크 {bank_size}문장 v{run_meta['bank_version']}({run_meta['bank_sha']})"
          f"{f' +확장 {expanded}(세트 {args.fill_bank})' if expanded else ''} · provider {provider} · "
          f"INTENT {run_meta['llm_intent']} · PARAPHRASE {run_meta['llm_paraphrase']} "
          f"(배정 출처 {assignment_source}) · openai_api {run_meta['openai_api']} · "
          f"embedding {run_meta['embedding_model']} · eval v{run_meta['eval_version']} · "
          f"t_high {cfg.t_high} · t_mid {cfg.t_mid} · vote_ratio {cfg.vote_ratio}")

    if args.eval:
        _leak_check(labeled, entries, embedding, store)

    samples: list[Sample] = []
    with tracing_context(metadata=run_meta):
        for i, (label, text) in enumerate(labeled, 1):
            started = time.perf_counter()
            m = router.route(text, TraceId(f"trace-intents-{i}"), datetime.now(UTC))
            elapsed_ms = (time.perf_counter() - started) * 1000
            mark = "" if label is None else ("  " if m.intent is label else " ✗")
            reason = f"  ← {m.reason}" if m.reason else ""
            print(f"{m.match_route.value:10} {m.intent.value:22} {m.confidence:.3f}{mark} {text}{reason}",
                  flush=True)
            if label is not None:
                samples.append(Sample(label, text, m, elapsed_ms))

    if samples:
        print("\n" + format_report(score(samples)))
    calls = trace.of_type(LlmCallRecord)
    if calls:  # 타임아웃·폴백이 많으면 점수 분포가 아니라 LLM 상태를 먼저 의심해야 한다
        failed = sum(1 for c in calls if not c.success)
        avg_ms = sum(c.latency_ms for c in calls) / len(calls)
        print(f"LLM 호출 {len(calls)}회 · 실패 {failed}회 · 평균 {avg_ms:.0f}ms", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
