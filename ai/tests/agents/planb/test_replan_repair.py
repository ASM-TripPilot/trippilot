"""다시 짜기 1회 수리 — 솔버가 뺀 곳을 까닭과 함께 구성 LLM 에 **한 번** 되묻는다 (2026-10-18 사용자 승인).

증명하는 것 (실 LLM 0 — 대본 LLM):
  ① 빠진 까닭과 빈 시간이 2차 프롬프트에 실리고, 후보는 빈 틈에 그대로 드는 곳뿐이다(1차에 고른 곳 제외)
  ② 2차가 실패·시한 부족이면 1차 해 그대로 — 노트로 밝힌다(INV-4)
  ③ 이름으로 집은 곳만 빠지면 되묻지 않는다(다른 곳을 골라도 그 요청은 안 채워진다)
  ④ 2차 해가 1차보다 못하면(놓인 곳을 잃으면) 1차를 낸다 — 엄격한 채택
  ⑤ 1차 프롬프트는 0.5.0 과 같은 글이다(수리할 것이 없으면 `$repair` 는 빈 문자열)
"""

from __future__ import annotations

import json
from dataclasses import replace

from trippilot.api.wiring import DEMO_ANCHOR, StaticPoiDb, build_dev_app, demo_poi_seed
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.gates.replan_request_extraction import ExtractedPlace, ExtractedRequest
from trippilot.ports.llm_port import LlmRequest, LlmResponse

from tests.agents.planb.test_replan_composition import _DIRECTIVES, _body, _post
from tests.agents.planb.test_replan_nl_request import _StubExtractor
from tests.fakes.fake_existence import FakeExistence

_MON = 0  # 2026-09-21 은 월요일


def _poi(pid: str, name: str, dlat: float, cat: PoiCategory, hours=None) -> Poi:
    return Poi(poi_id=PoiId(pid), name=name, category=cat,
               coord=GeoPoint(DEMO_ANCHOR.lat + dlat, DEMO_ANCHOR.lng), open_hours=hours or (),
               avg_cost=None, rating=None, quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None)


_A = _poi("rA", "종일미술관", 0.004, PoiCategory.CULTURE, (OpenHour(_MON, 9 * 60, 20 * 60),))
_B = _poi("rB", "아침시장", 0.006, PoiCategory.SHOPPING, (OpenHour(_MON, 7 * 60, 12 * 60),))  # 13시 뒤엔 못 간다
_C = _poi("rC", "골목카페", 0.005, PoiCategory.CAFE, (OpenHour(_MON, 10 * 60, 20 * 60),))
_POIS = (*demo_poi_seed(), _A, _B, _C)


class _RepairLlm:
    """구성 프롬프트에 차례로 대본을 답한다(1차 → 2차). 다른 기능은 파싱 실패(폴백)."""

    def __init__(self, *rounds: list[str] | None) -> None:
        self.rounds, self.prompts = list(rounds), []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        text = "not json"
        if request.prompt_ref.feature == "REPLAN_COMPOSITION":
            self.prompts.append(request.prompt)
            picks = self.rounds[len(self.prompts) - 1] if len(self.prompts) <= len(self.rounds) else None
            if picks is not None:
                text = json.dumps({"selections": [{"poiId": p, "reason": "분위기가 좋은 곳"} for p in picks]})
        return LlmResponse(raw_text=text, input_tokens=1, output_tokens=1, latency_ms=0,
                           model_id=request.model_id)


def _app(llm, extracted: ExtractedRequest | None = None):
    app = build_dev_app(llm=llm, model_id="m", directives=_DIRECTIVES, poi_db=StaticPoiDb(_POIS))
    orch = app.state.orchestrator
    if extracted is not None:
        orch._request_extractor = _StubExtractor(extracted)
        orch._existence = FakeExistence()
    return app, orch


def _run(llm, **over):
    app, orch = _app(llm, over.pop("extracted", None))
    for name, wrap in over.pop("wraps", {}).items():
        setattr(orch, name, wrap(getattr(orch, name)))
    body = _post(app, from_instant="2026-09-21T13:00:00+09:00", **over)
    return body, orch


def _placed(body) -> set[str]:
    return {s["poi_id"] for d in body["itinerary"]["days"] for s in d["slots"]}


def test_빠진_까닭과_빈_시간을_실어_한_번_되묻고_대신할_곳을_넣는다() -> None:
    llm = _RepairLlm(["rA", "rB"], ["rC"])
    body, _ = _run(llm)

    assert len(llm.prompts) == 2, body["notes"]
    second = llm.prompts[1]
    assert "[못 넣은 곳]" in second and "아침시장" in second and "[빈 시간]" in second
    candidates = second.split("[후보 목록]", 1)[1]
    assert "rA" not in candidates and "rB" not in candidates  # 1차에 고른 곳·뺀 곳은 후보가 아니다
    assert _placed(body) == {"rA", "rC"}, body["notes"]
    assert "llm_composed_why: rB=hours" in body["notes"], body["notes"]
    assert any(n.startswith("llm_repair: picked=1/1") for n in body["notes"]), body["notes"]
    assert any(n.endswith("kept=second") for n in body["notes"]), body["notes"]
    assert not any(s["is_fixed"] for d in body["itinerary"]["days"] for s in d["slots"])


def test_수리_LLM이_실패하면_1차_일정_그대로다() -> None:
    llm = _RepairLlm(["rA", "rB"], None)
    body, _ = _run(llm)
    assert len(llm.prompts) == 2
    assert _placed(body) == {"rA"}, body["notes"]
    assert any(n.startswith("llm_repair_fallback") for n in body["notes"]), body["notes"]


class _JumpClock:
    """첫 구성 호출 뒤 시계를 크게 민다 — 1차가 시한을 다 쓴 날."""

    def __init__(self, inner) -> None:
        self.inner, self.offset = inner, 0

    def monotonic_ms(self) -> int:
        return self.inner.monotonic_ms() + self.offset


def test_시한이_모자라면_되묻지_않는다() -> None:
    llm = _RepairLlm(["rA", "rB"], ["rC"])
    app, orch = _app(llm)
    clock = _JumpClock(orch._clock)
    orch._clock = clock
    composer = orch._composer

    class _Slow:
        def compose(self, *a, **kw):
            out = composer.compose(*a, **kw)
            clock.offset += 16_000  # 25s 시한에서 1차가 16초를 쓴 날 — 구성 바닥(5s) + 어셈블리 바닥(5s) 이 안 남는다
            return out

    orch._composer = _Slow()
    body = _post(app, from_instant="2026-09-21T13:00:00+09:00")
    assert len(llm.prompts) == 1, body["notes"]
    assert any(n.startswith("llm_repair_skipped: deadline") for n in body["notes"]), body["notes"]
    assert _placed(body) == {"rA"}


def test_이름으로_집은_곳만_빠지면_되묻지_않는다() -> None:
    llm = _RepairLlm(["rA", "rB"], ["rC"])
    body, _ = _run(llm, extracted=ExtractedRequest(places=(ExtractedPlace("아침시장", "visit"),)),
                   free_text="아침시장 꼭")
    assert len(llm.prompts) == 1, body["notes"]
    assert "llm_repair_skipped: not_actionable" in body["notes"], body["notes"]
    assert "nl_place_unplaced: rB" in body["notes"]  # 빠진 사실은 그대로 밝힌다


class _LoseOnSecond:
    """2차 풀이가 1차에 놓인 곳을 잃는 날 — 채택하면 사용자가 보던 곳이 사라진다."""

    def __init__(self, inner) -> None:
        self.inner, self.calls = inner, 0

    def run(self, task):
        self.calls += 1
        out = self.inner.run(task)
        if self.calls == 2 and out.solution is not None:
            out = replace(out, solution=replace(out.solution, days=tuple(
                replace(d, slots=tuple(s for s in d.slots if str(s.poi_id) != "rA"))
                for d in out.solution.days)))
        return out


def test_2차_해가_1차에_놓인_곳을_잃으면_1차를_낸다() -> None:
    llm = _RepairLlm(["rA", "rB"], ["rC"])
    body, orch = _run(llm, wraps={"_schedule_agent": _LoseOnSecond})
    assert orch._schedule_agent.calls == 2
    assert _placed(body) == {"rA"}, body["notes"]
    assert any(n.endswith("kept=first rejected=lost") for n in body["notes"]), body["notes"]


def test_수리할_것이_없으면_1차_프롬프트는_0_5_0_과_같다(monkeypatch) -> None:
    """`$repair` 는 1차에서 빈 문자열이다 — 같은 변수를 0.5.0 판 템플릿에 넣어 그린 글과 바이트까지 같아야 한다."""
    import pathlib
    import string
    import subprocess

    import pytest
    import yaml

    from trippilot.llm_gateway.workers import replan_composition as worker

    root = pathlib.Path(__file__).resolve().parents[3]
    old = subprocess.run(["git", "-C", str(root), "show", "origin/develop:ai/prompts/replan_composition.yaml"],
                         capture_output=True, text=True)
    if old.returncode != 0 or 'version: "0.5.0"' not in old.stdout:
        pytest.skip("비교할 0.5.0 판이 origin/develop 에 없다")
    seen: list[dict[str, str]] = []
    real = worker.build_compose_vars
    monkeypatch.setattr(worker, "build_compose_vars", lambda pool, inp: seen.append(real(pool, inp)) or seen[-1])
    llm = _RepairLlm(["rA"])
    _run(llm)
    assert len(llm.prompts) == 1 and len(seen) == 1
    assert seen[0]["repair"] == ""
    old_t = yaml.safe_load(old.stdout)["template"]
    assert llm.prompts[0] == string.Template(old_t).substitute({k: v for k, v in seen[0].items() if k != "repair"})
