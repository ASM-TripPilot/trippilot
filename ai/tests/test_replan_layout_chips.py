"""하루 모양 지시 3종 — 저녁은 그대로·시간만 당기기·숙소 근처에서 끝내기 (BR-U4-47 · `_LAYOUT_KEYS`).

종전엔 셋 다 사전이 인식만 하고 효과가 없었다(`directives_unwired`). 경계(`/planb/replan`)를 실조립으로
관통해 ① 에이전트 요청에 무엇이 실리는지 ② 응답 일정이 어떻게 바뀌는지를 본다. 조립기 쪽 끝 거리
감점의 효과는 `test_assembly_engine_end_near.py` 가 PBT 로 본다.
"""

from __future__ import annotations

from trippilot.api.wiring import demo_poi_seed

from tests.test_replan_natural_language import _replan

_SEED = {p.name: str(p.poi_id) for p in demo_poi_seed()}
_PORK = _SEED["제주 흑돼지거리"]   # FOOD
_HALLA = _SEED["한라산"]          # NATURE
_STAY = {"lat": 33.50, "lng": 126.52}


def _slot(poi: str, start: str, end: str) -> dict:
    return {"poi_id": poi, "start_at": start, "end_at": end, "placement_reason": "x"}


def _placed(body: dict) -> list[dict]:
    return [s for d in body["itinerary"]["days"] for s in d["slots"]]


# ── 저녁은 그대로 ─────────────────────────────────────────────────────


def test_저녁은_그대로_원_일정의_저녁_식당을_원_시각으로_잠근다() -> None:
    slots = [_slot(_HALLA, "10:00", "12:00"), _slot(_PORK, "18:00", "19:00")]
    body, seen = _replan(directives=["KEEP_DINNER"], reasons=["none"], current_slots=slots)

    held = [(str(b.poi_id), b.window.start.strftime("%H:%M")) for b in seen["agent"][0].fixed_blocks]
    assert (_PORK, "18:00") in held, held
    pork = [s for s in _placed(body) if s["poi_id"] == _PORK]
    assert [(s["start_at"][:5], s["end_at"][:5]) for s in pork] == [("18:00", "19:00")]
    # 이번 재계획에만 잠근다 — 고정으로 내면 BE 가 잠가서 다음 다시 짜기에서 못 바꾼다
    assert pork[0]["is_fixed"] is False
    assert any(n.startswith("keep_dinner: ") for n in body["notes"]), body["notes"]
    assert not any("directives_unwired" in n for n in body["notes"]), body["notes"]


def test_칩이_없으면_저녁도_잠그지_않는다() -> None:
    slots = [_slot(_HALLA, "10:00", "12:00"), _slot(_PORK, "18:00", "19:00")]
    _, seen = _replan(reasons=["none"], current_slots=slots)

    assert seen["agent"][0].fixed_blocks == ()


def test_원_일정에_저녁이_없으면_잠글_것이_없다고_밝힌다() -> None:
    slots = [_slot(_PORK, "12:00", "13:00")]  # 점심 — 저녁창(17~20시) 밖
    body, seen = _replan(directives=["KEEP_DINNER"], reasons=["none"], current_slots=slots)

    assert seen["agent"][0].fixed_blocks == ()
    assert any(n.startswith("keep_dinner_none") for n in body["notes"]), body["notes"]


def test_저녁은_한_끼만_잠근다() -> None:
    """창에 걸친 식당 둘을 다 잠그면 둘 사이 이동(흑돼지거리 → 월정리 28km)이 안 맞아 해 없음이었다."""
    cafe_street = _SEED["월정리 카페거리"]
    slots = [_slot(_PORK, "18:00", "19:00"), _slot(cafe_street, "19:30", "20:30")]
    body, seen = _replan(directives=["KEEP_DINNER", "EARLIER"], reasons=["none"], current_slots=slots)

    held = [str(b.poi_id) for b in seen["agent"][0].fixed_blocks if b.reason == "keep_dinner"]
    assert held == [_PORK]
    assert body["itinerary"] is not None, body["notes"]


def test_이미_끝난_저녁은_잠그지_않는다() -> None:
    """되실으면 고정으로 나가 BE 가 영구히 잠근다 — 지난 저녁은 잠글 대상이 아니다."""
    slots = [_slot(_PORK, "18:00", "19:00")]
    body, seen = _replan(directives=["KEEP_DINNER"], reasons=["none"], current_slots=slots,
                         from_instant="2026-09-21T20:00:00+09:00")

    assert all(b.reason != "keep_dinner" for b in seen["agent"][0].fixed_blocks)
    assert f"keep_dinner_skipped: {_PORK}" in body["notes"], body["notes"]


# ── 시간만 당기기 ────────────────────────────────────────────────────


def test_시간만_당기기는_장소_그대로_시각만_앞당긴다() -> None:
    slots = [_slot(_HALLA, "13:00", "15:00"), _slot(_PORK, "16:00", "17:00")]
    body, seen = _replan(directives=["EARLIER"], reasons=["none"], current_slots=slots)

    req = seen["agent"][0]
    assert [(str(v.poi_id), v.dwell_min) for v in req.required_visits] == [(_HALLA, 120), (_PORK, 60)]
    placed = _placed(body)
    assert sorted(s["poi_id"] for s in placed) == sorted([_HALLA, _PORK])  # 새 장소 없음
    assert min(s["start_at"] for s in placed) < "13:00", placed  # 하한(09:00)부터 당겨졌다
    assert all(s["is_fixed"] is False for s in placed)
    # 순서도 원 일정 그대로 — 거리로 섞이면 저녁 식당이 아침 첫 방문이 된다(로컬 실스택 2026-10-14)
    assert req.required_in_order is True
    assert [s["poi_id"] for s in sorted(placed, key=lambda s: s["start_at"])] == [_HALLA, _PORK]


def test_장소를_바꾸는_지시가_같이_오면_그쪽이_이긴다() -> None:
    slots = [_slot(_HALLA, "13:00", "15:00"), _slot(_PORK, "16:00", "17:00")]
    body, seen = _replan(directives=["EARLIER", "INDOOR"], reasons=["none"], current_slots=slots)

    assert all(v.reason != "earlier_retime" for v in seen["agent"][0].required_visits)
    assert "earlier_ignored: INDOOR" in body["notes"], body["notes"]


def test_저녁_잠금과_시간_당기기는_같이_간다() -> None:
    slots = [_slot(_HALLA, "13:00", "15:00"), _slot(_PORK, "18:00", "19:00")]
    body, seen = _replan(directives=["EARLIER", "KEEP_DINNER"], reasons=["none"], current_slots=slots)

    req = seen["agent"][0]
    # 잠근 저녁은 원 자리의 자리표로 순서에 든다(조립이 같은 날 핀으로 읽는다 — 두 번 놓지 않는다)
    assert [str(v.poi_id) for v in req.required_visits] == [_HALLA, _PORK]
    assert [str(b.poi_id) for b in req.fixed_blocks] == [_PORK]
    assert req.max_visits_per_day == 2  # 자리표를 상한에 두 번 세지 않는다 — 새 장소가 끼지 않는다


def test_저녁_잠금과_시간_당기기를_같이_고르면_저녁_뒤_방문은_저녁_뒤에_남는다() -> None:
    """잠금이 순서 밖이면 원 일정에서 저녁 뒤였던 카페가 저녁 앞 빈 시간으로 당겨졌다."""
    cafe = _SEED["월정리 카페거리"]
    slots = [_slot(_PORK, "17:30", "18:30"), _slot(cafe, "19:00", "20:00")]
    body, _ = _replan(directives=["EARLIER", "KEEP_DINNER"], reasons=["none"], current_slots=slots,
                      time_window={"date": "2026-09-21", "start": "09:00", "end": "23:00"})

    order = [s["poi_id"] for s in sorted(_placed(body), key=lambda s: s["start_at"])]
    assert order == [_PORK, cafe], body["notes"]  # 종전: 카페 12:01 → 저녁 17:30


def test_시간만_당기기는_사유가_암시한_회피로_원_일정을_빼지_않는다() -> None:
    """우천은 야외 회피를 암시하지만 사용자는 "시간만"이라 했다 — 원 일정의 한라산(자연)은 남는다."""
    slots = [_slot(_HALLA, "13:00", "15:00"), _slot(_PORK, "16:00", "17:00")]
    body, seen = _replan(directives=["EARLIER"], reasons=["weather"], current_slots=slots)

    req = seen["agent"][0]
    assert _HALLA in {str(v.poi_id) for v in req.required_visits}
    assert sorted(s["poi_id"] for s in _placed(body)) == sorted([_HALLA, _PORK])


def test_효과_없는_지시는_시간만_당기기를_막지_않는다() -> None:
    """예산 유지(미배선)·여유 있게(속도 — 체류는 원 일정 값)는 장소를 바꾸지 않는다."""
    slots = [_slot(_HALLA, "13:00", "15:00")]
    body, seen = _replan(directives=["EARLIER", "KEEP_BUDGET", "RELAX"], reasons=["none"],
                         current_slots=slots)

    assert [v.reason for v in seen["agent"][0].required_visits] == ["earlier_retime"]
    assert not any(n.startswith("earlier_ignored") for n in body["notes"]), body["notes"]


# ── 숙소 근처에서 끝내기 ──────────────────────────────────────────────


def test_숙소_근처에서_끝내기는_숙소를_끝점으로_싣는다() -> None:
    body, seen = _replan(directives=["END_NEAR_STAY"], reasons=["none"], stay_anchor=_STAY)

    end = seen["agent"][0].end_near
    assert (end.lat, end.lng) == (_STAY["lat"], _STAY["lng"])
    assert not any("END_NEAR_STAY" in n for n in body["notes"]), body["notes"]


def test_숙소가_없으면_끝점_없이_무효를_밝힌다() -> None:
    """`anchor` 로 대신하지 않는다 — 그것은 GPS·수동·마지막 방문일 수 있다."""
    body, seen = _replan(directives=["END_NEAR_STAY"], reasons=["none"])

    assert seen["agent"][0].end_near is None
    assert any(n.startswith("end_near_stay_no_stay") for n in body["notes"]), body["notes"]


def test_칩이_없으면_숙소가_와도_끝점은_없다() -> None:
    _, seen = _replan(reasons=["none"], stay_anchor=_STAY)

    assert seen["agent"][0].end_near is None
