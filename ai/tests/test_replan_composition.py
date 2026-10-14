"""다시 짜기 — LLM 이 남은 하루를 고른다 (REPLAN_COMPOSITION).

증명하는 것 (실 LLM 0 — 기능별 대본 LLM):
  ① 고른 곳만 그날에 들어간다 — 어셈블리는 시각·순서만 정한다(INV-2), 점수 LLM 은 안 부른다
  ② 후보 밖 id 는 게이트가 버린다(INV-1)
  ③ 구성이 실패하면 종전 재계획으로 간다(INV-4) — 노트로 밝힌다
  ④ 사유 규칙이 살아 있다 — 피로 상한은 목록을 자르고, 회피 카테고리는 후보에서 빠진다
     (실내로·야외 피하기 포함, 구성이 실패한 점수 경로에서도 — 2026-10-14 DEV)
  ⑤ 시한이 모자라면 부르지 않는다(#1102 — 504 교훈)
  ⑥ 프롬프트에 기존 일정·사유·요청이 실린다
"""

from __future__ import annotations

import json
import pathlib
from datetime import datetime, timedelta, timezone

import yaml  # tests 는 `src/` 밖이라 yaml 규칙 대상이 아니다
from fastapi.testclient import TestClient

from trippilot.agents.planb import composition
from trippilot.agents.planb.directives import load_directive_file
from trippilot.api.wiring import DEMO_ANCHOR, build_dev_app, demo_poi_seed
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.ports.llm_port import LlmRequest, LlmResponse

_DIRECTIVES = load_directive_file(
    pathlib.Path(__file__).resolve().parents[1] / "data" / "replan_directives.yaml",
    yaml.safe_load,
)
_SEED = {p.name: str(p.poi_id) for p in demo_poi_seed()}
_FOOD, _MOUNTAIN, _CAFE = _SEED["제주 흑돼지거리"], _SEED["한라산"], _SEED["월정리 카페거리"]


class _ScriptedLlm:
    """구성 프롬프트에만 대본을 답하고, 나머지 기능은 파싱 실패(폴백)."""

    def __init__(self, picks: list[str] | None) -> None:
        self.picks = picks
        self.requests: list[LlmRequest] = []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        if request.prompt_ref.feature == "REPLAN_COMPOSITION" and self.picks is not None:
            text = json.dumps({"selections": [
                {"poiId": p, "reason": "분위기가 좋은 곳"} for p in self.picks]})
        else:
            text = "not json"
        return LlmResponse(raw_text=text, input_tokens=1, output_tokens=1,
                           latency_ms=0, model_id=request.model_id)

    def features(self) -> list[str]:
        return [r.prompt_ref.feature for r in self.requests]

    def compose_prompt(self) -> str:
        return next(r.prompt for r in self.requests
                    if r.prompt_ref.feature == "REPLAN_COMPOSITION")


def _body(**over: object) -> dict:
    body: dict = {
        "trip_id": "trip-compose",
        "trip_context": {"destinations": ["제주"], "start_date": "2026-09-20",
                         "end_date": "2026-09-22"},
        "target_date": "2026-09-21",
        "time_window": {"date": "2026-09-21", "start": "09:00", "end": "21:00"},
        "anchor": {"lat": DEMO_ANCHOR.lat, "lng": DEMO_ANCHOR.lng},
        "scope": "FULL_DAY",
        "from_instant": "2026-09-21T09:00:00+09:00",
        "locked_blocks": [],
        "current_slots": [],
        "reasons": ["none"],
        "directives": [],
        "preference_profile": {},
        "transport_mode": "대중교통",
        "saved_places": [],
        "excluded_poi_ids": [],
        "request_meta": {"request_id": "compose-test",
                         "requested_at": "2026-09-21T08:00:00+09:00", "deadline_ms": 25000},
    }
    body.update(over)
    return body


def _replan(llm: _ScriptedLlm, **over: object) -> dict:
    with TestClient(build_dev_app(llm=llm, model_id="m", directives=_DIRECTIVES), raise_server_exceptions=False) as c:
        response = c.post("/ai/v1/planb/replan", json=_body(**over))
    assert response.status_code == 200, response.text
    return response.json()


def _placed(body: dict) -> set[str]:
    return {s["poi_id"] for d in body["itinerary"]["days"] for s in d["slots"]}


# ── ① 고른 곳만 들어간다 ───────────────────────────────────────────────


def test_구성_LLM이_고른_곳만_그날에_들어간다() -> None:
    llm = _ScriptedLlm([_FOOD, _MOUNTAIN])
    body = _replan(llm)

    assert body["empty_reason"] is None, body["notes"]
    assert _placed(body) == {_FOOD, _MOUNTAIN}, body["notes"]
    assert any(n.startswith("llm_composed: 2/2") for n in body["notes"]), body["notes"]
    # 판단은 LLM 이 했다 — 점수 단계가 규칙이어도 폴백이 아니다
    assert body["is_fallback"] is False and body["fallback_level"] == 0
    # 갈 곳을 이미 골랐으니 점수 LLM 은 부르지 않는다(25s 시한 — #1102)
    assert "PREFERENCE_SCORING" not in llm.features()


def test_고른_곳은_고정으로_나가지_않는다() -> None:
    """필수 방문은 배치되면 고정으로 사영되지만, LLM 이 고른 곳은 사용자가 고정한 곳이 아니다."""
    body = _replan(_ScriptedLlm([_FOOD, _MOUNTAIN]))
    slots = body["itinerary"]["days"][0]["slots"]
    assert slots and not any(s["is_fixed"] for s in slots), slots


def test_고른_곳에도_시각은_어셈블리가_정한다() -> None:
    """INV-2 — 시각은 창 안이고 겹치지 않는다(대본은 시각을 아예 안 준다)."""
    body = _replan(_ScriptedLlm([_FOOD, _MOUNTAIN]))
    slots = sorted(body["itinerary"]["days"][0]["slots"], key=lambda s: s["start_at"])
    assert all("09:00" <= s["start_at"] < s["end_at"] <= "21:00" for s in slots)
    assert all(a["end_at"] <= b["start_at"] for a, b in zip(slots, slots[1:]))


def test_고른_곳이_하나도_안_놓이면_종전_경로로_다시_푼다() -> None:
    """20:50 — 남은 10분에 고른 곳이 못 들어간다. 빈 하루를 LLM 결과로 내지 않는다(INV-4)."""
    llm = _ScriptedLlm([_FOOD])
    body = _replan(llm, scope="PARTIAL_SLOTS", from_instant="2026-09-21T20:50:00+09:00")
    assert "llm_composed_unplaced: 1/1" in body["notes"], body["notes"]
    assert body["empty_reason"]["code"] == "NO_FEASIBLE_SLOT"  # 종전 경로도 못 넣는다 — 정직하게


# ── ② 후보 밖 id ────────────────────────────────────────────────────


def test_후보_밖_id는_버리고_나머지로_짠다() -> None:
    body = _replan(_ScriptedLlm(["11111111-1111-4111-8111-111111111111", _FOOD]))
    assert _placed(body) == {_FOOD}, body["notes"]


# ── ③ 실패면 종전 경로 ────────────────────────────────────────────────


def test_구성이_실패하면_종전_재계획으로_간다() -> None:
    llm = _ScriptedLlm(None)  # 구성도 파싱 실패
    body = _replan(llm)

    assert body["empty_reason"] is None and _placed(body), body["notes"]
    assert any(n.startswith("llm_compose_fallback:") for n in body["notes"]), body["notes"]
    assert "PREFERENCE_SCORING" in llm.features()  # 종전 경로는 점수 LLM 을 부른다


# ── ④ 사유 규칙 ──────────────────────────────────────────────────────


def test_피로_상한이_구성_목록을_자른다() -> None:
    """원 일정 남은 3곳 − 1 = 상한 2 — LLM 이 3곳을 내도 2곳만."""
    current = [
        {"poi_id": _FOOD, "start_at": "10:00", "end_at": "11:00"},
        {"poi_id": _MOUNTAIN, "start_at": "12:00", "end_at": "14:00"},
        {"poi_id": _CAFE, "start_at": "15:00", "end_at": "16:00"},
    ]
    body = _replan(_ScriptedLlm([_FOOD, _MOUNTAIN, _CAFE]),
                   reasons=["fatigue"], current_slots=current)
    assert len(_placed(body)) <= 2, body["notes"]
    assert "planb_visit_cap: 2" in body["notes"]


def test_피로면_힘든_카테고리는_후보에서_빠진다() -> None:
    """피로 → AVOID_STRENUOUS(자연·액티비티 회피) — 프롬프트에 맡기지 않고 후보에서 뺀다."""
    llm = _ScriptedLlm([_FOOD])
    _replan(llm, reasons=["fatigue"])
    candidates = llm.compose_prompt().split("[후보 목록]")[1]
    assert _FOOD in candidates
    assert _MOUNTAIN not in candidates


def test_한_곳_추가도_피로_상한_안에서_센다() -> None:
    """피로 상한 1 + "카페 넣어줘" + LLM 이 맛집을 고름 → 카페(필수)가 남아 고른 목록을 0으로 줄인다.

    줄이지 않으면 맛집 + 카페 2곳이 되어 상한을 넘는다(필수 방문은 상한이 빼지 못한다).
    """
    current = [{"poi_id": _FOOD, "start_at": "10:00", "end_at": "11:00"},
               {"poi_id": _MOUNTAIN, "start_at": "12:00", "end_at": "14:00"}]
    body = _replan(_ScriptedLlm([_FOOD]), reasons=["fatigue"], directives=["ADD_CAFE"],
                   current_slots=current)
    assert "planb_visit_cap: 1" in body["notes"]
    assert "llm_composed_trimmed: 1->0 add_one" in body["notes"], body["notes"]
    assert len(_placed(body)) <= 1, body["notes"]


def test_바꿔_뺀_곳은_후보에_없다() -> None:
    """종전 경로는 점수 강등(TRIP-964)인데 고른 곳은 점수를 안 본다 — 후보에서 뺀다."""
    llm = _ScriptedLlm([_MOUNTAIN])
    _replan(llm, rejections=[{"poi_id": _FOOD, "kind": "SWAPPED_OUT"}])
    assert _FOOD not in llm.compose_prompt().split("[후보 목록]")[1]


_NATURE = {_MOUNTAIN, _SEED["성산일출봉"]}


def test_실내로면_원_일정의_야외도_후보에서_빠지고_교체로_보인다() -> None:
    """2026-10-14 DEV — "실내로"인데 원 일정의 공원이 남았다(선호 가산만 있었다). LLM 이 야외를
    다시 골라도 후보 밖이라 게이트가 버린다(INV-1)."""
    llm = _ScriptedLlm([_MOUNTAIN, _FOOD])
    current = [{"poi_id": _FOOD, "start_at": "10:00", "end_at": "11:00"},
               {"poi_id": _MOUNTAIN, "start_at": "12:00", "end_at": "14:00"}]
    body = _replan(llm, directives=["INDOOR"], current_slots=current)

    candidates = llm.compose_prompt().split("[후보 목록]")[1]
    assert not any(n in candidates for n in _NATURE)
    assert "한라산 | 요청과 안 맞음(교체)" in llm.compose_prompt()
    assert _placed(body) == {_FOOD}, body["notes"]
    assert any(n.startswith("avoid_excluded:") and "NATURE" in n for n in body["notes"]), body["notes"]


def test_구성이_실패해도_실내로면_야외가_안_들어간다() -> None:
    """f66f3fbf(2026-10-14 DEV) — 구성 타임아웃 → 점수 경로. 거기도 감점이 아니라 제외다."""
    body = _replan(_ScriptedLlm(None), directives=["INDOOR"])
    assert any(n.startswith("llm_compose_fallback:") for n in body["notes"])
    assert _placed(body) and not _placed(body) & _NATURE, body["notes"]


def test_피할_곳뿐이면_빼지_않고_밝힌다() -> None:
    body = _replan(_ScriptedLlm([_MOUNTAIN]), directives=["INDOOR"],
                   excluded_poi_ids=[_FOOD, _CAFE])
    assert any(n.startswith("avoid_relaxed:") for n in body["notes"]), body["notes"]
    assert _placed(body) == {_MOUNTAIN}, body["notes"]


def test_반대_칩을_같이_고르면_그_카테고리는_빼지_않는다() -> None:
    """실내로 + 자연 위주 — NATURE 는 상쇄(directive_fit 과 같은 규약), 후보에 남는다."""
    llm = _ScriptedLlm([_MOUNTAIN])
    body = _replan(llm, directives=["INDOOR", "NATURE_FOCUS"])
    assert _MOUNTAIN in llm.compose_prompt().split("[후보 목록]")[1]
    assert any(n.startswith("directives_conflict:") for n in body["notes"]), body["notes"]


def test_구성이_있으면_대체지_선택_LLM은_부르지_않는다() -> None:
    """DEV 3/3 이 6s 타임아웃으로 구성 몫을 깎았다 — 하루는 구성이 고른다."""
    llm = _ScriptedLlm([_FOOD])
    body = _replan(llm)
    assert "ALTERNATIVE_SELECTION" not in llm.features()
    assert any("alternative_llm_skipped" in n for n in body["notes"]), body["notes"]


def test_남은_일정을_그대로_고른_수를_노트로_남긴다() -> None:
    current = [{"poi_id": _FOOD, "start_at": "10:00", "end_at": "11:00"},
               {"poi_id": _CAFE, "start_at": "12:00", "end_at": "13:00"}]
    body = _replan(_ScriptedLlm([_FOOD, _MOUNTAIN]), current_slots=current)
    assert any(n.startswith("llm_composed: 2/2") and n.endswith("kept=1/2")
               for n in body["notes"]), body["notes"]


# ── ⑤ 시한 ──────────────────────────────────────────────────────────


def test_시한이_모자라면_구성을_부르지_않는다() -> None:
    llm = _ScriptedLlm([_FOOD])
    body = _replan(llm, request_meta={"request_id": "x", "deadline_ms": 6000,
                                      "requested_at": "2026-09-21T08:00:00+09:00"})
    assert "REPLAN_COMPOSITION" not in llm.features()
    assert any(n.startswith("llm_compose_skipped: deadline") for n in body["notes"])


# ── ⑥ 프롬프트 ───────────────────────────────────────────────────────


def test_프롬프트에_기존_일정과_사유와_요청이_실린다() -> None:
    llm = _ScriptedLlm([_FOOD])
    _replan(llm, reasons=["delay"], free_text="바다 보고 싶어",
            current_slots=[{"poi_id": _CAFE, "start_at": "10:00", "end_at": "11:00"}])
    prompt = llm.compose_prompt()
    assert "10:00~11:00 | CAFE | 월정리 카페거리 | 남은 일정" in prompt
    assert composition.REASON_LABELS["delay"] in prompt
    assert "바다 보고 싶어" in prompt
    assert "기존 일정을 그대로 돌려주지 마세요" in prompt  # 0.2.0 — 바꾸려고 누른 것이 전제


def test_사유_없음은_영문_토큰이_아니라_문장으로_실린다() -> None:
    llm = _ScriptedLlm([_FOOD])
    _replan(llm, reasons=["none"])
    reasons = llm.compose_prompt().split("[다시 짜는 이유]")[1].split("[")[0]
    assert composition.REASON_LABELS["none"] in reasons and "- none" not in reasons


# ── 순수 함수 ────────────────────────────────────────────────────────


def _poi(n: int, category: PoiCategory, hours: tuple[OpenHour, ...] = ()) -> Poi:
    return Poi(poi_id=PoiId(f"p{n:02d}"), name=f"곳{n}", category=category,
               coord=GeoPoint(33.5, 126.5), open_hours=hours, avg_cost=None, rating=None,
               quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None)


def _pool(*pois: Poi) -> CandidatePool:
    return CandidatePool(poi_ids=frozenset(p.poi_id for p in pois), pois=pois,
                         generated_at=datetime(2026, 9, 21, tzinfo=timezone.utc), anchor=None, radius_km=10.0)


def test_후보는_카테고리마다_상위_N곳에_keep_은_먼저() -> None:
    foods = [_poi(i, PoiCategory.FOOD) for i in range(10)]
    cafe = _poi(50, PoiCategory.CAFE)
    out = composition.shortlist(
        _pool(*foods, cafe), keep=[PoiId("p09")], excluded=set(), weekday=0,
        score=lambda p: -int(p.poi_id[1:]))
    ids = [p.poi_id for p in out.pois]
    assert ids[0] == "p09"  # keep 이 먼저 — 점수가 가장 낮아도
    assert sum(1 for p in out.pois if p.category is PoiCategory.FOOD) == 1 + composition.PER_CATEGORY
    assert "p50" in ids


def test_후보에서_제외_회피_그날_휴무는_빠진다() -> None:
    monday_only = (OpenHour(day_of_week=0, open_min=600, close_min=1200),)
    pois = (_poi(1, PoiCategory.FOOD), _poi(2, PoiCategory.NATURE),
            _poi(3, PoiCategory.CAFE, monday_only), _poi(4, PoiCategory.SIGHT))
    out = composition.shortlist(
        _pool(*pois), keep=[PoiId("p02")], excluded={PoiId("p04"), PoiId("p02")},
        weekday=1, score=lambda p: 0.0)
    assert {p.poi_id for p in out.pois} == {"p01"}  # keep 이어도 제외(피할 카테고리의 곳)는 뺀다


def test_방문_수는_남은_시간과_상한으로_정한다() -> None:
    tz = timezone(timedelta(hours=9))
    start = datetime(2026, 9, 21, 11, 30, tzinfo=tz)
    assert composition.max_visits(start, start + timedelta(hours=9, minutes=30), None) == 6
    assert composition.max_visits(start, start + timedelta(minutes=40), None) == 1
    assert composition.max_visits(start, start + timedelta(hours=2, minutes=30), None) == 2
    assert composition.max_visits(start, start + timedelta(hours=12), None) == composition.MAX_VISITS
    assert composition.max_visits(start, start + timedelta(hours=9), 2) == 2
