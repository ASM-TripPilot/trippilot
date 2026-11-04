"""다시 짜기 구성 앞 직렬 구간을 겹친다 (운영 2026-11-05 trip 8311ac19 run3, F-3).

run3 은 구성 시한이 7.8s 밖에 안 남아 opus 가 타임아웃했고 폴백으로 갔다. 구성 앞이 직렬이었다:
  - 지시 번역 LLM 1.5s(+ 임베딩 매칭 0.7s)가 끝나야 장소 수집이 시작됐다
  - 장소 수집 뒤 4.9s 공백 — 이름으로 집은 장소를 대조하려고 반경 50km 등록 POI 를 그때서야 불렀다

증명하는 것 (실 LLM·실 API 0, 시간 문턱 없이 사건 순서로):
  ① 지시 해석(번역)은 장소 수집과 겹쳐 돌고, 그 결과(가까운 데로)는 풀 확대 판정에 닿는다
  ② 집은 이름이 받은 후보 풀에 정확히 있으면 50km 조회를 기다리지 않는다
  ③ 풀에 없으면 50km 조회는 추출 직후 떠 있어 장소 수집과 겹친다
  ④ 대조 규칙: 풀 먼저는 정확 일치일 때만 — 부분 일치뿐이면 조회한다(멀리 있는 정확 일치가 이긴다)
"""

from __future__ import annotations

import threading

from fastapi.testclient import TestClient

from trippilot.agents.planb import request_verification as v
from trippilot.api.wiring import StaticPoiDb, build_dev_app, demo_poi_seed
from trippilot.domain.llm.llm import TypedResult
from trippilot.llm_gateway.gates.replan.replan_directive_translation import DirectiveTranslation
from trippilot.llm_gateway.gates.replan.replan_request_extraction import ExtractedPlace, ExtractedRequest

from tests.agents.planb.test_replan_nl_request import _REG, _WOLJEONG, _StubExtractor, _verify
from tests.api.test_api_replan_wired import _DIRECTIVES, _body
from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.fake_existence import FakeExistence
from tests.fakes.in_memory_vector_store import InMemoryVectorStore

# 데모 풀(제주 4곳) 기준 — 가장 가까운 한라산이 ≈12.4km: 대중교통 기본 10km 밖, 넓힌 15km 안
_RING_ANCHOR = {"lat": 33.25, "lng": 126.5292}
_HEUKDWAEJI = next(p for p in demo_poi_seed() if str(p.poi_id).endswith("0002"))  # 앵커 8.3km — 풀 안


class _InfoSpy:
    """장소 수집(`InfoCollector.collect`) 첫 호출이 끝날 때 `after()` 를 부른다 — 나머지는 그대로 넘긴다."""

    def __init__(self, inner, after) -> None:
        self._inner, self._after, self._done = inner, after, False

    def collect(self, *a, **kw):
        out = self._inner.collect(*a, **kw)
        if not self._done:
            self._done = True
            self._after()
        return out

    def __getattr__(self, name):
        return getattr(self._inner, name)


def _post(app, **over) -> dict:
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ai/v1/planb/replan", json=_body(**over))
    assert r.status_code == 200, r.text
    return r.json()


# ── ① 지시 해석 — 장소 수집과 겹치고, 확대 판정 전에 합류한다 ─────────────


def test_지시_번역은_장소_수집과_겹쳐_돌고_가까운_데로는_풀_확대_판정에_닿는다() -> None:
    """번역이 장소 수집이 **끝날 때까지** 돌게 한다 — 직렬이면 수집이 번역 뒤라 3s 를 기다리다 겹침 False.
    그래도 "가까운 데로"(NEARBY)는 넓히지 않는다로 이어져야 한다: 합류가 확대 판정보다 늦으면 사용자 말과 반대로
    반경을 넓힌다(기본 사유 weather 의 암시 LESS_MOVE 는 판정에 안 쓰여 그것만으로는 넓힌다 — 대조군)."""
    collected = threading.Event()
    seen: dict[str, bool] = {}

    class _NearAfterCollect:
        def translate(self, inp, trace_id, now, *, timeout_sec=None):
            seen["overlapped"] = collected.wait(3.0)
            return TypedResult(value=DirectiveTranslation(keys=("NEARBY",), dropped=()),
                               is_fallback=False, error=None, call_record=None)

    app = build_dev_app(directives=_DIRECTIVES, embedding=FakeEmbedding(), vector_store=InMemoryVectorStore())
    orch = app.state.orchestrator
    orch._directive_translator = _NearAfterCollect()
    orch._info = _InfoSpy(orch._info, after=collected.set)

    body = _post(app, anchor=_RING_ANCHOR, free_text="ㅠㅠ 다리 아파")

    assert seen.get("overlapped") is True, seen
    assert "NEARBY" in body["resolved_directives"], body["notes"]
    assert "pool_widen_skipped: near" in body["notes"], body["notes"]
    assert not any(n.startswith("pool_widened") for n in body["notes"]), body["notes"]
    assert any(n.startswith("stage_ms: directives_wait=") for n in body["notes"]), body["notes"]

    # 대조군 — 번역이 아무 것도 못 내면 같은 앵커에서 넓힌다(위 단언이 우연이 아니다)
    class _Nothing:
        def translate(self, *a, **kw):
            return TypedResult(value=None, is_fallback=True, error="stub", call_record=None)

    orch._directive_translator = _Nothing()
    body = _post(app, anchor=_RING_ANCHOR, free_text="ㅠㅠ 다리 아파")
    assert any(n.startswith("pool_widened:") for n in body["notes"]), body["notes"]


# ── ②③ 이름 장소 대조 — 풀 먼저, 50km 조회는 추출 직후 배경으로 ────────────


class _NameLookupDb(StaticPoiDb):
    """반경 50km 조회(이름 대조 전용)만 `release` 까지 막고, 시작·반환을 기록한다. 후보 풀(10·15km)·둘레(5km)는 그대로."""

    def __init__(self, seed, *, block: bool) -> None:
        super().__init__(seed)
        self.block, self.started, self.release, self.returned = block, threading.Event(), threading.Event(), False

    def find_by_radius(self, center, radius_km):
        if radius_km == v.NAME_SEARCH_RADIUS_KM:
            self.started.set()
            if self.block:
                self.release.wait(5.0)
            self.returned = True
        return super().find_by_radius(center, radius_km)


def _named_app(db, name: str):
    app = build_dev_app(directives=_DIRECTIVES, poi_db=db)
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor(ExtractedRequest(places=(ExtractedPlace(name, "visit"),)))
    orch._existence = FakeExistence()
    return app, orch


def test_집은_이름이_후보_풀에_정확히_있으면_50km_조회를_기다리지_않는다() -> None:
    """50km 조회를 막아 둔 채 응답이 나와야 한다 — 직렬이면 대조가 그 조회에서 5s 막혔다가 끝나 `returned` 가 참."""
    db = _NameLookupDb(demo_poi_seed(), block=True)
    app, _ = _named_app(db, _HEUKDWAEJI.name)
    try:
        body = _post(app, free_text=f"{_HEUKDWAEJI.name} 꼭 가고 싶어")
        returned_before_reply = db.returned
    finally:
        db.release.set()

    assert returned_before_reply is False
    assert f"nl_place_accepted: visit {_HEUKDWAEJI.poi_id}" in body["notes"], body["notes"]
    assert "nl_place_lookup: pool" in body["notes"], body["notes"]


def test_풀에_없는_이름은_50km_조회가_장소_수집과_겹쳐_돈다() -> None:
    """장소 수집이 끝날 때 이름 조회가 이미 떠 있어야 한다 — 직렬이면 수집 뒤에야 불러 3s 를 기다리다 False."""
    db = _NameLookupDb(demo_poi_seed(), block=False)
    app, orch = _named_app(db, "월정리 카페거리")  # 앵커 ~28km — 풀(10km) 밖
    seen: dict[str, bool] = {}
    orch._info = _InfoSpy(orch._info, after=lambda: seen.setdefault("overlapped", db.started.wait(3.0)))

    body = _post(app, free_text="월정리 카페거리 꼭 가고 싶어")

    assert seen.get("overlapped") is True, seen
    assert f"nl_place_accepted: visit {_WOLJEONG}" in body["notes"], body["notes"]
    assert "nl_place_lookup: pool" not in body["notes"], body["notes"]


# ── ④ 대조 규칙 ────────────────────────────────────────────────────────


def test_풀_먼저는_정확_일치일_때만이고_부분_일치뿐이면_조회한다() -> None:
    calls: list[int] = []

    def registered():
        calls.append(1)
        return _REG

    said = ExtractedRequest(places=(ExtractedPlace("성심당", "visit"),))
    r = _verify(said, registered=registered, nearby=_REG)
    assert calls == [] and [str(p.poi_id) for p in r.visit] == ["p3"], r.notes
    assert "nl_place_lookup: pool" in r.notes

    # 풀엔 "성심당 본점"(부분)뿐 — 조회해야 더 먼 정확 일치 "성심당"(p3)을 고른다(조회했을 때와 같은 답)
    r = _verify(said, registered=registered, nearby=(_REG[0],))
    assert calls == [1] and [str(p.poi_id) for p in r.visit] == ["p3"], r.notes
    assert "nl_place_lookup: pool" not in r.notes

    # 풀이 비면(받은 풀 없음) 종전대로 조회한다
    _verify(said, registered=registered)
    assert calls == [1, 1]
