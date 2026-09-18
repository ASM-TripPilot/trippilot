"""§6 평가 게이트 — 기록 재생으로 의도 정확도 회귀를 CI 에서 막는다 (intent-matching-design §6).

설계 §6: "뱅크·임계값·프롬프트 변경 시 평가셋 재실행 → accuracy 회귀하면 머지 불가 (CI, D37: LLM 은
fake/기록 재생)". 여기가 그 게이트다.

**왜 기록 재생인가.** CI 는 외부 호출이 0이어야 하고(D37) KURE-v1(약 1GB)도 못 올린다. 실 LLM 로 돌리면
같은 발화가 실행마다 다른 답을 낸다 — `temperature 0` 에서도 그렇다(실측: 경계 발화 3회에 득표율
1.000/0.760/0.758, 의도가 뒤집힘). 그 흔들림 위에 게이트를 세우면 무고한 PR 이 빨간불을 받는다.

**재생은 결정론이다.** 그래서 이 게이트가 재는 것은 "LLM 이 오늘 어떤 기분인가"가 아니라
**"내 변경이 점수를 움직였나"** 다. 흔들림을 없애는 것이 목적이지 실제 품질을 재는 척하는 것이 아니다 —
실 품질은 여전히 `scripts/trace_intents.py --eval` 를 최소 2회 돌려서 본다(ai/data/README.md).

**기록이 안 맞으면 실패한다.** 뱅크·평가셋·프롬프트·모델 중 무엇이 바뀌어도 기록 키가 달라진다.
이것이 결함이 아니라 목적이다 — 기록을 다시 뜨게 만들고, 갱신된 기록이 곧 리뷰 대상이 된다.

⚠️ 단, 미스는 **예외로 밖에 나오지 않는다.** `GatewayFacade` 가 벤더 예외를 포함해 모든 예외를 폴백
신호로 바꾸기 때문이다(BR-U4-02 — 옳은 설계다). 그래서 이 게이트는 `ReplayLlm.misses` 를 **정확도보다
먼저** 본다. 둘을 합치면 "기록이 낡았다"와 "점수가 떨어졌다"가 같은 빨간불이 되는데, 처방이 정반대다
(기록을 다시 뜬다 / 변경을 되돌린다). 실측으로 한 번 헷갈렸다 — 배정 모델을 잘못 되살렸더니 86/87 이
64/87 로 떨어졌고 표시는 "정확도 회귀" 한 줄뿐이었다.

기록 갱신:
    cd ai
    LLM_PROVIDER=mixed uv run --env-file ../.env python scripts/trace_intents.py \\
        --eval data/intent_eval_set.yaml --record tests/fixtures/intent_gate
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
import yaml

from tests.fakes.in_memory_trace import InMemoryTrace
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from tests.fakes.replay_fixtures import (
    ReplayEmbedding,
    ReplayLlm,
    ReplayMissError,
    read_meta,
    unpack_vector,
)
from trippilot.domain.common import TraceId
from trippilot.domain.intent import Intent, MatchRoute
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.intent import IntentGate
from trippilot.llm_gateway.gates.paraphrase import ParaphraseGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.orchestrator.intent_eval import Sample, score
from trippilot.orchestrator.intent_router import IntentRouter, IntentRouterConfig
from trippilot.orchestrator.question_bank import index_bank, load_bank_file

_AI_ROOT = Path(__file__).resolve().parents[1]
_FIXTURES = _AI_ROOT / "tests" / "fixtures" / "intent_gate"
_BANK = _AI_ROOT / "data" / "intent_question_bank.yaml"
_EVAL = _AI_ROOT / "data" / "intent_eval_set.yaml"
_PROMPTS = _AI_ROOT / "prompts"

pytestmark = pytest.mark.skipif(
    not (_FIXTURES / "meta.json").exists(),
    reason="기록 픽스처 없음 — scripts/trace_intents.py --record 로 먼저 뜬다",
)


def _cases() -> list[tuple[Intent, str]]:
    data = yaml.safe_load(_EVAL.read_text(encoding="utf-8"))
    return [(Intent(c["intent"]), str(u)) for c in data["cases"] for u in c["utterances"]]


def _c1(meta: dict) -> C1Config:
    """기록 당시의 **기능별 모델 배정**을 그대로 되살린다.

    이걸 빠뜨리면 PARAPHRASE 호출이 INTENT 모델 이름으로 나가 기록 키가 어긋난다 — 실측으로
    86/87 이 64/87 로 떨어졌고, 원인 표시는 "정확도 회귀" 한 줄뿐이었다. 모델 이름은 키의 일부다.
    """
    return C1Config(
        model_ids={ModelTier.LIGHT: meta["llm_intent"], ModelTier.HEAVY: meta["llm_intent"]},
        feature_models={
            LlmFeature.INTENT: meta["llm_intent"],
            LlmFeature.PARAPHRASE: meta["llm_paraphrase"],
        },
    )


def _build_router(meta: dict, embedding: ReplayEmbedding, llm: ReplayLlm) -> IntentRouter:
    """기록 당시와 **같은 임계값**으로 조립한다 — 임계값이 바뀌면 점수가 바뀌는 것이 정상이고,
    그 변경은 기록 갱신과 함께 와야 한다(meta.json 의 값이 리뷰 대상)."""
    store = InMemoryVectorStore()
    entries = load_bank_file(_BANK, yaml.safe_load)
    index_bank(entries, embedding, store)
    c1 = _c1(meta)
    renderer, trace = PromptRegistry(_PROMPTS), InMemoryTrace()
    return IntentRouter(
        embedding, store,
        intent_gateway=GatewayFacade(llm, renderer, IntentGate(), c1, trace),
        paraphrase_gateway=GatewayFacade(llm, renderer, ParaphraseGate(), c1, trace),
        config=IntentRouterConfig(
            t_high=meta["t_high"], t_mid=meta["t_mid"],
            vote_ratio=meta["vote_ratio"], intent_margin=meta["intent_margin"],
        ),
    )


def test_eval_accuracy_does_not_regress() -> None:
    """평가셋 정확도가 기록된 기준선 아래로 내려가면 머지 불가 (§6 게이트)."""
    meta = read_meta(_FIXTURES)
    embedding = ReplayEmbedding(_FIXTURES)
    llm = ReplayLlm(_FIXTURES)
    router = _build_router(meta, embedding, llm)

    cases = _cases()
    assert len(cases) == meta["eval_cases"], (
        f"평가셋이 {meta['eval_cases']}건에서 {len(cases)}건으로 바뀌었다 — 기록을 다시 뜬다"
    )
    samples = [
        Sample(label, text, router.route(text, TraceId(f"gate-{i}"), datetime.now(UTC)), 0.0)
        for i, (label, text) in enumerate(cases)
    ]
    # 미스를 **먼저** 본다 — 게이트웨이가 예외를 폴백으로 바꾸므로(BR-U4-02) 기록 미스는
    # "정확도가 떨어졌다"로만 보인다. 두 원인은 처방이 다르다.
    assert not llm.misses and not embedding.misses, (
        f"기록 미스 — LLM {len(llm.misses)}건 · 임베딩 {len(embedding.misses)}건. "
        f"첫 건: {(llm.misses + embedding.misses)[0]}. 기록을 다시 뜬다"
    )
    report = score(samples)
    assert report.correct >= meta["baseline_correct"], (
        f"정확도 회귀: {report.correct}/{report.total} < 기준선 {meta['baseline_correct']}. "
        "의도한 변경이면 기록을 다시 뜨고 기준선을 함께 올린다"
    )


def test_every_utterance_lands_on_a_closed_set_label() -> None:
    """INV-1 동형 — 라우터 산출은 항상 closed-set 라벨이다 (§6 'PBT 연계')."""
    meta = read_meta(_FIXTURES)
    router = _build_router(meta, ReplayEmbedding(_FIXTURES), ReplayLlm(_FIXTURES))
    for i, (_, text) in enumerate(_cases()):
        match = router.route(text, TraceId(f"closed-{i}"), datetime.now(UTC))
        assert isinstance(match.intent, Intent)
        # FALLBACK ⇔ OUT_OF_SCOPE 는 타입이 강제하지만, 게이트에서도 한 번 더 본다
        if match.match_route is MatchRoute.FALLBACK:
            assert match.intent is Intent.OUT_OF_SCOPE


def test_changed_prompt_breaks_replay_instead_of_passing_quietly() -> None:
    """프롬프트를 한 글자 바꾸면 기록 미스로 **실패**한다 — "몰래 바뀜"이 불가능하다는 증거.

    이 테스트가 게이트의 존재 이유다. 미스가 조용히 통과하면 프롬프트를 고쳐도 CI 가 초록이라,
    회귀를 막는다는 약속이 거짓이 된다.
    """
    meta = read_meta(_FIXTURES)
    embedding = ReplayEmbedding(_FIXTURES)
    llm = ReplayLlm(_FIXTURES)

    class TamperedRegistry(PromptRegistry):
        def render(self, feature, variables):  # type: ignore[override]
            rendered, ref = super().render(feature, variables)
            return rendered + "\n(프롬프트가 바뀌었다)", ref

    store = InMemoryVectorStore()
    index_bank(load_bank_file(_BANK, yaml.safe_load), embedding, store)
    renderer, trace = TamperedRegistry(_PROMPTS), InMemoryTrace()
    router = IntentRouter(
        embedding, store,
        intent_gateway=GatewayFacade(llm, renderer, IntentGate(), _c1(meta), trace),
        paraphrase_gateway=GatewayFacade(llm, renderer, ParaphraseGate(), _c1(meta), trace),
        config=IntentRouterConfig(
            t_high=meta["t_high"], t_mid=meta["t_mid"],
            vote_ratio=meta["vote_ratio"], intent_margin=meta["intent_margin"],
        ),
    )
    for i, (_, text) in enumerate(_cases()):
        router.route(text, TraceId(f"tamper-{i}"), datetime.now(UTC))
    # `GatewayFacade` 가 예외를 폴백으로 바꾸므로 예외는 밖으로 안 나온다(BR-U4-02).
    # 그래서 **미스 계수**가 증거다 — 이 값이 0이면 프롬프트를 고쳐도 CI 가 초록이라는 뜻이고,
    # 그때 이 게이트의 약속은 거짓이 된다.
    assert llm.misses, "프롬프트를 바꿨는데 기록 미스가 0 — 게이트가 변경을 못 잡는다"


def test_unknown_text_raises_instead_of_inventing_a_vector() -> None:
    """기록에 없는 문장에 그럴듯한 벡터를 만들어 주면 1차가 통째로 무의미해진다."""
    embedding = ReplayEmbedding(_FIXTURES)
    with pytest.raises(ReplayMissError):
        embedding.embed("기록에 있을 리 없는 문장 " + "☃" * 5)


def test_fixture_vectors_keep_dimension_and_are_not_all_zero() -> None:
    """fp16 왕복이 벡터를 망가뜨리지 않았는지 — 차원 유지 + 0벡터 없음."""
    embedding = ReplayEmbedding(_FIXTURES)
    assert embedding.dim == 1024  # BR-AF-09
    rows = (_FIXTURES / "embeddings.jsonl").read_text(encoding="utf-8").splitlines()
    assert rows, "임베딩 기록이 비어 있다"
    import json

    for line in rows[:20]:
        vec = unpack_vector(json.loads(line)["vec"])
        assert len(vec) == 1024
        assert any(abs(x) > 1e-6 for x in vec)
