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

from dataclasses import replace
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace

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


def test_named_place_across_the_island_is_found() -> None:
    """DEV 실호출 회귀(2026-10-14) — 제주시 기준점에서 38.4km 인 성산일출봉이 반경 30 에 걸려
    `not_registered` 로 탈락했다. 이름 대조 반경은 백엔드 조회 상한(50km)까지 본다."""
    anchor = GeoPoint(33.4996, 126.5312)  # 제주시
    seongsan = _poi("s1", "성산일출봉", 33.4587, 126.9427, cat=PoiCategory.NATURE)
    from trippilot.assembly_engine.travel import haversine_km
    assert 30 < haversine_km(anchor, seongsan.coord) <= v.NAME_SEARCH_RADIUS_KM  # 전제
    poi, _ = v.match_place("성산일출봉", (seongsan,), anchor)
    assert poi is seongsan


# ── DEV 실호출 회귀 (2026-10-14) — 수락된 장소가 구성 LLM 에 밀려 조용히 빠지던 것 ─────────

class _FullDayComposer:
    """구성 LLM 이 숏리스트에서 **이름으로 집은 곳을 빼고** 하루를 꽉 채우는 경우를 재현한다."""

    def __init__(self) -> None:
        self.shortlists = []

    def compose(self, pool, inp, trace_id, now, *, timeout_sec=None):
        self.shortlists.append({str(p.poi_id) for p in pool.pois})
        picks = tuple(SimpleNamespace(poi_id=p.poi_id, reason="r") for p in pool.pois
                      if str(p.poi_id) != _WOLJEONG and p.category is not PoiCategory.STAY)
        return TypedResult(value=picks, is_fallback=False, error=None, call_record=None)


def _replan_with_composer(composer, schedule_wrap=None):
    app = build_dev_app(directives=_DIRECTIVES)
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(
        ExtractedRequest(places=(ExtractedPlace("월정리 카페거리", "visit"),)))
    orch._existence = FakeExistence()
    orch._composer = composer
    if schedule_wrap is not None:
        orch._schedule_agent = schedule_wrap(orch._schedule_agent)
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ai/v1/planb/replan", json=_body(free_text="월정리 카페거리 꼭 가고 싶어"))
    assert r.status_code == 200, r.text
    return r.json()


def test_named_place_reaches_the_composer_and_survives_a_full_day() -> None:
    """구성 숏리스트는 풀에서만 나온다 — 반경 밖 곳을 풀에 합류시키지 않으면 구성이 고를 수 없다.
    구성이 다른 곳으로 하루를 채워도 이름으로 집은 곳이 맨 앞에 남아 실제로 배치된다."""
    composer = _FullDayComposer()
    body = _replan_with_composer(composer)
    assert composer.shortlists and _WOLJEONG in composer.shortlists[0], "구성 숏리스트에 없다"
    assert _WOLJEONG in _placed(body), body["notes"]
    slot = next(s for d in body["itinerary"]["days"] for s in d["slots"] if s["poi_id"] == _WOLJEONG)
    assert slot["is_fixed"] is False  # 사용자가 잠근 곳이 아니다 — 잠그면 다음 다시 짜기에서 못 바꾼다


def test_named_place_that_cannot_be_placed_is_reported_not_dropped_silently() -> None:
    """수락된 곳이 일정에 못 들어가면 노트로 남는다 — DEV 에서는 아무 표시 없이 사라졌다."""
    def drop_it(inner):
        class _Drop:
            def run(self, task):
                out = inner.run(task)
                if out.solution is None:
                    return out
                days = tuple(replace(d, slots=tuple(s for s in d.slots if str(s.poi_id) != _WOLJEONG))
                             for d in out.solution.days)
                return replace(out, solution=replace(out.solution, days=days))
        return _Drop()

    body = _replan_with_composer(_FullDayComposer(), schedule_wrap=drop_it)
    assert _WOLJEONG not in _placed(body)
    assert f"nl_place_unplaced: {_WOLJEONG}" in body["notes"], body["notes"]


def _crowded_app(composer):
    """DEV 처럼 후보가 많은 풀 — 앵커 근처 카페 30곳이(PlanB 순위 상한 20 을 넘게) 반경 밖 월정리(카페)를 카테고리 상위 6에서 밀어낸다."""
    from trippilot.api.wiring import StaticPoiDb
    cafes = tuple(_poi(f"c{i:02d}", f"근처카페{i}", DEMO_ANCHOR.lat + 0.002 * i, DEMO_ANCHOR.lng,
                       cat=PoiCategory.CAFE) for i in range(1, 31))
    app = build_dev_app(directives=_DIRECTIVES, poi_db=StaticPoiDb(demo_poi_seed() + cafes))
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(
        ExtractedRequest(places=(ExtractedPlace("월정리 카페거리", "visit"),)))
    orch._existence = FakeExistence()
    orch._composer = composer
    return app, orch


def test_named_place_is_kept_in_the_composer_shortlist_against_closer_rivals() -> None:
    """숏리스트는 카테고리마다 점수 상위 6곳이다 — 먼 곳은 가까운 같은 종류에 밀린다. 이름으로 집은 곳은
    `keep` 으로 먼저 넣어야 구성 LLM 에게 보인다."""
    composer = _FullDayComposer()
    app, _ = _crowded_app(composer)
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post("/ai/v1/planb/replan", json=_body(free_text="월정리 카페거리 꼭"))
    assert composer.shortlists and _WOLJEONG in composer.shortlists[0]


def test_named_place_takes_a_composed_seat_instead_of_adding_one() -> None:
    """구성이 정한 방문 수가 곧 남은 시간에 맞춘 수다. 이름으로 집은 곳을 **9번째로 얹으면** 솔버가 시간
    부족으로 가장 먼 그 곳을 떨어뜨린다(DEV 실측). 구성 결과 맨 앞에 두고 뒤에서 하나를 뺀다."""
    composer = _FullDayComposer()
    app, orch = _crowded_app(composer)
    seen = []
    inner = orch._schedule_agent

    class _Spy:
        def run(self, task):
            seen.append(task.request)
            return inner.run(task)

    orch._schedule_agent = _Spy()
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post("/ai/v1/planb/replan", json=_body(free_text="월정리 카페거리 꼭"))
    req = seen[0]
    ids = [str(r.poi_id) for r in req.required_visits]
    assert ids and ids[0] == _WOLJEONG, ids
    assert len(ids) == len(set(ids))
    assert req.max_visits_per_day is None or len(ids) <= req.max_visits_per_day


def test_named_place_without_composer_is_not_locked() -> None:
    """구성 LLM 이 없을 때(실패·미주입)는 필수 방문으로 따로 붙는다 — 그래도 잠그지 않는다."""
    app = build_dev_app(directives=_DIRECTIVES)
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(
        ExtractedRequest(places=(ExtractedPlace("월정리 카페거리", "visit"),)))
    orch._existence = FakeExistence()
    orch._composer = None
    with TestClient(app, raise_server_exceptions=False) as client:
        body = client.post("/ai/v1/planb/replan", json=_body(free_text="월정리 카페거리 꼭")).json()
    slot = next(s for d in body["itinerary"]["days"] for s in d["slots"] if s["poi_id"] == _WOLJEONG)
    assert slot["is_fixed"] is False, body["notes"]


def test_extraction_gets_enough_time_for_a_real_model_call() -> None:
    """DEV 회귀(2026-10-14) — 시한 2.94s 에 `timeout` 으로 추출이 통째로 빠졌다. GPT sol(effort low) 한 건이
    3~5s 가 흔하므로, 25초 예산의 일반적인 잔여에서 4.5초 이상은 준다."""
    seen = []

    class _Capture(_StubExtractor):
        def extract(self, *a, timeout_sec=None, **kw):
            seen.append(timeout_sec)
            return super().extract(*a, **kw)

    app = build_dev_app(directives=_DIRECTIVES)
    app.state.orchestrator._request_extractor = _Capture(ExtractedRequest())
    body = _body(free_text="성산일출봉 꼭")
    body["request_meta"]["deadline_ms"] = 25_000
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post("/ai/v1/planb/replan", json=body)
    assert seen and seen[0] >= 4.5, seen


def test_extraction_overlaps_the_directive_translation_instead_of_following_it() -> None:
    """DEV 실측(2026-10-14): 번역 3.75s 와 추출 ~5s 가 **직렬로** 쌓여 구성 LLM 이 시한을 못 받았다.
    추출은 후보 풀이 필요 없으므로 재계획 시작에 배경으로 띄운다 — **실행이 겹쳐야** 한다.

    판정: 추출이 도는 **동안** 번역이 끝나야 한다. 추출을 맨 앞에서 동기로 돌리면 번역은 추출이
    끝난 뒤에야 시작되므로 이 단언이 깨진다(순서만 보는 단언으로는 직렬·병렬을 못 가른다).
    """
    import threading
    translated = threading.Event()
    seen = {}

    class _WaitsForTranslation(_StubExtractor):
        def extract(self, *a, **kw):
            seen["overlapped"] = translated.wait(3.0)
            return super().extract(*a, **kw)

    class _Translate:
        def translate(self, *a, **kw):
            translated.set()
            return TypedResult(value=None, is_fallback=True, error="stub", call_record=None)

    app = build_dev_app(directives=_DIRECTIVES)
    orch = app.state.orchestrator
    orch._request_extractor = _WaitsForTranslation(ExtractedRequest())
    orch._directive_translator = _Translate()
    orch._embedding = None  # 임베딩 매칭을 건너뛰어 번역까지 가게
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post("/ai/v1/planb/replan", json=_body(free_text="어디 조용한 데 없을까"))
    assert seen.get("overlapped") is True, seen


def test_named_place_goes_to_the_solver_as_a_priority_visit() -> None:
    """이름으로 집은 곳만 `priority` — 구성 LLM 이 고른 곳은 보통 필수 방문이다. 같은 무게면 솔버가
    먼 그 한 곳을 버리고 가까운 둘을 지킨다(DEV 2026-10-14, 2시간 넘는 빈칸에도 미배치)."""
    composer = _FullDayComposer()
    app, orch = _crowded_app(composer)
    seen = []
    inner = orch._schedule_agent

    class _Spy:
        def run(self, task):
            seen.append(task.request)
            return inner.run(task)

    orch._schedule_agent = _Spy()
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post("/ai/v1/planb/replan", json=_body(free_text="월정리 카페거리 꼭"))
    flags = {str(r.poi_id): r.priority for r in seen[0].required_visits}
    assert flags.get(_WOLJEONG) is True, flags
    assert sum(flags.values()) == 1, flags  # 나머지(구성 LLM 몫)는 보통 필수


# ── 먼 곳을 집으면 그 둘레도 후보로 (DEV 2026-10-14: 성산 38km, 12:00~16:00 공백) ─────────

def test_nearby_is_closest_first_capped_per_category_and_skips_unusable() -> None:
    here = _poi("x", "집은 곳", 33.0, 126.0, cat=PoiCategory.NATURE)
    reg = (here,
           *(_poi(f"f{i}", f"식당{i}", 33.0 + 0.001 * i, 126.0) for i in range(1, 6)),
           _poi("s1", "명소", 33.01, 126.0, cat=PoiCategory.SIGHT),
           _poi("h1", "호텔", 33.0001, 126.0, cat=PoiCategory.STAY),
           _poi("m1", "월휴", 33.0001, 126.0, cat=PoiCategory.CAFE,
                hours=(OpenHour(day_of_week=1, open_min=600, close_min=1200),)))
    got = [str(p.poi_id) for p in v.nearby(here, reg, DAY.weekday())]
    assert got == ["f1", "f2", "s1"]  # 식당은 가까운 둘만, 숙소·그날 휴무·자기 자신은 빠진다
    many = tuple(_poi(f"k{c.value}{i}", "x", 33.0 + 0.001 * i, 126.0, cat=c)
                 for c in PoiCategory if c is not PoiCategory.STAY for i in range(2))
    assert len(v.nearby(here, many, DAY.weekday())) == v.NEARBY_MAX


class _RecordingComposer:
    """숏리스트와 LLM 에 보여 준 거리를 적고, 집은 곳 + 그 둘레를 고른다."""

    def __init__(self) -> None:
        self.inputs = []

    def compose(self, pool, inp, trace_id, now, *, timeout_sec=None):
        self.inputs.append((pool, inp))
        picks = tuple(SimpleNamespace(poi_id=p.poi_id, reason="r") for p in pool.pois
                      if str(p.poi_id) == _WOLJEONG or str(p.poi_id).startswith("w"))
        return TypedResult(value=picks, is_fallback=False, error=None, call_record=None)


_W = demo_poi_seed()
_WJ = next(p.coord for p in _W if str(p.poi_id) == _WOLJEONG)
_AROUND = (_poi("w1", "월정 미술관", _WJ.lat + 0.005, _WJ.lng, cat=PoiCategory.CULTURE),
           _poi("w2", "월정 식당", _WJ.lat, _WJ.lng + 0.005))


# 앵커 근처 식당 30곳 — 카테고리 상위 6 에서 둘레 식당(w2)을 밀어낸다. `keep` 없이는 숏리스트에 못 든다.
_CROWD = tuple(_poi(f"n{i:02d}", f"근처식당{i}", DEMO_ANCHOR.lat + 0.002 * i, DEMO_ANCHOR.lng)
               for i in range(1, 31))


def _far_app(name: str):
    from trippilot.api.wiring import StaticPoiDb
    composer = _RecordingComposer()
    app = build_dev_app(directives=_DIRECTIVES, poi_db=StaticPoiDb(_W + _AROUND + _CROWD))
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(ExtractedRequest(places=(ExtractedPlace(name, "visit"),)))
    orch._existence = FakeExistence()
    orch._composer = composer
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ai/v1/planb/replan", json=_body(free_text=f"{name} 꼭 가고 싶어"))
    assert r.status_code == 200, r.text
    return r.json(), composer


def test_far_named_place_brings_its_surroundings_into_the_composer() -> None:
    """앵커 반경 밖 둘레 곳은 원래 풀에 없다 — 넣지 않으면 구성이 그 근처로 하루를 이을 수 없다.
    LLM 에 보이는 거리도 집은 곳 기준이어야 한다(앵커 기준 ~28km 면 안 고른다)."""
    body, composer = _far_app("월정리 카페거리")
    pool, inp = composer.inputs[0]
    shown = {str(p.poi_id) for p in pool.pois}
    assert {"w1", "w2"} <= shown, "\n".join(body["notes"])
    assert all(inp.distance_km[PoiId(w)] < 1.0 for w in ("w1", "w2"))
    assert f"nl_nearby_added: {_WOLJEONG} +2" in body["notes"]
    assert {"w1", "w2", _WOLJEONG} <= set(_placed(body)), body["notes"]


def test_named_place_inside_the_pool_adds_nothing() -> None:
    near = next(p for p in _W if str(p.poi_id).endswith("0002")
)  # 흑돼지거리 8.3km — 풀 반경 안
    body, composer = _far_app(near.name)
    assert f"nl_place_accepted: visit {near.poi_id}" in body["notes"], body["notes"]
    assert not any(n.startswith("nl_nearby_added") for n in body["notes"]), body["notes"]
    assert not {"w1", "w2"} & {str(p.poi_id) for p in composer.inputs[0][0].pois}


def test_surroundings_lookup_failure_keeps_the_named_place_and_says_so() -> None:
    from trippilot.api.wiring import StaticPoiDb

    class _NoNearby(StaticPoiDb):
        def find_by_radius(self, center, radius_km):
            if radius_km == v.NEARBY_RADIUS_KM:
                raise TimeoutError("be down")
            return super().find_by_radius(center, radius_km)

    app = build_dev_app(directives=_DIRECTIVES, poi_db=_NoNearby(_W + _AROUND))
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(
        ExtractedRequest(places=(ExtractedPlace("월정리 카페거리", "visit"),)))
    orch._existence = FakeExistence()
    orch._composer = _RecordingComposer()
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ai/v1/planb/replan", json=_body(free_text="월정리 카페거리 꼭"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert f"nl_nearby_unavailable: {_WOLJEONG} TimeoutError" in body["notes"]
    assert _WOLJEONG in _placed(body), body["notes"]
