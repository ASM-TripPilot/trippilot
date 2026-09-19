"""U6-01(TRIP-242) — IntentRouter 3단 매칭 + 결정론 폴백 + 질문뱅크 로더.

**FakeEmbedding의 한계 우회**: FakeEmbedding은 해시 기반이라 의미 유사도가 없다.
따라서 임계값 시나리오(T_high 통과·의도 혼재·T_mid 미달·투표)는 전부
`_ScriptedEmbedding`(2차원 단위벡터, 각도로 코사인을 직접 지정) + InMemoryVectorStore에
**벡터를 직접 주입**해 구성한다. FakeEmbedding은 "동일 텍스트 왕복 매칭"(실제 seed 뱅크 e2e)과
PBT의 임의 입력 처리에만 쓴다.

**LLM 단계**: 실물 GatewayFacade + FakeLlm(결정론 canned) + **실물 PromptRegistry
(prompts/intent.yaml·paraphrase.yaml) + 실물 게이트**(IntentGate·ParaphraseGate) — TRIP-313에서
배선이 완성돼 대역이 사라졌다. 즉 이 파일의 2·3차 테스트는 전부 실제 경로를 탄다.
게이트 자체의 단위 검증과 배선 e2e는 `test_c1_intent_gates.py`.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.intent import IntentGate
from trippilot.llm_gateway.gates.paraphrase import ParaphraseGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.domain.common import TraceId
from trippilot.domain.intent import (
    ROUTABLE_INTENTS,
    ROUTING_TABLE,
    Intent,
    IntentMatch,
    MatchRoute,
    RoutingMode,
)
from trippilot.domain.llm import LlmFeature, ModelTier
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
_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"


# ── 테스트 대역 ─────────────────────────────────────────────────────────


class _ScriptedEmbedding:
    """각도 → 2차원 단위벡터. 코사인 유사도 = 두 각도 차의 cos — 임계값을 정확히 조준한다."""

    dim = 2
    model_id = "scripted-angles"  # 실모델과 collection 이 갈리게
    _FAR = 2.5  # 대본에 없는 텍스트는 뱅크에서 멀리 (rad)

    def __init__(self, angles: dict[str, float]) -> None:
        self._angles = angles

    def embed(self, text: str) -> tuple[float, ...]:
        theta = self._angles.get(text, self._FAR)
        return (math.cos(theta), math.sin(theta))

    def embed_batch(self, texts):
        return tuple(self.embed(t) for t in texts)


def _gateway(canned: str, gate) -> GatewayFacade:
    """실물 파이프라인 — 실물 프롬프트 yaml·실물 게이트, LLM만 결정론 fake (D37)."""
    return GatewayFacade(
        FakeLlm(canned=canned), PromptRegistry(_PROMPTS_DIR), gate, _CFG, InMemoryTrace()
    )


def _paraphrase_gw(*questions: str) -> GatewayFacade:
    return _gateway(json.dumps({"questions": list(questions)}), ParaphraseGate())


def _intent_gw(intent: str, slots: dict | None = None, confidence: float | None = None) -> GatewayFacade:
    body: dict = {"intent": intent, "slots": slots or {}}
    if confidence is not None:
        body["confidence"] = confidence
    return _gateway(json.dumps(body), IntentGate())


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
    *, extra_angles: dict[str, float] | None = None,
    bank: dict[str, tuple[float, Intent]] | None = None, **kwargs
) -> IntentRouter:
    embedding = _ScriptedEmbedding({**_QUERY_ANGLES, **(extra_angles or {})})
    store = InMemoryVectorStore()
    for item_id, (theta, intent) in (bank or _BANK_ANGLES).items():
        store.upsert(
            BANK_COLLECTION,
            item_id,
            (math.cos(theta), math.sin(theta)),
            {"intent": intent.value, "question": item_id},
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


def test_confident_fills_arguments_from_the_intent_table() -> None:
    """인자는 **뱅크 엔트리가 아니라 의도의 인자표**에서 온다 (FD §3).

    엔트리별 `slot_pattern` 을 폐기한 자리다 — 뱅크가 485문장이고 증강으로 계속 느는데
    문장마다 패턴을 달 수 없고, 같은 `date` 를 의도마다 다르게 뽑는 드리프트가 난다.
    """
    router = _scripted_router(
        bank={"W1": (0.00, Intent.GET_WEATHER)},
        extra_angles={"내일 확실한 질문": 0.0},
    )
    match = router.route("내일 확실한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.CONFIDENT
    assert match.slots == {"date": "내일"}  # GET_WEATHER.date 가 표에 있다


def test_confident_when_competing_intent_is_far_even_if_it_is_top2() -> None:
    """1차 확정 조건은 "top2 가 같은 의도" 가 아니라 **다른 의도와 충분히 벌어졌는가** 다.

    뱅크가 커지면 top2 가 우연히 타 의도인 경우가 흔해져, 종전 규칙에서는 **커질수록 1차가 덜
    확정되는** 역전이 난다(밀도가 올라가는데 확정률이 떨어진다). 여기서는 top1(W1 1.000) 바로
    아래가 타 의도(D_FAR 0.800)지만 0.200 이나 벌어져 있으니 확정해야 한다 —
    같은 의도 이웃이 그 사이에 없어도 마찬가지다.
    """
    router = _scripted_router(
        bank={"W1": (0.00, Intent.GET_WEATHER), "D_FAR": (0.6435, Intent.GET_DISTANCE)},
        extra_angles={"확실한 질문": 0.00},
    )
    match = router.route("확실한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.CONFIDENT
    assert match.intent is Intent.GET_WEATHER


def test_unextractable_arguments_do_not_break_routing() -> None:
    """추출 실패는 `None` 이고 예외가 아니다 — 의도는 이미 정해졌고 인자만 빈다."""
    router = _scripted_router()
    match = router.route("확실한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.CONFIDENT and match.slots == {}


def test_overlong_utterance_is_refused_not_truncated() -> None:
    """길이 상한 초과는 **거절**이지 자르기가 아니다 (프롬프트 인젝션 방어).

    상한이 없으면 임의 길이가 그대로 2·3차 프롬프트에 실린다 — 비용·지연이 입력에 비례하고
    긴 입력은 지시문을 숨길 자리를 준다. 잘라 내면 뜻이 바뀐 발화를 사용자 것인 양 처리하게
    되므로(INV-4: 조용한 변형 금지) 사유를 싣고 폴백한다.
    """
    router = _scripted_router()  # 게이트웨이 미주입 — LLM 을 부르면 그 자리에서 터진다
    match = router.route("확" * 501, _TID, _NOW)
    assert match.match_route is MatchRoute.FALLBACK
    assert match.intent is Intent.OUT_OF_SCOPE
    assert "utterance_too_long" in match.reason


def test_length_is_measured_after_normalisation() -> None:
    """공백·제어문자를 섞어 상한을 우회하는 입력은 정규화 **뒤** 길이로 판정된다."""
    router = _scripted_router(extra_angles={"확실한 질문": 0.0})
    padded = "확실한" + " " * 2000 + "질문"
    match = router.route(padded, _TID, _NOW)
    assert match.match_route is MatchRoute.CONFIDENT  # 정규화하면 6자다


def test_utterance_at_the_cap_still_routes() -> None:
    """상한 자체는 통과해야 한다 — off-by-one 으로 정상 발화를 막으면 안 된다."""
    router = _scripted_router(extra_angles={"확" * 500: 0.0})
    match = router.route("확" * 500, _TID, _NOW)
    assert match.match_route is not MatchRoute.FALLBACK or "too_long" not in (match.reason or "")


def test_config_rejects_a_nonpositive_cap() -> None:
    with pytest.raises(ValueError, match="max_utterance_chars"):
        IntentRouterConfig(max_utterance_chars=0)


# ── 2차: 의도 혼재 → 유사질문 투표 ──────────────────────────────────────


def test_mixed_top2_triggers_vote_and_confirms() -> None:
    # 투표 경로 자체를 검증한다 — 임계는 §5 설정값(기본 0.80, TRIP-678)이므로 대본 득표율 0.75 가
    # 확정되도록 명시한다. 기본값 아래에서는 같은 대본이 3차로 승격한다(아래 테스트).
    router = _scripted_router(
        paraphrase_gateway=_paraphrase_gw("유사질문-날씨A", "유사질문-날씨B", "유사질문-거리A"),
        config=IntentRouterConfig(vote_ratio=0.60),
    )
    match = router.route("애매한 질문", _TID, _NOW)
    # 가중 투표: WEATHER 0.9998+1+1 = 2.9998 / DISTANCE 1.0 → 득표율 0.75 ≥ 0.60
    assert match.match_route is MatchRoute.VOTED
    assert match.intent is Intent.GET_WEATHER
    assert math.isclose(match.confidence, 0.75, abs_tol=1e-3)


def test_default_vote_ratio_sends_two_way_tie_to_llm_direct() -> None:
    """기본 vote_ratio 0.80 고정(TRIP-678 실측): 0.75 동률대 대본은 기본 설정에서 3차로 승격한다.
    누가 기본값을 0.60 으로 되돌리면 이 테스트가 잡는다."""
    router = _scripted_router(
        paraphrase_gateway=_paraphrase_gw("유사질문-날씨A", "유사질문-날씨B", "유사질문-거리A"),
        intent_gateway=_intent_gw("GET_WEATHER"),
    )
    match = router.route("애매한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.LLM_DIRECT
    assert "vote_ratio(0.750)" in match.reason


def test_vote_below_ratio_escalates_to_llm_direct() -> None:
    router = _scripted_router(
        paraphrase_gateway=_paraphrase_gw("유사질문-거리A", "유사질문-거리B", "유사질문-날씨A"),
        intent_gateway=_intent_gw("EDIT_SCHEDULE", {"target": "저녁"}, 0.71),
    )
    match = router.route("애매한 질문", _TID, _NOW)
    # DISTANCE 2.0 / WEATHER 1.9998 → 득표율 0.500 < vote_ratio(기본 0.80) → 3차로
    assert match.match_route is MatchRoute.LLM_DIRECT
    assert match.intent is Intent.EDIT_SCHEDULE
    assert match.slots == {"target": "저녁"}
    assert math.isclose(match.confidence, 0.71)
    assert "ambiguous" in match.reason and "vote_ratio" in match.reason


def test_paraphrase_failure_escalates_not_silently_votes() -> None:
    """유사질문 생성이 실패했을 때 원문 1표만으로 확정하면 애매함이 은폐된다 → 3차로."""
    router = _scripted_router(
        paraphrase_gateway=_gateway("깨진 응답", ParaphraseGate()),
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
    router = IntentRouter(_ScriptedEmbedding(_QUERY_ANGLES), store)
    match = router.route("확실한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.FALLBACK
    assert "bank_miss" in match.reason


def test_out_of_scope_anchor_winning_the_vote_refuses_instead_of_crashing() -> None:
    """2차 투표가 거부 앵커를 승자로 뽑아도 거절로 수렴한다 (거부 앵커 후속 결함).

    앵커를 뱅크에 넣은 순간 **2차도 앵커를 뽑을 수 있게 됐다.** 그런데 `_vote` 는 승자를
    `MatchRoute.VOTED` 로 감싸고, `IntentMatch` 는 "FALLBACK 경로 ⇔ OUT_OF_SCOPE 라벨" 을
    강제한다 — 그래서 ValueError 가 났다.

    증상이 고약했다: 라우터가 그 예외를 잡아 폴백으로 바꾸므로 **결과는 우연히 거절이라 맞다.**
    사유만 `router_error: ValueError ...` 였고, 채점에서는 거절 표지가 없어 '비거절 폴백' 1건으로
    조용히 잡혔다. 평가셋 87건 중 1건이라 잡음으로 읽히기 딱 좋았다.
    """
    # 앵커 하나만 둔 뱅크 — 원문도 재질의도 전부 앵커에 붙어 2차 승자가 OUT_OF_SCOPE 가 된다
    router = _scripted_router(
        bank={"OOS1": (0.00, Intent.OUT_OF_SCOPE), "E1": (1.50, Intent.EDIT_SCHEDULE)},
        # 0.66 → top1 0.790: t_mid(0.75) 위·t_high(0.82) 아래라 **2차로 간다**.
        # 재질의 변형 셋이 전부 앵커에 딱 붙어(1.000) 득표율 1.0 → 승자가 OUT_OF_SCOPE 가 된다.
        extra_angles={"범위 밖 질문": 0.66, "변형1": 0.00, "변형2": 0.00, "변형3": 0.00},
        paraphrase_gateway=_paraphrase_gw("변형1", "변형2", "변형3"),
    )
    match = router.route("범위 밖 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.FALLBACK
    assert match.intent is Intent.OUT_OF_SCOPE
    assert "out_of_scope_anchor" in match.reason  # 거절 표지 — 인프라 실패로 세지 않는다
    assert "router_error" not in match.reason  # 예외로 수렴하면 안 된다


def test_out_of_scope_anchor_refuses_at_stage_one_without_calling_llm() -> None:
    """거부 앵커가 1차에서 이기면 **LLM 0회로 거절**한다 (TRIP-868).

    앵커가 없으면 딴소리도 13종 중 가장 덜 먼 곳에 붙는다 — 그래서 앵커는 매칭 대상이어야 하고,
    이겼을 때의 행동만 다르다(위임 대신 거절). 문턱은 CONFIDENT 와 같은 값을 쓴다.
    """
    store = InMemoryVectorStore()
    store.upsert(BANK_COLLECTION, "OOS#00", (1.0, 0.0), {"intent": "OUT_OF_SCOPE"})
    # LLM 게이트웨이를 주지 않는다 — 호출하면 그 자리에서 터진다(= 0회임을 구조로 증명)
    router = IntentRouter(_ScriptedEmbedding(_QUERY_ANGLES), store)
    match = router.route("확실한 질문", _TID, _NOW)
    assert match.match_route is MatchRoute.FALLBACK
    assert match.intent is Intent.OUT_OF_SCOPE
    assert "out_of_scope_anchor" in match.reason  # 거절 표지 — 인프라 실패와 구분된다


# ── 폴백: 결정론 + 침묵 금지 (INV-4) ────────────────────────────────────


def test_llm_failure_falls_back_with_reason() -> None:
    router = _scripted_router(
        intent_gateway=GatewayFacade(
            FailingLlm(), PromptRegistry(_PROMPTS_DIR), IntentGate(), _CFG, InMemoryTrace()
        )
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
    # 위임 대상 13종 전부 + 거부 앵커 1종 (TRIP-868) — 그 밖의 라벨은 없다
    assert {e.intent for e in entries} == ROUTABLE_INTENTS | {Intent.OUT_OF_SCOPE}
    assert len(entries) == 485  # v0.7 (seed 125 + §3.2 ② 증강 325 + 거부 앵커 35)
    assert sum(1 for e in entries if e.intent is Intent.OUT_OF_SCOPE) == 35
    assert all(e.bank_version == "0.7" for e in entries)
    assert all(e.reviewed for e in entries)  # 사람 검수(seed) · 기계 관문(증강) 통과분만 실린다
    by_origin = Counter(e.origin for e in entries)
    # 앵커도 seed 다 — 사람이 직접 썼고 증강 대상이 아니다(범위 밖은 열린 집합이라 불려도 의미가 없다)
    assert by_origin == {"seed": 160, "augmented": 325}  # 출처가 구분돼 되돌릴 수 있다


def test_each_intent_block_declares_augmented_at_most_once() -> None:
    """의도 하나에 `augmented:` 키가 둘이면 yaml 은 조용히 뒤엣것만 남긴다 — 앞의 증강분이 통째로 사라진다.

    `augment_bank.py --apply` 를 두 번째로 돌릴 때 실제로 날 수 있는 사고라 파일 자체를 센다
    (로더는 파싱된 뒤를 보므로 이 사고를 볼 수 없다).
    """
    current: str | None = None
    seen: Counter[str] = Counter()
    for line in _SEED_YAML.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("- intent:"):
            current = stripped.split(":", 1)[1].strip()
        elif stripped == "augmented:" and current:
            seen[current] += 1
    assert seen and max(seen.values()) == 1, f"중복 augmented 키: {[k for k, v in seen.items() if v > 1]}"


def test_reviewed_seed_bank_indexes_without_opt_in() -> None:
    """검수 완료(reviewed: true)라 `allow_unreviewed` 없이 실 적재 경로를 탄다 — 그게 검수의 목적이다."""
    store = InMemoryVectorStore()
    entries = _load_seed()
    assert index_bank(entries, FakeEmbedding(dim=8), store) == len(entries)


def test_index_bank_refuses_unreviewed_entries_by_default() -> None:
    """ai/data/README.md: 검수 완료 전 임베딩·뱅크 편입 금지 — 조용히 건너뛰지 않고 거부.

    seed 뱅크가 검수를 통과한 뒤로는 실물로 이 경로를 못 타므로 미검수 엔트리를 만들어 검증한다
    (규칙은 미래의 augmented·mined 편입분에 계속 적용된다 — §3.2 ②③).
    """
    raw = yaml.safe_load(_SEED_YAML.read_text(encoding="utf-8"))
    raw["intents"][0]["reviewed"] = False
    store = InMemoryVectorStore()
    with pytest.raises(UnreviewedBankError) as exc:
        index_bank(load_bank(raw), FakeEmbedding(dim=8), store)
    assert "GENERATE_SCHEDULE" in str(exc.value)
    assert store.search(BANK_COLLECTION, (1.0,) + (0.0,) * 7, top_k=5) == ()  # 부분 적재 없음


def test_augmented_questions_load_with_their_own_origin() -> None:
    """§3.2 ② 증강분은 `augmented:` 목록으로 따로 싣고 `origin` 이 구분돼야 한다.

    수기 seed 와 LLM 생성분을 한 목록에 섞으면 뱅크가 "전부 사람이 쓴 문장" 이라고 거짓말한다 —
    나중에 증강분만 되돌리거나 마이닝분(§3.2 ③)을 분리 추적할 수단도 사라진다.
    """
    raw = {
        "version": "t", "origin": "seed",
        "intents": [{
            "intent": "GET_WEATHER", "handler": "WeatherAgent", "mode": "FastPath",
            "reviewed": True,
            "questions": ["내일 날씨 어때?"],
            "augmented": ["낼 날씨 어떰?", "내일 비 오나요?"],
        }],
    }
    entries = load_bank(raw)
    assert [e.question for e in entries] == ["내일 날씨 어때?", "낼 날씨 어떰?", "내일 비 오나요?"]
    assert [e.origin for e in entries] == ["seed", "augmented", "augmented"]
    assert len({e.entry_id for e in entries}) == 3  # id 충돌 없음
    assert all(e.reviewed for e in entries)


def test_augmented_question_duplicating_a_seed_is_rejected() -> None:
    raw = {
        "version": "t", "origin": "seed",
        "intents": [{
            "intent": "GET_WEATHER", "handler": "WeatherAgent", "mode": "FastPath",
            "reviewed": True, "questions": ["내일 날씨 어때?"], "augmented": ["내일 날씨 어때?"],
        }],
    }
    with pytest.raises(BankLoadError) as exc:
        load_bank(raw)
    assert "완전중복" in str(exc.value)


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
        # OUT_OF_SCOPE 는 이제 거부 앵커로 실릴 수 있다(TRIP-868) — 다만 handler·mode 가 함께 맞아야
        # 한다. 라벨만 바꾸면 라우팅 표와 어긋나 드리프트 검사에 걸린다.
        (lambda d: d["intents"][0].__setitem__("intent", "OUT_OF_SCOPE"), "handler가 라우팅 테이블과"),
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


def test_routing_table_and_enum_stay_in_sync() -> None:
    assert set(ROUTING_TABLE) == set(Intent)
    assert len(ROUTABLE_INTENTS) == 13  # closed-set 13종 (CONFIRM/CANCEL/UNDO 제외)
    assert Intent.OUT_OF_SCOPE not in ROUTABLE_INTENTS


def test_delegate_handlers_name_real_agent_classes() -> None:
    """DELEGATE 행의 handler 문자열은 `agents/` 에 실재하는 클래스여야 한다.

    ScheduleAgent(#480)·PlanBAgent(개명 전 PlanBRagPipeline)는 표가 먼저 이름을 적고
    코드가 뒤따랐다 — 라우터가 배선되기 전까지는 아무도 안 읽어서 어긋나도 증상이 없다.
    FAST_PATH 의 Weather/Transit/PlaceScout 는 v2 에서 Provider 라 이 검사 밖이다.
    """
    import importlib

    delegated = {e.handler for e in ROUTING_TABLE.values() if e.mode is RoutingMode.DELEGATE}
    assert delegated == {"ScheduleAgent", "PlanBAgent", "ReflectAgent", "EditAgent"}
    modules = {
        "ScheduleAgent": "trippilot.agents.schedule.agent",
        "PlanBAgent": "trippilot.agents.planb.rag",
        "ReflectAgent": "trippilot.agents.reflect.agent",
        "EditAgent": "trippilot.agents.edit.agent",
    }
    for name in delegated:
        assert isinstance(getattr(importlib.import_module(modules[name]), name), type), name


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
        intent_gateway=_gateway("JSON 아님", IntentGate()),
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


# deadline 을 끈다 — 이 테스트는 **예제마다 라우터를 두 번 새로 만든다**(같은 입력이 서로 다른
# 인스턴스에서도 같은 답을 내는지가 속성이라 하나를 재사용할 수 없다). 그 구성 비용이 기본 200ms
# 를 넘나들어, 머신이 바쁠 때 속성이 아니라 **부하**를 재게 된다(실측 2회: 319ms·단독 실행 시 통과).
# 여기서 잡고 싶은 것은 결정론이지 속도가 아니다.
@settings(max_examples=40, deadline=None)
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
