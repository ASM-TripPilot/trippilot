"""`POST /ai/v1/dialogue/interpret` — 도우미 오케스트레이터 **on** 왕복 (assistant-orchestrator T014·T016·T018,
FD DE §2.1·§3.1·§3.2·§5 · BLM §3·§9 · BR-AO-01·07·08·13).

실 LLM·실 DB·실 HTTP 0 — `build_dev_app` **실조립**(배선 게이트 선례: 스텁 전용 금지) + `FeatureRoutingLlm`·`InMemoryPoi`·
fake `WeatherPort`. 증명하는 것:

  ① on: GET_NEXT_SLOT·GET_WEATHER·SUGGEST_ALTERNATIVE 세 턴이 **200 ANSWER** — kind·next_actions ≥1·분류 프레임 1개(LLM_DIRECT)·
     `llm_calls` 2(분류+답변, 서비스 호출만). 날씨는 fake 포트 값(80%)이 rows 에, 대안은 InMemory 풀 **안의** id 만(INV-1)
     + PICK_CANDIDATE 짝. 응답 키 집합 = 종전 5키 + `answer`, 본문에 INV-3 금칙 토큰 0
  ② off(기본): 종전 `DialogueInterpreter` 경로 **그대로** — FRAME, `answer` null (기존 테스트 무변경 통과의 근거)
  ③ 사영: `deadline_ms` 미지정 → 9_000, 지정값 관통 · session_id·account_ref·recent_turns·started_ms(주입 시계)가 `TurnInput` 에
     그대로 · 오케스트레이터 경로에 clock 이 없으면 ValueError(잔여 원점 불일치 금지)
  ④ 섀도: on 이면 분류 직후 submit — `intent_shadow` 1줄(발화 원문·account_ref 부재, meta 에 뱅크 지문·임계·프롬프트 판본),
     rate 0 이면 `intent_shadow_skipped`; 어느 쪽이든 응답 `llm_calls` 는 섀도를 세지 않는다(BR-AO-07)
"""

from __future__ import annotations

import json
import logging
import random
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_llm import FeatureRoutingLlm
from tests.fakes.in_memory_poi import InMemoryPoi
from trippilot.api import dialogue as projection
from trippilot.api import schemas
from trippilot.api.wiring import build_dev_app
from trippilot.domain.common import GeoPoint
from trippilot.domain.llm import LlmFeature
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.orchestrator.dialogue_orchestrator import TurnOutcome, capabilities_answer
from trippilot.orchestrator.dialogue_interpreter import DialogueContext

URL = "/ai/v1/dialogue/interpret"
_KST = timezone(timedelta(hours=9))
_D1, _D2 = date(2026, 10, 18), date(2026, 10, 19)
_NOW = "2026-10-19T10:00:00+09:00"  # 둘째 날 10:00 — 우도(첫날)는 지났고 해녀의집(12:00)이 다음 슬롯
_ANCHOR = GeoPoint(33.45, 126.56)
_ACCOUNT = "acct-77"
_INTENT, _ANSWER = LlmFeature.DIALOGUE_INTENT, LlmFeature.DIALOGUE_ANSWER
# INV-3 — 와이어 어디에도 소요시간 어휘가 없다 (`test_api_openapi_contract` 의 필드명 게이트와 같은 토큰)
_FORBIDDEN_TOKENS = ("duration", "minutes", "stay_min", "travel_time", "elapsed")


# 슬롯 키 `{date}#{poiId}` 의 poiId 는 UUID 여야 한다(BE PlannedSlotView.slotKey — `parse_slot_key` 가 검사한다)
_ID = {n: str(uuid.uuid5(uuid.NAMESPACE_DNS, n)) for n in ("우도", "해녀의집", "카페 모카", "성산일출봉", "섭지코지", "아쿠아플라넷")}


def _poi(name: str, category: PoiCategory, off: float) -> Poi:
    return Poi(
        poi_id=_ID[name], name=name, category=category, coord=GeoPoint(_ANCHOR.lat + off, _ANCHOR.lng + off),
        open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None,
    )


# 일정 안 3곳 + 일정 밖(대안 후보) 3곳 — 전부 PUBLIC 반경(10km) 안
_SCHEDULED = (_poi("우도", PoiCategory.SIGHT, 0.0), _poi("해녀의집", PoiCategory.FOOD, 0.005),
              _poi("카페 모카", PoiCategory.CAFE, 0.01))
_ALTS = (_poi("성산일출봉", PoiCategory.SIGHT, 0.015), _poi("섭지코지", PoiCategory.SIGHT, 0.02),
         _poi("아쿠아플라넷", PoiCategory.SIGHT, 0.025))
_ALT_IDS = {p.poi_id for p in _ALTS}
_UDO_SLOT_KEY = f"{_D1.isoformat()}#{_ID['우도']}"


class _Weather:
    """WeatherPort — 묻는 날짜 전부 강수확률 80%. 실 호출 0."""

    def __init__(self) -> None:
        self.calls: list[tuple[GeoPoint, tuple[date, ...]]] = []

    def daily_forecast(self, coord: GeoPoint, days) -> dict[date, int]:
        self.calls.append((coord, tuple(days)))
        return {d: 80 for d in days}


def _intent_json(intent: str, **slots: str) -> str:
    return json.dumps({"intent": intent, "slots": slots, "confidence": 0.9}, ensure_ascii=False)


def _answer_json(text: str) -> str:
    return json.dumps({"text": text, "footnote": None}, ensure_ascii=False)


def _body(utterance: str, *, deadline_ms: int | None = 9_000, recent_turns: list[dict] | None = None,
          session_id: str | None = "s-1", account_ref: str | None = _ACCOUNT, dialogue_context: dict | None = None) -> dict:
    meta: dict = {"request_id": "r-turn-1", "requested_at": _NOW}
    if deadline_ms is not None:
        meta["deadline_ms"] = deadline_ms
    return {
        "request_meta": meta,
        "utterance": utterance,
        "dialogue_context": dialogue_context,
        "context": {
            "surface": "LIVE",
            "trip": {"trip_id": "trip-1", "regions": ["제주"], "start_date": _D1.isoformat(),
                     "end_date": _D2.isoformat(), "phase": "IN_TRIP"},
            "base_stays": ["숙소"],
            "itinerary": {"status": "PLANNED", "days": [
                {"date": _D1.isoformat(), "slots": [
                    {"slot_key": _UDO_SLOT_KEY, "name": "우도", "start_at": "09:00", "category": "명소"}]},
                {"date": _D2.isoformat(), "slots": [
                    {"slot_key": f"{_D2.isoformat()}#{_ID['해녀의집']}", "name": "해녀의집", "start_at": "12:00", "category": "맛집"},
                    {"slot_key": f"{_D2.isoformat()}#{_ID['카페 모카']}", "name": "카페 모카", "start_at": "15:00", "category": "카페"}]},
            ]},
        },
        "session_id": session_id,
        "account_ref": account_ref,
        "recent_turns": recent_turns or [],
    }


def _client(by_feature: dict, *, enabled: bool = True, shadow_rate: float = 1.0, weather: _Weather | None = None) -> TestClient:
    """실조립 + fake 어댑터 — 테스트 공용 진입점. `shadow_rng` 고정으로 표본 추출이 결정론(AO-P16)."""
    app = build_dev_app(
        llm=FeatureRoutingLlm(by_feature), model_id="m-fake", poi_db=InMemoryPoi(_SCHEDULED + _ALTS),
        weather=weather if weather is not None else _Weather(),
        dialogue_orchestrator_enabled=enabled, shadow_rate=shadow_rate, shadow_rng=random.Random(1),
    )
    return TestClient(app, raise_server_exceptions=False)


def _assert_answer_shape(body: dict, intent: str, kind: str) -> dict:
    assert body["outcome"] == "ANSWER", body
    assert set(body) == {"outcome", "frames", "clarify", "dialogue_context", "llm_calls", "answer"}
    (frame,) = body["frames"]
    assert frame["intent"] == intent and frame["match_route"] == "LLM_DIRECT" and frame["missing"] == []
    assert body["clarify"] is None and body["dialogue_context"]["pending"] is None
    answer = body["answer"]
    assert answer["kind"] == kind and answer["text"] and len(answer["next_actions"]) >= 1
    assert body["llm_calls"] == 2  # 분류 + 답변 — 섀도(별도 LLM 카운터)는 들어오지 않는다(BR-AO-07)
    dumped = json.dumps(body, ensure_ascii=False)
    assert not any(tok in dumped for tok in _FORBIDDEN_TOKENS)  # INV-3
    return answer


def _shadow_records(caplog: pytest.LogCaptureFixture, prefix: str, *, wait_sec: float = 0.0) -> list[str]:
    """`trippilot.intent.shadow` 로거의 `prefix` 줄 — 섀도는 풀 스레드라 잠깐 기다릴 수 있다(wait_sec)."""
    deadline = time.monotonic() + wait_sec
    while True:
        found = [r.getMessage() for r in caplog.records
                 if r.name == "trippilot.intent.shadow" and r.getMessage().startswith(prefix)]
        if found or time.monotonic() >= deadline:
            return found
        time.sleep(0.02)


# ── ① on — 세 의도 왕복 ────────────────────────────────────────────────────


def test_next_slot_turn_answers_info_with_alternative_quick_reply() -> None:
    client = _client({_INTENT: _intent_json("GET_NEXT_SLOT"),
                      _ANSWER: _answer_json("다음은 해녀의집이에요. 일정 화면에서 자세히 볼 수 있어요.")})
    res = client.post(URL, json=_body("다음 장소 어디야"))
    assert res.status_code == 200, res.text
    answer = _assert_answer_shape(res.json(), "GET_NEXT_SLOT", "INFO")
    assert answer["payload"]["infoKind"] == "NEXT_SLOT" and answer["payload"]["title"] == "해녀의집"
    assert [a["type"] for a in answer["next_actions"]] == ["OPEN_LIVE"]  # 여행 중
    (qr,) = answer["quick_replies"]
    assert qr["action"] == "SEND_TEXT" and qr["params"]["intent"] == "SUGGEST_ALTERNATIVE"


def test_weather_turn_fans_out_to_poi_info_then_weather_port(caplog: pytest.LogCaptureFixture) -> None:
    weather = _Weather()
    client = _client({_INTENT: _intent_json("GET_WEATHER"),
                      _ANSWER: _answer_json("오늘 제주는 비 올 확률이 80%예요. 우산을 챙기면 좋겠어요.")}, weather=weather)
    with caplog.at_level(logging.INFO, logger="trippilot.intent.shadow"):
        res = client.post(URL, json=_body("오늘 날씨 어때"))
    assert res.status_code == 200, res.text
    answer = _assert_answer_shape(res.json(), "GET_WEATHER", "INFO")
    assert answer["payload"] == {"infoKind": "WEATHER", "title": "제주 날씨",
                                 "rows": [{"label": "오늘 최대 강수확률", "value": "80%"}]}
    assert answer["text"].startswith("오늘 제주는 비 올 확률이 80%")
    # 앵커 좌표는 PoiInfoProvider(InMemoryPoi) 가 해녀의집(오늘 첫 슬롯)에서 꺼냈다 — 포트가 그 좌표·그 날짜로 불렸다
    ((coord, days),) = weather.calls
    assert (coord.lat, coord.lng) == (pytest.approx(_ANCHOR.lat + 0.005), pytest.approx(_ANCHOR.lng + 0.005))
    assert days == (_D2,)


def test_alternative_turn_returns_candidates_only_from_the_in_memory_pool() -> None:
    client = _client({_INTENT: _intent_json("SUGGEST_ALTERNATIVE", target="우도"),
                      _ANSWER: _answer_json("우도 대신 갈 만한 곳을 골라 봤어요. 마음에 드는 곳을 눌러 바꿀 수 있어요.")})
    res = client.post(URL, json=_body("우도 말고 다른 데 추천해줘"))
    assert res.status_code == 200, res.text
    answer = _assert_answer_shape(res.json(), "SUGGEST_ALTERNATIVE", "CANDIDATES")
    candidates = answer["payload"]["candidates"]
    assert 1 <= len(candidates) <= 5
    picked = {c["poiId"] for c in candidates}
    assert picked <= _ALT_IDS  # 풀 안 ∧ 일정 밖 (INV-1)
    assert all(c["name"] and c["reason"] for c in candidates)
    # 후보마다 PICK_CANDIDATE 짝 — slotKey 는 대상 슬롯(우도)의 것
    picks = [q for q in answer["quick_replies"] if q["action"] == "PICK_CANDIDATE"]
    assert {q["params"]["poiId"] for q in picks} == picked
    assert {q["params"]["slotKey"] for q in picks} == {_UDO_SLOT_KEY}
    assert [a["type"] for a in answer["next_actions"]] == ["OPEN_ITINERARY"]


def test_null_intent_is_out_of_scope_with_the_legacy_shape() -> None:
    """분류가 `{"intent": null}` → OUT_OF_SCOPE — 문장 없음(answer null), 종전 키 집합 (BR-AO-02)."""
    client = _client({_INTENT: '{"intent": null}'})
    res = client.post(URL, json=_body("오늘 주식 시장 어때"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outcome"] == "OUT_OF_SCOPE" and body["answer"] is None and body["frames"] == []
    assert body["llm_calls"] == 1 and body["dialogue_context"]["pending"] is None


def test_capabilities_literal_answers_without_any_llm_call() -> None:
    client = _client({_INTENT: Exception("분류 LLM 을 부르면 안 된다")})
    res = client.post(URL, json=_body("내가 할 수 있는 것 보기"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outcome"] == "ANSWER" and body["frames"] == [] and body["llm_calls"] == 0
    assert body["answer"]["kind"] == "TEXT" and body["answer"]["quick_replies"] is None


# ── ② off — 종전 경로 그대로 ──────────────────────────────────────────────


def test_disabled_orchestrator_keeps_the_legacy_frame_path() -> None:
    """기본(off)은 `DialogueInterpreter` 3단 경로 — 3차 LLM(INTENT) 로 FRAME, `answer` 는 null 로만 실린다."""
    client = _client({LlmFeature.INTENT: _intent_json("GET_WEATHER")}, enabled=False)
    res = client.post(URL, json=_body("오늘 날씨 어때"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["outcome"] == "FRAME" and body["answer"] is None
    assert body["frames"][0]["intent"] == "GET_WEATHER" and body["frames"][0]["match_route"] == "LLM_DIRECT"
    assert body["llm_calls"] == 1
    assert set(body) == {"outcome", "frames", "clarify", "dialogue_context", "llm_calls", "answer"}


def test_default_build_dev_app_is_off() -> None:
    """인자 없는 조립은 off — 기존 `build_dev_app()` 기반 테스트 전부의 전제."""
    client = TestClient(build_dev_app())
    res = client.post(URL, json=_body("둘째 날 카페 바꿔줘"))
    assert res.status_code == 200, res.text
    assert res.json()["outcome"] == "OUT_OF_SCOPE" and res.json()["frames"][0]["intent"] == "OUT_OF_SCOPE"


# ── ③ 사영 — TurnInput 조립 ───────────────────────────────────────────────


class _SpyOrchestrator:
    """`turn()` 입력을 기록하고 결정론 ANSWER 를 돌려준다 — 사영이 봉투를 어떻게 채우는지만 본다."""

    def __init__(self) -> None:
        self.inputs: list = []

    def turn(self, inp) -> TurnOutcome:
        self.inputs.append(inp)
        return TurnOutcome("ANSWER", (), None, capabilities_answer(True), DialogueContext(turn_index=inp.context.turn_index), 0)


def _request(**kw) -> schemas.DialogueInterpretRequest:
    return schemas.DialogueInterpretRequest.model_validate(_body("아무 말", **kw))


def test_projection_fills_turn_input_from_the_wire() -> None:
    spy, clock = _SpyOrchestrator(), FakeClock(start_ms=4_321)
    turns = [{"role": "USER", "text": "비 오면 실내로"}, {"role": "ASSISTANT", "text": "실내 위주로 볼게요"}]
    res = projection.interpret(
        object(), _request(deadline_ms=6_000, recent_turns=turns, dialogue_context={"turn_index": 7, "pending": None}),
        _KST, orchestrator=spy, clock=clock,
    )
    (inp,) = spy.inputs
    assert inp.utterance == "아무 말" and inp.session_id == "s-1" and inp.account_ref == _ACCOUNT
    assert [(t.role, t.text) for t in inp.recent_turns] == [("USER", "비 오면 실내로"), ("ASSISTANT", "실내 위주로 볼게요")]
    assert inp.deadline_ms == 6_000 and inp.started_ms == 4_321 and inp.context.turn_index == 7
    assert str(inp.trace_id) == "r-turn-1" and inp.now == datetime(2026, 10, 19, 10, 0, tzinfo=_KST)
    snap = inp.snapshot
    assert snap.surface == "LIVE" and snap.trip.trip_id == "trip-1" and snap.trip.phase == "IN_TRIP"
    assert snap.base_stays == ("숙소",) and snap.itinerary_status == "PLANNED"
    assert [(d.date, [s.name for s in d.slots]) for d in snap.days] == [(_D1, ["우도"]), (_D2, ["해녀의집", "카페 모카"])]
    assert snap.days[0].slots[0].poi_id == _ID["우도"]
    # 응답 사영 — ANSWER 는 answer 채움, context 는 그대로(turn_index 는 백엔드가 올린다)
    assert res.outcome == "ANSWER" and res.answer is not None and res.answer.kind == "TEXT"
    assert res.frames == [] and res.clarify is None and res.dialogue_context["turn_index"] == 7


def test_projection_defaults_a_missing_deadline_to_nine_seconds() -> None:
    """백엔드가 deadline 을 안 보내면 9_000 — 종전 경로의 '시간제약 없음(600_000)' 을 그대로 쓰지 않는다 (BR-AO-01·미결 #5)."""
    spy = _SpyOrchestrator()
    projection.interpret(object(), _request(deadline_ms=None), _KST, orchestrator=spy, clock=FakeClock())
    assert spy.inputs[0].deadline_ms == 9_000


def test_projection_requires_a_clock_on_the_orchestrator_path() -> None:
    with pytest.raises(ValueError, match="clock"):
        projection.interpret(object(), _request(), _KST, orchestrator=_SpyOrchestrator())


# ── ④ 섀도 ──────────────────────────────────────────────────────────────


def test_shadow_logs_one_line_without_the_utterance_or_account_ref(caplog: pytest.LogCaptureFixture) -> None:
    utterance = "오늘 날씨 어때"
    client = _client({_INTENT: _intent_json("GET_WEATHER"), LlmFeature.INTENT: _intent_json("GET_WEATHER"),
                      _ANSWER: _answer_json("오늘 제주는 비 올 확률이 80%예요.")})
    with caplog.at_level(logging.INFO, logger="trippilot.intent.shadow"):
        res = client.post(URL, json=_body(utterance))
        assert res.status_code == 200 and res.json()["llm_calls"] == 2  # 섀도 INTENT 호출은 세지 않는다
        (line,) = _shadow_records(caplog, "intent_shadow {", wait_sec=5.0)
    assert utterance not in line and _ACCOUNT not in line  # SEC-U8-06
    record = json.loads(line.removeprefix("intent_shadow "))
    assert record["service"]["intent"] == "GET_WEATHER" and record["service"]["route"] == "LLM_DIRECT"
    assert record["service"]["llm_calls"] == 1 and record["turn_index"] == 0
    assert record["shadow"]["intent"] == "GET_WEATHER" and record["agree"] is True
    assert "slots" not in record["service"] and "utterance" not in record
    meta = record["meta"]
    assert set(meta) == {"bank_sha", "t_high", "t_mid", "vote_ratio", "intent_margin", "intent_prompt", "shadow_prompt"}
    assert meta["intent_prompt"].startswith("prompts/dialogue_intent.yaml@") and meta["shadow_prompt"].startswith("prompts/intent.yaml@")
    assert len(meta["bank_sha"]) == 12


def test_shadow_rate_zero_only_logs_a_skip(caplog: pytest.LogCaptureFixture) -> None:
    client = _client({_INTENT: _intent_json("GET_NEXT_SLOT"), _ANSWER: _answer_json("다음은 해녀의집이에요.")}, shadow_rate=0.0)
    with caplog.at_level(logging.INFO, logger="trippilot.intent.shadow"):
        res = client.post(URL, json=_body("다음 장소 어디야"))
        assert res.status_code == 200 and res.json()["llm_calls"] == 2
        (line,) = _shadow_records(caplog, "intent_shadow_skipped ")
        assert json.loads(line.removeprefix("intent_shadow_skipped "))["why"] == "sampled_out"
        assert _shadow_records(caplog, "intent_shadow {") == []
