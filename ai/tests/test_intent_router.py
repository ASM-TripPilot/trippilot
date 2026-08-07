"""U6-01(TRIP-242) — IntentRouter 3단 매칭 + 결정론 폴백 + 질문뱅크 로더.

**FakeEmbedding의 한계 우회**: FakeEmbedding은 해시 기반이라 의미 유사도가 없다.
따라서 임계값 시나리오(T_high 통과·의도 혼재·T_mid 미달·투표)는 전부
`_ScriptedEmbedding`(2차원 단위벡터, 각도로 코사인을 직접 지정) + InMemoryVectorStore에
**벡터를 직접 주입**해 구성한다. FakeEmbedding은 "동일 텍스트 왕복 매칭"(실제 seed 뱅크 e2e)과
PBT의 임의 입력 처리에만 쓴다.

**LLM 단계**: 실물 GatewayFacade + FakeLlm(결정론 canned) + 스텁 렌더러 + 게이트 대역.
INTENT·PARAPHRASE용 프롬프트 yaml과 c1 게이트는 아직 없다(보고 항목) — 그 자리를
테스트 대역이 채워 라우터↔게이트웨이 계약을 검증한다.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.c1.config import C1Config
from trippilot.c1.gates.base import GateOutcome
from trippilot.c1.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.intent import (
    ROUTABLE_INTENTS,
    ROUTING_TABLE,
    Intent,
    IntentDraft,
    IntentMatch,
    MatchRoute,
    RoutingMode,
)
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.prompt import PromptRef
from trippilot.orchestrator.intent_router import (
    IntentRouter,
    IntentRouterConfig,
    normalize,
)
from trippilot.orchestrator.question_bank import (
    BANK_COLLECTION,
    BankLoadError,
    UnreviewedBankError,
    index_bank,
    load_bank,
    load_bank_file,
)
from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.fakes.in_memory_vector_store import InMemoryVectorStore

_NOW = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)
_TID = TraceId("t-intent")
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
_SEED_YAML = Path(__file__).resolve().parent.parent / "data" / "intent_question_bank.yaml"


# ── 테스트 대역 ─────────────────────────────────────────────────────────


class _ScriptedEmbedding:
    """각도 → 2차원 단위벡터. 코사인 유사도 = 두 각도 차의 cos — 임계값을 정확히 조준한다."""

    dim = 2
    _FAR = 2.5  # 대본에 없는 텍스트는 뱅크에서 멀리 (rad)

    def __init__(self, angles: dict[str, float]) -> None:
        self._angles = angles

    def embed(self, text: str) -> tuple[float, ...]:
        theta = self._angles.get(text, self._FAR)
        return (math.cos(theta), math.sin(theta))

    def embed_batch(self, texts):
        return tuple(self.embed(t) for t in texts)


class _StubRenderer:
    """PromptRenderer 대역 — prompts/intent.yaml·paraphrase.yaml 미등록 상태를 대신한다."""

    def render(self, feature: LlmFeature, variables):
        rendered = f"{feature.value}|" + "|".join(f"{k}={v}" for k, v in sorted(variables.items()))
        return rendered, PromptRef(
            prompt_id=f"stub/{feature.value.lower()}.yaml", version="0.0.0-stub", feature=feature.value
        )


class _ParaphraseGate:
    """PARAPHRASE 출구 게이트 대역 — {"questions": [str]} → tuple[str, ...]."""

    def apply(self, raw_text, pool, *, feature, trace_id, now) -> GateOutcome:
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e.msg}")
        questions = data.get("questions") if isinstance(data, dict) else None
        if not isinstance(questions, list) or not all(isinstance(q, str) for q in questions):
            return GateOutcome(value=None, drop_event=None, error="parse_error: questions 비정상")
        return GateOutcome(value=tuple(questions), drop_event=None, error=None)


class _IntentGate:
    """INTENT 출구 게이트 대역 — 라벨 closed-set 강제 후 IntentDraft 조립."""

    def apply(self, raw_text, pool, *, feature, trace_id, now) -> GateOutcome:
        try:
            data = json.loads(raw_text)
            if not isinstance(data, dict):
                raise ValueError("최상위가 객체가 아님")
            intent = Intent(data.get("intent"))  # closed-set 밖이면 ValueError
            slots = data.get("slots") or {}
            if not isinstance(slots, dict):
                raise ValueError("slots 비정상")
            draft = IntentDraft(intent=intent, slots=slots, confidence=data.get("confidence"))
        except (json.JSONDecodeError, ValueError) as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")
        return GateOutcome(value=draft, drop_event=None, error=None)


def _gateway(canned: str, gate) -> GatewayFacade:
    return GatewayFacade(FakeLlm(canned=canned), _StubRenderer(), gate, _CFG, InMemoryTrace())


def _paraphrase_gw(*questions: str) -> GatewayFacade:
    return _gateway(json.dumps({"questions": list(questions)}), _ParaphraseGate())


def _intent_gw(intent: str, slots: dict | None = None, confidence: float | None = None) -> GatewayFacade:
    body: dict = {"intent": intent, "slots": slots or {}}
    if confidence is not None:
        body["confidence"] = confidence
    return _gateway(json.dumps(body), _IntentGate())


# ── 대본 뱅크 (각도로 유사도 조준) ──────────────────────────────────────
#
#   W1 GET_WEATHER  @0.00 | W2 GET_WEATHER  @0.30
#   D1 GET_DISTANCE @0.35 | D2 GET_DISTANCE @1.20 | E1 EDIT_SCHEDULE @1.50

_BANK_ANGLES = {
    "W1": (0.00, Intent.GET_WEATHER),
    "W2": (0.30, Intent.GET_WEATHER),
    "D1": (0.35, Intent.GET_DISTANCE),
    "D2": (1.20, Intent.GET_DISTANCE),
    "E1": (1.50, Intent.EDIT_SCHEDULE),
}
_QUERY_ANGLES = {
    "확실한 질문": 0.00,  # top1 W1(1.000) · top2 W2(동일 의도) → CONFIDENT
    "애매한 질문": 0.32,  # top1 W2(0.9998) · top2 D1(0.9996, 다른 의도) → 2차
    "생소한 질문": 2.50,  # top1 E1(0.540) < T_mid → 3차
    "유사질문-날씨A": 0.00,
    "유사질문-날씨B": 0.30,
    "유사질문-거리A": 0.35,
    "유사질문-거리B": 1.20,
}


def _scripted_router(
    *, slot_pattern: dict | None = None, extra_angles: dict[str, float] | None = None, **kwargs
) -> IntentRouter:
    embedding = _ScriptedEmbedding({**_QUERY_ANGLES, **(extra_angles or {})})
    store = InMemoryVectorStore()
    for item_id, (theta, intent) in _BANK_ANGLES.items():
        store.upsert(
            BANK_COLLECTION,
            item_id,
            (math.cos(theta), math.sin(theta)),
            {"intent": intent.value, "question": item_id, "slot_pattern": slot_pattern or {}},
        )
    return IntentRouter(embedding, store, **kwargs)


# ── 1차: CONFIDENT (LLM 0회) ────────────────────────────────────────────


def test_confident_route_without_any_llm() -> None:
    router = _scripted_router()  # 게이트웨이 미주입 = LLM 경로 자체가 없다
    match = router.route("확실한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.CONFIDENT
    assert match.intent is Intent.GET_WEATHER
    assert math.isclose(match.confidence, 1.0, abs_tol=1e-9)
    assert match.reason is None
    assert match.routing.mode is RoutingMode.FAST_PATH  # Fast Path 판정이 바로 선다
    assert match.routing.handler == "WeatherAgent"


def test_confident_extracts_slots_from_entry_pattern() -> None:
    router = _scripted_router(
        slot_pattern={"date": "regex:오늘|내일|모레", "bad": "glob:*"},
        extra_angles={"내일 확실한 질문": 0.0},
    )
    match = router.route("내일 확실한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.CONFIDENT
    assert match.slots == {"date": "내일"}  # 지원하지 않는 패턴 형식(bad)은 조용히 제외


def test_broken_regex_pattern_does_not_break_routing() -> None:
    router = _scripted_router(slot_pattern={"x": "regex:[unclosed"})
    match = router.route("확실한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.CONFIDENT and match.slots == {}


# ── 2차: 의도 혼재 → 유사질문 투표 ──────────────────────────────────────


def test_mixed_top2_triggers_vote_and_confirms() -> None:
    router = _scripted_router(
        paraphrase_gateway=_paraphrase_gw("유사질문-날씨A", "유사질문-날씨B", "유사질문-거리A")
    )
    match = router.route("애매한 질문", _TID, _NOW)
    # 가중 투표: WEATHER 0.9998+1+1 = 2.9998 / DISTANCE 1.0 → 득표율 0.75 ≥ 0.60
    assert match.match_route is MatchRoute.VOTED
    assert match.intent is Intent.GET_WEATHER
    assert math.isclose(match.confidence, 0.75, abs_tol=1e-3)


def test_vote_below_ratio_escalates_to_llm_direct() -> None:
    router = _scripted_router(
        paraphrase_gateway=_paraphrase_gw("유사질문-거리A", "유사질문-거리B", "유사질문-날씨A"),
        intent_gateway=_intent_gw("EDIT_SCHEDULE", {"target": "저녁"}, 0.71),
    )
    match = router.route("애매한 질문", _TID, _NOW)
    # DISTANCE 2.0 / WEATHER 1.9998 → 득표율 0.500 < 0.60 → 3차로
    assert match.match_route is MatchRoute.LLM_DIRECT
    assert match.intent is Intent.EDIT_SCHEDULE
    assert match.slots == {"target": "저녁"}
    assert math.isclose(match.confidence, 0.71)
    assert "ambiguous" in match.reason and "vote_ratio" in match.reason


def test_paraphrase_failure_escalates_not_silently_votes() -> None:
    """유사질문 생성이 실패했을 때 원문 1표만으로 확정하면 애매함이 은폐된다 → 3차로."""
    router = _scripted_router(
        paraphrase_gateway=_gateway("깨진 응답", _ParaphraseGate()),
        intent_gateway=_intent_gw("GET_DISTANCE"),
    )
    match = router.route("애매한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.LLM_DIRECT
    assert match.intent is Intent.GET_DISTANCE
    assert "paraphrase_fallback" in match.reason


def test_paraphrase_gateway_absent_escalates() -> None:
    router = _scripted_router(intent_gateway=_intent_gw("GET_WEATHER"))
    match = router.route("애매한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.LLM_DIRECT
    assert "paraphrase_gateway_absent" in match.reason


# ── 3차: LLM 직접 분류 ──────────────────────────────────────────────────


def test_below_t_mid_goes_to_llm_direct() -> None:
    router = _scripted_router(intent_gateway=_intent_gw("GENERATE_SCHEDULE"))
    match = router.route("생소한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.LLM_DIRECT
    assert match.intent is Intent.GENERATE_SCHEDULE
    assert match.routing.mode is RoutingMode.DELEGATE
    assert "below_t_mid" in match.reason


def test_llm_direct_without_confidence_uses_config_default() -> None:
    router = _scripted_router(
        intent_gateway=_intent_gw("TRIP_SUMMARY"),
        config=IntentRouterConfig(llm_direct_confidence=0.42),
    )
    match = router.route("생소한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.LLM_DIRECT and match.confidence == 0.42


def test_empty_bank_goes_straight_to_llm_direct() -> None:
    router = IntentRouter(
        _ScriptedEmbedding(_QUERY_ANGLES),
        InMemoryVectorStore(),
        intent_gateway=_intent_gw("SHOW_SCHEDULE"),
    )
    match = router.route("확실한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.LLM_DIRECT and "bank_miss" in match.reason


def test_polluted_bank_labels_are_ignored_inv1() -> None:
    """closed-set 밖 라벨이 실린 엔트리는 매칭 대상이 아니다 (INV-1 — 뱅크 오염 방어)."""
    store = InMemoryVectorStore()
    store.upsert(BANK_COLLECTION, "X1", (1.0, 0.0), {"intent": "HACK_THE_PLANET"})
    store.upsert(BANK_COLLECTION, "X2", (1.0, 0.0), {"intent": "OUT_OF_SCOPE"})
    router = IntentRouter(_ScriptedEmbedding(_QUERY_ANGLES), store)
    match = router.route("확실한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.FALLBACK
    assert "bank_miss" in match.reason


# ── 폴백: 결정론 + 침묵 금지 (INV-4) ────────────────────────────────────


def test_llm_failure_falls_back_with_reason() -> None:
    router = _scripted_router(
        intent_gateway=GatewayFacade(FailingLlm(), _StubRenderer(), _IntentGate(), _CFG, InMemoryTrace())
    )
    match = router.route("생소한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.FALLBACK
    assert match.intent is Intent.OUT_OF_SCOPE
    assert match.confidence == 0.0 and match.slots == {}
    assert match.routing.mode is RoutingMode.FALLBACK
    assert "below_t_mid" in match.reason and "intent_fallback" in match.reason


def test_no_gateway_at_all_falls_back() -> None:
    match = _scripted_router().route("생소한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.FALLBACK
    assert "intent_gateway_absent" in match.reason


def test_llm_classified_out_of_scope_becomes_fallback() -> None:
    router = _scripted_router(intent_gateway=_intent_gw("OUT_OF_SCOPE"))
    match = router.route("생소한 질문", _TID, _NOW)
    # 게이트가 라벨 자체는 통과시켜도 위임 불가 라벨은 라우터가 폴백으로 돌린다
    assert match.match_route is MatchRoute.FALLBACK
    assert "intent_not_routable" in match.reason


def test_infrastructure_exception_never_escapes() -> None:
    class _ExplodingStore:
        def upsert(self, *a, **k): ...
        def delete(self, *a, **k): ...

        def search(self, *a, **k):
            raise RuntimeError("pgvector down")

    match = IntentRouter(_ScriptedEmbedding({}), _ExplodingStore()).route("아무말", _TID, _NOW)
    assert match.match_route is MatchRoute.FALLBACK
    assert "router_error" in match.reason and "pgvector down" in match.reason


@pytest.mark.parametrize("utterance", ["", "   ", "\n\t", "🙂🙂", "​"])
def test_empty_after_normalization_falls_back(utterance: str) -> None:
    match = _scripted_router().route(utterance, _TID, _NOW)
    assert match.match_route is MatchRoute.FALLBACK and match.reason == "empty_utterance"


def test_normalize_collapses_space_and_strips_emoji() -> None:
    assert normalize("  내일   날씨 🙂 어때?  ") == "내일 날씨 어때?"
    assert normalize("ＧＥＴ　날씨") == "GET 날씨"  # NFKC — 전각·전각공백


# ── 매칭 결과 타입 불변식 ───────────────────────────────────────────────


def test_intent_match_roundtrip_and_invariants() -> None:
    m = IntentMatch(Intent.REPLAN, {"scope": "today"}, 0.9, MatchRoute.VOTED)
    assert IntentMatch.from_dict(m.to_dict()) == m

    with pytest.raises(ValueError):  # 폴백 라벨은 폴백 경로에서만
        IntentMatch(Intent.OUT_OF_SCOPE, {}, 0.0, MatchRoute.CONFIDENT, "x")
    with pytest.raises(ValueError):  # 폴백 경로인데 위임 라벨
        IntentMatch(Intent.REPLAN, {}, 0.0, MatchRoute.FALLBACK, "x")
    with pytest.raises(ValueError):  # 폴백인데 사유 없음 = 침묵 실패
        IntentMatch(Intent.OUT_OF_SCOPE, {}, 0.0, MatchRoute.FALLBACK, None)
    with pytest.raises(ValueError):
        IntentMatch(Intent.REPLAN, {}, 1.5, MatchRoute.CONFIDENT)


def test_config_rejects_inverted_thresholds() -> None:
    with pytest.raises(ValueError):
        IntentRouterConfig(t_high=0.5, t_mid=0.8)
    with pytest.raises(ValueError):
        IntentRouterConfig(vote_ratio=0.0)


# ── 질문뱅크 로더 ───────────────────────────────────────────────────────


def _load_seed():
    return load_bank_file(_SEED_YAML, yaml.safe_load)


def test_seed_bank_covers_closed_set_and_matches_routing_table() -> None:
    entries = _load_seed()
    assert {e.intent for e in entries} == ROUTABLE_INTENTS  # 13종 전부, 그 밖은 없음
    assert len(entries) == 121  # v0.2-draft (yaml 헤더 명시)
    assert all(e.bank_version == "0.2-draft" and e.origin == "seed" for e in entries)
    assert all(not e.reviewed for e in entries)  # 아직 검수 전


def test_index_bank_refuses_unreviewed_entries_by_default() -> None:
    """ai/data/README.md: 검수 완료 전 임베딩·뱅크 편입 금지 — 조용히 건너뛰지 않고 거부."""
    store = InMemoryVectorStore()
    with pytest.raises(UnreviewedBankError) as exc:
        index_bank(_load_seed(), FakeEmbedding(dim=8), store)
    assert "GENERATE_SCHEDULE" in str(exc.value)
    assert store.search(BANK_COLLECTION, (1.0,) + (0.0,) * 7, top_k=5) == ()  # 부분 적재 없음


def test_index_bank_opt_in_indexes_everything() -> None:
    store = InMemoryVectorStore()
    entries = _load_seed()
    assert index_bank(entries, FakeEmbedding(dim=8), store, allow_unreviewed=True) == len(entries)


def test_seed_question_roundtrips_through_router_with_fake_embedding() -> None:
    """FakeEmbedding으로 검증 가능한 것: 동일 텍스트 매칭(의미 유사도 아님).

    top_k=1로 두는 이유 — 해시 임베딩에서는 top2가 무작위 의도라 "top1·top2 의도 일치"
    조건이 무의미하다. 동일 문장 왕복(로더 → 스토어 → 라우터)만 확인한다.
    """
    embedding, store = FakeEmbedding(dim=8), InMemoryVectorStore()
    index_bank(_load_seed(), embedding, store, allow_unreviewed=True)
    router = IntentRouter(embedding, store, config=IntentRouterConfig(top_k=1))
    match = router.route("다음 일정 뭐야?", _TID, _NOW)
    assert match.match_route is MatchRoute.CONFIDENT
    assert match.intent is Intent.GET_NEXT_SLOT
    assert math.isclose(match.confidence, 1.0, abs_tol=1e-9)


@pytest.mark.parametrize(
    "mutate, needle",
    [
        (lambda d: d["intents"][0].__setitem__("intent", "MAKE_COFFEE"), "closed-set"),
        (lambda d: d["intents"][0].__setitem__("intent", "OUT_OF_SCOPE"), "위임 대상이 아닌"),
        (lambda d: d["intents"][0].__setitem__("handler", "PlanBAgent"), "handler가 라우팅 테이블과"),
        (lambda d: d["intents"][0].__setitem__("mode", "FastPath"), "mode가 라우팅 테이블과"),
        (lambda d: d["intents"][0].__setitem__("mode", "Turbo"), "알 수 없는 mode"),
        (lambda d: d["intents"][0].__setitem__("reviewed", "yes"), "reviewed는 bool"),
        (lambda d: d["intents"][0].__setitem__("questions", []), "questions는"),
        (lambda d: d["intents"][0]["questions"].append("  "), "질문이 비어있음"),
        (
            lambda d: d["intents"][1]["questions"].append(d["intents"][0]["questions"][0]),
            "질문 완전중복",
        ),
        (lambda d: d.__setitem__("version", None), "version은"),
        (lambda d: d.__setitem__("intents", []), "intents는"),
    ],
)
def test_loader_rejects_structural_violations(mutate, needle) -> None:
    data = yaml.safe_load(_SEED_YAML.read_text(encoding="utf-8"))
    mutate(data)
    with pytest.raises(BankLoadError) as exc:
        load_bank(data)
    assert needle in str(exc.value)


def test_loader_reads_slot_pattern_into_payload() -> None:
    data = yaml.safe_load(_SEED_YAML.read_text(encoding="utf-8"))
    data["intents"][0]["slot_pattern"] = {"date": "regex:오늘|내일"}
    entries = load_bank(data)
    assert entries[0].payload()["slot_pattern"] == {"date": "regex:오늘|내일"}
    with pytest.raises(BankLoadError):
        data["intents"][0]["slot_pattern"] = {"date": 3}
        load_bank(data)


def test_routing_table_and_enum_stay_in_sync() -> None:
    assert set(ROUTING_TABLE) == set(Intent)
    assert len(ROUTABLE_INTENTS) == 13  # closed-set 13종 (CONFIRM/CANCEL/UNDO 제외)
    assert Intent.OUT_OF_SCOPE not in ROUTABLE_INTENTS


# ── PBT ─────────────────────────────────────────────────────────────────


def _pbt_router(gateways: bool) -> IntentRouter:
    embedding, store = FakeEmbedding(dim=8), InMemoryVectorStore()
    for idx, intent in enumerate(sorted(ROUTABLE_INTENTS, key=lambda i: i.value)):
        store.upsert(
            BANK_COLLECTION, f"b{idx}", embedding.embed(f"질문{idx}"), {"intent": intent.value}
        )
    if not gateways:
        return IntentRouter(embedding, store)
    return IntentRouter(
        embedding,
        store,
        # 게이트가 거부하는 응답 = LLM 실패 경로까지 함께 훑는다
        intent_gateway=_gateway("JSON 아님", _IntentGate()),
        paraphrase_gateway=_paraphrase_gw("변형1", "변형2", "변형3"),
    )


_utterances = st.text(max_size=60)


@settings(max_examples=60)
@given(utterance=_utterances, wired=st.booleans())
def test_route_never_raises_and_label_is_closed_set(utterance: str, wired: bool) -> None:
    match = _pbt_router(wired).route(utterance, _TID, _NOW)
    assert isinstance(match, IntentMatch)
    assert match.intent in ROUTABLE_INTENTS | {Intent.OUT_OF_SCOPE}  # 13종 ∪ 폴백 라벨
    assert 0.0 <= match.confidence <= 1.0
    if match.match_route is MatchRoute.FALLBACK:
        assert match.intent is Intent.OUT_OF_SCOPE
        assert match.reason  # 침묵 실패 금지 (INV-4)
    else:
        assert match.intent is not Intent.OUT_OF_SCOPE
    assert match.routing is ROUTING_TABLE[match.intent]


@settings(max_examples=40)
@given(utterance=_utterances, wired=st.booleans())
def test_route_is_deterministic(utterance: str, wired: bool) -> None:
    first = _pbt_router(wired).route(utterance, _TID, _NOW)
    second = _pbt_router(wired).route(utterance, _TID, _NOW)
    assert first == second
    assert IntentMatch.from_dict(first.to_dict()) == first


@settings(max_examples=40)
@given(utterance=_utterances)
def test_normalize_is_idempotent_and_trimmed(utterance: str) -> None:
    once = normalize(utterance)
    assert normalize(once) == once
    assert once == once.strip() and "  " not in once
