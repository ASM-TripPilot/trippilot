"""U8 도우미 대화 해석 경계 (`POST /ai/v1/dialogue/interpret`, FD §3 · G-U8-4).

AI 는 해석만 한다(DEC-U8-1). 여기서 고정하는 것:
- 결과 셋(FRAME · ARGUMENT_CLARIFY · OUT_OF_SCOPE)의 모양과 전이
- 되묻기는 요청당 1회, 답은 **물은 인자로** 읽는다(FD assistant-dialogue §2.1)
- 짧은 답이라도 다른 요청이 확실하면 답으로 삼키지 않는다
- 상태는 들고 있지 않는다 — `dialogue_context` 를 받아 갱신본을 돌려준다
- `llm_calls` 는 실제로 일어난 호출 수다(백엔드 사용량 상한의 원천)
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from trippilot.agents.adapters.memory_vector_store import InMemoryVectorStore
from trippilot.api.wiring import build_dev_app
from trippilot.domain.common import TraceId
from trippilot.domain.dialogue import CLARIFY_QUESTIONS, specs_of
from trippilot.domain.intent import ROUTABLE_INTENTS, Intent
from trippilot.domain.llm import ModelTier
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.intent import IntentGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.orchestrator.dialogue_interpreter import (
    BankIndex,
    CountingLlm,
    DialogueContext,
    DialogueInterpreter,
    PendingFrame,
    TripView,
)
from trippilot.orchestrator.intent_router import IntentRouter
from trippilot.orchestrator.question_bank import BANK_COLLECTION, BankEntry

_TID = TraceId("t-dialogue")
_NOW = datetime(2026, 10, 14, 3, 0, tzinfo=timezone.utc)
_PROMPTS = Path(__file__).resolve().parents[2] / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
_TRIP = TripView(day_count=3, slot_names=("카페 모카", "해운대", "카페 모카", "광안리", "자갈치"))


class _Angles:
    """각도 → 2차원 단위벡터. 대본에 없는 텍스트는 뱅크에서 멀다."""

    dim = 2
    model_id = "scripted"

    def __init__(self, angles: dict[str, float]) -> None:
        self._a = angles

    def embed(self, text: str) -> tuple[float, ...]:
        t = self._a.get(text, -1.6)  # 대본 밖 = 어느 뱅크 문장과도 멀다
        return (math.cos(t), math.sin(t))

    def embed_batch(self, texts):
        return tuple(self.embed(t) for t in texts)


_BANK = {"D1": (0.0, Intent.GET_DISTANCE), "D2": (0.05, Intent.GET_DISTANCE),
         "W1": (1.0, Intent.GET_WEATHER), "W2": (1.05, Intent.GET_WEATHER),
         "X1": (2.0, Intent.OUT_OF_SCOPE), "X2": (2.05, Intent.OUT_OF_SCOPE)}
_QUERIES = {"거리 알려줘": 0.0, "날씨 알려줘": 1.0, "주식 어때": 2.0}


def _interpreter(llm=None) -> DialogueInterpreter:
    store = InMemoryVectorStore()
    for item_id, (t, intent) in _BANK.items():
        store.upsert(BANK_COLLECTION, item_id, (math.cos(t), math.sin(t)), {"intent": intent.value})
    gw = None
    if llm is not None:
        gw = GatewayFacade(CountingLlm(llm), PromptRegistry(_PROMPTS), IntentGate(), _CFG, InMemoryTrace())
    return DialogueInterpreter(IntentRouter(_Angles(_QUERIES), store, intent_gateway=gw))


def _run(it: DialogueInterpreter, text: str, ctx: DialogueContext | None = None):
    return it.interpret(text, ctx or DialogueContext(), _TRIP, _TID, _NOW)


# ── 한 턴의 세 결과 ──────────────────────────────────────────────────────


def test_missing_required_argument_asks_once_with_fixed_question_and_options() -> None:
    r = _run(_interpreter(), "거리 알려줘")
    assert r.outcome == "ARGUMENT_CLARIFY"
    assert r.frames[0].intent is Intent.GET_DISTANCE and r.frames[0].missing == ("destination",)
    assert r.clarify.argument == "destination"
    assert r.clarify.question == CLARIFY_QUESTIONS[(Intent.GET_DISTANCE, "destination")]
    # 보기는 여행 스냅샷의 슬롯 이름 — 중복 없이, 상한까지
    assert r.clarify.options == ("카페 모카", "해운대", "광안리", "자갈치")
    assert r.context.pending.asked == "destination" and r.context.clarify_count == 1
    assert r.llm_calls == 0  # 1차 확정 — LLM 0회


def test_out_of_scope_anchor_refuses_and_clears_state() -> None:
    r = _run(_interpreter(), "주식 어때", DialogueContext(turn_index=7))
    assert r.outcome == "OUT_OF_SCOPE" and r.frames[0].intent is Intent.OUT_OF_SCOPE
    assert r.context.pending is None and r.context.turn_index == 7


# ── 되묻기의 답 ──────────────────────────────────────────────────────────


def _asked_distance() -> DialogueContext:
    return DialogueContext(
        pending=PendingFrame(Intent.GET_DISTANCE, {}, "destination", 0.95),
        turn_index=4, clarify_count=1)


def test_short_answer_fills_the_asked_argument() -> None:
    r = _run(_interpreter(), "카페 모카", _asked_distance())
    assert r.outcome == "FRAME"
    f = r.frames[0]
    assert f.intent is Intent.GET_DISTANCE and f.arguments == {"destination": "카페 모카"}
    assert f.missing == () and f.match_route == "CLARIFY_ANSWER"
    assert r.context.pending is None and r.context.clarify_count == 0
    assert r.context.turn_index == 4  # 턴 번호는 백엔드가 올린다 — 읽기만 한다


def test_a_confident_different_request_is_not_swallowed_as_an_answer() -> None:
    """"날씨 알려줘"를 목적지로 받으면 안 된다 — 1차가 다른 의도를 확정하면 새 요청이다."""
    r = _run(_interpreter(), "날씨 알려줘", _asked_distance())
    assert r.frames[0].intent is Intent.GET_WEATHER
    assert r.outcome == "FRAME" and r.context.pending is None


def test_asked_field_outside_the_table_skips_extractors() -> None:
    """`confirm` 같은 입력 필드는 인자표 밖이다 — 추출기를 돌리지 않고 새 요청으로 읽는다."""
    ctx = DialogueContext(pending=PendingFrame(Intent.EDIT_SCHEDULE, {}, "confirm", 0.9))
    r = _run(_interpreter(), "거리 알려줘", ctx)
    assert r.frames[0].intent is Intent.GET_DISTANCE


# ── 상태 직렬형 ──────────────────────────────────────────────────────────


def test_context_round_trips() -> None:
    ctx = _asked_distance()
    assert DialogueContext.from_dict(json.loads(json.dumps(ctx.to_dict()))) == ctx


def test_broken_context_is_dropped_not_fatal() -> None:
    """저장된 보류가 깨졌다고 턴을 죽이면 그 세션에서 다시는 말을 못 건다."""
    ctx = DialogueContext.from_dict({"pending": {"intent": "NOPE"}, "turn_index": 3})
    assert ctx.pending is None and ctx.turn_index == 3
    assert DialogueContext.from_dict(None) == DialogueContext()


# ── LLM 호출 수 ─────────────────────────────────────────────────────────


def test_llm_calls_counts_third_stage() -> None:
    llm = FakeLlm(canned=json.dumps({"intent": "GET_WEATHER", "slots": {}, "confidence": 0.8}))
    r = _run(_interpreter(llm), "생전 처음 듣는 말")  # 1차·2차 밖 → 3차
    assert r.frames[0].intent is Intent.GET_WEATHER and r.frames[0].match_route == "LLM_DIRECT"
    assert r.llm_calls == 1


# ── 뱅크 색인 ───────────────────────────────────────────────────────────


class _FlakyEmbedding(_Angles):
    def __init__(self) -> None:
        super().__init__({})
        self.fail = True

    def embed_batch(self, texts):
        if self.fail:
            raise RuntimeError("embedding down")
        return super().embed_batch(texts)


def test_bank_index_retries_after_outage() -> None:
    now = [0.0]
    emb, store = _FlakyEmbedding(), InMemoryVectorStore()
    entry = BankEntry(entry_id="E1", intent=Intent.GET_WEATHER, question="날씨", reviewed=True,
                      origin="seed", bank_version="t")
    idx = BankIndex((entry,), emb, store, retry_after_s=60, clock=lambda: now[0])
    idx.ensure()
    assert not idx.indexed  # 실패해도 해석을 죽이지 않는다
    emb.fail = False
    idx.ensure()
    assert not idx.indexed  # 재시도 간격 전
    now[0] = 61
    idx.ensure()
    assert idx.indexed and store.search(BANK_COLLECTION, (1.0, 0.0), 1)


# ── 표 정합 ─────────────────────────────────────────────────────────────


def test_every_required_argument_has_a_clarify_question() -> None:
    required = {(i, s.name) for i in ROUTABLE_INTENTS for s in specs_of(i) if s.required}
    assert required == set(CLARIFY_QUESTIONS)


# ── 경계 ────────────────────────────────────────────────────────────────


def _body(utterance: str, dialogue_context=None) -> dict:
    return {
        "request_meta": {"request_id": "r-1", "requested_at": "2026-10-14T03:00:00Z", "deadline_ms": 6000},
        "utterance": utterance,
        "dialogue_context": dialogue_context,
        "context": {
            "surface": "ITINERARY",
            "trip": {"trip_id": "t-1", "regions": ["부산"], "start_date": "2026-11-01",
                     "end_date": "2026-11-03", "phase": "PLANNING"},
            "base_stays": ["서면 호텔"],
            "itinerary": {"status": "PLANNED", "days": [{"date": "2026-11-02", "slots": [
                {"slot_key": "2026-11-02#p1", "name": "카페 모카", "start_at": "14:00", "category": "CAFE"}]}]},
        },
    }


def test_boundary_is_wired_and_degrades_deterministically_without_llm() -> None:
    """LLM·임베딩 미배선 조립에서도 200 — 범위 밖으로 결정론 폴백한다(INV-4)."""
    client = TestClient(build_dev_app())
    res = client.post("/ai/v1/dialogue/interpret", json=_body("둘째 날 카페 바꿔줘"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outcome"] == "OUT_OF_SCOPE"
    assert body["frames"][0]["intent"] == "OUT_OF_SCOPE"
    assert body["dialogue_context"]["pending"] is None


def test_rule_extraction_never_emits_handler_owned_op() -> None:
    """1·2차 규칙 추출도 3차 게이트와 같은 표를 본다 — `op` 는 핸들러 몫이라 싣지 않는다.

    실측(2026-10-14): 2차로 확정된 편집 프레임에 `op: REPLACE_SLOT` 이 실려 나갔다. 추출기는
    "바꿔줘" 에서 `REPLACE_SLOT` 을 정확히 뽑지만, 묻지 않기로 한 인자를 1·2차만 내보내면
    경로마다 프레임 모양이 다시 갈라진다.
    """
    store = InMemoryVectorStore()
    store.upsert(BANK_COLLECTION, "E1", (1.0, 0.0), {"intent": Intent.EDIT_SCHEDULE.value})
    store.upsert(BANK_COLLECTION, "E2", (1.0, 0.0), {"intent": Intent.EDIT_SCHEDULE.value})
    router = IntentRouter(_Angles({"2일차 카페 교체해줘": 0.0}), store)
    match = router.route("2일차 카페 교체해줘", _TID, _NOW)
    assert match.intent is Intent.EDIT_SCHEDULE
    assert "op" not in match.slots and match.slots.get("day")


def test_boundary_rejects_overlong_utterance() -> None:
    client = TestClient(build_dev_app())
    assert client.post("/ai/v1/dialogue/interpret", json=_body("가" * 501)).status_code == 422
