"""다시 짜기가 원 일정의 방문 수를 지킨다 (F-4 — 운영 2026-11-05 trip 8311ac19 보고 ③④).

운영 보고: 두 번째 다시 짜기에서 일정 수가 확 줄었고(구성 LLM 7.8s 타임아웃 → 폴백), "클럽 넣어줘"로 들어간 곳이
다음 다시 짜기에서 사라졌다. 폴백은 원 일정 방문을 필수에 넣지 않고 규칙 점수로 하루를 새로 짰고, OR 프리필터
(점수 상위 60 · 카테고리 몫)가 원 일정의 술집·미술·문화를 0곳으로 잘랐다. 구성 성공 경로도 MAX_VISITS=8 이
원 11곳을 8곳으로 잘랐다(run1 `limit=8 kept=8/11`).

증명하는 것 (실 LLM·실 API 0):
  ① 구성 타임아웃 → 원 일정 남은 11곳(술집 포함)이 우선 아닌 필수 방문으로 다 들어간다 — 프리필터가 원 일정 곳을
     자르지 않고, 하루 상한은 원 남은 수, 지킨 곳은 고정으로 나가지 않는다. 고른 곳이 전부 미배치라 다시 풀 때도 같다
  ② 이번 요청이 이긴다 — 이름으로 뺀 곳("풍월관 빼줘")·회피 카테고리(실내로 → 자연)는 지키지 않고, 그 자리는 다른 곳이 채운다
  ③ 지키지 않는 경우 — 새로 짜 보기(사유·요청 없음)·피로 상한(원−1)이 이긴다
  ④ 구성 성공 경로 — 원 11곳 + 06:00~21:00(15h) 창이면 고를 수 있는 수가 10 이다(MAX_VISITS 8 을 넘는다). 새로 짜 보기는 8
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from trippilot.assembly_engine import ortools_assembler
from trippilot.api.wiring import DEMO_ANCHOR
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi.poi import NIGHTLIFE_TAG, DataQuality, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.gates.replan.replan_request_extraction import ExtractedPlace, ExtractedRequest
from trippilot.ports.llm_port import LlmTimeoutError

from tests.agents.planb.test_replan_composition import _AgentSpy, _app, _post, _ScriptedLlm, _strip_slots

_A = DEMO_ANCHOR


def _poi(pid: str, name: str, cat: PoiCategory, dlat: float, dlng: float, *,
         saved: int = 0, tags: tuple[str, ...] = ()) -> Poi:
    return Poi(PoiId(pid), name, cat, GeoPoint(_A.lat + dlat, _A.lng + dlng), (), None, None,
               DataQuality.FULL, PoiSource.SEED, None, saved_count=saved, tags=tags)


# 원 일정 11곳 — 기준점에서 1.5km 떨어진 한 동네(서로 50m 남짓). 저장 수 0 이라 규칙 점수가 아래 후보보다 낮다.
_ORIG_SPEC = (
    (PoiCategory.FOOD, "아침 국밥"), (PoiCategory.CAFE, "골목 카페"), (PoiCategory.SIGHT, "성곽길"),
    (PoiCategory.ART, "작은 미술관"), (PoiCategory.FOOD, "점심 식당"), (PoiCategory.CULTURE, "옛 극장"),
    (PoiCategory.SHOPPING, "공방 거리"), (PoiCategory.CAFE, "언덕 카페"), (PoiCategory.NATURE, "숲 산책로"),
    (PoiCategory.FOOD, "저녁 식당"), (PoiCategory.BAR, "풍월관"),
)
_ORIG = tuple(
    _poi(f"a0000000-0000-4000-8000-{i:012d}", name, cat, 0.0135 + 0.0004 * i, 0.0004 * (i % 3),
         tags=(NIGHTLIFE_TAG,) if cat is PoiCategory.BAR else ())
    for i, (cat, name) in enumerate(_ORIG_SPEC))
_IDS = [str(p.poi_id) for p in _ORIG]
_BAR, _NATURE = _IDS[10], _IDS[8]

# 기준점 바로 곁의 인기 후보 68곳 — 카테고리 몫(카페 2×4, 그 밖 3×4)을 다 채우고도 60을 넘겨, 원 일정 곳이
# 필수가 아니면 프리필터 상위 60 밖으로 밀린다(운영 run3 의 술집·미술·문화 잔존 0 과 같은 모양).
_FILL_SPEC = ((PoiCategory.FOOD, 12), (PoiCategory.CAFE, 8), (PoiCategory.SIGHT, 12),
              (PoiCategory.SHOPPING, 12), (PoiCategory.NATURE, 12), (PoiCategory.ACTIVITY, 12))
_FILL = tuple(
    _poi(f"b0000000-0000-4000-8000-{k:012d}", f"인기 후보 {k}", cat,
         0.0003 * (k % 9), 0.0003 * (k // 9), saved=100_000)
    for k, cat in enumerate(c for c, n in _FILL_SPEC for _ in range(n)))
_POIS = (*_ORIG, *_FILL)


def _slots() -> list[dict]:
    """원 일정 — 06:00 부터 카테고리 기본 체류로 이어 붙인 시각(어셈블리가 낸 원 하루의 모양)."""
    stay = {PoiCategory.FOOD: 60, PoiCategory.CAFE: 45, PoiCategory.SIGHT: 75, PoiCategory.ART: 75,
            PoiCategory.CULTURE: 90, PoiCategory.SHOPPING: 60, PoiCategory.NATURE: 90, PoiCategory.BAR: 90}
    at, out = datetime(2026, 9, 21, 6, 0), []
    for p in _ORIG:
        end = at + timedelta(minutes=stay[p.category])
        out.append({"poi_id": str(p.poi_id), "start_at": f"{at:%H:%M}", "end_at": f"{end:%H:%M}",
                    "is_fixed": False})
        at = end + timedelta(minutes=10)
    return out


def _day(**over: object) -> dict:
    return {"time_window": {"date": "2026-09-21", "start": "06:00", "end": "22:00"},
            "from_instant": "2026-09-21T06:00:00+09:00",
            "request_meta": {"request_id": "keep-original", "requested_at": "2026-09-21T05:50:00+09:00",
                             "deadline_ms": 25000},
            "current_slots": _slots(), **over}


class _ComposeTimesOut(_ScriptedLlm):
    """구성 호출만 시한 초과(운영 run3: opus 7.8s) — 나머지 기능은 파싱 실패(규칙 점수 폴백)."""

    def __init__(self) -> None:
        super().__init__(None)

    def invoke(self, request):
        if request.prompt_ref.feature == "REPLAN_COMPOSITION":
            self.requests.append(request)
            raise LlmTimeoutError("compose 7.8s")
        return super().invoke(request)


def _run(llm, monkeypatch, *, extracted: ExtractedRequest | None = None, first=None, **over: object):
    """(응답, 에이전트가 받은 마지막 요청, 프리필터 절단 기록 [(절단 전 id, 남은 id)]). `first` 는 1차 해를 바꾼다."""
    cuts: list[tuple[set[PoiId], set[PoiId]]] = []
    real = ortools_assembler._log_prefilter_cut

    def spy(day, before, kept, pois):
        cuts.append(({c.poi_id for c in before}, {c.poi_id for c in kept}))
        return real(day, before, kept, pois)

    monkeypatch.setattr(ortools_assembler, "_log_prefilter_cut", spy)
    app, orch = _app(llm, pois=_POIS, extracted=extracted)
    agent = _AgentSpy(orch._schedule_agent, first=first)
    orch._schedule_agent = agent
    body = _post(app, **_day(**over))
    return body, agent.tasks[-1].request, cuts


def _placed(body: dict) -> list[str]:
    return [s["poi_id"] for d in body["itinerary"]["days"] for s in d["slots"]]


# ── ① 구성 타임아웃 → 원 일정 11곳이 남는다 ─────────────────────────────


def test_구성이_타임아웃이면_원_일정_남은_방문이_필수로_남고_술집도_잘리지_않는다(monkeypatch) -> None:
    body, req, cuts = _run(_ComposeTimesOut(), monkeypatch, free_text="오늘 남은 일정 다시 맞춰줘")

    assert any(n.startswith("llm_compose_fallback:") for n in body["notes"]), body["notes"]
    assert "replan_keep: 11/11" in body["notes"], body["notes"]
    keep = {v.poi_id: v for v in req.required_visits if v.reason == "replan_keep"}
    assert set(keep) == {PoiId(p) for p in _IDS}
    assert not any(v.priority for v in keep.values())  # 이름으로 집은 곳보다 가볍다
    assert req.max_visits_per_day == 11  # 원 남은 수 — 새 곳이 끼어 방문 수가 흔들리지 않는다
    # 프리필터가 돌았고(후보 79 > 60), 원 일정 곳은 하나도 안 잘렸다
    assert cuts, "프리필터가 안 돌았다 — 이 테스트의 전제(후보 > 60)가 깨졌다"
    for before, kept in cuts:
        assert {PoiId(p) for p in _IDS} & before <= kept, sorted(map(str, ({PoiId(p) for p in _IDS} & before) - kept))
    placed = _placed(body)
    assert set(_IDS) <= set(placed), (sorted(set(_IDS) - set(placed)), body["notes"])
    assert _BAR in placed
    # 지킨 곳은 사용자가 고정한 곳이 아니다 — 고정으로 내면 BE 가 잠가 다음 다시 짜기에서 못 바꾼다
    assert not any(s["is_fixed"] for d in body["itinerary"]["days"] for s in d["slots"])


def test_고른_곳이_하나도_안_놓여_다시_풀_때도_원_일정을_지킨다(monkeypatch) -> None:
    """구성이 고른 곳이 전부 미배치면 종전 경로로 다시 푼다 — 그 풀이도 구성 실패와 같은 규칙이다."""
    body, req, _ = _run(_ScriptedLlm(list(_IDS[:3])), monkeypatch, first=_strip_slots,
                        free_text="오늘 남은 일정 다시 맞춰줘")
    assert "llm_composed_unplaced: 3/3" in body["notes"], body["notes"]
    assert "replan_keep: 11/11" in body["notes"], body["notes"]
    assert {str(v.poi_id) for v in req.required_visits if v.reason == "replan_keep"} == set(_IDS)
    assert req.max_visits_per_day == 11
    assert set(_IDS) <= set(_placed(body)), body["notes"]
    assert not any(s["is_fixed"] for d in body["itinerary"]["days"] for s in d["slots"])


def test_말한_시각_창_밖의_원_일정은_지키지_않는다(monkeypatch) -> None:
    """"3시 이후로 다시 짜줘" + 구성 타임아웃 — 하루가 15시에 시작한다는 말이라, 15시 전에 끝나는 원 일정 7곳을 필수로 두고
    15시 뒤에 몰아넣지 않는다(검토 2026-11-06). 15시에 걸치거나 뒤인 4곳은 종전대로 지킨다."""
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, extracted=ExtractedRequest(start_after=time(15, 0)),
                        free_text="3시 이후로 다시 짜줘")

    assert "nl_time_accepted: start_after 15:00" in body["notes"], body["notes"]
    assert "replan_keep: 4/4" in body["notes"], body["notes"]
    assert {str(v.poi_id) for v in req.required_visits if v.reason == "replan_keep"} == set(_IDS[7:])
    assert req.max_visits_per_day == 4 and (req.day_window.start.hour, req.day_window.start.minute) == (15, 0)
    placed = _placed(body)
    assert set(_IDS[7:]) <= set(placed), (sorted(set(_IDS[7:]) - set(placed)), body["notes"])
    assert not set(_IDS[:7]) & set(placed), body["notes"]
    assert all(s["start_at"] >= "15:00" for d in body["itinerary"]["days"] for s in d["slots"]), body


def test_말한_끝_시각_뒤의_원_일정은_지키지_않고_못_놓인_수를_밝힌다(monkeypatch) -> None:
    """"3시까지만" + 구성 타임아웃 — 15시 뒤에 시작하는 원 일정 3곳(숲·저녁·풍월관)은 필수로 두지 않는다(`until`). 지킨 8곳이
    06~15시에 다 안 들어가면 `replan_keep_unplaced` 로 밝힌다(종전엔 구성 없는 경로가 조용히 빠뜨렸다, INV-4)."""
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, extracted=ExtractedRequest(end_by=time(15, 0)),
                        free_text="3시까지만")
    assert "nl_time_accepted: end_by 15:00" in body["notes"], body["notes"]
    assert "replan_keep: 8/8" in body["notes"], body["notes"]
    assert {str(v.poi_id) for v in req.required_visits if v.reason == "replan_keep"} == set(_IDS[:8])
    assert (req.day_window.end.hour, req.day_window.end.minute) == (15, 0)
    placed = _placed(body)
    assert not set(_IDS[8:]) & set(placed), body["notes"]
    assert all(s["end_at"] <= "15:00" for d in body["itinerary"]["days"] for s in d["slots"]), body
    lost = len(set(_IDS[:8]) - set(placed))
    assert (lost == 0) or (f"replan_keep_unplaced: {lost}/8" in body["notes"]), (lost, body["notes"])


def test_더_늦게까지도_말한_시각_창_밖의_원_일정은_두지_않는다(monkeypatch) -> None:
    """"3시 이후로 더 늦게까지" — 더 늦게까지(EXTEND_DAY)의 '남은 방문 그대로'도 15시 전 원 일정은 세지 않는다(검토 2026-11-06).
    종전엔 kept 가 nl 창보다 앞에서 계산돼 오전 7곳이 15시 뒤 창에 우선 필수로 몰렸다."""
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, extracted=ExtractedRequest(start_after=time(15, 0)),
                        free_text="3시 이후로 더 늦게까지 놀고 싶어", directives=["EXTEND_DAY"])
    assert "extend_day: kept 4" in body["notes"], body["notes"]
    kept = {str(v.poi_id) for v in req.required_visits if v.reason == "extend_keep"}
    assert kept == set(_IDS[7:]), body["notes"]
    assert (req.day_window.start.hour, req.day_window.start.minute) == (15, 0)
    # 오전 원 일정은 우선 필수가 아니다 — 후보로 남아 규칙 점수로 15시 뒤에 들 수는 있다(다른 후보와 같은 자격)
    assert not any(str(v.poi_id) in _IDS[:7] for v in req.required_visits), req.required_visits
    assert all(s["start_at"] >= "15:00" for d in body["itinerary"]["days"] for s in d["slots"]), body


# ── ② 이번 요청이 이긴다 ──────────────────────────────────────────────


def test_이름으로_뺀_곳과_회피_카테고리는_지키지_않고_그_자리는_다른_곳이_채운다(monkeypatch) -> None:
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch,
                        extracted=ExtractedRequest(places=(ExtractedPlace("풍월관", "avoid"),)),
                        free_text="풍월관은 빼줘", directives=["INDOOR"])

    keep = {str(v.poi_id) for v in req.required_visits if v.reason == "replan_keep"}
    assert keep == set(_IDS) - {_BAR, _NATURE}, body["notes"]
    assert "replan_keep: 9/11" in body["notes"], body["notes"]
    placed = _placed(body)
    assert _BAR not in placed and _NATURE not in placed, body["notes"]
    assert set(keep) <= set(placed), (sorted(set(keep) - set(placed)), body["notes"])
    # 뺀 두 자리는 비지 않는다 — 상한은 원 남은 수 그대로라 규칙 점수가 다른 곳으로 채운다
    assert req.max_visits_per_day == 11
    assert len(placed) == 11, (len(placed), body["notes"])


# ── ③ 지키지 않는 경우 ────────────────────────────────────────────────


def test_새로_짜_보기는_원_일정을_지키지_않는다(monkeypatch) -> None:
    """사유도 요청도 없는 "새로 짜기"는 다른 하루를 원한다 — 지키면 같은 곳이 시각만 바뀌어 돌아온다."""
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, reasons=["none"])
    assert not any(n.startswith("replan_keep") for n in body["notes"]), body["notes"]
    assert not any(v.reason == "replan_keep" for v in req.required_visits)
    assert req.max_visits_per_day is None


def test_피로_상한이_있으면_그_상한이_이긴다(monkeypatch) -> None:
    body, req, _ = _run(_ComposeTimesOut(), monkeypatch, reasons=["fatigue"])
    assert "planb_visit_cap: 10" in body["notes"], body["notes"]
    assert not any(n.startswith("replan_keep") for n in body["notes"]), body["notes"]
    assert req.max_visits_per_day == 10


# ── ④ 구성 성공 경로 — 원 남은 수까지는 고를 수 있다 ─────────────────────


def _composed_note(body: dict) -> str:
    return next(n for n in body["notes"] if n.startswith("llm_composed:"))


def test_구성_성공이면_원_11곳과_15시간_창에서_10곳까지_고른다(monkeypatch) -> None:
    llm = _ScriptedLlm(list(_IDS))  # 원 일정을 그대로 다 고른다
    body, _, _ = _run(llm, monkeypatch, free_text="오늘 남은 일정 다시 맞춰줘",
                      time_window={"date": "2026-09-21", "start": "06:00", "end": "21:00"})
    assert "limit=10" in _composed_note(body), body["notes"]
    assert "10곳 이하로" in llm.compose_prompt()


def test_새로_짜_보기는_시간_환산과_MAX_VISITS_로만_정한다(monkeypatch) -> None:
    llm = _ScriptedLlm(list(_IDS))
    body, _, _ = _run(llm, monkeypatch, reasons=["none"],
                      time_window={"date": "2026-09-21", "start": "06:00", "end": "21:00"})
    assert "limit=8" in _composed_note(body), body["notes"]
