"""`/replan` 실 배선 — 계약만 있던 자리가 실제로 일정을 낸다.

`tests/test_api_replan.py` 8건은 **스텁 오케스트레이터**로 계약(스키마·503·상한)을
본다. 이 파일은 `build_dev_app()` 실 배선으로 **산출물**을 본다 — 그 구분이 없어서
`/replan` 이 100% 503 인 상태가 CI 를 통과했다(2026-09-24 실측).

증명하는 것 (실 LLM·실 벡터·실 API 0 — D37):
  ① 실 배선이 일정을 낸다 — 503 이 아니고 슬롯이 있다
  ② 원 일정 POI 가 후보 풀에 합류한다 (legacy 경로가 버리던 것)
  ③ 지시(KB-4)가 **실제로 점수를 바꾼다** — 해석만 하고 마는 게 아니다
  ④ 미배선 지시·모르는 칩·사전 부재를 **조용히 무시하지 않는다**
  ⑤ 후보가 없으면 빈 일정으로 위장하지 않는다 (itinerary=null + empty_reason)
  ⑥ 주입을 끊으면 죽는다 — 합성 루트가 배선을 정말 하고 있는지
"""

from __future__ import annotations

import pytest
import yaml  # tests 는 `src/` 밖이라 yaml 규칙 대상이 아니다

from fastapi.testclient import TestClient

from trippilot.agents.planb.directives import load_directive_file
from trippilot.api.wiring import DEMO_ANCHOR, build_dev_app, demo_poi_seed
from trippilot.assembly_engine.scorer import (
    CATEGORY_WEIGHT,
    DIRECTIVE_STEP,
    build_rule_score,
    directive_fit,
)
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

import pathlib

_DIRECTIVES = load_directive_file(
    pathlib.Path(__file__).resolve().parents[1] / "data" / "replan_directives.yaml",
    yaml.safe_load,
)


def _body(**over: object) -> dict:
    body: dict = {
        "trip_id": "trip-replan-wired",
        "trip_context": {
            "destinations": ["제주"],
            "start_date": "2026-09-20",
            "end_date": "2026-09-22",
        },
        "target_date": "2026-09-21",
        "time_window": {"date": "2026-09-21", "start": "09:00", "end": "21:00"},
        "anchor": {"lat": DEMO_ANCHOR.lat, "lng": DEMO_ANCHOR.lng},
        "scope": "FULL_DAY",
        "from_instant": "2026-09-21T09:00:00+09:00",
        "locked_blocks": [],
        "current_slots": [],
        "reasons": ["weather"],
        "directives": [],
        "preference_profile": {},
        "transport_mode": "대중교통",
        "saved_places": [],
        "excluded_poi_ids": [],
        "request_meta": {
            "request_id": "replan-wired-test",
            "requested_at": "2026-09-21T08:00:00+09:00",
            "deadline_ms": 20000,
        },
    }
    body.update(over)
    return body


def _post(app, **over: object):
    with TestClient(app, raise_server_exceptions=False) as client:
        return client.post("/ai/v1/itinerary/replan", json=_body(**over))


# ── ① 실 배선이 일정을 낸다 ────────────────────────────────────────────


def test_실_배선이_재계획안을_낸다() -> None:
    """503 이 아니라 일정이다 — 이 단언이 없어서 미배선이 CI 를 통과했다."""
    response = _post(build_dev_app(directives=_DIRECTIVES))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["empty_reason"] is None, body["notes"]
    days = body["itinerary"]["days"]
    assert len(days) == 1                      # 하루만 다시 짠다
    assert days[0]["slots"], body["notes"]     # 슬롯이 실제로 있다
    assert body["total_distance_km"] is not None and body["total_distance_km"] >= 0


def test_응답에_소요시간_계열_필드가_없다() -> None:
    """INV-3 — 거리만 낸다. `total_distance_km` 을 새로 만들었으니 같이 고정한다."""
    raw = _post(build_dev_app(directives=_DIRECTIVES)).text
    for token in ('"duration', '"travel_minutes"', '"eta"', '"소요'):
        assert token not in raw, token


# ── ② 원 일정 POI 가 후보로 합류한다 ───────────────────────────────────


def test_원_일정_POI_가_후보풀에_합류한다() -> None:
    """legacy 경로(`legacyReplanViaGenerate`)가 버리던 것 — "바꿀 이유 없는 곳까지 바뀐다".

    반경 밖 POI 를 원 일정으로 주고, 그것이 후보가 됐는지 본다. 풀 빌더는 반경으로
    자르므로 합류가 없으면 이 POI 는 절대 안 나온다.
    """
    seed = demo_poi_seed()
    far = next(p for p in seed if p.name == "성산일출봉")  # 데모 앵커에서 반경 밖
    body_slots = [{"poi_id": str(far.poi_id), "start_at": "10:00", "end_at": "11:30",
                   "placement_reason": "아침에 한적해서"}]

    response = _post(build_dev_app(directives=_DIRECTIVES), current_slots=body_slots)

    assert response.status_code == 200, response.text
    body = response.json()
    placed = {s["poi_id"] for d in body["itinerary"]["days"] for s in d["slots"]}
    assert str(far.poi_id) in placed, (
        f"원 일정 POI 가 후보에 안 들어갔다 — placed={placed} notes={body['notes']}")


def test_제외한_원_일정_POI_는_합류하지_않는다() -> None:
    """사용자가 이미 거절한 곳을 되살리면 거절 버튼이 거짓이 된다."""
    far = next(p for p in demo_poi_seed() if p.name == "성산일출봉")
    response = _post(
        build_dev_app(directives=_DIRECTIVES),
        current_slots=[{"poi_id": str(far.poi_id), "start_at": "10:00",
                        "end_at": "11:30", "placement_reason": "x"}],
        excluded_poi_ids=[str(far.poi_id)],
    )

    assert response.status_code == 200, response.text
    placed = {s["poi_id"] for d in response.json()["itinerary"]["days"] for s in d["slots"]}
    assert str(far.poi_id) not in placed


# ── ③ 지시가 실제로 점수를 바꾼다 ──────────────────────────────────────


def _poi(category: PoiCategory) -> Poi:
    return Poi(
        poi_id=PoiId("p1"), name="x", category=category, coord=GeoPoint(37.5, 127.0),
        open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL,
        source=PoiSource.SEED, confidence=None,
    )


def test_회피_지시가_카테고리_서열을_실제로_뒤집는다() -> None:
    """"힘든 건 피해줘"를 눌렀는데 액티비티가 그대로 오면 그 버튼은 거짓이다.

    2026-09-24 실측: 사전 20종이 적재돼 있는데 `prefer_categories`·`avoid_categories`
    를 읽는 코드가 `src/` 전체에 **0건**이었다 — 인식만 하고 효과가 없었다.
    """
    avoid = frozenset({PoiCategory.ACTIVITY, PoiCategory.NATURE})  # AVOID_STRENUOUS
    activity = build_rule_score(_poi(PoiCategory.ACTIVITY), BudgetLevel.MID, None, 1,
                               avoid=avoid)
    culture = build_rule_score(_poi(PoiCategory.CULTURE), BudgetLevel.MID, None, 1,
                               avoid=avoid)
    # 지시 없이는 ACTIVITY(0.9) > CULTURE(0.8) 인데, 회피가 서열을 뒤집는다
    assert CATEGORY_WEIGHT[PoiCategory.ACTIVITY] > CATEGORY_WEIGHT[PoiCategory.CULTURE]
    assert activity < culture


def test_선호와_회피가_겹치면_상쇄된다() -> None:
    """반대인 칩을 같이 누른 것 — 한쪽을 임의로 이기게 하면 화면에 설명할 수 없다."""
    both = frozenset({PoiCategory.CAFE})
    assert directive_fit(PoiCategory.CAFE, both, both) == 0.0
    assert directive_fit(PoiCategory.CAFE, both, frozenset()) == DIRECTIVE_STEP
    assert directive_fit(PoiCategory.CAFE, frozenset(), both) == -DIRECTIVE_STEP


def test_해석한_지시를_응답에_되돌려_보낸다() -> None:
    response = _post(build_dev_app(directives=_DIRECTIVES), directives=["INDOOR"])

    assert response.status_code == 200, response.text
    assert response.json()["resolved_directives"] == ["INDOOR"]


# ── ④ 조용히 무시하지 않는다 ──────────────────────────────────────────


def test_모르는_칩은_되돌려_보낸다() -> None:
    """FE 가 칩을 늘렸는데 사전이 안 따라온 상황이 응답에 드러나야 한다."""
    body = _post(build_dev_app(directives=_DIRECTIVES),
                 directives=["INDOOR", "이런건없다"]).json()

    assert body["resolved_directives"] == ["INDOOR"]
    assert body["unknown_directives"] == ["이런건없다"]


def test_미배선_지시는_해석분에_넣되_무효를_밝힌다() -> None:
    """해석 못 한 것과 해석했지만 안 듣는 것은 다른 사실이다.

    섞으면 FE 가 "사전을 늘려야 하나"와 "솔버를 열어야 하나"를 못 가른다.
    """
    body = _post(build_dev_app(directives=_DIRECTIVES), directives=["RELAX"]).json()

    assert body["resolved_directives"] == ["RELAX"]   # 사전이 아는 키다
    assert body["unknown_directives"] == []
    assert any("directives_unwired" in n and "RELAX" in n for n in body["notes"]), body["notes"]


def test_사전이_없으면_그_사실을_노트로_낸다() -> None:
    """사전 부재를 조용히 넘기면 "칩이 왜 안 먹나"를 아무도 못 짚는다."""
    body = _post(build_dev_app(), directives=["INDOOR"]).json()  # directives 미주입

    assert "directive_dictionary_absent" in body["notes"]
    assert body["unknown_directives"] == ["INDOOR"]


def test_벡터_미주입이면_자유입력_해석_불가를_밝힌다() -> None:
    body = _post(build_dev_app(directives=_DIRECTIVES),
                 free_text="비 와서 실내로 바꿔줘").json()

    assert "free_text_match_unavailable" in body["notes"]


# ── ⑤ 빈 일정으로 위장하지 않는다 ─────────────────────────────────────


def test_후보가_없으면_itinerary_는_null_이다() -> None:
    """IO-7 — 200 + `empty_reason`. 빈 `days` 로 "성공한 척" 하지 않는다."""
    body = _post(build_dev_app(directives=_DIRECTIVES),
                 anchor={"lat": 37.5665, "lng": 126.9780}).json()  # 제주 시드 반경 밖

    assert body["itinerary"] is None
    assert body["empty_reason"]["code"] in {"NO_CANDIDATE", "NO_FEASIBLE_SLOT"}
    assert body["fallback_level"] == 2


# ── ⑥ 주입을 끊으면 죽는다 ────────────────────────────────────────────


def test_에이전트_주입을_끊으면_재계획이_죽는다() -> None:
    """합성 루트가 배선을 **정말** 하고 있는지 — 안 그러면 위 단언들이 허수다.

    이 리포에서 "배선한 인자를 합성 루트에서 끊어도 스위트가 초록"이 이번 주 세 번
    나왔다(PR #668·#681 계열). 그래서 끊어 보는 테스트를 같이 둔다.
    """
    app = build_dev_app(directives=_DIRECTIVES)
    orchestrator = app.state.orchestrator
    assert orchestrator._schedule_agent is not None

    object.__setattr__(orchestrator, "_schedule_agent", None)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/itinerary/replan", json=_body())
    assert response.status_code != 200, "에이전트 없이 200 이 나오면 재사용이 거짓이다"


def test_해석한_지시가_에이전트_요청까지_실린다() -> None:
    """경계에서 점수까지의 **고리**를 지킨다 — 위 서열 테스트는 이걸 못 본다.

    실측(2026-09-24): `agent.py` 의 `avoid=request.avoid_categories` 를
    `frozenset()` 으로 끊었더니 이 파일 13건이 **전부 통과**했다. 서열 테스트가
    `build_rule_score` 를 직접 불러서 경계를 안 지나기 때문이다.

    그래서 에이전트가 **실제로 받은 요청**을 붙잡아 본다. 하류 효과(어느 슬롯이
    바뀌나)가 아니라 이음매 자체를 단언하므로, 점수 산식이 바뀌어도 이 테스트는
    조인만 지킨다.
    """
    app = build_dev_app(directives=_DIRECTIVES)
    orchestrator = app.state.orchestrator
    real = orchestrator._schedule_agent
    seen: list[object] = []

    class _Spy:
        def run(self, task):
            seen.append(task.request)
            return real.run(task)

    object.__setattr__(orchestrator, "_schedule_agent", _Spy())
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/ai/v1/itinerary/replan",
            json=_body(directives=["AVOID_STRENUOUS", "ADD_CAFE"]),
        )

    assert response.status_code == 200, response.text
    assert seen, "에이전트가 불리지 않았다"
    request = seen[0]
    assert PoiCategory.ACTIVITY in request.avoid_categories  # AVOID_STRENUOUS
    assert PoiCategory.NATURE in request.avoid_categories
    assert PoiCategory.CAFE in request.prefer_categories     # ADD_CAFE


def test_지시가_없으면_요청에도_빈_집합이_실린다() -> None:
    """generate 경로 무영향의 근거 — 기본값이 빈 집합이라 점수가 종전과 같다."""
    app = build_dev_app(directives=_DIRECTIVES)
    orchestrator = app.state.orchestrator
    real = orchestrator._schedule_agent
    seen: list[object] = []

    class _Spy:
        def run(self, task):
            seen.append(task.request)
            return real.run(task)

    object.__setattr__(orchestrator, "_schedule_agent", _Spy())
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post("/ai/v1/itinerary/replan", json=_body())

    assert seen
    assert seen[0].prefer_categories == frozenset()
    assert seen[0].avoid_categories == frozenset()
