"""말한 시각·낱말 vs 자유입력 임베딩이 추정한 모양 지시 — 임베딩은 낱말 하나로 방향을 뒤집는다.

실측(KURE, 현 사전 별칭 전부 대조, 임계 0.74, 2026-11-06):
  "남은 일정 다시 짜줘" END_DAY 0.822·EXTEND_DAY 0.876 · "일정 좀 바꿔줘" 0.750·0.845 · "남은 일정 줄여줘" 0.821·0.819 — 하루가 끝난다
  "6시까지 숙소로 돌아갈래" SHORTER_DAY 0.872 · "저녁부터 일정 짜줘" SHORTER_DAY 0.748·KEEP_DINNER 0.796 · "오전에만" EARLIER 0.742
  "오후에만 돌아다닐래" KEEP_DINNER 0.755 · "오늘 일정 6시에 끝낼래" END_DAY 0.858

증명하는 것 (실 LLM·실 임베딩 0 — `match_free_text` 대역이 위 실측대로 돌려준다):
  ① 말로 온 END_DAY·EXTEND_DAY 는 낱말이 있어야 남는다. 진짜 끝내기·늘리기 말은 남는다(칩이 없어 말이 유일한 입구다)
  ② 말한 시각이 추정한 SHORTER_DAY·EARLIER·KEEP_DINNER·END_DAY(끝을 말했을 때)를 대신한다 — 칩·명시한 말은 둔다
  ③ 이미 지난 시작("3시 이후로"를 18:30 에)도 말한 시각이다
"""

from __future__ import annotations

from datetime import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from trippilot.api.wiring import _spoken_layout, build_dev_app, demo_poi_seed
from trippilot.domain.llm.llm import TypedResult
from trippilot.llm_gateway.gates.replan.replan_request_extraction import ExtractedRequest

from tests.api.test_api_replan_wired import _DIRECTIVES, _body

_ID = {p.name: str(p.poi_id) for p in demo_poi_seed()}
_DINNER = _ID["제주 흑돼지거리"]  # 데모 풀의 식당 — 저녁 잠금 재료
_OTHER_DAY = "2026-09-20T20:00:00+09:00"


def _layout(free_text: str, resolved: list[str], *, directives: tuple[str, ...] = ()) -> tuple[list[str], list[str]]:
    notes: list[str] = []
    return _spoken_layout(SimpleNamespace(free_text=free_text, directives=list(directives)), resolved, notes), notes


class _Stub:
    def __init__(self, value: ExtractedRequest) -> None:
        self.value = value

    def extract(self, *a, **kw) -> TypedResult:
        return TypedResult(value=self.value, is_fallback=False, error=None, call_record=None)


def _replan(monkeypatch, extracted: ExtractedRequest, free_text: str, *keys: str, **over):
    """(응답, 에이전트가 받은 요청들). `keys` = 임베딩이 이 말에서 잡았다고 치는 지시."""
    import trippilot.api.wiring as wiring

    monkeypatch.setattr(wiring, "match_free_text", lambda text, specs, *a, **k: tuple(s for s in specs if s.key in keys))
    app = build_dev_app(directives=_DIRECTIVES)
    orch = app.state.orchestrator
    orch._request_extractor = _Stub(extracted)
    orch._embedding, orch._vector_store = object(), object()
    seen = []
    inner = orch._schedule_agent

    class _Spy:
        def run(self, task):
            seen.append(task.request)
            return inner.run(task)

    orch._schedule_agent = _Spy()
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ai/v1/planb/replan", json=_body(free_text=free_text, **over))
    assert r.status_code == 200, r.text[:300]
    return r.json(), seen


# ── ① 끝내기·늘리기 낱말 ─────────────────────────────────────────────────


@pytest.mark.parametrize("said", [
    "오늘 남은 일정 다시 맞춰줘", "남은 일정 다시 짜줘", "오늘 일정 다시 잡아줘", "남은 일정 조정해줘", "일정 좀 바꿔줘", "남은 일정 줄여줘",
    "남은 일정 새로 짜줘", "오늘 남은 일정 어떻게 좀 해줘", "남은 일정 변경해줘", "오늘 일정 수정해줘", "남은 일정 다시 부탁해",
    "오늘 일정 취소하고 다시 짜줘",  # 끝말이 있어도 다시 짜 달라는 말이다
])
def test_ordinary_replan_words_never_end_or_extend_the_day(said) -> None:
    out, notes = _layout(said, ["EXTEND_DAY", "END_DAY", "INDOOR"])
    assert out == ["INDOOR"], notes
    assert any(n.startswith("end_day_dropped") for n in notes)


@pytest.mark.parametrize("said", [
    "전부 취소", "다 취소해줘", "남은 일정 취소", "오늘 일정 끝", "오늘은 여기까지 할래", "오늘 일정 종료", "오늘 일정 마무리할래", "오늘은 여기서 마무리할게",
    "남은 일정 없애줘", "남은 일정 삭제해줘", "오늘은 이만 할래", "오늘 일정 접을래", "남은 일정 지워줘", "일정 끝내고 싶어",
    "오늘은 여기까지 할래 내일 다시 올게", "전부 취소하고 숙소로 다시 돌아갈래",  # 이 '다시'는 다시 짜 달라는 말이 아니다
])
def test_real_ending_words_still_end_the_day(said) -> None:
    assert _layout(said, ["END_DAY"])[0] == ["END_DAY"]


@pytest.mark.parametrize("said", [
    "더 늦게까지 놀고 싶어", "일정 더 추가해줘", "일정 늘려줘", "늦게까지 놀래", "새벽까지 놀고 싶어", "오래 놀고 싶어", "좀더 놀고 싶어", "더놀고싶어",
    "계속 놀고 싶어", "아직 놀고 싶어", "실컷 놀고 싶어", "밤 10시까지 놀고 싶어", "공연 끝나고 더 가볼 곳", "저녁 끝나고 더가자",
])
def test_real_extending_words_stay(said) -> None:
    assert _layout(said, ["EXTEND_DAY"])[0] == ["EXTEND_DAY"]


@pytest.mark.parametrize("said", ["저녁 8시 반 이후로 바꿔줘", "3시 이후로 다시 짜줘", "남은 일정 다시 짜줘", "남은 일정 없애줘", "너무 더워서 실내로", "더블룸 있는 곳으로"])
def test_words_without_asking_for_more_drop_extending(said) -> None:
    out, notes = _layout(said, ["EXTEND_DAY"])
    assert out == [] and "extend_day_dropped: no_more_word" in notes


def test_a_chip_is_never_dropped_by_the_word_guard() -> None:
    assert _layout("다시 맞춰줘", ["END_DAY", "EXTEND_DAY"], directives=("END_DAY", "EXTEND_DAY"))[0] == ["END_DAY", "EXTEND_DAY"]


def test_rearrange_words_do_not_end_the_day_through_replan(monkeypatch) -> None:
    """경로 시험 — 호출을 지우면 빨강이어야 한다. 옛 코드는 `end_day_nothing_kept`·NO_FEASIBLE_SLOT 이었다."""
    body, _ = _replan(monkeypatch, ExtractedRequest(), "오늘 남은 일정 다시 맞춰줘", "END_DAY", "EXTEND_DAY")
    assert "end_day_dropped: no_end_word" in body["notes"] and "extend_day_dropped: no_more_word" in body["notes"], body["notes"]
    assert body["empty_reason"] is None and body["itinerary"], body["notes"]


def test_a_real_ending_still_ends_the_day_through_replan(monkeypatch) -> None:
    body, seen = _replan(monkeypatch, ExtractedRequest(), "전부 취소", "END_DAY")
    assert "end_day_nothing_kept" in body["notes"] and not seen, body["notes"]  # 솔버 0회


# ── ② 말한 시각이 추정한 지시를 대신한다 ──────────────────────────────────


@pytest.mark.parametrize("said,end", [("오늘 일정 6시에 끝낼래", 18), ("오늘은 6시까지만 하고 끝낼래", 18), ("3시 이후 일정 취소해줘", 15)])
def test_a_said_end_is_a_window_not_the_end_of_the_day(monkeypatch, said, end) -> None:
    """"6시에 끝낼래"가 18시 창이 아니라 지금 하루를 끝냈다."""
    body, seen = _replan(monkeypatch, ExtractedRequest(end_by=time(end, 0)), said, "END_DAY", "SHORTER_DAY")
    assert "END_DAY" not in body["resolved_directives"], body["notes"]
    assert "end_day_nothing_kept" not in body["notes"] and body["itinerary"], body["notes"]
    assert seen[-1].day_window.end.hour == end


def test_a_said_end_replaces_the_one_more_place_cap(monkeypatch) -> None:
    """"6시까지 숙소로 돌아갈래"가 일찍 마무리(새 방문 한 곳)로 읽혀 09~18시 창에 한 곳이었다."""
    body, seen = _replan(monkeypatch, ExtractedRequest(end_by=time(18, 0)), "6시까지 숙소로 돌아갈래", "SHORTER_DAY", from_instant=_OTHER_DAY)
    assert "nl_time_over_directive: SHORTER_DAY" in body["notes"], body["notes"]
    assert not any(n.startswith(("shorter_day:", "planb_visit_cap")) for n in body["notes"]), body["notes"]
    assert seen[-1].day_window.end.hour == 18
    assert body["resolved_directives"] == ["END_NEAR_STAY"]  # 숙소로 돌아간다는 말이 있으니 그쪽 마무리만 남긴다


@pytest.mark.parametrize("extracted,said,key", [
    (ExtractedRequest(start_after=time(17, 0)), "저녁부터 일정 짜줘", "SHORTER_DAY"),
    (ExtractedRequest(end_by=time(12, 0)), "오전에만 다니고 싶어", "SHORTER_DAY"),
    (ExtractedRequest(end_by=time(12, 0)), "오전에만 다니고 싶어", "EARLIER"),
    (ExtractedRequest(start_after=time(7, 0)), "아침 7시부터 시작하고 싶어", "EARLIER"),
])
def test_any_said_time_drops_the_inferred_layout_and_adds_nothing(monkeypatch, extracted, said, key) -> None:
    body, seen = _replan(monkeypatch, extracted, said, key, from_instant=_OTHER_DAY,
                         current_slots=[{"poi_id": _DINNER, "start_at": "09:00", "end_at": "10:00", "is_fixed": False}])
    assert f"nl_time_over_directive: {key}" in body["notes"], body["notes"]
    assert body["resolved_directives"] == []  # 숙소를 말하지 않았으면 숙소 쪽 마무리를 지어내지 않는다
    assert not any(n.startswith(("earlier_retime", "shorter_day:")) for n in body["notes"]), body["notes"]
    assert not seen[-1].required_in_order


def test_a_said_start_already_behind_now_still_counts(monkeypatch) -> None:
    """18:30 의 "저녁부터 일정 짜줘" — 17시는 지났지만 시작을 말한 것이다. 창을 안 움직여도 상한은 걸지 않는다."""
    body, seen = _replan(monkeypatch, ExtractedRequest(start_after=time(17, 0)), "저녁부터 일정 짜줘", "SHORTER_DAY",
                         from_instant="2026-09-21T18:30:00+09:00")
    assert "nl_time_satisfied: start_after 17:00" in body["notes"], body["notes"]
    assert "nl_time_over_directive: SHORTER_DAY" in body["notes"], body["notes"]
    assert not any(n.startswith("planb_visit_cap") for n in body["notes"]), body["notes"]


@pytest.mark.parametrize("said", ["앞으로 당겨줘 2시부터", "시간 당기기 3시부터", "오전에 몰아서 12시까지", "장소는 그대로 3시부터"])
def test_asking_to_shift_keeps_places_even_with_a_time(monkeypatch, said) -> None:
    body, _ = _replan(monkeypatch, ExtractedRequest(start_after=time(14, 0)), said, "EARLIER", from_instant=_OTHER_DAY,
                      current_slots=[{"poi_id": _DINNER, "start_at": "15:00", "end_at": "16:00", "is_fixed": False}])
    assert "EARLIER" in body["resolved_directives"] and any(n.startswith("earlier_retime") for n in body["notes"]), body["notes"]


def _dinner_slot(start: str, end: str) -> list[dict]:
    return [{"poi_id": _DINNER, "start_at": start, "end_at": end, "is_fixed": False}]


def test_an_inferred_dinner_lock_does_not_cross_the_said_window(monkeypatch) -> None:
    """"오후에만 돌아다닐래"(KEEP_DINNER 0.755) — 18:30 저녁을 잠가 말한 끝 18:00 을 넘겼다."""
    body, seen = _replan(monkeypatch, ExtractedRequest(start_after=time(12, 0), end_by=time(18, 0)), "오후에만 돌아다닐래", "KEEP_DINNER",
                         from_instant=_OTHER_DAY, current_slots=_dinner_slot("18:30", "19:30"), reasons=["none"])
    assert "nl_time_over_directive: KEEP_DINNER" in body["notes"], body["notes"]
    assert not any(n.startswith("keep_dinner") for n in body["notes"]), body["notes"]
    assert not any(b.reason == "keep_dinner" for b in seen[-1].fixed_blocks)
    assert all(s["end_at"][:5] <= "18:00" for d in body["itinerary"]["days"] for s in d["slots"]), [
        (s["poi_id"][-4:], s["start_at"], s["end_at"]) for d in body["itinerary"]["days"] for s in d["slots"]]


@pytest.mark.parametrize("said", ["저녁은 그대로 두고 오후에만 다닐래", "저녁은 유지하고 3시 이후로 짜줘", "저녁 예약은 그대로 하고 2시부터 짜줘"])
def test_saying_keep_dinner_keeps_it_even_with_a_time(monkeypatch, said) -> None:
    body, _ = _replan(monkeypatch, ExtractedRequest(start_after=time(14, 0)), said, "KEEP_DINNER", from_instant=_OTHER_DAY,
                      current_slots=_dinner_slot("18:30", "19:30"), reasons=["none"])
    assert any(n.startswith("keep_dinner:") for n in body["notes"]), body["notes"]
    assert "KEEP_DINNER" in body["resolved_directives"]


@pytest.mark.parametrize("chip", ["SHORTER_DAY", "KEEP_DINNER"])
def test_a_chip_beats_a_said_time(monkeypatch, chip) -> None:
    body, _ = _replan(monkeypatch, ExtractedRequest(end_by=time(18, 0)), "6시까지", directives=[chip],
                      from_instant=_OTHER_DAY, current_slots=_dinner_slot("17:30", "18:30"), reasons=["none"])
    assert chip in body["resolved_directives"] and "nl_time_over_directive" not in " ".join(body["notes"]), body["notes"]
