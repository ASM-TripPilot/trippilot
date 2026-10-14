"""자연어 재계획 — LLM 이 뽑은 정보는 **외부 출처로 검증된 것만** 일정에 쓴다.

증명하는 것 (실 LLM·실 지도·실 API 0 — D37):
  ① 게이트는 모양만 본다 — 항목 격리, `HH:MM` 아닌 시각은 그 필드만 버린다, 빈 결과는 성공
  ② 장소 주장은 세 출처를 모두 통과해야 한다 — 등록 POI(INV-1) · 지도 실재 · 그날 영업
  ③ 시각 주장은 남은 시간창 안이어야 하고 창을 **좁히기만** 한다
  ④ 비 주장은 기상청 강수확률이 임계 이상일 때만 따른다
  ⑤ 통합: 검증 통과한 장소가 **실제로 일정에 들어간다** · 탈락은 노트로 남고 일정은 그대로 나온다
  ⑥ 추출이 실패해도 재계획은 돈다 (INV-4)
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from trippilot.agents.planb import request_verification as v
from trippilot.api.wiring import DEMO_ANCHOR, build_dev_app, demo_poi_seed
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.gates.replan_request_extraction import (
    ExtractedPlace,
    ExtractedRequest,
    ReplanRequestExtractionGate,
)
from trippilot.ports.place_existence_port import ExistenceStatus

from tests.fakes.fake_existence import FakeExistence
from tests.api.test_api_replan_wired import _DIRECTIVES, _body

KST = timezone(timedelta(hours=9))
DAY = date(2026, 9, 21)  # 월요일 — `_body` 의 target_date


def _gate(raw: str):
    return ReplanRequestExtractionGate().apply(
        raw, None, feature=LlmFeature.REPLAN_REQUEST_EXTRACTION,
        trace_id="t", now=datetime(2026, 9, 21, tzinfo=KST))


# ── ① 게이트 ──────────────────────────────────────────────────────────


def test_gate_keeps_good_items_and_drops_bad_ones() -> None:
    out = _gate('{"places": [{"name": "성심당", "want": "visit"}, {"name": "", "want": "visit"},'
                ' {"name": "경포해변", "want": "maybe"}, "x"], "end_by": "18:00",'
                ' "start_after": "오후 2시", "weather": "snow"}')
    assert out.error is None
    assert out.value.places == (ExtractedPlace("성심당", "visit"),)
    assert out.value.end_by == time(18, 0)
    assert out.value.start_after is None  # HH:MM 아님 → 그 필드만 버린다
    assert out.value.weather is None      # rain|clear 밖


def test_gate_empty_is_success_and_garbage_is_parse_error() -> None:
    empty = _gate('{"places": [], "start_after": null, "end_by": null, "weather": null}')
    assert empty.error is None and empty.value.empty
    assert _gate("죄송하지만 JSON 이 아닙니다").error.startswith("parse_error")


# ── ② 장소 — 세 출처 ─────────────────────────────────────────────────


def _poi(pid: str, name: str, lat: float, lng: float, *,
         cat: PoiCategory = PoiCategory.FOOD, hours: tuple[OpenHour, ...] = ()) -> Poi:
    return Poi(poi_id=PoiId(pid), name=name, category=cat, coord=GeoPoint(lat, lng),
               open_hours=hours, avg_cost=None, rating=None, quality=DataQuality.FULL,
               source=PoiSource.SEED, confidence=None)


_A = GeoPoint(36.33, 127.43)
_REG = (
    _poi("p1", "성심당 본점", 36.3276, 127.4273),
    _poi("p2", "성심당 DCC점", 36.3750, 127.3920),  # 더 멀다
    _poi("p3", "성심당", 36.40, 127.50),            # 정확 일치지만 멀다
    _poi("p4", "한빛탑", 36.37, 127.38, cat=PoiCategory.SIGHT),
    _poi("p5", "월요휴무식당", 36.33, 127.43, hours=(OpenHour(day_of_week=1, open_min=600, close_min=1200),)),
    _poi("p6", "호텔 오노마", 36.37, 127.39, cat=PoiCategory.STAY),
)


def test_exact_name_beats_partial_then_nearest_wins() -> None:
    poi, how = v.match_place("성심당", _REG, _A)
    assert (str(poi.poi_id), how) == ("p3", "exact")
    poi, how = v.match_place("성심당 본", _REG, _A)  # 부분 일치끼리는 가까운 곳
    assert str(poi.poi_id) == "p1" and how.startswith("partial")


@pytest.mark.parametrize("name,why", [("없는가게", "not_registered"), ("카", "too_short")])
def test_unregistered_or_too_short_names_never_become_candidates(name: str, why: str) -> None:
    """INV-1 — 등록 POI 에 없으면 후보가 될 길이 없다(지도에 있어도 마찬가지).

    탈락 **사유**까지 단언한다 — 처음엔 "어떤 사유로든 탈락"만 봐서, 대조를 끊어도 이름 없는 주장이
    가까운 휴무 식당으로 떨어져 **다른 사유로** 탈락하며 초록이었다(역검증 ③).
    """
    open_only = tuple(p for p in _REG if str(p.poi_id) != "p5")  # 휴무 식당을 빼 우연한 탈락을 막는다
    keep, avoid, notes = v.verify_places(
        (ExtractedPlace(name, "visit"),), open_only, _A, 0, FakeExistence(), 1000)
    assert keep == () and avoid == frozenset()
    assert notes == [f"nl_place_rejected: {why}"]


def test_map_not_found_is_rejected_unverified_is_kept_with_a_note() -> None:
    gone = FakeExistence({"p1": ExistenceStatus.NOT_FOUND})
    keep, _, notes = v.verify_places((ExtractedPlace("성심당 본점", "visit"),), _REG, _A, 0, gone, 1000)
    assert keep == () and "nl_place_rejected: map_not_found p1" in notes

    unsure = FakeExistence(default=ExistenceStatus.UNVERIFIED)
    keep, _, notes = v.verify_places((ExtractedPlace("성심당 본점", "visit"),), _REG, _A, 0, unsure, 1000)
    assert [str(p.poi_id) for p in keep] == ["p1"]  # 장애를 폐업으로 읽지 않는다
    assert "nl_place_existence_unverified: 1" in notes


def test_closed_that_day_and_stay_are_rejected() -> None:
    keep, _, notes = v.verify_places(
        (ExtractedPlace("월요휴무식당", "visit"), ExtractedPlace("호텔 오노마", "visit")),
        _REG, _A, 0, FakeExistence(), 1000)  # weekday 0 = 월요일, 영업은 화요일(1)만
    assert keep == ()
    assert "nl_place_rejected: closed_that_day p5" in notes
    assert "nl_place_rejected: stay p6" in notes


def test_existence_port_failure_does_not_kill_and_is_noted() -> None:
    class _Boom:
        def verify(self, queries, *, deadline_ms):
            raise RuntimeError("vendor down")

    keep, _, notes = v.verify_places((ExtractedPlace("한빛탑", "visit"),), _REG, _A, 0, _Boom(), 1000)
    assert [str(p.poi_id) for p in keep] == ["p4"]
    assert "nl_place_existence_error: RuntimeError" in notes


def test_avoid_needs_only_a_registered_match() -> None:
    port = FakeExistence()
    _, avoid, _ = v.verify_places((ExtractedPlace("한빛탑", "avoid"),), _REG, _A, 0, port, 1000)
    assert avoid == frozenset({PoiId("p4")})
    assert port.calls == []  # 피할 곳은 지도에 물을 필요가 없다


# ── ③ 시각 ────────────────────────────────────────────────────────────

_WS = datetime(2026, 9, 21, 9, 0, tzinfo=KST)
_WE = datetime(2026, 9, 21, 21, 0, tzinfo=KST)


def test_times_inside_the_window_narrow_it() -> None:
    s, e, notes = v.verify_window(DAY, time(11, 0), time(18, 0), _WS, _WE, None, KST)
    assert (s.hour, e.hour) == (11, 18)
    assert "nl_time_accepted: end_by 18:00" in notes


@pytest.mark.parametrize("start,end,now_h", [
    (None, time(22, 30), None),    # 창 뒤 — 넓히지 않는다
    (time(8, 0), None, None),      # 창 앞
    (time(10, 0), None, 12),       # 이미 지난 시각
    (None, time(12, 30), 12),      # 남는 창이 60분 미만
])
def test_times_outside_the_window_are_rejected(start, end, now_h) -> None:
    nb = datetime(2026, 9, 21, now_h, 0, tzinfo=KST) if now_h else None
    s, e, notes = v.verify_window(DAY, start, end, _WS, _WE, nb, KST)
    assert (s, e) == (None, None)
    assert any(n.startswith("nl_time_rejected") for n in notes)


# ── ④ 날씨 ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("prob,expected,prefix", [
    (80, True, "nl_weather_confirmed"),
    (20, False, "nl_weather_rejected"),
    (None, False, "nl_weather_unverified"),
])
def test_rain_claim_follows_the_forecast_not_the_words(prob, expected, prefix) -> None:
    ok, notes = v.verify_weather("rain", prob, 60)
    assert ok is expected and notes[0].startswith(prefix)


# ── ⑤⑥ 통합 — 실제로 일정에 닿는가 ─────────────────────────────────

_WOLJEONG = "e0000000-0000-4000-8000-000000000003"  # 월정리 카페거리 — 앵커에서 ~28km, 풀(10km) 밖


class _StubExtractor:
    def __init__(self, value: ExtractedRequest | None, error: str | None = None) -> None:
        self.value, self.error, self.calls = value, error, 0

    def extract(self, *a, **kw) -> TypedResult:
        self.calls += 1
        return TypedResult(value=self.value, is_fallback=self.value is None,
                           error=self.error, call_record=None)


def _replan(extracted: ExtractedRequest | None, *, existence=None, error=None, **body):
    app = build_dev_app(directives=_DIRECTIVES)
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(extracted, error)
    orch._existence = existence
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ai/v1/planb/replan", json=_body(free_text="월정리 카페거리 꼭 가고 싶어", **body))
    assert r.status_code == 200, r.text
    return r.json(), orch._request_extractor


def _placed(body) -> list[str]:
    return [s["poi_id"] for d in body["itinerary"]["days"] for s in d["slots"]]


def test_verified_place_outside_the_pool_lands_in_the_itinerary() -> None:
    """검증 통과 → 풀 밖이어도 필수 방문으로 들어간다. 이 단언이 없으면 배선해도 효과 0 이 초록이다."""
    body, ext = _replan(ExtractedRequest(places=(ExtractedPlace("월정리 카페거리", "visit"),)),
                        existence=FakeExistence())
    assert ext.calls == 1
    assert _WOLJEONG in _placed(body), body["notes"]
    assert f"nl_place_accepted: visit {_WOLJEONG}" in body["notes"]


def test_map_rejected_place_stays_out_and_the_day_still_comes_back() -> None:
    body, _ = _replan(ExtractedRequest(places=(ExtractedPlace("월정리 카페거리", "visit"),)),
                      existence=FakeExistence({_WOLJEONG: ExistenceStatus.NOT_FOUND}))
    assert _WOLJEONG not in _placed(body)
    assert f"nl_place_rejected: map_not_found {_WOLJEONG}" in body["notes"]
    assert body["empty_reason"] is None


def test_end_by_reaches_the_solver_window() -> None:
    """좁힌 창이 **어셈블리에 닿는다** — 데모 풀은 작아 하루가 원래 일찍 끝나므로 슬롯 시각으로는
    못 가른다(역검증 ⑧). 에이전트가 받는 `day_window` 를 직접 본다."""
    app = build_dev_app(directives=_DIRECTIVES)
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(ExtractedRequest(end_by=time(15, 0)))
    seen = []
    inner = orch._schedule_agent

    class _Spy:
        def run(self, task):
            seen.append(task.request.day_window)
            return inner.run(task)

    orch._schedule_agent = _Spy()
    with TestClient(app, raise_server_exceptions=False) as client:
        body = client.post("/ai/v1/planb/replan", json=_body(free_text="3시까지만")).json()
    assert "nl_time_accepted: end_by 15:00" in body["notes"]
    assert seen and seen[0].end.hour == 15 and seen[0].end.minute == 0


def test_extractor_failure_keeps_the_old_path() -> None:
    body, _ = _replan(None, error="timeout")
    assert "nl_extract_fallback: timeout" in body["notes"]
    assert body["empty_reason"] is None and _placed(body)


def test_no_free_text_means_no_llm_call() -> None:
    app = build_dev_app(directives=_DIRECTIVES)
    stub = _StubExtractor(ExtractedRequest())
    app.state.orchestrator._request_extractor = stub
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post("/ai/v1/planb/replan", json=_body())
    assert stub.calls == 0


@pytest.mark.parametrize("prob,expect_avoid", [(80, True), (10, False)])
def test_rain_claim_reaches_the_solver_only_when_the_forecast_agrees(prob, expect_avoid) -> None:
    """"비 온대"는 기상청이 확인할 때만 실외 회피가 된다 — 말이 아니라 관측을 따른다."""
    from trippilot.assembly_engine.config import RAIN_OUTDOOR

    app = build_dev_app(directives=_DIRECTIVES)
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(ExtractedRequest(weather="rain"))
    orch._rain_from = lambda packets, dates, now: {DAY: prob}
    seen = []
    inner = orch._schedule_agent

    class _Spy:
        def run(self, task):
            seen.append(task.request.avoid_categories)
            return inner.run(task)

    orch._schedule_agent = _Spy()
    with TestClient(app, raise_server_exceptions=False) as client:
        body = client.post("/ai/v1/planb/replan",
                           json=_body(reasons=[], free_text="비 온다던데")).json()
    assert seen
    assert (RAIN_OUTDOOR <= seen[0]) is expect_avoid, (seen[0], body["notes"])
