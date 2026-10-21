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
import re
from dataclasses import replace

from trippilot.agents.planb.composition import REPAIR_LABELS
from trippilot.api.wiring import DEMO_ANCHOR, StaticPoiDb, build_dev_app, demo_poi_seed
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.itinerary import SolveMode
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.gates.replan_request_extraction import ExtractedPlace, ExtractedRequest
from trippilot.ports.llm_port import LlmRequest, LlmResponse

from tests.agents.planb.test_replan_composition import _DIRECTIVES, _body, _post
from tests.agents.planb.test_replan_nl_request import _StubExtractor
from tests.fakes.fake_existence import FakeExistence
from tests.fakes.in_memory_trace import InMemoryTrace
from trippilot.ports.place_existence_port import ExistenceStatus

_MON = 0  # 2026-09-21 은 월요일


def _poi(pid: str, name: str, dlat: float, cat: PoiCategory, hours=None) -> Poi:
    return Poi(poi_id=PoiId(pid), name=name, category=cat,
               coord=GeoPoint(DEMO_ANCHOR.lat + dlat, DEMO_ANCHOR.lng), open_hours=hours or (),
               avg_cost=None, rating=None, quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None)


_A = _poi("rA", "종일미술관", 0.004, PoiCategory.CULTURE, (OpenHour(_MON, 9 * 60, 20 * 60),))
_B = _poi("rB", "아침시장", 0.006, PoiCategory.SHOPPING, (OpenHour(_MON, 7 * 60, 12 * 60),))  # 13시 뒤엔 못 간다
_C = _poi("rC", "골목카페", 0.005, PoiCategory.CAFE, (OpenHour(_MON, 10 * 60, 20 * 60),))
_D = _poi("rD", "저녁식당", 0.003, PoiCategory.FOOD, (OpenHour(_MON, 9 * 60, 21 * 60),))
_E = _poi("rE", "골목서점", 0.0045, PoiCategory.SHOPPING, (OpenHour(_MON, 10 * 60, 20 * 60),))
_POIS = (*demo_poi_seed(), _A, _B, _C, _D, _E)


def _offered(prompt: str) -> set[str]:
    """후보 줄(번호 | 카테고리 | 상호명 | …)의 상호명 → poi_id. 0.7.0 부터 후보 줄에 UUID 가 없다(번호화)."""
    names = {p.name: str(p.poi_id) for p in _POIS}
    section = prompt.split("[후보 목록]", 1)[1].split("[출력 JSON 스키마]", 1)[0]
    cells = (line.split("|") for line in section.splitlines())
    return {names[c[2].strip()] for c in cells if len(c) >= 3 and c[2].strip() in names}


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


def _app(llm, extracted: ExtractedRequest | None = None, **ports):
    app = build_dev_app(llm=llm, model_id="m", directives=_DIRECTIVES, poi_db=StaticPoiDb(_POIS), **ports)
    orch = app.state.orchestrator
    if extracted is not None:
        orch._request_extractor = _StubExtractor(extracted)
        orch._existence = FakeExistence()
    return app, orch


def _run(llm, **over):
    app, orch = _app(llm, over.pop("extracted", None), **over.pop("ports", {}))
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
    assert f"아침시장 | {PoiCategory.SHOPPING.value} | {REPAIR_LABELS['hours']}" in second  # 까닭 문구
    assert re.search(r"\d\d:\d\d~21:00", second.split("[빈 시간]", 1)[1])  # 틈 경계 = 어셈블리 값
    candidates = _offered(second)
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


# 0.5.0 판 `template` 의 sha256 — 0.6.0 템플릿에서 `$repair` 를 지운 글이 이것과 같아야 한다(2026-10-19 고정).
# git 에서 읽으면 CI(얕은 체크아웃)·머지 뒤(develop 이 0.6.0)에 늘 건너뛴다(리뷰 10-19).
# 0.7.0(후보 번호화, 2026-10-21) 렌더 — 1차는 `$repair` 만 빈다. 0.5.0 은 6615c838…
_TEMPLATE_0_7_0_SHA256 = "c148f03bbaf7c0286003c0ce5e34111d3d858df96f4fc120d2bc060c36fb65af"


def test_수리할_것이_없으면_1차_프롬프트는_0_7_0_과_같다(monkeypatch) -> None:
    """`$repair` 는 1차에서 빈 문자열이다 — 템플릿의 나머지가 0.7.0 과 바이트까지 같고, 워커가 실제로 빈 값을 준다."""
    import hashlib
    import pathlib

    import yaml

    from trippilot.llm_gateway.workers import replan_composition as worker

    root = pathlib.Path(__file__).resolve().parents[3]
    template = yaml.safe_load((root / "prompts" / "replan_composition.yaml").read_text(encoding="utf-8"))["template"]
    assert hashlib.sha256(template.replace("$repair", "").encode()).hexdigest() == _TEMPLATE_0_7_0_SHA256
    seen: list[dict[str, str]] = []
    real = worker.build_compose_vars
    monkeypatch.setattr(worker, "build_compose_vars", lambda pool, inp: seen.append(real(pool, inp)) or seen[-1])
    llm = _RepairLlm(["rA"])
    _run(llm)
    assert len(llm.prompts) == 1 and len(seen) == 1
    assert seen[0]["repair"] == ""
    assert "[못 넣은 곳]" not in llm.prompts[0] and "[빈 시간]" not in llm.prompts[0]


# ── 리뷰(2026-10-19) 확정 지적의 회귀 ────────────────────────────────────


def test_되실릴_잠금이_있는_날은_되묻지_않는다() -> None:
    """마감을 넘는 잠금은 솔버 밖에서 원 시각 그대로 되실리고, 사영이 그와 겹치는 새 방문을 뺀다 — 솔버 해로 잰
    빈 틈·채택 판정이 사용자가 보는 일정과 달라져, 2차를 채택했는데 1차에 놓인 곳이 사라졌다(재현)."""
    llm = _RepairLlm(["rA", "rB"], ["rC"])
    body, _ = _run(llm, locked_blocks=[{"poi_id": "rD", "date": "2026-09-21", "start": "17:30",
                                        "dwell_min": 240}])
    assert len(llm.prompts) == 1, body["notes"]
    assert "llm_repair_skipped: echoed_locks" in body["notes"], body["notes"]
    assert any(n.startswith("locked_block_echoed:") for n in body["notes"])


def test_2차를_채택해도_1차의_풀이_전_강등이_남고_지도_확인은_한_번이다() -> None:
    """2차는 ⓪·②′·②⁗ 를 다시 안 산다 — 1차가 남긴 강등을 잇지 않으면 2차 해를 채택한 응답에서 그 사실이
    사라진다(INV-4). 지도 확인을 다시 하면 같은 질의를 잔여 ≈0 에서 또 보낸다(리뷰 재현: 호출 2회)."""
    existence = FakeExistence(default=ExistenceStatus.UNVERIFIED)
    llm = _RepairLlm(["rA", "rB"], ["rC"])
    body, _ = _run(llm, ports={"existence": existence})
    assert any(n.endswith("kept=second") for n in body["notes"]), body["notes"]
    assert sum(n.startswith("existence_unverified") for n in body["notes"]) == 1, body["notes"]
    assert existence.call_count == 1


class _DowngradeOnSecond:
    """2차 풀이가 규칙 해로 내려간 날 — 더 놓았어도 OR 해를 규칙 해로 바꾸지 않는다."""

    def __init__(self, inner) -> None:
        self.inner, self.calls = inner, 0

    def run(self, task):
        self.calls += 1
        out = self.inner.run(task)
        if self.calls == 2 and out.solution is not None:
            out = replace(out, solution=replace(out.solution, is_fallback=True,
                                                solve_mode=SolveMode.RULE_FALLBACK))
        return out


def test_2차_해가_규칙_해로_낮아지면_1차를_낸다() -> None:
    llm = _RepairLlm(["rA", "rB"], ["rC"])
    body, orch = _run(llm, wraps={"_schedule_agent": _DowngradeOnSecond})
    assert orch._schedule_agent.calls == 2
    assert _placed(body) == {"rA"}, body["notes"]
    assert any(n.endswith("kept=first rejected=downgrade") for n in body["notes"]), body["notes"]


def test_2차_구성_뒤에_어셈블리_바닥이_안_남으면_다시_풀지_않는다() -> None:
    """2차 구성이 시한을 먹은 날 — 다시 풀면 백스톱 504 다. 1차 그대로 + 노트 + 폴백 이벤트."""
    trace = InMemoryTrace()
    llm = _RepairLlm(["rA", "rB"], ["rC"])
    app, orch = _app(llm, trace=trace)
    clock = _JumpClock(orch._clock)
    orch._clock = clock
    composer, timeouts = orch._composer, []

    class _SlowSecond:
        def compose(self, *a, **kw):
            out = composer.compose(*a, **kw)
            timeouts.append(kw["timeout_sec"])
            if len(timeouts) == 2:
                clock.offset += 30_000  # 2차가 시한을 다 썼다
            return out

    orch._composer = _SlowSecond()
    runs = _LoseOnSecond(orch._schedule_agent)  # 호출 수만 센다(2차까지 안 가야 한다)
    orch._schedule_agent = runs
    body = _post(app, from_instant="2026-09-21T13:00:00+09:00")
    assert len(llm.prompts) == 2 and runs.calls == 1, body["notes"]
    assert any(n.startswith("llm_repair_skipped: deadline_after_compose") for n in body["notes"]), body["notes"]
    assert _placed(body) == {"rA"}
    assert timeouts[1] <= 18.0  # 2차 구성도 상한(`_COMPOSE_MAX_MS`) 안에서 부른다
    assert any(isinstance(e, FallbackEvent) and e.from_mode == "llm_compose_repair"
               and "deadline_after_compose" in e.reason for e in trace.events)


def test_수리_LLM이_실패하면_수리_폴백_이벤트가_남는다() -> None:
    trace = InMemoryTrace()
    llm = _RepairLlm(["rA", "rB"], None)
    app, _ = _app(llm, trace=trace)
    body = _post(app, from_instant="2026-09-21T13:00:00+09:00")
    assert any(n.startswith("llm_repair_fallback") for n in body["notes"]), body["notes"]
    modes = {(e.from_mode, e.to_mode) for e in trace.events if isinstance(e, FallbackEvent)}
    assert ("llm_compose_repair", "llm_compose_day") in modes, modes


def test_사용자가_바꿔_뺀_곳은_2차_후보가_아니다() -> None:
    """바꿔 뺀 곳(거절 이력 SWAPPED_OUT)은 풀에 남는다(점수 강등 경로) — 1차 구성이 후보에서 뺀 것을 2차도 뺀다."""
    llm = _RepairLlm(["rA", "rB"], ["rE"])
    body, _ = _run(llm, rejections=[{"poi_id": "rC", "kind": "SWAPPED_OUT"}])
    assert len(llm.prompts) == 2, body["notes"]
    candidates = _offered(llm.prompts[1])
    assert "rC" not in candidates and "rE" in candidates


class _FitsOnly:
    """솔버가 틈이 있는데도 멈춘 날(`fits`) — 다른 곳을 골라도 안 낫다."""

    def __init__(self, inner) -> None:
        self.inner = inner

    def run(self, task):
        out = self.inner.run(task)
        if out.repair_hints is not None:
            out = replace(out, repair_hints=replace(
                out.repair_hints, why={p: "fits" for p in out.repair_hints.why}))
        return out


def test_까닭이_fits_뿐이면_되묻지_않는다() -> None:
    llm = _RepairLlm(["rA", "rB"], ["rC"])
    body, _ = _run(llm, wraps={"_schedule_agent": _FitsOnly})
    assert len(llm.prompts) == 1, body["notes"]
    assert "llm_repair_skipped: not_actionable" in body["notes"], body["notes"]
