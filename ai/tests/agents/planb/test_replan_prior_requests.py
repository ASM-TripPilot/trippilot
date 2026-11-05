"""다시 짜기의 요청 간 기억 정식안(F-8)과 다른 날 장소 안내 재료(F-7 2단계 서버 몫) — 와이어 칸 셋.

사용자 원문(2026-11-05): "일정 재생성을 여러번 해도 전에 기억가지고 유지하면서 일정을 만들게 해야지",
"언제 어디에다가 넣어달라고 요청하면 그거에 맞게 처리해야지".

F-5(변경 이력 근사)는 사유 한 줄만 읽어 밤 낱말·한 곳 추가 칩만 가를 수 있었다 — 이름으로 집은 곳("숲 산책로 꼭")은
그 회차에 들어온 곳 중 어느 것인지 몰랐다. 정식안은 AI 가 응답에 '요청 때문에 든 곳'(`requested_poi_ids`)을 싣고, BE 가
세션에 남겼다가 다음 다시 짜기에 `prior_requests` 로 되싣는다. F-6 이 다른 날로 판정한 갈 곳은 `deferred_places` 로 낸다 —
앱이 '그 날에 넣어 다시 짜기' 한 탭을 그린다.

증명하는 것 (실 LLM·실 API 0):
  ① `requested_poi_ids` — 이름으로 집은 곳·밤에 놀기·한 곳 추가 칩·앞 요청에서 이어받은 곳은 싣고, 원 일정·구성이
     고른 곳은 안 싣는다. 이번 요청이 잊게 한 곳은 다음 회차로 잇지 않는다
  ② `prior_requests` — 앞 회차가 이름으로 집은 곳도 우선 필수로 남는다(F-5 는 못 한다) · 이번 요청이 이긴다(회피·
     건너뛰기·"클럽은 빼줘") · 지금 일정에 없거나 편집으로 바꿔 뺀 곳은 잊는다 · 있으면 변경 이력 근사를 쓰지 않고,
     없으면 F-5 그대로
  ③ `deferred_places` — 다른 날로 집은 갈 곳은 그 날과 등록 이름으로 싣고, 빼 달라는 곳·이 날 곳·지난 날은 안 싣는다
"""

from __future__ import annotations

import pytest

from trippilot.domain.common import PoiId
from trippilot.domain.poi.poi import PoiCategory
from trippilot.llm_gateway.gates.replan.replan_request_extraction import ExtractedPlace, ExtractedRequest

from tests.agents.planb.test_replan_composition import _ScriptedLlm
from tests.agents.planb.test_replan_keeps_original_day import (
    _BAR, _FILL, _IDS, _NATURE, _POIS, _ComposeTimesOut, _placed, _run, _slots,
)
from tests.agents.planb.test_replan_memory import _CLUB_ASKED, _WINDOW_21, _bar_start, _entry
from tests.agents.planb.test_replan_nl_other_day import _WOLJEONG, _verify
from tests.agents.planb.test_replan_nl_other_day import _run as _run_day

_CATEGORY = {str(p.poi_id): p.category for p in _POIS}
_KEEP = {"free_text": "오늘 남은 일정 다시 맞춰줘", "time_window": _WINDOW_21}
_CLUB_KEPT = [{"text": "클럽 넣어줘", "kept_poi_ids": [_BAR]}]
_NATURE_KEPT = [{"text": "숲 산책로 꼭", "kept_poi_ids": [_NATURE]}]
_NATURE_LOG = [_entry("PLAN_B", "숲 산책로 꼭", "05:00", added=[_NATURE])]


def _visit(req, pid: str):
    return next((v for v in req.required_visits if v.poi_id == PoiId(pid)), None)


# ── ① requested_poi_ids — 요청 때문에 든 곳만 ─────────────────────────────


def test_이름으로_집은_곳은_요청한_곳이고_원_일정은_아니다(monkeypatch) -> None:
    body, _, _ = _run(_ComposeTimesOut(), monkeypatch, free_text="숲 산책로 꼭", time_window=_WINDOW_21,
                      extracted=ExtractedRequest(places=(ExtractedPlace("숲 산책로", "visit"),)))
    assert f"nl_place_accepted: visit {_NATURE}" in body["notes"], body["notes"]
    assert set(_IDS) - {_BAR} <= set(_placed(body))  # 원 일정은 그대로 들었다(술집은 21시 창에 못 든다)
    assert body["requested_poi_ids"] == [_NATURE], body["notes"]


def test_집었어도_일정에_못_든_곳은_싣지_않는다(monkeypatch) -> None:
    """술집(추정 20시~·90분)은 21시 창에 못 든다 — 요청한 곳은 **최종 일정에 남은 곳**만이다(다음 회차가 지킬 것이 없다)."""
    body, _, _ = _run(_ComposeTimesOut(), monkeypatch, free_text="풍월관 꼭", time_window=_WINDOW_21,
                      extracted=ExtractedRequest(places=(ExtractedPlace("풍월관", "visit"),)))
    assert f"nl_place_unplaced: {_BAR}" in body["notes"], body["notes"]
    assert body["requested_poi_ids"] == []


def test_밤에_놀기로_든_곳은_요청한_곳이다(monkeypatch) -> None:
    body, _, _ = _run(_ComposeTimesOut(), monkeypatch, directives=["NIGHTLIFE"], time_window=_WINDOW_21)
    assert _BAR in _placed(body), body["notes"]
    assert body["requested_poi_ids"] == [_BAR]


def test_한_곳_추가_칩으로_새로_든_한_곳은_요청한_곳이다(monkeypatch) -> None:
    body, _, _ = _run(_ComposeTimesOut(), monkeypatch, directives=["ADD_FOOD"], time_window=_WINDOW_21)
    new_food = [p for p in _placed(body) if p not in _IDS and _CATEGORY[p] is PoiCategory.FOOD]
    assert len(new_food) == 1, (new_food, body["notes"])
    assert body["requested_poi_ids"] == new_food


def test_구성이_고른_곳과_원_일정은_요청한_곳이_아니다(monkeypatch) -> None:
    fill = str(_FILL[0].poi_id)
    body, _, _ = _run(_ScriptedLlm([*_IDS[:6], fill]), monkeypatch, **_KEEP)
    assert any(n.startswith("llm_composed:") for n in body["notes"]), body["notes"]
    assert fill in _placed(body)
    assert body["requested_poi_ids"] == []


def test_변경_이력으로_기억한_곳도_다음_회차로_잇는다(monkeypatch) -> None:
    """F-5 근사로 기억한 곳(앞 세션이 이 칸을 모르던 때)도 이번 응답에 싣는다 — 정식안으로 넘어가는 다리다."""
    body, _, _ = _run(_ComposeTimesOut(), monkeypatch, change_log=_CLUB_ASKED, **_KEEP)
    assert f"replan_memory: {_BAR}" in body["notes"], body["notes"]
    assert body["requested_poi_ids"] == [_BAR]


def test_이번_요청이_잊게_한_곳은_일정에_남아도_다음_회차로_잇지_않는다(monkeypatch) -> None:
    """"클럽은 빼줘"는 기억만 지운다 — 창(~22:00)에 드는 술집은 원 일정 지키기(F-4)로 남을 수 있다. 남아도 요청한 곳이 아니다."""
    body, _, _ = _run(_ComposeTimesOut(), monkeypatch, prior_requests=_CLUB_KEPT, free_text="클럽은 빼줘")
    assert f"replan_memory_dropped: {_BAR}" in body["notes"], body["notes"]
    assert _BAR in _placed(body), body["notes"]  # 이 시험의 전제 — 일정에 남았다
    assert body["requested_poi_ids"] == []


def test_한_곳_추가로_새로_든_곳이_둘이면_어느_쪽인지_몰라_싣지_않는다(monkeypatch) -> None:
    foods = [str(p.poi_id) for p in _FILL if p.category is PoiCategory.FOOD][:2]
    body, _, _ = _run(_ScriptedLlm([*_IDS[:5], *foods]), monkeypatch, directives=["ADD_FOOD"], **_KEEP)
    assert set(foods) <= set(_placed(body)), body["notes"]
    assert body["requested_poi_ids"] == []


# ── ② prior_requests — 앞 회차가 요청한 곳 ───────────────────────────────


def test_앞_회차가_이름으로_집은_곳을_우선_필수로_남긴다(monkeypatch) -> None:
    """F-5 는 사유("숲 산책로 꼭")만으로 그 회차에 들어온 곳 중 어느 것인지 못 가른다 — 정식안은 집은 id 를 받는다."""
    base, base_req, _ = _run(_ComposeTimesOut(), monkeypatch, change_log=_NATURE_LOG, **_KEEP)
    assert not any(n.startswith("replan_memory") for n in base["notes"]), base["notes"]  # 대조: 근사는 못 한다
    assert not _visit(base_req, _NATURE).priority

    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, change_log=_NATURE_LOG, prior_requests=_NATURE_KEPT, **_KEEP)
    assert "replan_memory_source: prior_requests=1" in body["notes"], body["notes"]
    assert f"replan_memory: {_NATURE}" in body["notes"]
    assert _visit(req, _NATURE).priority, req.required_visits
    assert _NATURE in _placed(body)
    assert body["requested_poi_ids"] == [_NATURE]  # 사슬 — 다음 회차도 기억한다


def test_구성이_안_골라도_앞_회차가_집은_곳을_맨_앞에_넣는다(monkeypatch) -> None:
    llm = _ScriptedLlm([p for p in _IDS if p != _NATURE])
    body, req, _ = _run(llm, monkeypatch, prior_requests=_NATURE_KEPT, **_KEEP)
    assert any(n.startswith("llm_composed:") for n in body["notes"]), body["notes"]
    assert _visit(req, _NATURE).priority
    assert _NATURE in _placed(body)


def test_앞_회차의_클럽은_창을_밤까지_넓혀_남긴다(monkeypatch) -> None:
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, prior_requests=_CLUB_KEPT, **_KEEP)
    assert f"replan_memory: {_BAR}" in body["notes"], body["notes"]
    assert _visit(req, _BAR).priority
    assert req.day_window.end.strftime("%H:%M") == "23:59"
    assert (_bar_start(body) or "") >= "20:00", body["notes"]


@pytest.mark.parametrize("over", [
    {"free_text": "클럽은 빼줘"},
    {"free_text": "풍월관은 빼줘", "extracted": ExtractedRequest(places=(ExtractedPlace("풍월관", "avoid"),))},
    {"free_text": "오늘 남은 일정 다시 맞춰줘", "excluded_poi_ids": [_BAR]},
], ids=["클럽은_빼줘", "이름으로_뺌", "건너뛰기"])
def test_이번_요청이_빼면_앞_회차가_요청한_곳도_잊는다(monkeypatch, over: dict) -> None:
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, time_window=_WINDOW_21, prior_requests=_CLUB_KEPT, **over)
    assert f"replan_memory_dropped: {_BAR}" in body["notes"], body["notes"]
    visit = _visit(req, _BAR)
    assert visit is None or not visit.priority
    assert req.day_window.end.strftime("%H:%M") == "21:00"
    assert _BAR not in body["requested_poi_ids"]


@pytest.mark.parametrize("over", [
    {"rejections": [{"poi_id": _BAR, "kind": "SWAPPED_OUT", "count": 1}]},
    {"current_slots": [s for s in _slots() if s["poi_id"] != _BAR]},
], ids=["편집으로_바꿔_뺌", "지금_일정에_없음"])
def test_지금_일정에_없거나_편집으로_바꿔_뺀_곳은_잊는다(monkeypatch, over: dict) -> None:
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, prior_requests=_CLUB_KEPT, **_KEEP, **over)
    assert not any(n.startswith(("replan_memory:", "replan_memory_dropped")) for n in body["notes"]), body["notes"]
    assert req.day_window.end.strftime("%H:%M") == "21:00"


def test_prior_requests_가_있으면_변경_이력_근사를_쓰지_않는다(monkeypatch) -> None:
    """앞 회차들이 요청한 곳을 이미 셌다 — 같은 이력을 사유로 다시 읽어 더하지 않는다."""
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, change_log=_CLUB_ASKED,
                        prior_requests=[{"text": "클럽 넣어줘", "kept_poi_ids": []}], **_KEEP)
    assert not any(n.startswith("replan_memory:") for n in body["notes"]), body["notes"]
    visit = _visit(req, _BAR)
    assert visit is None or not visit.priority
    assert req.day_window.end.strftime("%H:%M") == "21:00"


def test_prior_requests_가_없으면_변경_이력_근사_그대로다(monkeypatch) -> None:
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, change_log=_CLUB_ASKED, **_KEEP)
    assert not any(n.startswith("replan_memory_source") for n in body["notes"]), body["notes"]
    assert f"replan_memory: {_BAR}" in body["notes"]
    assert _visit(req, _BAR).priority


# ── ③ deferred_places — 다른 날로 집은 갈 곳 ─────────────────────────────


def test_검증은_다른_날_갈_곳만_그_날과_함께_넘긴다() -> None:
    """이 날에도 가겠다고 한 곳·빼 달라는 곳은 넘기지 않는다(`other_day` 와 같은 규칙). 같은 곳을 두 날로 말하면 처음 말한 날."""
    out = _verify(ExtractedPlace("서울광장", "visit", day="2일차"), ExtractedPlace("서울광장", "visit", day="3일차"),
                  ExtractedPlace("덕수궁", "avoid", day="2일차"))
    assert [(str(p.poi_id), d.isoformat()) for p, d in out.deferred] == [("p1", "2026-11-06")]
    both = _verify(ExtractedPlace("서울광장", "visit"), ExtractedPlace("서울광장", "visit", day="2일차"))
    assert [str(p.poi_id) for p in both.visit] == ["p1"]
    assert both.deferred == ()


def test_다른_날로_집은_갈_곳은_그_날과_등록_이름으로_싣는다() -> None:
    body, placed, _ = _run_day(ExtractedPlace("월정리 카페거리", "visit", day="2일차"))
    assert _WOLJEONG not in placed
    assert body["deferred_places"] == [{"poi_id": _WOLJEONG, "name": "월정리 카페거리", "date": "2026-11-06"}]
    assert _WOLJEONG not in body["requested_poi_ids"]


def test_빼_달라는_다른_날_곳은_싣지_않는다() -> None:
    body, _, _ = _run_day(ExtractedPlace("월정리 카페거리", "avoid", day="2일차"))
    assert f"nl_place_other_day: avoid {_WOLJEONG} 2026-11-06" in body["notes"]
    assert body["deferred_places"] == []


def test_이_날로_집은_곳은_싣지_않고_요청한_곳이다() -> None:
    body, placed, _ = _run_day(ExtractedPlace("월정리 카페거리", "visit", day="1일차"))
    assert _WOLJEONG in placed, body["notes"]
    assert body["deferred_places"] == []
    assert _WOLJEONG in body["requested_poi_ids"]


def test_다른_날로_집었어도_이_날_잠금으로_든_곳은_싣지_않는다() -> None:
    """잠금은 그대로다(F-6) — 이 날 일정에 이미 있는 곳을 '이번엔 넣지 않았어요'라고 알리면 거짓이다."""
    body, placed, _ = _run_day(ExtractedPlace("월정리 카페거리", "visit", day="2일차"),
                               locked_blocks=[{"poi_id": _WOLJEONG, "date": "2026-11-05", "start": "15:00",
                                               "dwell_min": 60}])
    assert _WOLJEONG in placed, body["notes"]
    assert body["deferred_places"] == []


def test_지난_날로_집은_곳은_싣지_않는다() -> None:
    """2일차(11-06)를 11-06 에 다시 짜며 "1일차에" — 그 날은 지나 앱이 다시 짜기를 열 수 없다. 이 날에도 넣지 않는다."""
    body, placed, _ = _run_day(ExtractedPlace("월정리 카페거리", "visit", day="1일차"),
                               target="2026-11-06", requested_at="2026-11-06T09:00:00+09:00")
    assert f"nl_place_other_day: visit {_WOLJEONG} 2026-11-05" in body["notes"], body["notes"]
    assert _WOLJEONG not in placed
    assert body["deferred_places"] == []


# ── 리뷰 2026-11-05 — 세 회차 사슬 · 한 곳 추가와 같이 · 다른 날 안내의 다시 짜기 문장 ─────────────


def test_잊은_기억은_다음_회차에서_되살아나지_않는다(monkeypatch) -> None:
    """회차1 "클럽 넣어줘" → 회차2 "클럽은 빼줘"(술집은 원 일정 지키기로 일정에 남는다) → 회차3 관계없는 요청.

    BE 는 그 날 반영된 세션을 최근 반영 먼저 싣는다. 응답 `requested_poi_ids` 가 이미 사슬이라(이어받아 남은 곳은 다시 싣고 잊은
    곳은 뺀다) AI 는 맨 앞 회차만 읽는다 — 전부 합치면 회차2 가 잊은 술집이 회차1 기록에서 되살아나 우선 필수·창 23:59 로 돌아왔다.
    """
    second, _, _ = _run(_ComposeTimesOut(), monkeypatch, prior_requests=_CLUB_KEPT, free_text="클럽은 빼줘")
    assert _BAR in _placed(second) and second["requested_poi_ids"] == [], second["notes"]  # 전제 — 잊었고 일정에 남았다
    prior = [{"text": "클럽은 빼줘", "kept_poi_ids": second["requested_poi_ids"]}, *_CLUB_KEPT]  # BE 가 싣는 모양 그대로

    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, prior_requests=prior, **_KEEP)

    assert "replan_memory_source: prior_requests=2" in body["notes"], body["notes"]
    assert not any(n.startswith("replan_memory:") for n in body["notes"]), body["notes"]
    visit = _visit(req, _BAR)
    assert visit is None or not visit.priority
    assert req.day_window.end.strftime("%H:%M") == "21:00"
    assert _BAR not in body["requested_poi_ids"]


def test_구성_LLM_없이_한_곳_추가와_앞_요청_기억이_같이_와도_일정이_나온다() -> None:
    """PlanB 선택 LLM 순위를 한 곳 추가로 자르는 줄이 자른 수(int)로 잊은 기억 이름을 덮어써, 사영 직전 `p not in dropped` 가
    TypeError → 500 이었다(IO-7 위반). 구성 LLM 이 없고 PlanB 가 LLM 경로일 때만 타는 길이라 운영에선 잠복했다."""
    from fastapi.testclient import TestClient

    from tests.agents.planb.test_replan_via_planb import _StubRag
    from tests.api.test_api_replan_wired import _DIRECTIVES, _body
    from trippilot.api.wiring import build_dev_app

    food, cafe = "e0000000-0000-4000-8000-000000000002", "e0000000-0000-4000-8000-000000000003"
    app = build_dev_app(directives=_DIRECTIVES)
    orch = app.state.orchestrator
    orch._composer = None
    orch._rag = _StubRag((food, cafe))  # 선택 LLM 이 성공한 모양 — 순위가 자르기를 탄다
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ai/v1/planb/replan", json=_body(
            current_slots=[{"poi_id": food}], directives=["ADD_FOOD"],
            prior_requests=[{"text": "숲 산책로 꼭", "kept_poi_ids": [food]}]))

    assert r.status_code == 200, r.text
    assert "replan_memory_source: prior_requests=1" in r.json()["notes"]
    assert not any(n.startswith("planb_rank_skipped") for n in r.json()["notes"])  # 자르기 길을 탔다


def test_다른_날_안내를_그_날_눌러도_날_말_없는_문장이면_그_날에_든다() -> None:
    """앱 계약(F-7): [N일차에 넣어 다시 짜기]는 원문이 아니라 날 말 없는 문장 `"{name} 꼭"` 으로 그 날을 다시 짠다.

    원문의 "내일"은 **새 요청 시각**의 오늘로 다시 환산된다 — 11-05 에 "내일 월정리"로 미룬 곳을 11-06 아침에 원문으로 누르면
    하루 더 밀려(11-07) 그 날에도 안 든다(리뷰 2026-11-05).
    """
    tapped = {"target": "2026-11-06", "requested_at": "2026-11-06T09:00:00+09:00"}
    raw, placed, _ = _run_day(ExtractedPlace("월정리 카페거리", "visit", day="내일"), **tapped)
    assert _WOLJEONG not in placed
    assert [d["date"] for d in raw["deferred_places"]] == ["2026-11-07"]  # 원문이면 또 미룬다

    body, placed, _ = _run_day(ExtractedPlace("월정리 카페거리", "visit"), **tapped)  # "월정리 카페거리 꼭" — 날 말 없음
    assert _WOLJEONG in placed, body["notes"]
    assert body["deferred_places"] == []
