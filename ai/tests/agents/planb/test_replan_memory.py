"""다시 짜기가 같은 날의 앞 요청을 기억한다 (F-5 — 운영 2026-11-05 trip 8311ac19 보고 ④).

운영 보고: "클럽 넣어줘"로 들어간 풍월관이 다음 다시 짜기에서 사라졌다 — 재생성을 여러 번 해도 앞 요청을 기억해
유지해 달라. 요청에도 슬롯에도 출처가 없어 다음 다시 짜기는 그 곳이 '요청해서 넣은 곳'인 줄 몰랐다. 재료는 이미
오는 변경 이력(`change_log`)이다 — 반영된 다시 짜기는 `PLAN_B` 이고 사유 한 줄에 칩 키·자유입력이 실린다(BE
`ReplanSessionService.changeReason`), 되돌림은 `MANUAL` 로 반영분을 뺀다.

증명하는 것 (실 LLM·실 API 0):
  ① 앞 요청 "클럽 넣어줘"로 들어온 곳은 우선 필수 방문으로 남고 창 끝이 23:59 다 — 구성 타임아웃(폴백)에서도,
     구성이 그 곳을 안 골라도. 지킨 곳은 고정으로 나가지 않는다
  ② 이번 요청이 이긴다 — 이름으로 뺀 곳·"클럽은 빼줘"·건너뛰기는 기억하지 않는다
  ③ 기억하지 않는 것 — 되돌린 세션·편집으로 바꿔 뺀 곳(SWAPPED_OUT)·요청과 안 맞는 곳(실내로)·수동 편집·
     앞 요청이 부정문("술집 말고")·이번 요청이 일찍 마무리. 기억한 곳은 피로 상한 안에서 세고 밤 후보와 겹치지 않는다
  ④ 한 곳 추가 칩(ADD_FOOD)은 그 종류로 들어온 곳이 딱 한 곳일 때 그 곳을 기억한다
  ⑤ 새로 짜 보기(사유·요청 없음)에 기억한 밤 장소가 창을 23:59 로 넓혀도, 구성이 결과를 못 내면 하루가 무너지지
     않는다 — 원 창(~21:00)을 채우는 만큼 + 기억한 밤 장소가 상한이다(상한 없이 긴 창이면 조립이 4곳만 냈다)
"""

from __future__ import annotations

import pytest

from trippilot.domain.common import PoiId
from trippilot.llm_gateway.gates.replan.replan_request_extraction import ExtractedPlace, ExtractedRequest

from tests.agents.planb.test_replan_composition import _ScriptedLlm, _strip_slots
from tests.agents.planb.test_replan_keeps_original_day import _BAR, _IDS, _ComposeTimesOut, _placed, _run

_FOOD_LUNCH, _CAFE_HILL = _IDS[4], _IDS[7]  # 점심 식당 · 언덕 카페
# BE 가 보내는 창 — 하루 끝 21:00(`HttpScheduleAgentAdapter.DAY_END`). 술집 추정 영업(20~04시)·체류 90분이라 이 창엔 못 든다.
_WINDOW_21 = {"date": "2026-09-21", "start": "06:00", "end": "21:00"}


def _entry(source: str, reason: str, at: str, *, added=(), removed=()) -> dict:
    return {"source": source, "reason": reason, "at": f"2026-09-21T{at}:00+09:00",
            "added_poi_ids": list(added), "removed_poi_ids": list(removed)}


# 앞 다시 짜기 — "클럽 넣어줘"가 풍월관을 넣었다(반영). BE 는 최신순으로 싣는다.
_CLUB_ASKED = [_entry("PLAN_B", "클럽 넣어줘", "05:00", added=[_BAR])]


def _bar_visit(req):
    return next((v for v in req.required_visits if v.poi_id == PoiId(_BAR)), None)


def _bar_start(body: dict) -> str | None:
    return next((s["start_at"] for d in body["itinerary"]["days"] for s in d["slots"] if s["poi_id"] == _BAR), None)


# ── ① 앞 요청으로 들어온 곳이 남는다 ──────────────────────────────────


def test_구성이_타임아웃이어도_앞_요청의_클럽은_우선_필수로_남고_창이_밤까지다(monkeypatch) -> None:
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, free_text="오늘 남은 일정 다시 맞춰줘",
                        time_window=_WINDOW_21, change_log=_CLUB_ASKED)

    assert f"replan_memory: {_BAR}" in body["notes"], body["notes"]
    visit = _bar_visit(req)
    assert visit is not None and visit.priority, req.required_visits
    assert req.day_window.end.strftime("%H:%M") == "23:59"  # 밤에 놀기와 같은 창
    assert (_bar_start(body) or "") >= "20:00", body["notes"]
    assert not any(s["is_fixed"] for d in body["itinerary"]["days"] for s in d["slots"])


def test_구성이_앞_요청의_클럽을_안_골라도_맨_앞에_넣는다(monkeypatch) -> None:
    llm = _ScriptedLlm([p for p in _IDS if p != _BAR])
    body, req, _ = _run(llm, monkeypatch, free_text="오늘 남은 일정 다시 맞춰줘",
                        time_window=_WINDOW_21, change_log=_CLUB_ASKED)

    assert any(n.startswith("llm_composed:") for n in body["notes"]), body["notes"]
    visit = _bar_visit(req)
    assert visit is not None and visit.priority, req.required_visits
    assert "~23:59" in llm.compose_prompt()  # 구성도 밤까지 본다
    assert (_bar_start(body) or "") >= "20:00", body["notes"]
    slot = next(s for d in body["itinerary"]["days"] for s in d["slots"] if s["poi_id"] == _BAR)
    assert slot["is_fixed"] is False


def test_기억한_곳은_피로_상한_안에서_센다(monkeypatch) -> None:
    """이름으로 집은 곳은 상한에 자리를 더하지만, 기억한 곳은 원 일정의 한 곳이라 더하면 피로 상한(원−1)이 사라진다."""
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, reasons=["fatigue"], time_window=_WINDOW_21,
                        change_log=_CLUB_ASKED)
    assert "planb_visit_cap: 10" in body["notes"], body["notes"]
    assert f"replan_memory: {_BAR}" in body["notes"], body["notes"]
    assert req.max_visits_per_day == 10
    visit = _bar_visit(req)
    assert visit is not None and visit.priority


def test_밤에_놀기를_또_말해도_기억한_곳을_두_번_넣지_않는다(monkeypatch) -> None:
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, directives=["NIGHTLIFE"], time_window=_WINDOW_21,
                        change_log=_CLUB_ASKED)
    assert f"replan_memory: {_BAR}" in body["notes"], body["notes"]
    assert [v.poi_id for v in req.required_visits].count(PoiId(_BAR)) == 1, req.required_visits


# ── ② 이번 요청이 이긴다 ──────────────────────────────────────────────


@pytest.mark.parametrize("over", [
    {"free_text": "클럽은 빼줘"},
    {"free_text": "풍월관은 빼줘", "extracted": ExtractedRequest(places=(ExtractedPlace("풍월관", "avoid"),))},
    {"free_text": "오늘 남은 일정 다시 맞춰줘", "excluded_poi_ids": [_BAR]},
], ids=["클럽은_빼줘", "이름으로_뺌", "건너뛰기"])
def test_이번_요청이_빼면_앞_요청을_기억하지_않는다(monkeypatch, over: dict) -> None:
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, time_window=_WINDOW_21, change_log=_CLUB_ASKED, **over)

    assert f"replan_memory_dropped: {_BAR}" in body["notes"], body["notes"]
    assert not any(n.startswith("replan_memory:") for n in body["notes"]), body["notes"]
    visit = _bar_visit(req)
    assert visit is None or not visit.priority
    assert req.day_window.end.strftime("%H:%M") == "21:00"  # 창을 밤까지 넓히지 않는다
    assert _bar_start(body) is None, body["notes"]


# ── ③ 기억하지 않는 것 ────────────────────────────────────────────────


_REVERTED_THEN_READDED = [  # 최신순 — 되돌린 뒤 다른 요청의 다시 짜기가 우연히 같은 곳을 다시 넣었다
    _entry("PLAN_B", "성곽길 넣어줘", "07:00", added=[_BAR]),
    _entry("MANUAL", "재계획 되돌림 · 클럽 넣어줘", "06:00", removed=[_BAR]),
    *_CLUB_ASKED,
]


@pytest.mark.parametrize("over", [
    {"change_log": _REVERTED_THEN_READDED},
    {"change_log": _CLUB_ASKED, "rejections": [{"poi_id": _BAR, "kind": "SWAPPED_OUT", "count": 1}]},
    {"change_log": [_entry("PLAN_B", "WEATHER · INDOOR", "05:00", added=[_BAR])]},
    {"change_log": [_entry("MANUAL", "클럽 넣어줘", "05:00", added=[_BAR])]},
    {"change_log": [_entry("PLAN_B", "술집 말고 조용한 데로", "05:00", added=[_BAR])]},
    {"change_log": _CLUB_ASKED, "directives": ["SHORTER_DAY"]},
], ids=["되돌린_세션", "편집으로_바꿔_뺌", "요청과_안_맞음", "수동_편집", "앞_요청이_부정문", "일찍_마무리"])
def test_되돌렸거나_뺐거나_요청과_안_맞으면_기억하지_않는다(monkeypatch, over: dict) -> None:
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, free_text="오늘 남은 일정 다시 맞춰줘",
                        time_window=_WINDOW_21, **over)

    assert not any(n.startswith("replan_memory") for n in body["notes"]), body["notes"]
    visit = _bar_visit(req)
    assert visit is None or not visit.priority
    assert req.day_window.end.strftime("%H:%M") == "21:00"


def test_앞_요청을_뺀_뒤_다시_짜기를_되돌리면_앞_요청_기억이_되살아난다(monkeypatch) -> None:
    """리뷰 2026-11-05: run1 "클럽 넣어줘"(풍월관 들어옴) → run2 "클럽은 빼줘"(풍월관 빠짐) → run2 되돌림(풍월관 다시
    들어옴). 되돌린 것은 run2 의 요청이지 run1 의 요청이 아니다 — 종전엔 run2 의 뺌이 기억을 지운 채로 남아 다음
    다시 짜기에서 풍월관이 또 빠졌다(창 21:00, 미배치). 되돌림은 BE 가 `MANUAL` · "재계획 되돌림 · <원래 사유>" 로 싣는다."""
    log = [  # 최신순
        _entry("MANUAL", "재계획 되돌림 · 클럽은 빼줘", "06:10", added=[_BAR]),
        _entry("PLAN_B", "클럽은 빼줘", "06:00", removed=[_BAR]),
        *_CLUB_ASKED,
    ]
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, free_text="오늘 남은 일정 다시 맞춰줘",
                        time_window=_WINDOW_21, change_log=log)

    assert f"replan_memory: {_BAR}" in body["notes"], body["notes"]
    visit = _bar_visit(req)
    assert visit is not None and visit.priority, req.required_visits
    assert req.day_window.end.strftime("%H:%M") == "23:59"
    assert (_bar_start(body) or "") >= "20:00", body["notes"]


def test_되돌림이_다시_넣은_곳이라도_다시_짜기가_요청해_넣은_곳이_아니었으면_기억하지_않는다(monkeypatch) -> None:
    """되살리는 것은 다시 짜기가 뺀 **기억**뿐이다 — 기억한 적 없는 곳을 되돌림이 다시 넣었다고 새로 기억하지 않는다."""
    log = [
        _entry("MANUAL", "재계획 되돌림 · 오늘 남은 일정 다시 맞춰줘", "06:10", added=[_BAR]),
        _entry("PLAN_B", "오늘 남은 일정 다시 맞춰줘", "06:00", removed=[_BAR]),
    ]
    body, _, _ = _run(_ComposeTimesOut(), monkeypatch, free_text="오늘 남은 일정 다시 맞춰줘",
                      time_window=_WINDOW_21, change_log=log)
    assert not any(n.startswith("replan_memory") for n in body["notes"]), body["notes"]


# ── ④ 한 곳 추가 칩 ──────────────────────────────────────────────────


def test_맛집_추가_칩으로_들어온_한_곳을_기억한다(monkeypatch) -> None:
    log = [_entry("PLAN_B", "ADD_FOOD", "05:00", added=[_FOOD_LUNCH, _CAFE_HILL])]
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, free_text="오늘 남은 일정 다시 맞춰줘",
                        time_window=_WINDOW_21, change_log=log)

    assert f"replan_memory: {_FOOD_LUNCH}" in body["notes"], body["notes"]  # 카페는 그 요청이 바란 종류가 아니다
    prio = {str(v.poi_id) for v in req.required_visits if v.priority}
    assert _FOOD_LUNCH in prio and _CAFE_HILL not in prio
    assert req.day_window.end.strftime("%H:%M") == "21:00"  # 밤 장소가 아니면 창은 그대로


def test_맛집_추가로_들어온_식당이_둘이면_어느_쪽인지_몰라_기억하지_않는다(monkeypatch) -> None:
    log = [_entry("PLAN_B", "ADD_FOOD", "05:00", added=[_FOOD_LUNCH, _IDS[9]])]
    body, _, _ = _run(_ComposeTimesOut(), monkeypatch, free_text="오늘 남은 일정 다시 맞춰줘",
                      time_window=_WINDOW_21, change_log=log)
    assert not any(n.startswith("replan_memory") for n in body["notes"]), body["notes"]


# ── ⑤ 새로 짜 보기 + 기억한 밤 장소 — 구성이 결과를 못 내도 하루가 무너지지 않는다 ─────────────


def _slot_times(body: dict) -> list[tuple[int, int]]:
    def m(t: str) -> int:
        return int(t[:2]) * 60 + int(t[3:5])
    return sorted((m(s["start_at"]), m(s["end_at"])) for d in body["itinerary"]["days"] for s in d["slots"])


def _longest_gap_min(body: dict) -> int:
    times = _slot_times(body)
    return max((b[0] - a[1] for a, b in zip(times, times[1:])), default=0)


@pytest.mark.parametrize("llm,first", [
    (_ComposeTimesOut, None),                    # 구성 타임아웃(운영 run3 꼴)
    (lambda: _ScriptedLlm(list(_IDS[:3])), _strip_slots),  # 고른 곳이 하나도 안 놓여 다시 푼다
], ids=["구성_타임아웃", "전부_미배치_다시_풀기"])
def test_새로_짜_보기에_기억한_클럽이_창을_넓혀도_하루가_무너지지_않는다(monkeypatch, llm, first) -> None:
    """리뷰 2026-11-05: 기억한 밤 장소가 창을 23:59 로 넓히는데 새로 짜 보기는 원 일정 지키기·상한이 없어, 구성이
    결과를 못 내면 조립이 11곳 → 4곳(07:00·07:46·09:07 … 20:00 술집, 10:37~20:00 공백)을 냈다 — 보고 ③ 재발."""
    base, _, _ = _run(llm(), monkeypatch, first=first, reasons=["none"], time_window=_WINDOW_21)
    body, req, _ = _run(llm(), monkeypatch, first=first, reasons=["none"], time_window=_WINDOW_21,
                        change_log=_CLUB_ASKED)

    assert f"replan_memory: {_BAR}" in body["notes"], body["notes"]
    assert req.day_window.end.strftime("%H:%M") == "23:59"
    assert (_bar_start(body) or "") >= "20:00", body["notes"]  # 기억은 그대로 산다
    assert len(_placed(body)) >= len(_placed(base)), (len(_placed(body)), len(_placed(base)), body["notes"])
    assert _longest_gap_min(body) <= 6 * 60, (_slot_times(body), body["notes"])
    # 새로 짜 보기는 여전히 원 일정을 지키지 않는다(BR F-4 ③) — 상한만 준다
    assert not any(n.startswith("replan_keep") for n in body["notes"]), body["notes"]
