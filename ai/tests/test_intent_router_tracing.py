"""TRIP-653 — IntentRouter 단계 트레이스 (LangSmith `@traceable`).

기본은 꺼져 있다 — `LANGSMITH_TRACING` 미설정이면 데코레이터는 함수를 그대로 통과시키고
아무것도 전송하지 않는다(CI 외부 호출 0 유지). 여기서는 `tracing_context(enabled="local")`
로 **전송 없이** run tree 만 만들어 다음을 본다:

1. 발화 1건 = 트리 1개 — 단계 함수(1차 뱅크 · 2차 유사질문/투표 · 3차 LLM)가 중첩 run 으로
   남고, 임계값 3종이 루트 run 의 metadata 에 실린다. 트레이싱이 켜져도 결과는 꺼졌을 때와 같다.
2. 단계 안에서 예외가 나도 `route()` 는 던지지 않고 폴백한다(INV-4) — 그리고 그 예외가
   run.error 로 남는다(침묵 실패 금지 — 트리에서 어디가 터졌는지 보인다).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import langsmith
import pytest
from langsmith import traceable
from langsmith.run_helpers import get_current_run_tree, tracing_context

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.paraphrase import ParaphraseGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.domain.common import TraceId
from trippilot.domain.intent import Intent, MatchRoute
from trippilot.domain.llm import ModelTier
from trippilot.orchestrator.intent_router import IntentRouter, IntentRouterConfig
from trippilot.orchestrator.question_bank import BANK_COLLECTION
from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.fakes.in_memory_vector_store import InMemoryVectorStore

_NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
_TID = TraceId("t-trace")
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
_TEXT = "내일 비 온다는데 일정 어떡하지"


def _ambiguous_router() -> IntentRouter:
    """같은 문장이 두 의도에 실린 뱅크 → 1차 top1·top2 의도 불일치 → 2차 투표로 간다.

    두 엔트리의 벡터가 동일하니 어떤 질의든 동점 → item_id 사전순으로 "a" 가 항상 top1
    → 득표율 1.0 → VOTED(GENERATE_SCHEDULE). 유사질문 3개는 서로 달라야 게이트 중복 제거에
    안 걸린다(원문 + 유사질문 3 = 재매칭 4회).
    """
    embedding = FakeEmbedding()
    store = InMemoryVectorStore()
    for item_id, intent in (("a", Intent.GENERATE_SCHEDULE), ("b", Intent.REPLAN)):
        store.upsert(BANK_COLLECTION, item_id, embedding.embed(_TEXT), {"intent": intent.value})
    variants = [_TEXT + suffix for suffix in ("", "?", "!")]
    paraphrase = GatewayFacade(
        FakeLlm(canned=json.dumps({"questions": variants})),
        PromptRegistry(_PROMPTS_DIR),
        ParaphraseGate(),
        _CFG,
        InMemoryTrace(),
    )
    return IntentRouter(embedding, store, paraphrase_gateway=paraphrase)


def _route_under_local_tracing(router: IntentRouter, text: str):
    """전송 없는 로컬 run tree 안에서 route() 를 한 번 부른다. 반환: (결과, 루트 아래 run 목록)."""

    @traceable(name="test-root")
    def _root():
        return router.route(text, _TID, _NOW), get_current_run_tree()

    # client 를 명시하는 이유: 미지정이면 "API key must be provided" 경고가 뜬다. 로컬 모드는
    # 어차피 전송하지 않으므로 더미 키로 충분하다. auto_batch_tracing=False 가 핵심 —
    # 기본값(True)은 Client 생성만으로 백그라운드 스레드가 /info 를 치러 나간다(CI 외부 호출 0 위반).
    client = langsmith.Client(api_key="test", auto_batch_tracing=False)
    with tracing_context(enabled="local", client=client):
        match, root = _root()
    return match, root.child_runs


def test_route_leaves_one_tree_with_stage_runs_and_threshold_metadata() -> None:
    router = _ambiguous_router()
    untraced = router.route(_TEXT, _TID, _NOW)  # 기본 = 트레이싱 꺼짐

    match, runs = _route_under_local_tracing(router, _TEXT)

    assert match == untraced  # 트레이싱은 관측일 뿐 결과를 바꾸지 않는다
    assert match.match_route is MatchRoute.VOTED
    assert [r.name for r in runs] == ["intent.route"]
    route = runs[0]
    cfg = IntentRouterConfig()
    meta = route.extra["metadata"]
    assert (meta["t_high"], meta["t_mid"], meta["vote_ratio"]) == (
        cfg.t_high, cfg.t_mid, cfg.vote_ratio,
    )
    assert [c.name for c in route.child_runs] == ["intent.bank", "intent.vote"]
    hits = route.child_runs[0].outputs["output"]  # 1차 top-k 점수가 트리에 남는다
    assert [h.intent for h in hits] == [Intent.GENERATE_SCHEDULE, Intent.REPLAN]
    assert [h.score for h in hits] == pytest.approx([1.0, 1.0])
    vote = route.child_runs[1]
    assert [c.name for c in vote.child_runs] == [
        "intent.paraphrase", "intent.bank", "intent.bank", "intent.bank", "intent.bank",
    ]


def test_stage_exception_is_recorded_on_the_run_and_route_still_falls_back() -> None:
    class _BoomEmbedding:
        dim = 8

        def embed(self, text: str):
            raise RuntimeError("boom")

        def embed_batch(self, texts):
            raise RuntimeError("boom")

    router = IntentRouter(_BoomEmbedding(), InMemoryVectorStore())

    match, runs = _route_under_local_tracing(router, _TEXT)

    assert match.match_route is MatchRoute.FALLBACK
    assert "boom" in (match.reason or "")
    route = runs[0]
    assert route.name == "intent.route" and "boom" in (route.error or "")
    assert route.child_runs[0].name == "intent.bank"
    assert "boom" in (route.child_runs[0].error or "")
