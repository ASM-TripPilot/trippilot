"""다시 짜기 자유입력의 '다른 날' — "서울광장 꼭, 1일차 말고 2일차에"를 이 날에 넣지 않는다 (F-6 1단계).

운영 2026-11-05(trip 8311ac19) 보고 ②: 1일차 다시 짜기에 "서울광장 꼭, 2일차에"라고 썼는데 서울광장이 1일차 필수
방문으로 들어갔다. 추출 스키마에 날 칸이 없었고, 검증을 통과한 장소는 무조건 그 다시 짜기 날짜에 고정됐다.

증명하는 것 (실 LLM·실 지도 0):
  ① 게이트는 날 말을 **말 그대로** 받는다 — 말에 없으면 None(지어내지 않는다), 모양이 틀리면 그 칸만 버린다
  ② 추출 프롬프트 0.5.0 이 places[].day 를 묻는다 (판 번호 핀)
  ③ 검증: 날 말을 여행 날짜로 환산해 이 날이 아니면 이 날의 갈 곳·뺄 곳에서 빼고 노트로 밝힌다 — 같은 날·못 환산하면 종전대로
  ④ 통합: 다른 날 장소는 필수 방문·후보·최종 일정 어디에도 이 날에 없다 · 같은 날 표현은 종전대로 들어간다
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from trippilot.agents.planb import request_verification as v
from trippilot.api.wiring import build_dev_app
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.llm.llm import LlmFeature, TypedResult
from trippilot.domain.poi.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.gates.replan.replan_request_extraction import (
    ExtractedPlace,
    ExtractedRequest,
    ReplanRequestExtractionGate,
)
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.replan.replan_request_extraction import build_extraction_vars

from tests.fakes.fake_existence import FakeExistence
from tests.api.test_api_replan_wired import _DIRECTIVES, _body

KST = timezone(timedelta(hours=9))
_PROMPTS = Path(__file__).resolve().parents[3] / "prompts"


def _gate(raw: str):
    return ReplanRequestExtractionGate().apply(
        raw, None, feature=LlmFeature.REPLAN_REQUEST_EXTRACTION,
        trace_id="t", now=datetime(2026, 11, 5, tzinfo=KST))


# ── ① 게이트 — 날 말은 말 그대로, 없으면 None ─────────────────────────


def test_gate_keeps_the_day_as_said_and_never_invents_one() -> None:
    out = _gate('{"places": [{"name": "서울광장", "want": "visit", "day": "2일차"},'
                ' {"name": "성심당", "want": "visit"},'
                ' {"name": "한빛탑", "want": "visit", "day": null},'
                ' {"name": "경포해변", "want": "visit", "day": 2},'
                ' {"name": "엑스포공원", "want": "avoid", "day": "   "}]}')
    assert out.error is None
    assert [(p.name, p.day) for p in out.value.places] == [
        ("서울광장", "2일차"),  # 말 그대로 — 환산은 코드 몫
        ("성심당", None),       # 말에 없으면 None (지어내지 않는다)
        ("한빛탑", None),
        ("경포해변", None),     # 문자열이 아니면 그 칸만 버린다 — 장소는 산다
        ("엑스포공원", None),   # 빈 말
    ]


def test_gate_drops_an_overlong_day_but_keeps_the_place() -> None:
    out = _gate('{"places": [{"name": "서울광장", "want": "visit", "day": "' + "가" * 41 + '"}]}')
    assert [(p.name, p.day) for p in out.value.places] == [("서울광장", None)]


# ── ② 추출 프롬프트 0.5.0 ────────────────────────────────────────────


def test_extraction_prompt_asks_for_the_day_as_said() -> None:
    prompt, ref = PromptRegistry(_PROMPTS).render(
        LlmFeature.REPLAN_REQUEST_EXTRACTION, build_extraction_vars("서울광장 꼭, 2일차에", "11월 5일 (목)", "06:00~21:00"))
    assert ref.version == "0.7.0"  # 0.5.0(places[].day) + 0.6.0 창 밖 시각 그대로 + 0.7.0 시간대·지금 기준 말
    assert '"day": "string|null"' in prompt  # 출력 스키마
    assert '"day":"2일차"' in prompt          # 사용자 보고 문장의 예시 — 빼 달라는 날(1일차)이 아니라 가고 싶은 날
    assert "지어내지" in prompt


# ── ③ 검증 — 이 날이 아니면 이 날에 넣지도 빼지도 않는다 ────────────────

_A = GeoPoint(36.33, 127.43)
_TRIP = (date(2026, 11, 5), date(2026, 11, 6), date(2026, 11, 7))  # 목·금·토
_ON = date(2026, 11, 5)  # 1일차 다시 짜기


def _poi(pid: str, name: str, cat: PoiCategory = PoiCategory.SIGHT) -> Poi:
    return Poi(poi_id=PoiId(pid), name=name, category=cat, coord=GeoPoint(36.33, 127.43),
               open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL,
               source=PoiSource.SEED, confidence=None)


_REG = (_poi("p1", "서울광장"), _poi("p2", "덕수궁"))


def _verify(*places: ExtractedPlace, existence=None, trip=_TRIP, today=_ON, registered=lambda: _REG):
    return v.verify(
        ExtractedRequest(places=places), on=_ON, anchor=_A,
        window_start=datetime(2026, 11, 5, 6, 0, tzinfo=KST), window_end=datetime(2026, 11, 5, 21, 0, tzinfo=KST),
        not_before=None, tz=KST, registered=registered, existence=existence or FakeExistence(),
        existence_deadline_ms=1000, rain_by_date={}, rain_threshold=60, trip_days=trip, today=today)


@pytest.mark.parametrize("said,on", [
    ("2일차", date(2026, 11, 6)), ("둘째 날", date(2026, 11, 6)), ("둘째날", date(2026, 11, 6)),
    ("내일", date(2026, 11, 6)), ("모레", date(2026, 11, 7)), ("11월 7일", date(2026, 11, 7)),
    ("2일차에", date(2026, 11, 6)),  # 조사가 붙어 와도
])
def test_place_said_for_another_day_is_left_out_of_this_day(said: str, on: date) -> None:
    """운영 보고 ② — "서울광장 꼭, 2일차에"가 1일차 필수 방문으로 들어갔다."""
    port = FakeExistence()
    out = _verify(ExtractedPlace("서울광장", "visit", day=said), existence=port)
    assert out.visit == ()
    assert out.other_day == frozenset({PoiId("p1")})
    assert f"nl_place_other_day: visit p1 {on.isoformat()}" in out.notes
    assert port.calls == []  # 이 날 갈 곳이 아니니 지도에 묻지 않는다


@pytest.mark.parametrize("said", [None, "1일차", "오늘", "첫째 날", "11월 5일"])
def test_same_day_or_no_day_goes_in_as_before(said: str | None) -> None:
    out = _verify(ExtractedPlace("서울광장", "visit", day=said))
    assert [str(p.poi_id) for p in out.visit] == ["p1"]
    assert out.other_day == frozenset()
    assert not any(n.startswith("nl_place_other_day") for n in out.notes)


@pytest.mark.parametrize("said", ["5일차", "다음 주", "언젠가"])
def test_unresolvable_day_falls_back_to_this_day_and_says_so(said: str) -> None:
    """못 환산하면 종전처럼 이 날이다 — 넘겨짚어 다른 날로 보내지 않는다. 사유 코드만 남긴다(사용자 말은 안 싣는다)."""
    out = _verify(ExtractedPlace("서울광장", "visit", day=said))
    assert [str(p.poi_id) for p in out.visit] == ["p1"]
    assert "nl_place_day_unresolved: day_out_of_trip" in out.notes
    assert not any(said in n for n in out.notes)


def test_an_empty_lookup_still_says_why_each_named_place_was_dropped() -> None:
    """50km 안 등록 POI 가 0곳이면 조회는 빈 목록으로 **정상** 끝난다 — 그때 다른 날 장소도 이 날 장소도 노트 한 줄 없이
    사라졌다(2026-11-05 Codex 리뷰). 빈 결과는 "조회 안 함"이 아니라 "못 찾음"이다 — 장소마다 사유를 남긴다(INV-4)."""
    out = _verify(ExtractedPlace("서울광장", "visit", day="2일차"), ExtractedPlace("덕수궁", "visit"),
                  registered=lambda: ())
    assert out.visit == () and out.other_day == frozenset()
    assert out.notes.count("nl_place_rejected: not_registered") == 2


def test_a_failed_lookup_does_not_call_the_places_unregistered() -> None:
    """조회 장애는 `nl_place_lookup_error` 하나로 밝힌다 — 장소마다 '등록 안 됨'이라고 하면 사유가 거짓이다(못 본 것이다)."""
    def down():
        raise RuntimeError("db down")

    out = _verify(ExtractedPlace("서울광장", "visit", day="2일차"), ExtractedPlace("덕수궁", "visit"), registered=down)
    assert out.visit == () and out.other_day == frozenset()
    assert "nl_place_lookup_error: RuntimeError" in out.notes
    assert not any(n.startswith("nl_place_rejected") for n in out.notes)


def test_pre_trip_relative_day_counts_from_the_real_today() -> None:
    """여행 전날(11-04) 1일차를 다시 짜며 "내일" → 11-05 = 이 날이다. '오늘'의 기준은 다시 짜는 날이 아니라 지금이다."""
    out = _verify(ExtractedPlace("서울광장", "visit", day="내일"), today=date(2026, 11, 4))
    assert [str(p.poi_id) for p in out.visit] == ["p1"]


def test_avoid_said_for_another_day_does_not_remove_it_from_this_day() -> None:
    out = _verify(ExtractedPlace("덕수궁", "avoid", day="2일차"))
    assert out.avoid == frozenset()
    assert "nl_place_other_day: avoid p2 2026-11-06" in out.notes


def test_mixed_sentence_keeps_this_day_and_moves_only_the_other() -> None:
    out = _verify(ExtractedPlace("덕수궁", "visit"), ExtractedPlace("서울광장", "visit", day="2일차"))
    assert [str(p.poi_id) for p in out.visit] == ["p2"]
    assert out.other_day == frozenset({PoiId("p1")})


def test_without_trip_days_the_day_is_not_read() -> None:
    """여행 날짜를 안 넘긴 호출(종전 호출측)은 날 말을 읽지 않는다 — 종전 동작 그대로."""
    out = _verify(ExtractedPlace("서울광장", "visit", day="2일차"), trip=())
    assert [str(p.poi_id) for p in out.visit] == ["p1"]


# ── ④ 통합 — 다른 날 장소는 이 날 어디에도 없다 ─────────────────────────

_HALLA = "e0000000-0000-4000-8000-000000000004"  # 한라산 — 데모 풀(10km) 안
_WOLJEONG = "e0000000-0000-4000-8000-000000000003"  # 월정리 카페거리 — 풀 밖


class _StubExtractor:
    def __init__(self, value: ExtractedRequest) -> None:
        self.value = value

    def extract(self, *a, **kw) -> TypedResult:
        return TypedResult(value=self.value, is_fallback=False, error=None, call_record=None)


class _AllComposer:
    """구성 LLM 이 숏리스트를 전부 고른다 — 다른 날 장소가 숏리스트에 있으면 그대로 일정에 들어간다."""

    def __init__(self) -> None:
        self.shortlists: list[set[str]] = []

    def compose(self, pool, inp, trace_id, now, *, timeout_sec=None):
        self.shortlists.append({str(p.poi_id) for p in pool.pois})
        return TypedResult(value=tuple(SimpleNamespace(poi_id=p.poi_id, reason="r") for p in pool.pois
                                       if p.category is not PoiCategory.STAY),
                           is_fallback=False, error=None, call_record=None)


def _report_day_body(*, target: str = "2026-11-05", requested_at: str = "2026-11-05T05:30:00+09:00",
                     **over) -> dict:
    """운영 보고와 같은 꼴 — 여행 11-05~07, 1일차(11-05)를 11-05 에 다시 짠다.
    사유는 비운다 — `_body` 기본 사유 weather 는 실외(한라산 NATURE)를 따로 빼서 이 판정을 가린다(역검증에서 확인)."""
    return _body(
        reasons=[],
        trip_context={"destinations": ["제주"], "start_date": "2026-11-05", "end_date": "2026-11-07"},
        target_date=target, time_window={"date": target, "start": "06:00", "end": "21:00"},
        from_instant=f"{target}T06:00:00+09:00",
        request_meta={"request_id": "replan-other-day", "requested_at": requested_at, "deadline_ms": 20000},
        **over)


def _run(place: ExtractedPlace, *, composer=None, **body_over):
    app = build_dev_app(directives=_DIRECTIVES)
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(ExtractedRequest(places=(place,)))
    orch._existence = FakeExistence()
    if composer is not None:
        orch._composer = composer
    seen = []
    inner = orch._schedule_agent

    class _Spy:
        def run(self, task):
            seen.append(task.request)
            return inner.run(task)

    orch._schedule_agent = _Spy()
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ai/v1/planb/replan", json=_report_day_body(free_text="꼭 가고 싶어", **body_over))
    assert r.status_code == 200, r.text
    body = r.json()
    placed = [s["poi_id"] for d in body["itinerary"]["days"] for s in d["slots"]]
    required = [str(x.poi_id) for req in seen for x in req.required_visits]
    return body, placed, required


@pytest.mark.parametrize("pid,name", [(_WOLJEONG, "월정리 카페거리"), (_HALLA, "한라산")])
def test_place_for_day_two_is_not_put_on_day_one(pid: str, name: str) -> None:
    """운영 보고 ② 재현 — 풀 밖(월정리: 종전엔 풀에 합류해 필수로)·풀 안(한라산: 후보에 남아 구성이 고른다) 둘 다."""
    composer = _AllComposer()
    body, placed, required = _run(ExtractedPlace(name, "visit", day="2일차"), composer=composer)
    assert pid not in placed, body["notes"]
    assert pid not in required
    assert composer.shortlists and all(pid not in s for s in composer.shortlists)  # 이 날 후보에서도 뺀다
    assert f"nl_place_other_day: visit {pid} 2026-11-06" in body["notes"]
    assert body["empty_reason"] is None  # 하루는 그대로 나온다


@pytest.mark.parametrize("said", ["1일차", "오늘", None])
def test_same_day_words_still_put_the_place_on_this_day(said: str | None) -> None:
    body, placed, required = _run(ExtractedPlace("월정리 카페거리", "visit", day=said))
    assert _WOLJEONG in placed, body["notes"]
    assert f"nl_place_accepted: visit {_WOLJEONG}" in body["notes"]


# ── ⑤ '오늘'·'내일'의 기준은 현지 날 — 백엔드는 요청 시각을 UTC(…Z)로 보낸다 ──────────


def test_today_said_before_9am_kst_is_this_day_even_when_requested_at_is_utc() -> None:
    """2일차(11-06)를 05:30 KST 에 다시 짜며 "오늘" — BE `AiRequestMeta.requestedAt: Instant` 는 `2026-11-05T20:30:00Z`
    로 온다. UTC 날짜(11-05)로 '오늘'을 세면 1일차로 읽어 이 날에서 뺐다(리뷰 2026-11-05)."""
    body, placed, _ = _run(ExtractedPlace("월정리 카페거리", "visit", day="오늘"),
                           target="2026-11-06", requested_at="2026-11-05T20:30:00Z")
    assert _WOLJEONG in placed, body["notes"]
    assert f"nl_place_accepted: visit {_WOLJEONG}" in body["notes"]


def test_tomorrow_said_before_9am_kst_is_another_day_even_when_requested_at_is_utc() -> None:
    """1일차(11-05)를 05:30 KST(`2026-11-04T20:30:00Z`)에 다시 짜며 "내일" = 11-06 — 이 날에 넣지 않는다."""
    body, placed, required = _run(ExtractedPlace("월정리 카페거리", "visit", day="내일"),
                                  requested_at="2026-11-04T20:30:00Z")
    assert _WOLJEONG not in placed, body["notes"]
    assert _WOLJEONG not in required
    assert f"nl_place_other_day: visit {_WOLJEONG} 2026-11-06" in body["notes"]
