"""assistant-orchestrator T011 — 의도별 핸들러(순수) · 슬롯 해소 (FD DE §2.4·§2.5, BLM §5). 실 호출 0.

증명하는 것:
  [표]      ① HANDLERS 는 라우팅 가능 의도 13종 전수, OUT_OF_SCOPE 없음 · FRAME 으로 넘기는 것은 EDIT_SCHEDULE 하나
  [slot_key] ② parse_slot_key — 'YYYY-MM-DD#<uuid>' 왕복(PBT), 모양이 다르면 None · SlotView.from_wire 가 같은 규칙으로 poi_id 를 판다
  [해소]    ③ resolve_slot — 이름 부분일치는 유일할 때만(여럿 → None, 한 글자 무시) · 날짜·'N일차'·상대 날짜 · '점심'/'저녁' → FOOD ∧ 시각대 ·
              '다음' → 지금 이후 첫 슬롯 · 못 풀면 None(지어내지 않는다) · 임의 문자열에 예외 0(PBT)
  [의도별]  ④ 각 의도의 Facts 모양 — kind·payload(INFO rows list·CANDIDATES ≤5 + PICK_CANDIDATE 정확 1개)·next_action 종류·라벨(BE IntentDispatcher 문구)·
              quick reply(GET_NEXT_SLOT '다른 곳 추천' SEND_TEXT{intent, slotKey}) · 플랜 콜러블이 주입 포트를 어떤 params 로 부르는가
  [공통]    ⑤ needs_trip — STYLE_ANALYSIS·OUT_OF_SCOPE 외 여행 필수 → CREATE_TRIP·OPEN_STAY_SEARCH + BE needTrip 문구
  [PBT]     ⑥ 결정론(같은 입력 → 같은 Facts) · next_actions ≥1 ∧ 17종 안 · template_text 가 답변 게이트를 스스로 통과 · 와이어 payload 에 INV-3 금칙 토큰 0
"""

from __future__ import annotations

from dataclasses import replace

import json
import uuid
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.planb.rag import Alternative, PlanBRagRequest, PlanBRagResult
from trippilot.domain.common import GeoPoint, PoiId, TraceId
from trippilot.domain.freshness import FreshnessMeta, InfoPacket, ProviderKind, ProviderStatus
from trippilot.domain.intent import DIALOGUE_INTENTS, ROUTABLE_INTENTS, Intent
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.region_centers import region_center
from trippilot.domain.trigger import TriggerKind
from trippilot.llm_gateway.gates.dialogue_answer import _MAX_LENGTH, _violates
from trippilot.llm_gateway.workers.dialogue_answer import NEED_TRIP_TEXT, fallback_answer_text
from trippilot.poi_curation.adapters.pg_place_sql import PlaceRow
from trippilot.orchestrator import dialogue_handlers as dh
from trippilot.agents.planb.rag import _REASON_KO
from trippilot.orchestrator.dialogue_handlers import (
    _REASON_WORDS,
    _planb_reason,
    CANDIDATE_REASON,
    HANDLERS,
    NEXT_ACTION_TYPES,
    AnswerKind,
    DayView,
    FactStatus,
    Facts,
    HandlerPorts,
    HandlerTask,
    SlotView,
    TaskResult,
    TripInfo,
    TurnContext,
    TurnSnapshot,
    edit_arguments,
    need_trip_facts,
    needs_trip,
    next_slot_after,
    parse_slot_key,
    resolve_day,
    resolve_slot,
)

_KST = timezone(timedelta(hours=9))
_D1, _D2, _D3 = date(2026, 10, 18), date(2026, 10, 19), date(2026, 10, 20)
# 둘째 날 10:00 KST — 여행 중, 둘째 날 첫 슬롯(09:00)은 지났고 둘째 슬롯(12:00)은 남았다
_NOW = datetime(2026, 10, 19, 10, 0, tzinfo=_KST)
_TRACE = TraceId("trace-t011")
_TRIP = TripInfo("trip-1", ("제주",), _D1, _D3, "IN_TRIP")

# 고정 uuid — 테스트 안에서 slot_key·poi_id 를 눈으로 대조할 수 있게
# 앞 9곳은 일정(_SNAP) 안, 뒤 6곳은 일정 밖 — 대안 후보는 일정 밖에서만 나온다(일정 전부가 excluded)
_U = {name: str(uuid.uuid5(uuid.NAMESPACE_DNS, name)) for name in (
    "성산일출봉", "섭지코지", "올레국수", "우도", "해녀의집", "카페 모카", "스타벅스 카페", "한라산", "제주민속촌",
    "흑돼지거리", "동문시장", "용두암", "협재해수욕장", "함덕해수욕장", "천지연폭포",
)}
_COORD = {name: GeoPoint(33.4 + i * 0.01, 126.5 + i * 0.01) for i, name in enumerate(_U)}
_FOOD_KO = "맛집"  # 스냅샷 category 는 BE 한글 정본(PlannedSlotView.category)


def _slot(name: str, hhmm: str, category: str | None = None, on: date = _D1) -> SlotView:
    h, m = hhmm.split(":")
    return SlotView.from_wire(f"{on.isoformat()}#{_U[name]}", name, time(int(h), int(m)), category)


def _snapshot(days: tuple[tuple[date, tuple[SlotView, ...]], ...], *, trip: TripInfo | None = _TRIP,
              status: str | None = "PLANNED") -> TurnSnapshot:
    return TurnSnapshot(surface="ITINERARY", trip=trip, base_stays=("숙소",), itinerary_status=status,
                        days=tuple(DayView(d, slots) for d, slots in days))


# 3일치 일정 — 둘째 날에 점심(FOOD 12:00)·저녁(FOOD 18:30), 카페가 둘(이름 겹침 → 해소 실패 재료)
_SNAP = _snapshot((
    (_D1, (_slot("성산일출봉", "09:00", "명소", _D1), _slot("섭지코지", "11:00", "자연", _D1),
           _slot("올레국수", "12:30", _FOOD_KO, _D1))),
    (_D2, (_slot("우도", "09:00", "자연", _D2), _slot("해녀의집", "12:00", _FOOD_KO, _D2),
           _slot("카페 모카", "15:00", "카페", _D2), _slot("스타벅스 카페", "16:30", "카페", _D2),
           _slot("한라산", "18:30", _FOOD_KO, _D2))),
    (_D3, (_slot("제주민속촌", "10:00", "문화", _D3),)),
))
_EMPTY_SNAP = _snapshot((), status=None)


def _ctx(snapshot: TurnSnapshot = _SNAP, arguments: Mapping[str, str] | None = None, *,
         ports: HandlerPorts | None = None, now: datetime = _NOW, remaining_ms: int = 3000) -> TurnContext:
    return TurnContext(snapshot=snapshot, arguments=dict(arguments or {}), now=now, tz=_KST, trace_id=_TRACE,
                       remaining_ms=lambda: remaining_ms, ports=ports or HandlerPorts())


# ── 주입 포트의 대역 (실 호출 0) ───────────────────────────────────────────────


def _fresh(now: datetime) -> FreshnessMeta:
    return FreshnessMeta(source="fake", fetched_at=now, cache_hit=False, ttl_sec=60, stale=False)


class _PoiInfo:
    """PoiInfoProvider 대역 — 이름표 좌표를 돌려주고 호출 params 를 기록한다."""

    def __init__(self, *, fail: bool = False, missing: frozenset[str] = frozenset()) -> None:
        self.calls: list[dict] = []
        self._fail, self._missing = fail, missing

    def fetch(self, params: dict) -> InfoPacket:
        self.calls.append(params)
        if self._fail:
            return InfoPacket(ProviderKind.POI_INFO, ProviderStatus.UNAVAILABLE, {"reason": "down"}, None)
        by_id = {_U[n]: n for n in _U}
        pois, misses = [], []
        for pid in sorted(params["poi_ids"]):
            name = by_id.get(str(pid))
            if name is None or name in self._missing:
                misses.append(str(pid))
                continue
            pois.append({"poi_id": str(pid), "name": name, "category": "FOOD" if name in ("올레국수", "해녀의집", "흑돼지거리") else "SIGHT",
                         "lat": _COORD[name].lat, "lng": _COORD[name].lng,
                         # 정보 없음은 실물(providers.poi_info.hours_label)처럼 문구로 온다 — None 은 "그 요일 휴무 증명"이다
                         "hours_label": "09:00~18:00" if name != "우도" else "영업시간 정보 없음", "fee": 0 if name == "우도" else 5000,
                         "source_ref": None})
        status = ProviderStatus.OK if not misses else ProviderStatus.LOW
        return InfoPacket(ProviderKind.POI_INFO, status, {"pois": pois, "misses": misses}, _fresh(params["now"]))


class _Weather:
    def __init__(self, pop: int | None = 80, *, unknown: bool = False) -> None:
        self.calls: list[dict] = []
        self._pop, self._unknown = pop, unknown

    def fetch(self, params: dict) -> InfoPacket:
        self.calls.append(params)
        if self._unknown:
            return InfoPacket(ProviderKind.WEATHER, ProviderStatus.WEATHER_UNKNOWN, {"reason": "kma down"}, None)
        daily = {d.isoformat(): self._pop for d in params["days"]} if self._pop is not None else {}
        return InfoPacket(ProviderKind.WEATHER, ProviderStatus.OK,
                          {"daily": daily, "hourly": {}, "triggers": ()}, _fresh(params["now"]))


class _Transit:
    def __init__(self, *, fail: bool = False, confidence: str = "LOW") -> None:
        self.calls: list[dict] = []
        self._fail, self._confidence = fail, confidence

    def fetch(self, params: dict) -> InfoPacket:
        self.calls.append(params)
        if self._fail:
            return InfoPacket(ProviderKind.TRANSIT, ProviderStatus.UNAVAILABLE, {}, None)
        # TransitProvider 는 내부용 internal_minutes 까지 싣는다 — 핸들러가 떨어뜨려야 한다(INV-3)
        return InfoPacket(ProviderKind.TRANSIT, ProviderStatus.OK,
                          {"distance_m": 1200, "distance_range": "약 1.2km", "internal_minutes": 17,
                           "confidence": self._confidence,
                           "source": "haversine_x_detour" if self._confidence == "LOW" else "odsay_transit", "delay_trigger": None,
                           "freshness": _fresh(params["now"]).to_dict()}, _fresh(params["now"]))


def _poi(name: str, category: PoiCategory = PoiCategory.SIGHT) -> Poi:
    return Poi(poi_id=PoiId(_U[name]), name=name, category=category, coord=_COORD[name], open_hours=(),
               avg_cost=None, rating=None, quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None)


def _pool(*pois: Poi) -> CandidatePool:
    return CandidatePool(poi_ids=frozenset(p.poi_id for p in pois), pois=tuple(pois), generated_at=_NOW)


class _PoolBuilder:
    def __init__(self, pool: CandidatePool | None, *, raise_: bool = False) -> None:
        self.requests: list = []
        self._pool, self._raise = pool, raise_

    def build(self, request, now):
        self.requests.append((request, now))
        if self._raise:
            raise RuntimeError("backend down")
        return self._pool


class _PlanB:
    def __init__(self, result: PlanBRagResult) -> None:
        self.requests: list[PlanBRagRequest] = []
        self._result = result

    def run(self, request: PlanBRagRequest) -> PlanBRagResult:
        self.requests.append(request)
        return self._result


def _planb_result(*groups: tuple[str, ...], rationale: str = "가까운 식당") -> PlanBRagResult:
    alts = tuple(Alternative(label=chr(65 + i), poi_ids=tuple(PoiId(_U[n]) for n in g), rationale=rationale)
                 for i, g in enumerate(groups))
    return PlanBRagResult(alternatives=alts, is_fallback=True, fallback_level=1 if alts else 2, notes=("rule_ranking",),
                          retrieved={}, dropped_out_of_pool=(), empty_reason=None if alts else "no_candidates")


def _run(handler: dh.Handler, ctx: TurnContext, *, fail: Mapping[str, str] | None = None) -> Facts:
    """플랜 → 콜러블 실행(동기) → TaskResult → assemble. `fail` 은 이름별 전송 실패 상태(TIMEOUT 등)."""
    results: dict[str, TaskResult] = {}
    for task in handler.plan(ctx):
        status = (fail or {}).get(task.name)
        results[task.name] = TaskResult.failed(task.name, status) if status else TaskResult.ok(task.name, task.fn())
    return handler.assemble(ctx, results)


def _types(facts: Facts) -> list[str]:
    return [a.type for a in facts.next_actions]


# ── ① 표 ─────────────────────────────────────────────────────────────────────


def test_handlers_cover_exactly_the_routable_intents() -> None:
    assert set(HANDLERS) == DIALOGUE_INTENTS
    assert Intent.OUT_OF_SCOPE not in HANDLERS
    assert all(HANDLERS[i].intent is i for i in HANDLERS)


def test_only_edit_schedule_hands_off_as_a_frame() -> None:
    """핸들러 표의 운영 메타는 `handoff_frame` 하나다 — kind·next_actions 선언은 산출(Facts)이 곧 정본이라 두지 않는다."""
    assert {i for i, h in HANDLERS.items() if h.handoff_frame} == {Intent.EDIT_SCHEDULE}


def test_next_action_types_are_the_backend_seventeen() -> None:
    assert len(NEXT_ACTION_TYPES) == 17
    assert {"OPEN_ITINERARY", "OPEN_PLACE", "CREATE_TRIP", "SHOW_CAPABILITIES", "RESTORE_REVISION"} <= NEXT_ACTION_TYPES


# ── ② slot_key ───────────────────────────────────────────────────────────────


@settings(max_examples=100, deadline=None)
@given(d=st.dates(min_value=date(2000, 1, 1), max_value=date(2099, 12, 31)), u=st.uuids())
def test_parse_slot_key_round_trips(d: date, u: uuid.UUID) -> None:
    key = f"{d.isoformat()}#{u}"
    assert parse_slot_key(key) == (d, PoiId(str(u)))
    assert SlotView.from_wire(key, None, time(9), None).poi_id == str(u)


@pytest.mark.parametrize("bad", [
    "", "2026-10-18", f"#{uuid.uuid4()}", "2026-10-18#", "2026-10-18#not-a-uuid", f"20261018#{uuid.uuid4()}",
    f"2026-13-01#{uuid.uuid4()}", f"2026-10-18#{uuid.uuid4()}#x", f"a#2026-10-18#{uuid.uuid4()}",
])
def test_parse_slot_key_rejects_other_shapes(bad: str) -> None:
    assert parse_slot_key(bad) is None
    assert SlotView.from_wire(bad, "x", time(9), None).poi_id is None


@settings(max_examples=100, deadline=None)
@given(text=st.text(max_size=40))
def test_parse_slot_key_never_raises(text: str) -> None:
    out = parse_slot_key(text)
    assert out is None or isinstance(out[0], date)


# ── ③ 슬롯 해소 ──────────────────────────────────────────────────────────────


def _resolve(target: str | None, day: str | None = None, snapshot: TurnSnapshot = _SNAP, now: datetime = _NOW):
    return resolve_slot(snapshot, day=day, target=target, now=now, tz=_KST)


def test_resolve_by_unique_name_substring_in_either_direction() -> None:
    assert _resolve("성산일출봉 대신").name == "성산일출봉"  # 이름 ⊂ 말
    assert _resolve("섭지").name == "섭지코지"  # 말 ⊂ 이름


def test_resolve_two_matches_is_none_and_day_disambiguates_nothing_here() -> None:
    """여럿에 걸리면 None — "없다"와 같은 값이다(호출자 전부가 둘을 같게 접었다). 지어내지 않는다는 점만 지킨다."""
    assert _resolve("카페") is None
    assert _resolve("카페", day="2일차") is None  # 둘 다 둘째 날이다


def test_resolve_ignores_single_char_and_unknown_names() -> None:
    assert _resolve("카") is None
    assert _resolve("경복궁") is None  # 일정 밖 장소 — 지어내지 않는다


def test_resolve_day_narrows_the_candidate_set() -> None:
    assert _resolve("국수", day="1일차").name == "올레국수"
    assert _resolve("국수", day="2일차") is None  # 둘째 날엔 없다
    assert _resolve("국수", day="2026-10-18").name == "올레국수"


def test_resolve_day_expressions_pick_first_slot_of_that_day() -> None:
    assert _resolve("둘째 날").name == "우도"
    assert _resolve("첫날").name == "성산일출봉"
    assert _resolve("마지막 날").name == "제주민속촌"
    assert _resolve(None, day="3일차").name == "제주민속촌"
    assert _resolve(None, day="2").name == "우도"  # BE targetDate 와 같은 맨 숫자
    assert _resolve("오늘").name == "우도"
    assert _resolve("내일").name == "제주민속촌"


def test_resolve_unreadable_day_is_none_not_a_guess() -> None:
    assert _resolve("국수", day="언젠가") is None
    assert _resolve(None, day="9일차") is None  # 여행 밖


def test_resolve_meal_words_use_food_category_and_time_window() -> None:
    # 날이 없으면 오늘(둘째 날) 점심·저녁
    assert _resolve("점심").name == "해녀의집"
    assert _resolve("저녁").name == "한라산"
    assert _resolve("점심", day="1일차").name == "올레국수"
    assert _resolve("둘째 날 점심").name == "해녀의집"
    # 둘째 날엔 FOOD 저녁이 하나지만, 첫날엔 저녁 FOOD 가 없다
    assert _resolve("저녁", day="1일차") is None


def test_resolve_meal_across_days_without_today_is_ambiguous() -> None:
    before_trip = datetime(2026, 10, 10, 9, 0, tzinfo=_KST)
    assert _resolve("점심", now=before_trip) is None  # 첫날·둘째 날 점심 둘


def test_resolve_next_means_first_slot_after_now() -> None:
    assert _resolve("다음 일정").name == "해녀의집"  # 10:00 기준 둘째 날 12:00
    assert next_slot_after(_SNAP, _NOW, _KST) == (_D2, _SNAP.days[1].slots[1])
    late = datetime(2026, 10, 20, 23, 0, tzinfo=_KST)
    assert next_slot_after(_SNAP, late, _KST) is None


def test_resolve_nothing_said_means_today_first_slot_or_none() -> None:
    assert _resolve(None).name == "우도"
    assert _resolve(None, now=datetime(2026, 11, 1, 9, 0, tzinfo=_KST)) is None
    assert _resolve("성산", snapshot=_EMPTY_SNAP) is None


def test_resolve_day_relative_and_absolute_forms() -> None:
    today = _D2
    assert resolve_day("오늘", _SNAP, today) == _D2
    assert resolve_day("내일", _SNAP, today) == _D3
    assert resolve_day("어제", _SNAP, today) == _D1
    assert resolve_day("10월 20일", _SNAP, today) == _D3
    assert resolve_day("10/18", _SNAP, today) == _D1
    assert resolve_day("둘째 날", _SNAP, today) == _D2
    assert resolve_day("세 번째 날", _SNAP, today) == _D3
    assert resolve_day("1일차", _SNAP, today) == _D1
    assert resolve_day("토요일", _SNAP, today) is None  # 요일은 해석하지 않는다 — 넘겨짚기 금지


@settings(max_examples=200, deadline=None)
@given(target=st.one_of(st.none(), st.text(max_size=30)), day=st.one_of(st.none(), st.text(max_size=12)))
def test_resolve_slot_never_raises_and_only_returns_snapshot_slots(target: str | None, day: str | None) -> None:
    out = _resolve(target, day)
    all_slots = {s.slot_key for _, s in _SNAP.slots()}
    assert out is None or out.slot_key in all_slots


# ── ⑤ needs_trip ─────────────────────────────────────────────────────────────


def test_needs_trip_excludes_style_and_out_of_scope() -> None:
    assert not needs_trip(Intent.STYLE_ANALYSIS) and not needs_trip(Intent.OUT_OF_SCOPE)
    assert all(needs_trip(i) for i in ROUTABLE_INTENTS - {Intent.STYLE_ANALYSIS})


@pytest.mark.parametrize("intent", sorted(ROUTABLE_INTENTS - {Intent.STYLE_ANALYSIS}, key=lambda i: i.value))
def test_without_trip_every_trip_intent_plans_nothing_and_answers_need_trip(intent: Intent) -> None:
    ctx = _ctx(_snapshot((), trip=None, status=None), {"target": "x", "destination": "x", "place": "x"})
    handler = HANDLERS[intent]
    assert handler.plan(ctx) == ()
    facts = handler.assemble(ctx, {})
    assert facts == need_trip_facts(intent)
    assert facts.needs_trip and facts.kind is AnswerKind.TEXT and facts.payload is None
    assert _types(facts) == ["CREATE_TRIP", "OPEN_STAY_SEARCH"]
    assert facts.template_text == NEED_TRIP_TEXT
    assert facts.quick_replies == ()


def test_style_analysis_answers_without_a_trip() -> None:
    facts = _run(HANDLERS[Intent.STYLE_ANALYSIS], _ctx(_snapshot((), trip=None, status=None)))
    assert not facts.needs_trip and _types(facts) == ["OPEN_STYLE"]
    assert facts.next_actions[0].label == "내 여행 스타일"


# ── ④ 의도별 — 넘기기(handoff) ───────────────────────────────────────────────


@pytest.mark.parametrize("intent,action,label", [
    (Intent.GENERATE_SCHEDULE, "OPEN_ITINERARY_METHOD", "일정 만들기"),
    (Intent.REGENERATE, "OPEN_REGENERATE", "일정 다시 만들기"),
    (Intent.GENERATE_REFLECTION, "OPEN_REFLECTION", "기록 열기"),
    (Intent.TRIP_SUMMARY, "OPEN_TRIP_SUMMARY", "여행 요약 보기"),
    (Intent.STYLE_ANALYSIS, "OPEN_STYLE", "내 여행 스타일"),
])
def test_handoff_intents_are_text_with_the_dispatcher_action(intent: Intent, action: str, label: str) -> None:
    handler = HANDLERS[intent]
    assert handler.plan(_ctx()) == ()
    facts = _run(handler, _ctx())
    assert facts.kind is AnswerKind.TEXT and facts.payload is None and facts.quick_replies == ()
    assert [(a.type, a.label) for a in facts.next_actions] == [(action, label)]
    assert facts.template_text == fallback_answer_text(intent, {})


def test_replan_goes_to_replan_in_trip_and_regenerate_otherwise() -> None:
    in_trip = _run(HANDLERS[Intent.REPLAN], _ctx())
    assert _types(in_trip) == ["OPEN_REPLAN"] and in_trip.next_actions[0].label == "다시 짜기"
    assert in_trip.template_text == fallback_answer_text(Intent.REPLAN, {})
    planning = _snapshot(tuple((d.date, d.slots) for d in _SNAP.days),
                         trip=TripInfo("trip-1", ("제주",), _D1, _D3, "PLANNING"))
    before = _run(HANDLERS[Intent.REPLAN], _ctx(planning))
    assert _types(before) == ["OPEN_REGENERATE"]
    assert before.template_text == fallback_answer_text(Intent.REGENERATE, {})


def test_edit_schedule_is_a_frame_handoff_that_only_tidies_arguments() -> None:
    handler = HANDLERS[Intent.EDIT_SCHEDULE]
    ctx = _ctx(arguments={"day": "둘째 날", "target": "카페 모카", "op": "x"})
    assert handler.handoff_frame and handler.plan(ctx) == ()
    facts = _run(handler, ctx)
    assert _types(facts) == ["OPEN_ITINERARY_EDIT"] and facts.kind is AnswerKind.TEXT
    tidy = edit_arguments(ctx)
    assert tidy == {"day": _D2.isoformat(), "target": "카페 모카", "op": "x"}  # day 만 ISO 로, 나머지 그대로
    assert edit_arguments(_ctx(arguments={"day": "언젠가"})) == {"day": "언젠가"}  # 못 읽으면 손대지 않는다
    assert edit_arguments(_ctx(arguments={})) == {}


# ── ④ 의도별 — 스냅샷 계산 ──────────────────────────────────────────────────


def test_show_schedule_summarizes_days_in_detail_and_one_line_template() -> None:
    facts = _run(HANDLERS[Intent.SHOW_SCHEDULE], _ctx(arguments={"scope": "ALL"}))
    assert facts.kind is AnswerKind.TEXT and facts.status is FactStatus.OK and _types(facts) == ["OPEN_ITINERARY"]
    days = facts.detail["days"]
    assert [d["date"] for d in days] == [_D1.isoformat(), _D2.isoformat(), _D3.isoformat()]
    assert days[0]["slots"][0] == {"name": "성산일출봉", "start_at": "09:00", "category": "명소"}
    assert facts.detail["scope"] == "ALL"
    assert facts.template_text == "10월 18일 3곳, 10월 19일 5곳, 10월 20일 1곳 일정이 있어요."
    assert [(r.label, r.value) for r in facts.rows] == [("10월 18일", "3곳"), ("10월 19일", "5곳"), ("10월 20일", "1곳")]
    assert len(facts.places) == 9 and all(p.name for p in facts.places)


def test_show_schedule_remaining_scope_drops_past_slots_and_days() -> None:
    facts = _run(HANDLERS[Intent.SHOW_SCHEDULE], _ctx(arguments={"scope": "REMAINING"}))
    days = facts.detail["days"]
    assert [d["date"] for d in days] == [_D2.isoformat(), _D3.isoformat()]
    assert [s["name"] for s in days[0]["slots"]] == ["해녀의집", "카페 모카", "스타벅스 카페", "한라산"]  # 09:00 우도는 지났다


def test_show_schedule_single_day_argument() -> None:
    facts = _run(HANDLERS[Intent.SHOW_SCHEDULE], _ctx(arguments={"day": "3일차"}))
    assert [d["date"] for d in facts.detail["days"]] == [_D3.isoformat()]
    assert facts.template_text == "10월 20일 1곳 일정이 있어요."


def test_show_schedule_without_slots_is_empty_and_points_to_making_one() -> None:
    facts = _run(HANDLERS[Intent.SHOW_SCHEDULE], _ctx(_snapshot((), status=None)))
    assert facts.status is FactStatus.EMPTY and facts.kind is AnswerKind.TEXT
    assert _types(facts) == ["OPEN_ITINERARY_METHOD"]
    assert facts.template_text == fallback_answer_text(Intent.SHOW_SCHEDULE, {"status": "EMPTY"})
    # 일정은 있는데 비었다 → 일정 보기
    assert _types(_run(HANDLERS[Intent.SHOW_SCHEDULE], _ctx(_snapshot(((_D1, ()),))))) == ["OPEN_ITINERARY"]


def test_next_slot_info_card_with_alternatives_quick_reply() -> None:
    facts = _run(HANDLERS[Intent.GET_NEXT_SLOT], _ctx())
    assert facts.kind is AnswerKind.INFO and facts.status is FactStatus.OK
    assert facts.payload == {"infoKind": "NEXT_SLOT", "title": "해녀의집", "rows": [{"label": "계획 시각", "value": "12:00"}]}
    assert [(a.type, a.label) for a in facts.next_actions] == [("OPEN_LIVE", "여행 중 화면 열기")]
    (qr,) = facts.quick_replies
    assert (qr.label, qr.action) == ("다른 곳 추천", "SEND_TEXT")
    assert qr.params == {"intent": "SUGGEST_ALTERNATIVE", "slotKey": f"{_D2.isoformat()}#{_U['해녀의집']}"}
    assert facts.template_text == "다음 장소예요."
    assert facts.places[0].poi_id == _U["해녀의집"]


def test_next_slot_on_another_day_adds_date_row_and_itinerary_action_before_trip() -> None:
    before = datetime(2026, 10, 10, 9, 0, tzinfo=_KST)
    planning = _snapshot(tuple((d.date, d.slots) for d in _SNAP.days), trip=TripInfo("trip-1", (), _D1, _D3, "PLANNING"))
    facts = _run(HANDLERS[Intent.GET_NEXT_SLOT], _ctx(planning, now=before))
    assert facts.payload["title"] == "성산일출봉"
    assert facts.payload["rows"] == [{"label": "날짜", "value": "10월 18일"}, {"label": "계획 시각", "value": "09:00"}]
    assert _types(facts) == ["OPEN_ITINERARY"]
    # PLANNED 일정은 시작 전에도 바꿀 수 있다 — CONFIRMED 는 시작 전엔 빠른 답을 주지 않는다 (BE QueryCards 규칙)
    assert facts.quick_replies and facts.quick_replies[0].action == "SEND_TEXT"
    confirmed = _snapshot(tuple((d.date, d.slots) for d in _SNAP.days),
                          trip=TripInfo("trip-1", (), _D1, _D3, "PLANNING"), status="CONFIRMED")
    assert _run(HANDLERS[Intent.GET_NEXT_SLOT], _ctx(confirmed, now=before)).quick_replies == ()


def test_next_slot_when_nothing_remains() -> None:
    late = datetime(2026, 10, 20, 23, 0, tzinfo=_KST)
    facts = _run(HANDLERS[Intent.GET_NEXT_SLOT], _ctx(now=late))
    assert facts.status is FactStatus.EMPTY and facts.kind is AnswerKind.TEXT and facts.payload is None
    assert facts.template_text == "남은 일정이 없어요." and _types(facts) == ["OPEN_ITINERARY"]
    assert facts.quick_replies == ()


# ── ④ 의도별 — Provider 작업 ─────────────────────────────────────────────────


def test_weather_plan_chains_poi_info_coordinates_into_the_weather_provider() -> None:
    poi_info, weather = _PoiInfo(), _Weather(pop=80)
    ctx = _ctx(ports=HandlerPorts(poi_info=poi_info, weather=weather))
    (task,) = HANDLERS[Intent.GET_WEATHER].plan(ctx)
    assert isinstance(task, HandlerTask) and task.name == "weather"
    value = task.fn()
    # 앵커 = 오늘(둘째 날) 첫 슬롯 '우도' 의 좌표, 날짜 = 그 날 하루
    assert poi_info.calls[0]["poi_ids"] == frozenset({PoiId(_U["우도"])}) and poi_info.calls[0]["on"] == _D2
    assert weather.calls == [{"anchor": _COORD["우도"], "days": (_D2,), "now": _NOW}]
    facts = HANDLERS[Intent.GET_WEATHER].assemble(ctx, {"weather": TaskResult.ok("weather", value)})
    assert facts.kind is AnswerKind.INFO and facts.status is FactStatus.OK
    assert facts.payload == {"infoKind": "WEATHER", "title": "제주 날씨", "rows": [{"label": "오늘 최대 강수확률", "value": "80%"}]}
    assert _types(facts) == ["OPEN_ITINERARY"] and facts.template_text == "오늘 예보예요."
    assert facts.detail["date"] == _D2.isoformat()


def test_weather_date_argument_moves_anchor_and_row_label() -> None:
    poi_info, weather = _PoiInfo(), _Weather(pop=30)
    ctx = _ctx(arguments={"date": "내일"}, ports=HandlerPorts(poi_info=poi_info, weather=weather))
    facts = _run(HANDLERS[Intent.GET_WEATHER], ctx)
    assert poi_info.calls[0]["poi_ids"] == frozenset({PoiId(_U["제주민속촌"])})
    assert facts.payload["rows"] == [{"label": "10월 20일 최대 강수확률", "value": "30%"}]


def test_weather_before_the_trip_anchors_on_the_first_upcoming_slot() -> None:
    before = datetime(2026, 10, 10, 9, 0, tzinfo=_KST)
    poi_info, weather = _PoiInfo(), _Weather(pop=10)
    _run(HANDLERS[Intent.GET_WEATHER], _ctx(now=before, ports=HandlerPorts(poi_info=poi_info, weather=weather)))
    assert poi_info.calls[0]["poi_ids"] == frozenset({PoiId(_U["성산일출봉"])}) and weather.calls[0]["days"] == (_D1,)


@pytest.mark.parametrize("ports,fail,status", [
    (HandlerPorts(poi_info=_PoiInfo(), weather=_Weather(unknown=True)), None, FactStatus.EMPTY),
    (HandlerPorts(poi_info=_PoiInfo(), weather=_Weather(pop=None)), None, FactStatus.EMPTY),
    (HandlerPorts(poi_info=_PoiInfo(fail=True), weather=_Weather()), None, FactStatus.UNAVAILABLE),
    (HandlerPorts(poi_info=_PoiInfo(), weather=_Weather()), {"weather": "TIMEOUT"}, FactStatus.UNAVAILABLE),
    (HandlerPorts(), None, FactStatus.UNAVAILABLE),  # 미배선 — 플랜 자체가 없다
])
def test_weather_failures_converge_to_a_text_template(ports: HandlerPorts, fail, status: FactStatus) -> None:
    facts = _run(HANDLERS[Intent.GET_WEATHER], _ctx(ports=ports), fail=fail)
    assert facts.status is status and facts.kind is AnswerKind.TEXT and facts.payload is None
    assert facts.template_text == fallback_answer_text(Intent.GET_WEATHER, {"status": status.value})
    assert _types(facts) == ["OPEN_ITINERARY"] and facts.notes


def test_weather_without_any_slot_falls_back_to_the_trip_region_center() -> None:
    """일정 슬롯이 없으면(일정 없음) 여행 지역 중심 좌표로 바로 묻는다 — 종전엔 앵커를 못 잡아 "지금 날씨를 확인할 수 없어요"
    (사용자 실측 "오늘 날씨도 못 보여준다"). 좌표 조회(POI_INFO) 없이, 날짜는 여행 중이니 오늘."""
    poi_info, weather = _PoiInfo(), _Weather(pop=40)
    facts = _run(HANDLERS[Intent.GET_WEATHER], _ctx(_snapshot((), status=None), ports=HandlerPorts(poi_info=poi_info, weather=weather)))
    assert poi_info.calls == []
    assert weather.calls == [{"anchor": region_center("제주")[1], "days": (_D2,), "now": _NOW}]
    assert facts.status is FactStatus.OK and facts.payload == {
        "infoKind": "WEATHER", "title": "제주 날씨", "rows": [{"label": "오늘 최대 강수확률", "value": "40%"}]}
    assert _types(facts) == ["OPEN_ITINERARY_METHOD"]  # 일정이 없으니 보기가 아니라 만들기로
    assert facts.detail == {"date": _D2.isoformat(), "anchor": "제주"}


def test_weather_today_asked_on_a_day_without_slots_uses_the_region_center() -> None:
    """"오늘 날씨" 인데 오늘이 여행일이 아니다(여행 전) — 그 날 슬롯이 없으니 지역 중심, 날짜는 말한 대로 오늘."""
    before = datetime(2026, 10, 10, 9, 0, tzinfo=_KST)
    poi_info, weather = _PoiInfo(), _Weather(pop=20)
    facts = _run(HANDLERS[Intent.GET_WEATHER], _ctx(arguments={"date": "오늘"}, now=before,
                                                   ports=HandlerPorts(poi_info=poi_info, weather=weather)))
    assert poi_info.calls == []
    assert weather.calls[0]["anchor"] == region_center("제주")[1] and weather.calls[0]["days"] == (date(2026, 10, 10),)
    assert facts.payload["rows"] == [{"label": "오늘 최대 강수확률", "value": "20%"}]


def test_weather_before_the_trip_without_slots_asks_about_the_first_day() -> None:
    """날짜를 안 말했고 슬롯도 없는 여행 전 — 슬롯 규칙("앞으로 올 첫 슬롯")과 같은 날인 여행 첫날."""
    before = datetime(2026, 10, 10, 9, 0, tzinfo=_KST)
    weather = _Weather(pop=10)
    _run(HANDLERS[Intent.GET_WEATHER], _ctx(_snapshot((), status=None), now=before, ports=HandlerPorts(poi_info=_PoiInfo(), weather=weather)))
    assert weather.calls[0]["days"] == (_D1,)


def test_weather_unknown_region_and_no_slot_stays_empty() -> None:
    """표에 없는 여행 지역(도 단위)·슬롯 없음 — 종전처럼 EMPTY, 만들기로 잇는다."""
    trip = TripInfo("trip-2", ("전라남도",), _D1, _D3, "IN_TRIP")
    facts = _run(HANDLERS[Intent.GET_WEATHER], _ctx(_snapshot((), trip=trip, status=None), ports=HandlerPorts(poi_info=_PoiInfo(), weather=_Weather())))
    assert facts.status is FactStatus.EMPTY and _types(facts) == ["OPEN_ITINERARY_METHOD"]


def test_distance_uses_previous_slot_as_origin_and_keeps_only_distance_strings() -> None:
    poi_info, transit = _PoiInfo(), _Transit()
    ctx = _ctx(arguments={"destination": "해녀의집"}, ports=HandlerPorts(poi_info=poi_info, transit=transit))
    (task,) = HANDLERS[Intent.GET_DISTANCE].plan(ctx)
    assert task.name == "transit"
    value = task.fn()
    assert poi_info.calls[0]["poi_ids"] == frozenset({PoiId(_U["우도"]), PoiId(_U["해녀의집"])})
    (call,) = transit.calls
    assert call["origin"] == _COORD["우도"] and call["destination"] == _COORD["해녀의집"]
    assert call["mode"] == "PUBLIC" and call["purpose"] == "info_display" and call["now"] == _NOW
    assert "internal_minutes" not in value and value["distance_range"] == "약 1.2km"  # INV-3
    facts = HANDLERS[Intent.GET_DISTANCE].assemble(ctx, {"transit": TaskResult.ok("transit", value)})
    # 대역 기본은 실 경로 API 가 안 될 때의 하버사인×우회계수(LOW) — 경로 거리가 아니라서 추정으로 밝힌다
    assert facts.payload == {"infoKind": "DISTANCE", "title": "해녀의집", "rows": [{"label": "직전 구간", "value": "약 1.2km(추정)"}]}
    assert facts.template_text == "두 곳 사이 거리를 찾아봤어요." and _types(facts) == ["OPEN_ITINERARY"]
    assert facts.detail == {"origin": "우도", "destination": "해녀의집", "mode": "PUBLIC"}
    assert any("PUBLIC" in n for n in facts.notes)  # 가정한 수단을 남긴다
    assert any("직선" in n for n in facts.notes)  # 답변 LLM 이 경로 거리처럼 말하지 않게


def test_distance_mode_argument_is_passed_through() -> None:
    transit = _Transit(confidence="HIGH")
    ctx = _ctx(arguments={"destination": "해녀의집", "mode": "WALK"}, ports=HandlerPorts(poi_info=_PoiInfo(), transit=transit))
    facts = _run(HANDLERS[Intent.GET_DISTANCE], ctx)
    assert transit.calls[0]["mode"] == "WALK" and facts.detail["mode"] == "WALK" and not facts.notes


def test_route_distance_is_shown_as_is_and_straight_line_estimate_is_marked() -> None:
    """경로 API(ODsay·TMAP)가 한도 초과로 빠지면 Provider 는 하버사인×우회계수(confidence LOW)로 상태 OK 를 낸다 — 그 값을
    경로 거리처럼 보이면 "약 3.1km"(실제 5.8km)가 된다(2026-10-19 E2E). LOW 만 "(추정)"을 붙이고 메모를 남긴다."""
    ctx = lambda transit: _ctx(arguments={"destination": "해녀의집", "mode": "WALK"}, ports=HandlerPorts(poi_info=_PoiInfo(), transit=transit))
    route = _run(HANDLERS[Intent.GET_DISTANCE], ctx(_Transit(confidence="HIGH")))
    assert route.payload["rows"] == [{"label": "직전 구간", "value": "약 1.2km"}] and not route.notes
    guess = _run(HANDLERS[Intent.GET_DISTANCE], ctx(_Transit(confidence="LOW")))
    assert guess.payload["rows"] == [{"label": "직전 구간", "value": "약 1.2km(추정)"}]
    assert guess.places[-1].distance_range == "약 1.2km(추정)" and any("직선" in n for n in guess.notes)


@pytest.mark.parametrize("arguments", [
    {"destination": "우도"},  # 그 날 첫 슬롯 — 직전 구간이 없다
    {"destination": "카페"},  # 여럿 — None
    {"destination": "경복궁"},  # 일정 밖
    {"destination": "경복궁", "origin": "우도"},  # 일정 밖 목적지 — 장소 DB 가 없으면 못 찾는다
    {},
])
def test_distance_unresolvable_leg_is_an_empty_handoff(arguments: dict) -> None:
    ctx = _ctx(arguments=arguments, ports=HandlerPorts(poi_info=_PoiInfo(), transit=_Transit()))
    assert HANDLERS[Intent.GET_DISTANCE].plan(ctx) == ()
    facts = _run(HANDLERS[Intent.GET_DISTANCE], ctx)
    assert facts.status is FactStatus.EMPTY and facts.kind is AnswerKind.TEXT
    assert facts.template_text == "그 구간 거리는 아직 확인하지 못했어요."
    assert any("미해소" in n for n in facts.notes)  # '없다'가 아니라 '못 풀었다' — LLM 재료·관측에 남긴다


def _free_distance(arguments: dict, found=None) -> tuple[Facts, _Transit, _PlaceSql | None]:
    transit, finder = _Transit(confidence="HIGH"), (_PlaceSql(found) if found is not None else None)
    ctx = _ctx(arguments=arguments, ports=HandlerPorts(poi_info=_PoiInfo(), transit=transit, place_sql=finder))
    return _run(HANDLERS[Intent.GET_DISTANCE], ctx), transit, finder


def test_distance_between_two_named_areas_uses_region_centers_and_says_so() -> None:
    from trippilot.domain.region_centers import region_center

    facts, transit, _ = _free_distance({"origin": "강남역", "destination": "홍대 쪽"})
    (call,) = transit.calls
    assert call["origin"] == region_center("강남")[1] and call["destination"] == region_center("홍대")[1]
    assert "internal_minutes" not in json.dumps(facts.payload)  # 거리만(INV-3)
    assert facts.status is FactStatus.OK and facts.payload["rows"] == [{"label": "구간", "value": "약 1.2km(지역 중심 기준)"}]
    assert facts.detail == {"origin": "강남", "destination": "홍대", "mode": "PUBLIC"}  # 표 이름 — 발화 원문 아님
    assert facts.places == () and _types(facts) == ["OPEN_ITINERARY"] and facts.template_text == "두 곳 사이 거리를 찾아봤어요."


def test_distance_between_two_non_adjacent_itinerary_places_is_now_answered() -> None:
    facts, transit, _ = _free_distance({"origin": "성산일출봉", "destination": "해녀의집"})
    assert transit.calls[0]["origin"] == _COORD["성산일출봉"] and transit.calls[0]["destination"] == _COORD["해녀의집"]
    assert [p.name for p in facts.places] == ["성산일출봉", "해녀의집"] and facts.places[-1].distance_range == "약 1.2km"
    assert _types(facts) == ["OPEN_PLACE"]


def test_distance_to_a_registered_place_outside_the_itinerary_finds_it_by_exact_name() -> None:
    found = [PlaceRow(_U["천지연폭포"], "천지연폭포", "자연", "제주특별자치도", "서귀포시", False, False)]
    facts, transit, finder = _free_distance({"origin": "우도", "destination": "천지연 폭포"}, found)
    assert finder.calls == [("find", "천지연 폭포", "제주")]
    assert transit.calls[0]["destination"] == _COORD["천지연폭포"] and facts.detail["destination"] == "천지연폭포"


def test_distance_with_an_unknown_end_stays_empty_and_never_calls_transit() -> None:
    facts, transit, _ = _free_distance({"origin": "우도", "destination": "롯데월드"}, [])
    assert transit.calls == [] and facts.status is FactStatus.EMPTY


def test_distance_origin_matching_the_previous_slot_is_accepted() -> None:
    ctx = _ctx(arguments={"destination": "해녀의집", "origin": "우도"}, ports=HandlerPorts(poi_info=_PoiInfo(), transit=_Transit()))
    assert _run(HANDLERS[Intent.GET_DISTANCE], ctx).kind is AnswerKind.INFO


def test_distance_transit_failure_is_unavailable_text() -> None:
    ctx = _ctx(arguments={"destination": "해녀의집"}, ports=HandlerPorts(poi_info=_PoiInfo(), transit=_Transit(fail=True)))
    facts = _run(HANDLERS[Intent.GET_DISTANCE], ctx)
    assert facts.status is FactStatus.UNAVAILABLE and facts.kind is AnswerKind.TEXT
    assert facts.template_text == fallback_answer_text(Intent.GET_DISTANCE, {"status": "UNAVAILABLE"})


def test_poi_info_card_rows_and_open_place_action() -> None:
    poi_info = _PoiInfo()
    ctx = _ctx(arguments={"place": "해녀의집"}, ports=HandlerPorts(poi_info=poi_info))
    (task,) = HANDLERS[Intent.GET_POI_INFO].plan(ctx)
    assert task.name == "poi_info"
    facts = HANDLERS[Intent.GET_POI_INFO].assemble(ctx, {"poi_info": TaskResult.ok("poi_info", task.fn())})
    assert poi_info.calls[0] == {"poi_ids": frozenset({PoiId(_U["해녀의집"])}), "on": _D2, "now": _NOW}
    assert facts.payload == {"infoKind": "PLACE", "title": "해녀의집", "rows": [
        {"label": "분류", "value": _FOOD_KO}, {"label": "영업시간", "value": "09:00~18:00"}, {"label": "입장료", "value": "5,000원"}]}
    assert [(a.type, a.label, a.params) for a in facts.next_actions] == [("OPEN_PLACE", "장소 보기", {"poiId": _U["해녀의집"]})]
    assert facts.status is FactStatus.OK and facts.template_text == "장소 정보를 찾아봤어요."
    assert facts.to_prompt_dict()["rows"] == facts.payload["rows"]  # 아는 입장료는 프롬프트에도 간다
    (place,) = facts.places
    assert (place.poi_id, place.hours_label, place.fee) == (_U["해녀의집"], "09:00~18:00", 5000)


def test_poi_info_unknown_hours_keep_the_provider_wording_and_free_is_free() -> None:
    """영업시간 정보가 없으면 Provider 문구("영업시간 정보 없음")를 그대로 싣는다 — 대역이 None 으로 "모름"을 흉내 내던 동안
    실물에서 None 이 뜻하는 "그 요일 휴무"가 "미확인"으로 뭉개졌다(2026-10-19 E2E)."""
    ctx = _ctx(arguments={"place": "우도"}, ports=HandlerPorts(poi_info=_PoiInfo()))
    facts = _run(HANDLERS[Intent.GET_POI_INFO], ctx)
    assert facts.payload["rows"] == [{"label": "분류", "value": "자연"}, {"label": "영업시간", "value": "영업시간 정보 없음"},
                                     {"label": "입장료", "value": "무료"}]


def test_poi_info_date_argument_sets_the_weekday_lookup() -> None:
    poi_info = _PoiInfo()
    _run(HANDLERS[Intent.GET_POI_INFO], _ctx(arguments={"place": "성산", "date": "10월 18일"}, ports=HandlerPorts(poi_info=poi_info)))
    assert poi_info.calls[0]["on"] == _D1


@pytest.mark.parametrize("ports,fail", [
    (HandlerPorts(poi_info=_PoiInfo(fail=True)), None),
    (HandlerPorts(poi_info=_PoiInfo(missing=frozenset({"해녀의집"}))), None),
    (HandlerPorts(poi_info=_PoiInfo()), {"poi_info": "TIMEOUT"}),
    (HandlerPorts(), None),
])
def test_poi_info_lookup_failure_still_shows_the_snapshot_card_as_partial(ports: HandlerPorts, fail) -> None:
    facts = _run(HANDLERS[Intent.GET_POI_INFO], _ctx(arguments={"place": "해녀의집"}, ports=ports), fail=fail)
    assert facts.status is FactStatus.PARTIAL and facts.kind is AnswerKind.INFO
    assert facts.payload["rows"] == [{"label": "분류", "value": _FOOD_KO}, {"label": "영업시간", "value": "미확인"}, {"label": "입장료", "value": "미확인"}]
    assert facts.notes and facts.template_text == "장소 정보를 찾아봤어요."
    # 모르는 입장료는 카드에만 — 답변 프롬프트에 실으면 카페 답마다 "입장료도 미확인이에요"가 붙는다(답변 0.3.2)
    assert facts.to_prompt_dict()["rows"] == [{"label": "분류", "value": _FOOD_KO}, {"label": "영업시간", "value": "미확인"}]


@pytest.mark.parametrize("arguments", [{"place": "경복궁"}, {"place": "카페"}, {}])
def test_poi_info_unresolved_place_is_an_empty_handoff(arguments: dict) -> None:
    ctx = _ctx(arguments=arguments, ports=HandlerPorts(poi_info=_PoiInfo()))
    assert HANDLERS[Intent.GET_POI_INFO].plan(ctx) == ()
    facts = _run(HANDLERS[Intent.GET_POI_INFO], ctx)
    assert facts.status is FactStatus.EMPTY and facts.template_text == "그 장소는 아직 찾지 못했어요."
    assert _types(facts) == ["OPEN_ITINERARY"] and any("미해소" in n for n in facts.notes)


# ── ④ 의도별 — SUGGEST_ALTERNATIVE (PlanB 인프로세스) ────────────────────────


def _alt_ports(*, pool: CandidatePool | None = None, result: PlanBRagResult | None = None,
               weather: _Weather | None = None, pool_raise: bool = False) -> tuple[HandlerPorts, _PoolBuilder, _PlanB]:
    # 대상(해녀의집·성산일출봉)은 풀에 있되 일정이라 excluded — 후보는 일정 밖 흑돼지거리(FOOD)·동문시장·용두암
    pool = pool if pool is not None else _pool(
        _poi("해녀의집", PoiCategory.FOOD), _poi("흑돼지거리", PoiCategory.FOOD), _poi("성산일출봉"), _poi("동문시장"), _poi("용두암"))
    builder = _PoolBuilder(pool, raise_=pool_raise)
    planb = _PlanB(result if result is not None else _planb_result(("흑돼지거리",), ("동문시장",)))
    return HandlerPorts(poi_info=_PoiInfo(), weather=weather, pool_builder=builder, planb=planb), builder, planb


def test_alternatives_chain_anchor_pool_weather_and_planb_request() -> None:
    ports, builder, planb = _alt_ports(weather=_Weather(pop=90))
    ctx = _ctx(arguments={"target": "해녀의집", "reason": "closed"}, ports=ports, remaining_ms=2500)
    (task,) = HANDLERS[Intent.SUGGEST_ALTERNATIVE].plan(ctx)
    assert task.name == "alternatives"
    value = task.fn()
    (request, now), = builder.requests
    assert request.anchor == _COORD["해녀의집"] and request.dates == (_D2,) and now == _NOW
    (req,) = planb.requests
    assert req.trigger.kind is TriggerKind.MANUAL and req.trigger.affected_date == _D2
    assert req.reason == "closed" and req.use_llm is False and req.deadline_ms == 2500
    assert req.excluded_poi_ids == frozenset(PoiId(_U[n]) for n in (
        "성산일출봉", "섭지코지", "올레국수", "우도", "해녀의집", "카페 모카", "스타벅스 카페", "한라산", "제주민속촌"))
    assert req.rain_prob_by_date == {_D2: 90} and req.trace_id == _TRACE and req.now == _NOW
    # 식사 칸이라 풀은 식사 후보로 좁혀진다 (pool_builder.restrict_pool_to_target_role — 앱 슬롯 대안과 같은 함수)
    assert req.pool.poi_ids == frozenset({PoiId(_U["해녀의집"]), PoiId(_U["흑돼지거리"])})
    assert value["status"] == "OK" and [c["name"] for c in value["candidates"]] == ["흑돼지거리"]  # 동문시장은 좁힌 풀 밖


def test_alternatives_food_narrowing_relaxes_when_every_food_candidate_is_already_scheduled() -> None:
    # 식사 후보가 전부 일정 안(올레국수·해녀의집)이면 좁혀서 0 이 되니 넓힌다 — 대안 0 보다 낫다(INV-4)
    pool = _pool(_poi("해녀의집", PoiCategory.FOOD), _poi("올레국수", PoiCategory.FOOD), _poi("용두암"))
    ports, _, planb = _alt_ports(pool=pool, result=_planb_result(("용두암",)))
    _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "해녀의집"}, ports=ports))
    assert planb.requests[0].pool.poi_ids == pool.poi_ids


def test_alternatives_default_reason_none_and_no_weather_port() -> None:
    ports, _, planb = _alt_ports()
    _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "성산"}, ports=ports))
    (req,) = planb.requests
    assert req.reason == "none" and req.rain_prob_by_date == {}
    # 비식사 칸은 식당을 빼고, 같은 분류(명소)가 일정 밖에 둘뿐이라 모자라 식당 아닌 전부로 채운다(결정 3)
    assert req.pool.poi_ids == frozenset(PoiId(_U[n]) for n in ("성산일출봉", "동문시장", "용두암"))


_SIGHT_POOL = (_poi("제주민속촌"), _poi("흑돼지거리", PoiCategory.FOOD), _poi("동문시장"), _poi("천지연폭포", PoiCategory.NATURE))


def test_alternatives_sight_slot_keeps_only_same_category_when_three_are_left() -> None:
    pool = _pool(*_SIGHT_POOL, _poi("용두암"), _poi("협재해수욕장"))
    ports, _, planb = _alt_ports(pool=pool, result=_planb_result(("동문시장",)))
    _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "제주민속촌"}, ports=ports))
    assert planb.requests[0].pool.poi_ids == frozenset(PoiId(_U[n]) for n in ("제주민속촌", "동문시장", "용두암", "협재해수욕장"))


def test_alternatives_sight_slot_fills_with_other_non_food_and_lists_same_category_first() -> None:
    ports, _, planb = _alt_ports(pool=_pool(*_SIGHT_POOL), result=_planb_result(("천지연폭포",), ("동문시장",)))
    facts = _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "제주민속촌"}, ports=ports))
    assert planb.requests[0].pool.poi_ids == frozenset(PoiId(_U[n]) for n in ("제주민속촌", "동문시장", "천지연폭포"))
    assert [c["name"] for c in facts.payload["candidates"]] == ["동문시장", "천지연폭포"]


@pytest.mark.parametrize("constraint,food", [
    ("밥 먹을 데", True), ("근처 맛집으로", True), ("배고파", True), ("식사할 곳", True),
    ("밥 먹고 갈 만한 데", False),  # 식후에 갈 곳
    ("맛집 말고 구경할 곳", False), ("식당은 빼고", False), ("실내로", False),
])
def test_alternatives_food_only_when_the_user_asks_for_somewhere_to_eat(constraint: str, food: bool) -> None:
    ports, _, planb = _alt_ports(pool=_pool(*_SIGHT_POOL), result=_planb_result(("동문시장",)))
    _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "제주민속촌", "constraint": constraint}, ports=ports))
    assert (planb.requests[0].pool.poi_ids == frozenset({PoiId(_U["흑돼지거리"])})) is food


@pytest.mark.parametrize("said,expected", [
    ("weather", "weather"), ("fully_booked", "fully_booked"), ("none", "none"),
    ("비 와서 10분 거리로 바꿔줘", "weather"),  # 임의 문장도 키워드로 닫힌 어휘에 사상된다 — PlanB 에는 닫힌 어휘만 간다
    ("WEATHER", "none"), ("", "none"),
])
def test_alternatives_reason_slot_is_folded_to_the_planb_closed_set(said: str, expected: str) -> None:
    """`reason` 슬롯 스펙은 `choices=()` 라 IntentGate 가 값을 거르지 않는다(gates/intent.py `if spec.choices`) — 인자표에
    choices 를 채우면 `$intents` 가 바뀌어 intent.yaml 재생 픽스처가 전건 미스라(BR-AO-14) 여기서 접는다."""
    ports, _, planb = _alt_ports()
    _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "성산", "reason": said}, ports=ports))
    assert planb.requests[0].reason == expected


def test_alternatives_candidates_card_with_one_pick_quick_reply_each() -> None:
    # PlanB 의 rationale 은 use_llm=False 에서 출처 표기("MANUAL/none · rule_ranking")다 — 사용자 카드의 reason 은 결정론 라벨만
    ports, _, _ = _alt_ports(result=_planb_result(("흑돼지거리", "용두암"), ("동문시장",), rationale="MANUAL/none · rule_ranking"))
    ctx = _ctx(arguments={"target": "우도"}, ports=ports)
    facts = _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], ctx)
    assert facts.kind is AnswerKind.CANDIDATES and facts.status is FactStatus.OK
    cands = facts.payload["candidates"]
    assert [c["name"] for c in cands] == ["흑돼지거리", "용두암", "동문시장"]
    assert all(c["reason"] == CANDIDATE_REASON and c["distanceRange"].startswith("약 ") for c in cands)
    assert "rule_ranking" not in json.dumps(facts.payload) and all(p.reason == CANDIDATE_REASON for p in facts.places)
    slot_key = f"{_D2.isoformat()}#{_U['우도']}"
    assert [(q.action, q.params) for q in facts.quick_replies] == [
        ("PICK_CANDIDATE", {"poiId": c["poiId"], "slotKey": slot_key}) for c in cands]
    assert _types(facts) == ["OPEN_ITINERARY"] and facts.template_text == "우도 대신 갈 만한 곳이에요."
    assert facts.detail["target"] == "우도" and {p.poi_id for p in facts.places} == {c["poiId"] for c in cands}


def test_alternatives_cap_at_five_and_dedupe() -> None:
    outside = ("흑돼지거리", "동문시장", "용두암", "협재해수욕장", "함덕해수욕장", "천지연폭포")
    many = _pool(_poi("제주민속촌"), *(_poi(n) for n in outside))
    result = _planb_result(("흑돼지거리", "동문시장", "흑돼지거리"), ("용두암", "협재해수욕장", "함덕해수욕장", "천지연폭포"))
    ports, _, _ = _alt_ports(pool=many, result=result)
    facts = _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "제주민속촌"}, ports=ports))
    names = [c["name"] for c in facts.payload["candidates"]]
    assert names == ["흑돼지거리", "동문시장", "용두암", "협재해수욕장", "함덕해수욕장"] and len(facts.quick_replies) == 5


@pytest.mark.parametrize("arguments", [{"target": "카페"}, {"target": "경복궁"}, {}])
def test_alternatives_unresolved_target_is_empty_text(arguments: dict) -> None:
    ports, builder, planb = _alt_ports()
    ctx = _ctx(arguments=arguments, ports=ports)
    assert HANDLERS[Intent.SUGGEST_ALTERNATIVE].plan(ctx) == ()
    facts = _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], ctx)
    assert facts.status is FactStatus.EMPTY and facts.kind is AnswerKind.TEXT and facts.quick_replies == ()
    assert facts.template_text == fallback_answer_text(Intent.SUGGEST_ALTERNATIVE, {"status": "EMPTY"})
    assert any("미해소" in n for n in facts.notes)  # spec Edge Case: 여럿 겹치면 지어내지 않는다 — '없음'이 아니라 '해소 실패'
    assert not builder.requests and not planb.requests


def test_alternatives_zero_candidates_is_empty_with_the_reason_in_notes() -> None:
    ports, _, _ = _alt_ports(result=_planb_result())
    facts = _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "우도"}, ports=ports))
    assert facts.status is FactStatus.EMPTY and facts.kind is AnswerKind.TEXT
    assert "no_candidates" in " ".join(facts.notes) and _types(facts) == ["OPEN_ITINERARY"]


@pytest.mark.parametrize("make", [
    lambda: _alt_ports(pool_raise=True)[0],
    lambda: HandlerPorts(poi_info=_PoiInfo(fail=True), pool_builder=_PoolBuilder(_pool()), planb=_PlanB(_planb_result())),
    lambda: HandlerPorts(poi_info=_PoiInfo(), pool_builder=None, planb=_PlanB(_planb_result())),
])
def test_alternatives_infrastructure_failure_is_unavailable_text(make) -> None:
    facts = _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "우도"}, ports=make()))
    assert facts.status is FactStatus.UNAVAILABLE and facts.kind is AnswerKind.TEXT and facts.quick_replies == ()
    assert facts.template_text == fallback_answer_text(Intent.SUGGEST_ALTERNATIVE, {"status": "UNAVAILABLE"})


def test_alternatives_planb_pipeline_error_is_unavailable_not_empty() -> None:
    """KB·DB 장애(PlanB `empty_reason="pipeline_error"`)는 "대안이 없다"(EMPTY)가 아니라 "확인할 수 없다"다 — 그래야 팬아웃이
    상태값으로 보고하고(2026-10-18 리뷰: 이벤트 0·로그 0 이었다) 사용자 문장도 정직하다. 사유는 코드만(예외 메시지 없음)."""
    failed = PlanBRagResult(alternatives=(), is_fallback=True, fallback_level=2, notes=("pipeline_error: OperationalError: x",),
                            retrieved={}, dropped_out_of_pool=(), empty_reason="pipeline_error")
    ports, _, _ = _alt_ports(result=failed)
    (task,) = HANDLERS[Intent.SUGGEST_ALTERNATIVE].plan(_ctx(arguments={"target": "우도"}, ports=ports))
    assert task.fn() == {"status": "UNAVAILABLE", "reason": "planb_pipeline_error"}
    facts = _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "우도"}, ports=ports))
    assert facts.status is FactStatus.UNAVAILABLE


def test_alternatives_timeout_is_unavailable_text() -> None:
    ports, _, _ = _alt_ports()
    facts = _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "우도"}, ports=ports), fail={"alternatives": "TIMEOUT"})
    assert facts.status is FactStatus.UNAVAILABLE and facts.kind is AnswerKind.TEXT


# ── Facts·NextAction 불변식 ──────────────────────────────────────────────────


def _text_facts(**over) -> Facts:
    base = dict(intent=Intent.GENERATE_SCHEDULE, status=FactStatus.OK, kind=AnswerKind.TEXT, rows=(), places=(), notes=(),
                payload=None, next_actions=(dh.NextAction("OPEN_ITINERARY", "일정 보기"),), quick_replies=(),
                template_text="일정 만들기 화면으로 안내할게요.")
    base.update(over)
    return Facts(**base)


@pytest.mark.parametrize("over", [
    {"next_actions": ()},
    {"template_text": ""},
    {"template_text": "약 30분 걸려요."},  # INV-3
    {"template_text": "자세한 건 https://example.com 에서"},
    {"template_text": "가" * 401},
    {"template_text": "\n".join(["줄"] * 7)},
    {"footnote": "가" * 121},
    {"payload": {"x": 1}},  # TEXT 는 payload 없음
    {"kind": AnswerKind.INFO, "payload": {"infoKind": "PLACE", "title": "t"}},  # rows 누락 — FE 크래시
    {"kind": AnswerKind.INFO, "payload": {"infoKind": "NOPE", "title": "t", "rows": []}},
    {"kind": AnswerKind.CANDIDATES, "payload": {"candidates": []}},
    # 고르기 버튼은 전부 있거나 전부 없다 — 일부만 있으면 거부 (장소 탐색은 전부 없다)
    {"kind": AnswerKind.CANDIDATES, "payload": {"candidates": [{"poiId": "p", "name": "n", "reason": "r"},
                                                               {"poiId": "q", "name": "m", "reason": "r"}]},
     "quick_replies": (dh.QuickReplyDraft("n", "PICK_CANDIDATE", {"poiId": "p", "slotKey": "k"}),)},
    {"detail": {"status": "x"}},  # 예약 키
    # 후보 reason 은 사용자 카드에 그대로 그려진다(FE AssistantCards) — 문장 게이트와 같은 검사(시간 표현·연락처·빈 값)
    {"kind": AnswerKind.CANDIDATES, "payload": {"candidates": [{"poiId": "p", "name": "n", "reason": "걸어서 30분 거리"}]},
     "quick_replies": (dh.QuickReplyDraft("n", "PICK_CANDIDATE", {"poiId": "p", "slotKey": "k"}),)},
    {"kind": AnswerKind.CANDIDATES, "payload": {"candidates": [{"poiId": "p", "name": "n", "reason": ""}]},
     "quick_replies": (dh.QuickReplyDraft("n", "PICK_CANDIDATE", {"poiId": "p", "slotKey": "k"}),)},
])
def test_facts_rejects_shapes_the_wire_or_gate_would_reject(over: dict) -> None:
    with pytest.raises(ValueError):
        _text_facts(**over)


def test_facts_info_with_empty_rows_list_is_allowed_and_candidates_need_exactly_one_pick() -> None:
    info = _text_facts(kind=AnswerKind.INFO, payload={"infoKind": "WEATHER", "title": "t", "rows": []})
    assert info.payload["rows"] == []
    pick = dh.QuickReplyDraft("n", "PICK_CANDIDATE", {"poiId": "p", "slotKey": "k"})
    cands = _text_facts(kind=AnswerKind.CANDIDATES, payload={"candidates": [{"poiId": "p", "name": "n", "reason": "r"}]},
                        quick_replies=(pick,))
    assert cands.quick_replies == (pick,)
    with pytest.raises(ValueError):
        _text_facts(kind=AnswerKind.CANDIDATES, payload={"candidates": [{"poiId": "p", "name": "n", "reason": "r"}]},
                    quick_replies=(pick, pick))


@pytest.mark.parametrize("bad", [
    lambda: dh.NextAction("OPEN_EVERYTHING", "x"),
    lambda: dh.NextAction("OPEN_PLACE", "장소 보기"),  # poiId 필수
    lambda: dh.NextAction("OPEN_ITINERARY", ""),
    lambda: dh.NextAction("OPEN_ITINERARY", "가" * 31),
    lambda: dh.QuickReplyDraft("x", "PICK_OPTION", {}),  # AI 가 내지 않는 종류
    lambda: dh.QuickReplyDraft("x", "PICK_CANDIDATE", {"poiId": "p"}),
])
def test_next_action_and_quick_reply_drafts_are_closed_sets(bad) -> None:
    with pytest.raises(ValueError):
        bad()


def test_task_result_constructors() -> None:
    assert TaskResult.ok("w", {"status": "OK"}) == TaskResult("w", "OK", {"status": "OK"})
    assert TaskResult.failed("w", "TIMEOUT").value is None
    with pytest.raises(ValueError):
        TaskResult("w", "LOST", None)
    with pytest.raises(ValueError):
        TaskResult("w", "OK", None)


def test_facts_prompt_dict_has_no_coordinates_or_internal_ids() -> None:
    ports, _, _ = _alt_ports()
    facts = _run(HANDLERS[Intent.SUGGEST_ALTERNATIVE], _ctx(arguments={"target": "우도"}, ports=ports))
    rendered = json.dumps(facts.to_prompt_dict(), ensure_ascii=False, default=str)
    assert "lat" not in rendered and "lng" not in rendered
    assert facts.payload["candidates"] and all(c["poiId"] not in rendered for c in facts.payload["candidates"])
    assert facts.to_prompt_dict()["target"] == "우도" and facts.to_prompt_dict()["status"] == "OK"


# ── ⑥ PBT — 결정론 · next_actions · 게이트 자가 만족 · INV-3 ────────────────

_INV3_TOKENS = ("duration", "minutes", "internal_minutes", "소요")
_names = st.sampled_from(sorted(_U))
_categories = st.sampled_from(["명소", _FOOD_KO, "카페", "자연", "문화", None])


@st.composite
def _snapshots(draw) -> TurnSnapshot:
    n_days = draw(st.integers(min_value=0, max_value=3))
    days = []
    for i in range(n_days):
        names = draw(st.lists(_names, unique=True, max_size=4))
        times = sorted(draw(st.lists(st.times(), min_size=len(names), max_size=len(names))))
        on = _D1 + timedelta(days=i)
        slots = tuple(SlotView.from_wire(f"{on.isoformat()}#{_U[nm]}", nm if draw(st.booleans()) else None, t, draw(_categories))
                      for nm, t in zip(names, times))
        days.append((on, slots))
    trip = draw(st.sampled_from([_TRIP, TripInfo("trip-1", (), _D1, _D3, "PLANNING"), TripInfo("trip-1", (), _D1, _D3, "ENDED"), None]))
    return _snapshot(tuple(days), trip=trip, status=draw(st.sampled_from(["PLANNED", "CONFIRMED", None])))


_arguments = st.fixed_dictionaries({}, optional={
    "target": st.one_of(_names, st.text(max_size=6)), "destination": st.one_of(_names, st.text(max_size=6)),
    "place": st.one_of(_names, st.text(max_size=6)), "origin": _names, "mode": st.sampled_from(["WALK", "CAR", "PUBLIC", "택시"]),
    "day": st.sampled_from(["1일차", "2일차", "둘째 날", "오늘", "x"]), "date": st.sampled_from(["오늘", "내일", "10월 18일", "x"]),
    "scope": st.sampled_from(["ALL", "REMAINING"]), "reason": st.sampled_from(["weather", "closed", "none"]),
    "region": st.sampled_from(["부산", "제주 애월", "강원도", ""]), "category": st.sampled_from(["CAFE", "NIGHT_VIEW", "FOOD"]),
    "theme": st.sampled_from(["요즘 핫한", "야경", "분위기 좋은 바"]),
})
_outcomes = st.sampled_from(["ok", "TIMEOUT", "UNAVAILABLE"])


def _random_ports(draw) -> HandlerPorts:
    return HandlerPorts(
        poi_info=_PoiInfo(fail=draw(st.booleans()), missing=frozenset(draw(st.lists(_names, max_size=2)))),
        weather=draw(st.one_of(st.none(), st.builds(_Weather, pop=st.one_of(st.none(), st.integers(0, 100)), unknown=st.booleans()))),
        transit=draw(st.one_of(st.none(), st.builds(_Transit, fail=st.booleans()))),
        pool_builder=_PoolBuilder(_pool(_poi("흑돼지거리", PoiCategory.FOOD), _poi("동문시장"), _poi("용두암")), raise_=draw(st.booleans())),
        planb=_PlanB(draw(st.sampled_from([_planb_result(("흑돼지거리",), ("동문시장", "용두암")), _planb_result()]))),
    )


@settings(max_examples=250, deadline=None)
@given(data=st.data(), intent=st.sampled_from(sorted(DIALOGUE_INTENTS, key=lambda i: i.value)),
       snapshot=_snapshots(), arguments=_arguments, now=st.sampled_from([_NOW, datetime(2026, 10, 10, 9, tzinfo=_KST)]))
def test_every_handler_is_deterministic_valid_and_free_of_duration(data, intent: Intent, snapshot: TurnSnapshot,
                                                                   arguments: dict, now: datetime) -> None:
    handler = HANDLERS[intent]
    ctx = _ctx(snapshot, arguments, ports=_random_ports(data.draw), now=now)
    tasks = handler.plan(ctx)
    assert len({t.name for t in tasks}) == len(tasks)  # 이름은 플랜 안에서 유일 — 결정론 병합 키
    results = {}
    for task in tasks:
        outcome = data.draw(_outcomes)
        results[task.name] = TaskResult.ok(task.name, task.fn()) if outcome == "ok" else TaskResult.failed(task.name, outcome)
    first = handler.assemble(ctx, results)
    assert first == handler.assemble(ctx, results)  # 같은 입력 → 같은 Facts (도착 순서 무관)
    assert first == handler.assemble(ctx, dict(reversed(list(results.items()))))
    assert first.next_actions and {a.type for a in first.next_actions} <= NEXT_ACTION_TYPES
    assert not _violates(first.template_text, _MAX_LENGTH)
    wire = json.dumps({"payload": first.payload, "text": first.template_text, "notes": first.notes,
                       "detail": first.to_prompt_dict()}, ensure_ascii=False, default=str).lower()
    assert not any(tok in wire for tok in _INV3_TOKENS)
    if snapshot.trip is None:
        assert first.needs_trip is (intent not in (Intent.STYLE_ANALYSIS, Intent.EXPLORE_PLACES))
    for task in tasks:
        assert task.fn() == task.fn()  # 콜러블도 결정론 (대역이 결정론이라 그렇다 — 핸들러가 상태를 섞지 않는다)


@pytest.mark.parametrize(("said", "reason"), [
    ("오늘 휴관", "closed"), ("문 닫았대", "closed"), ("closed", "closed"),
    ("비가 와서", "weather"), ("눈이 많이 와", "weather"),
    ("늦게 일어나서", "delay"), ("차가 막혀서", "delay"),
    ("너무 피곤해", "fatigue"),
    ("예약이 꽉 찼대", "fully_booked"), ("예약이 취소됐어", "canceled"),
    ("비싸서", "none"), ("그냥", "none"), (None, "none"),  # "비싸서"의 "비"를 날씨로 읽지 않는다
    # 셀프 리뷰 오탐 실측 — weather 는 PlanB 가 야외 후보를 내리는 사유라 오탐이 순위를 바꾼다
    ("주차비가 비싸서", "none"), ("가성비가 별로라서", "none"), ("날씨 좋으니까 야외로", "none"), ("비가 안 와서", "none"),
    ("눈이 아파서", "none"), ("그냥 취소하고 다른 데", "none"), ("늦게까지 하는 데로", "none"), ("주차가 힘들어서", "none"),
    ("준비가 늦어져서", "delay"), ("도로 공사로 길이 막혀서", "delay"), ("영업 마감했대", "closed"), ("날씨가 안 좋아서", "weather"),
    ("비 와서 문 닫았대", "closed"),  # 그곳이 닫힌 것이 사유 — 휴관이 날씨보다 앞
])
def test_alternative_reason_maps_free_korean_to_planb_vocabulary(said, reason) -> None:
    """SUGGEST_ALTERNATIVE 의 reason 슬롯은 한글 자유문("오늘 휴관")이다 — `_REASON_KO` 키와 같을 때만 넘기면 늘 none 이라
    휴관 대신 찾기가 "근처의 대안"으로만 나왔다(2026-10-19 E2E). 키워드로 PlanB 어휘에 사상한다."""
    assert _planb_reason(said) == reason


def test_reason_words_only_name_planb_reasons() -> None:
    assert {key for key, _ in _REASON_WORDS} <= set(_REASON_KO)


@given(said=st.one_of(st.none(), st.integers(), st.text(max_size=80), st.lists(st.text(max_size=10), max_size=3)))
def test_pbt_planb_reason_always_lands_in_the_closed_vocabulary(said) -> None:
    """LLM 슬롯 출구 — 무엇이 와도 PlanB 어휘 안이고 예외가 없다(INV-1 닫힌 어휘, DL-5)."""
    assert _planb_reason(said) in _REASON_KO


def test_poi_info_on_another_day_names_the_day() -> None:
    """영업시간은 그 장소가 든 날 기준이다 — 오늘이 아니면 날짜 행을 밝힌다("휴무일 수 있음"이 오늘로 읽히지 않게, 셀프 리뷰)."""
    facts = _run(HANDLERS[Intent.GET_POI_INFO], _ctx(arguments={"place": "성산"}, ports=HandlerPorts(poi_info=_PoiInfo())))
    assert facts.payload["rows"][0] == {"label": "날짜", "value": "10월 18일"}


def test_next_slot_without_any_itinerary_offers_to_make_one() -> None:
    """일정 자체가 없는데 "남은 일정이 없어요"·[일정 보기]로 답하면 틀린다 — 사실이 비어 템플릿 직행이라(BR-AO-25) LLM 이
    고쳐 말해 주지도 않는다(셀프 리뷰). 만들기로 보낸다(BE QueryCards.noItinerary)."""
    facts = _run(HANDLERS[Intent.GET_NEXT_SLOT], _ctx(_EMPTY_SNAP))
    assert facts.template_text == "아직 일정에 장소가 없어요."
    assert [a.type for a in facts.next_actions] == ["OPEN_ITINERARY_METHOD"]



# ── EXPLORE_PLACES — 지역·일정 근처 등록 POI 탐색 (INV-1: 풀 안에서만) ─────────────────────────────────


def _xpoi(name: str, category: PoiCategory = PoiCategory.SIGHT, *, tags: tuple[str, ...] = (), saved: int = 0) -> Poi:
    return Poi(poi_id=PoiId(str(uuid.uuid5(uuid.NAMESPACE_DNS, "x-" + name))), name=name, category=category,
               coord=GeoPoint(35.16, 129.16), open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL,
               source=PoiSource.SEED, confidence=None, saved_count=saved, tags=tags)


_X_POOL = _pool(
    _xpoi("평범한 식당", PoiCategory.FOOD, saved=9), _xpoi("인기 식당", PoiCategory.FOOD, tags=("요즘 인기",)),
    _xpoi("셋째 식당", PoiCategory.FOOD, saved=5), _xpoi("인기 카페", PoiCategory.CAFE, tags=("요즘 인기",)),
    _xpoi("바다 전망 카페", PoiCategory.CAFE), _xpoi("황령산 야경", PoiCategory.NIGHT_VIEW),
    _xpoi("루프탑 바", PoiCategory.FOOD, tags=("나이트라이프",)), _xpoi("해변 호텔", PoiCategory.STAY),
)
_EXPLORE = HANDLERS[Intent.EXPLORE_PLACES]


def _explore(arguments: dict, *, snapshot: TurnSnapshot = _EMPTY_SNAP, pool: CandidatePool = _X_POOL,
             raise_: bool = False) -> tuple[Facts, _PoolBuilder]:
    builder = _PoolBuilder(pool, raise_=raise_)
    ctx = _ctx(snapshot, arguments, ports=HandlerPorts(poi_info=_PoiInfo(), pool_builder=builder))
    return _run(_EXPLORE, ctx), builder


def _names_of(facts: Facts) -> list[str]:
    return [c["name"] for c in facts.payload["candidates"]]


def test_explore_region_anchor_ranks_trending_first_and_keeps_out_stays_and_nightlife() -> None:
    from trippilot.domain.region_centers import region_center

    facts, builder = _explore({"region": "부산 해운대", "theme": "요즘 핫한"})
    (request, _), = builder.requests
    _, center, km = region_center("부산 해운대")
    assert request.anchor == center and request.radius_override_km == km  # 더 구체적인 '해운대'
    assert facts.kind is AnswerKind.CANDIDATES and facts.status is FactStatus.OK and not facts.needs_trip
    names = _names_of(facts)
    assert set(names[:2]) == {"인기 식당", "인기 카페"}  # "요즘 인기" 태그가 먼저(그 안은 poi_id)
    assert "해변 호텔" not in names and "루프탑 바" not in names  # 숙소·나이트라이프는 밤 주제일 때만
    assert sum(1 for n in names if "식당" in n) == 2  # 종류를 안 정하면 한 종류 ≤2
    assert facts.quick_replies == () and _types(facts) == ["OPEN_PLACE"] * len(names)  # 바꿀 슬롯이 없다 — 고르기 대신 장소 보기
    assert all(c["distanceRange"] is None for c in facts.payload["candidates"])  # 지역 중심에서의 거리는 싣지 않는다
    assert [p.name for p in facts.places] == names  # 문장 재료 = 카드 = 풀 (INV-1)
    assert facts.detail == {"anchor": "해운대", "anchor_kind": "region"}  # 표 이름 — theme 같은 발화 원문은 싣지 않는다(INV-2)


def test_explore_night_theme_puts_night_view_and_nightlife_first() -> None:
    facts, _ = _explore({"region": "부산", "theme": "분위기 좋은 바"})
    assert set(_names_of(facts)[:2]) == {"황령산 야경", "루프탑 바"}


@pytest.mark.parametrize("theme", ["가볼 만한", "실내 데이트", "놀거리"])
def test_explore_sightseeing_theme_without_a_category_leaves_out_restaurants(theme: str) -> None:
    names = _names_of(_explore({"region": "부산", "theme": theme})[0])
    assert names and not any("식당" in n for n in names) and "인기 카페" in names


def test_explore_food_category_keeps_restaurants_even_with_a_sightseeing_word() -> None:
    assert any("식당" in n for n in _names_of(_explore({"region": "부산", "category": "FOOD", "theme": "데이트"})[0]))


def _outside(arguments: dict, found) -> tuple[Facts, _PlaceSql, _PoiInfo]:
    finder, poi_info = _PlaceSql(found), _PoiInfo()
    ctx = _ctx(arguments=arguments, ports=HandlerPorts(poi_info=poi_info, place_sql=finder))
    return _run(HANDLERS[Intent.GET_POI_INFO], ctx), finder, poi_info


def test_poi_info_outside_the_itinerary_finds_the_registered_place_by_name() -> None:
    found = [PlaceRow(_U["천지연폭포"], "천지연폭포", "자연", "제주특별자치도", "서귀포시", False, False)]
    facts, finder, poi_info = _outside({"place": "천지연 폭포"}, found)
    assert finder.calls == [("find", "천지연 폭포", "제주")]  # 여행 지역(시·도)으로 좁힌다
    assert poi_info.calls[0]["poi_ids"] == frozenset({PoiId(_U["천지연폭포"])}) and poi_info.calls[0]["on"] == _ctx().today
    assert facts.status is FactStatus.OK and facts.kind is AnswerKind.INFO
    assert facts.payload["title"] == "천지연폭포"  # 이름은 DB 값 — 발화 원문("천지연 폭포")이 아니다
    assert facts.payload["rows"] == [{"label": "분류", "value": "자연"}, {"label": "영업시간", "value": "09:00~18:00"},
                                     {"label": "입장료", "value": "5,000원"}]
    assert [(a.type, a.params) for a in facts.next_actions] == [("OPEN_PLACE", {"poiId": _U["천지연폭포"]})]
    assert any("일정 밖" in n for n in facts.notes) and facts.template_text == "장소 정보를 찾아봤어요."


def test_poi_info_outside_the_itinerary_not_found_or_ambiguous_stays_empty() -> None:
    facts, finder, poi_info = _outside({"place": "롯데월드"}, [])  # 없음·여럿(체인점) 모두 찾기가 None
    assert finder.calls and poi_info.calls == []
    assert facts.status is FactStatus.EMPTY and facts.template_text == "그 장소는 아직 찾지 못했어요."


def test_poi_info_in_the_itinerary_never_asks_the_place_db() -> None:
    _, finder, _ = _outside({"place": "우도"}, [PlaceRow("x", "다른 우도", "자연", None, None, False, False)])
    assert finder.calls == []


class _RefPoiInfo(_PoiInfo):
    """source_ref 를 싣는 POI_INFO 대역 — 소개(KB-5) 조인 키."""

    def fetch(self, params: dict) -> InfoPacket:
        packet = super().fetch(params)
        for row in packet.data.get("pois", ()):
            row["source_ref"] = "ref-" + row["name"]
        return packet


class _Intro:
    def __init__(self, text: str = "우도는 제주 동쪽의 섬이다.") -> None:
        self.text, self.calls = text, []

    def intro(self, source_ref: str, query: str) -> str:
        self.calls.append((source_ref, query))
        return self.text


def _intro_run(arguments: dict, utterance: str = "") -> tuple[Facts, _Intro]:
    intro = _Intro()
    ctx = replace(_ctx(arguments=arguments, ports=HandlerPorts(poi_info=_RefPoiInfo(), place_intro=intro)), utterance=utterance)
    return _run(HANDLERS[Intent.GET_POI_INFO], ctx), intro


def test_poi_info_about_a_place_carries_a_kb5_intro_for_the_answer_only() -> None:
    facts, intro = _intro_run({"place": "우도", "aspect": "어떤 곳"}, "우도 어떤 곳이야?")
    assert intro.calls == [("ref-우도", "어떤 곳")]
    assert facts.detail == {"target": "우도", "intro": "우도는 제주 동쪽의 섬이다."}
    assert "섬" not in str(facts.payload)  # 카드(payload)에는 싣지 않는다 — 위키 원문 출처 표기


def test_poi_info_hours_or_fee_question_does_not_fetch_an_intro() -> None:
    facts, intro = _intro_run({"place": "우도"}, "우도 몇 시까지 해?")
    assert intro.calls == [] and "intro" not in facts.detail


def test_explore_category_filters_the_pool() -> None:
    facts, _ = _explore({"region": "부산", "category": "CAFE"})
    assert _names_of(facts) == ["인기 카페", "바다 전망 카페"]


def test_explore_without_region_uses_the_next_itinerary_slot_with_distance() -> None:
    facts, builder = _explore({}, snapshot=_SNAP)
    (request, _), = builder.requests
    assert request.anchor == _COORD["해녀의집"] and request.radius_override_km == dh._NEAR_SLOT_KM  # 10:00 이후 첫 슬롯
    assert facts.detail["anchor_kind"] == "itinerary"
    assert all(c["distanceRange"] for c in facts.payload["candidates"])


def test_explore_without_region_or_slots_uses_the_trip_destination() -> None:
    from trippilot.domain.region_centers import region_center

    facts, builder = _explore({}, snapshot=_snapshot((), trip=_TRIP))
    assert builder.requests[0][0].anchor == region_center("제주")[1]
    assert facts.kind is AnswerKind.CANDIDATES


def test_explore_without_any_anchor_asks_for_a_region_without_calling_anything() -> None:
    from trippilot.llm_gateway.workers.dialogue_answer import EXPLORE_ASK_REGION_TEXT

    facts, builder = _explore({}, snapshot=_snapshot((), trip=None, status=None))
    assert builder.requests == [] and facts.template_text == EXPLORE_ASK_REGION_TEXT and not facts.needs_trip
    assert not (facts.rows or facts.places or facts.notes or facts.detail)  # 사실 없음 → 오케스트레이터가 LLM 없이 이 문장 그대로
    assert _types(facts) == ["CREATE_TRIP"]


def test_explore_unknown_region_is_empty_and_does_not_fall_back_to_the_trip() -> None:
    facts, builder = _explore({"region": "강원도"}, snapshot=_SNAP)
    assert builder.requests == [] and facts.status is FactStatus.EMPTY and facts.kind is AnswerKind.TEXT
    assert facts.detail == {} and facts.notes  # 발화 원문은 사실 칸에 옮기지 않는다


@pytest.mark.parametrize("kw", [{"raise_": True}, {"pool": _pool()}])
def test_explore_pool_failure_is_unavailable_and_empty_pool_is_empty(kw) -> None:
    facts, _ = _explore({"region": "부산"}, **kw)
    assert facts.kind is AnswerKind.TEXT
    assert facts.status is (FactStatus.UNAVAILABLE if kw.get("raise_") else FactStatus.EMPTY)



def test_alternative_candidates_need_a_pick_each_but_explore_candidates_have_none() -> None:
    """모양 검사는 "고르기 버튼이 전부 있거나 전부 없다"(탐색) — 대안만은 Facts 가 후보마다 하나를 다시 조인다(BR-AO-20)."""
    cand = {"candidates": [{"poiId": "p", "name": "n", "reason": "r"}]}
    with pytest.raises(ValueError):
        _text_facts(intent=Intent.SUGGEST_ALTERNATIVE, kind=AnswerKind.CANDIDATES, payload=cand)
    assert _text_facts(intent=Intent.EXPLORE_PLACES, kind=AnswerKind.CANDIDATES, payload=cand).quick_replies == ()


class _PlaceSql:
    """PlaceSqlLookup 대역 — 부른 인자를 남기고 정해 둔 행(None = 폴백)을 돌려준다."""

    writes_sql = True

    def __init__(self, rows) -> None:
        self.rows, self.calls = rows, []

    def lookup(self, utterance, arguments, trace_id, now, *, timeout_sec):
        self.calls.append((utterance, dict(arguments), timeout_sec))
        return self.rows

    def find_place(self, name, sido_prefix, trace_id):
        self.calls.append(("find", name, sido_prefix))
        return self.rows[0] if self.rows else None


def _row(name: str, category: str = "명소", sigungu: str | None = "종로구", *, sido: str = "서울특별시",
         trending: bool = False, nightlife: bool = False) -> PlaceRow:
    return PlaceRow(poi_id="s-" + name, name=name, category=category, sido=sido, sigungu=sigungu, trending=trending,
                    nightlife=nightlife)


def _explore_sql(arguments: dict, rows, *, utterance: str = "서울 요즘 핫한 곳", remaining_ms: int = 7000,
                 pool: CandidatePool = _X_POOL) -> tuple[Facts, _PlaceSql, _PoolBuilder]:
    port, builder = _PlaceSql(rows), _PoolBuilder(pool)
    ctx = replace(_ctx(_EMPTY_SNAP, arguments, ports=HandlerPorts(poi_info=_PoiInfo(), pool_builder=builder, place_sql=port),
                       remaining_ms=remaining_ms), utterance=utterance)
    return _run(_EXPLORE, ctx), port, builder


def test_explore_sql_runs_beside_the_radius_pool_and_wins_when_it_has_rows() -> None:
    rows = [_row("경복궁", trending=True), _row("클럽 엑스", "야경", "마포구", nightlife=True), _row("북촌", "문화")]
    facts, port, builder = _explore_sql({"region": "서울", "theme": "요즘 핫한", "category": "SIGHT"}, rows)
    (said, args, timeout), = port.calls
    assert said == "서울 요즘 핫한 곳" and args == {"region": "서울", "theme": "요즘 핫한", "category": "명소"}  # 종류는 한글로
    assert timeout == pytest.approx(2.8) and builder.requests  # 반경 풀도 나란히 돈다(실패 대비)
    assert _names_of(facts) == ["경복궁", "북촌"]  # 나이트라이프는 밤 주제일 때만
    assert [c["reason"] for c in facts.payload["candidates"]] == ["요즘 인기", "문화"]
    assert all(c["distanceRange"] is None for c in facts.payload["candidates"]) and _types(facts) == ["OPEN_PLACE"] * 2
    assert facts.detail == {"anchor": "서울", "anchor_kind": "region"}  # 지역 표 이름 — 발화 원문 아님(INV-2)


def test_explore_sql_keeps_only_rows_in_the_said_city() -> None:
    rows = [_row("해운대해수욕장", sido="부산광역시", sigungu="해운대구"), _row("경복궁"), _row("광안리", sido="부산광역시", sigungu="수영구")]
    facts, _, _ = _explore_sql({"region": "부산"}, rows, utterance="부산 가볼 만한 곳")
    assert _names_of(facts) == ["해운대해수욕장", "광안리"]


def test_explore_sql_argument_region_wins_over_another_region_in_the_utterance() -> None:
    # 계획 경로: "부산 카페랑 서울 맛집" 이 도구 둘로 나뉘고 이 몫은 region=부산 — SQL 이 발화의 서울을 읽어도 서울 행은 버린다
    rows = [_row("서울 카페 A", "카페"), _row("서울 카페 B", "카페")]
    facts, port, _ = _explore_sql({"region": "부산", "category": "CAFE"}, rows, utterance="부산 카페랑 서울 맛집")
    assert port.calls[0][1]["region"] == "부산"
    assert facts.detail == {"anchor": "부산", "anchor_kind": "region"}
    assert _names_of(facts) == ["인기 카페", "바다 전망 카페"]  # 반경 탐색 결과(부산 중심)


def test_explore_sql_runs_from_arguments_alone_on_the_plan_path() -> None:
    facts, port, _ = _explore_sql({"region": "서울", "theme": "요즘 핫한"}, [_row("경복궁", trending=True)], utterance="")
    assert port.calls and port.calls[0][0] == "" and _names_of(facts) == ["경복궁"]


@pytest.mark.parametrize("rows", [None, []])
def test_explore_sql_failure_or_zero_rows_falls_back_to_the_radius_pool(rows) -> None:
    facts, port, _ = _explore_sql({"region": "부산", "theme": "요즘 핫한"}, rows)
    assert port.calls and set(_names_of(facts)[:2]) == {"인기 식당", "인기 카페"}  # 반경 탐색 결과(INV-4)


def test_explore_sql_finds_a_district_the_region_table_does_not_know() -> None:
    rows = [_row("망원한강공원", sigungu="마포구"), _row("경의선숲길", sigungu="마포구"), _row("여의도공원", sigungu="영등포구")]
    facts, _, builder = _explore_sql({"region": "망원동"}, rows, utterance="망원동 산책할 곳")
    assert builder.requests == [] and facts.status is FactStatus.OK  # 표에 없는 지역 — 반경은 못 돈다
    assert facts.detail == {"anchor": "마포구", "anchor_kind": "region"}  # 행의 구군(DB 값)이 앵커


def test_explore_sql_with_nothing_found_for_an_unknown_district_stays_empty() -> None:
    facts, _, _ = _explore_sql({"region": "망원동"}, [])
    assert facts.status is FactStatus.EMPTY and facts.detail == {}


def test_explore_sql_is_not_planned_without_a_said_region() -> None:
    _, port, _ = _explore_sql({"theme": "요즘 핫한"}, [_row("경복궁")], utterance="요즘 핫한 곳")  # 일정 근처는 거리가 핵심 — 반경만
    assert port.calls == []


def test_explore_sql_skips_the_llm_when_the_turn_has_too_little_time_left() -> None:
    facts, port, _ = _explore_sql({"region": "부산"}, [_row("경복궁")], remaining_ms=1500)  # 1.5s × 0.4 = 0.6s < 하한
    assert port.calls == [] and "인기 카페" in _names_of(facts)


def test_explore_asks_for_a_region_only_when_no_anchor_can_be_found() -> None:
    ask = HANDLERS[Intent.EXPLORE_PLACES].ask
    nothing = _ctx(_snapshot((), trip=None, status=None), ports=HandlerPorts(poi_info=_PoiInfo()))
    assert ask(nothing)[0] == "region"
    assert ask(_ctx(_snapshot((), trip=None, status=None), {"region": "강원도"})) is None  # 말했으면 묻지 않는다 — 못 찾으면 EMPTY
    assert ask(_ctx(_SNAP, ports=HandlerPorts(poi_info=_PoiInfo()))) is None  # 일정 근처
    assert ask(_ctx(_snapshot((), trip=_TRIP))) is None  # 여행 목적지
    assert all(HANDLERS[i].ask is None for i in HANDLERS if i is not Intent.EXPLORE_PLACES)


# ── EXPLORE_PLACES PBT (BR-AO-27) — 후보는 풀 안·≤5·결정론·입력 순서 무관, 숙소 0, 밤 주제가 아니면 나이트라이프 0, 종류 필터·한 종류 ≤2 ──


_X_CATS = sorted(PoiCategory, key=lambda c: c.value)


@st.composite
def _explore_pois(draw) -> list[Poi]:
    n = draw(st.integers(0, 14))
    return [Poi(poi_id=PoiId(str(uuid.uuid5(uuid.NAMESPACE_DNS, f"pbt-{i}"))), name=draw(st.sampled_from(["감천문화마을", "흰여울 카페", "x", "루프탑 바"])) + str(i),
                category=draw(st.sampled_from(_X_CATS)), coord=GeoPoint(35.1, 129.0), open_hours=(), avg_cost=None,
                rating=draw(st.one_of(st.none(), st.floats(0, 5))), quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None,
                saved_count=draw(st.integers(0, 50)), tags=tuple(draw(st.lists(st.sampled_from(["요즘 인기", "나이트라이프", "야경", "오션뷰"]), max_size=2, unique=True))))
            for i in range(n)]


@settings(max_examples=200, deadline=None)
@given(pois=_explore_pois(), category=st.one_of(st.none(), st.sampled_from([c.value for c in _X_CATS if c is not PoiCategory.STAY])),
       theme=st.one_of(st.none(), st.sampled_from(["요즘 핫한", "야경", "분위기 좋은 바", "오션뷰", "조용한"])), data=st.data())
def test_explore_rank_stays_inside_the_pool_and_obeys_its_filters(pois, category, theme, data) -> None:
    picked = dh._explore_rank(pois, category, theme)
    ids = [p.poi_id for p in picked]
    assert len(picked) <= dh.MAX_CANDIDATES and len(set(ids)) == len(ids) and set(ids) <= {p.poi_id for p in pois}  # INV-1
    assert picked == dh._explore_rank(data.draw(st.permutations(pois)), category, theme)  # 입력 순서 무관 결정론
    assert all(p.category is not PoiCategory.STAY for p in picked)
    night = bool(theme and dh._NIGHT.search(theme)) or category == PoiCategory.NIGHT_VIEW.value
    if not night:
        assert all("나이트라이프" not in p.tags for p in picked)
    if category is not None:
        assert all(p.category.value == category for p in picked)
    else:
        assert all(sum(1 for q in picked if q.category is p.category) <= 2 for p in picked)
