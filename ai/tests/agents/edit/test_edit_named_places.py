"""F9 — 편집 번역의 풀 밖 이름 장소 (agents/edit/agent.py `_with_named` · EditTask.named_places).

#1731 은 풀 안·렌더 상한 밖까지만 실었다. 기본 풀(5,000곳 절단·반경) 밖의 이름("효창공원을 경리단길 끝나고")은 번역 후보에도 INV-1
풀에도 없어 게이트가 명령을 버렸다(TRANSLATION_FAILED). 이제 말이 번역기로 갈 때만 이름 장소 콘센트를 한 번 불러, 찾은 등록 POI 를
번역 후보와 **게이트·② validate_command 가 보는 같은 풀**에 합친다.

번역 워커·게이트·명령 검증·재타이밍·추정기는 진짜이고 LLM 은 정해진 답(기록), 어셈블리 검증만 가짜(위반 없음)다.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from trippilot.agents.edit import agent as agent_module
from trippilot.agents.edit.agent import EditAgent, EditTask
from trippilot.agents.edit.commands import EditStatus
from trippilot.api.wiring import _problem_for
from trippilot.assembly_engine.config import AssemblyConfig
from trippilot.assembly_engine.travel import TravelEstimator
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TraceId, TransportMode
from trippilot.domain.edit import EditCommand, EditOp
from trippilot.domain.itinerary.itinerary import DaySolution, ItinerarySolution, SolveMode, VisitSlot
from trippilot.domain.llm.llm import CandidatePool, ModelTier
from trippilot.domain.poi.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.content.edit_translation import EditTranslationGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.content.edit_translation import EditTranslationWorker
from trippilot.ports.llm_port import LlmResponse
from tests.fakes.in_memory_trace import InMemoryTrace

KST = timezone(timedelta(hours=9))
D = date(2026, 10, 21)
_NOW = datetime(2026, 10, 20, 20, 0, tzinfo=KST)  # 여행 전날 저녁
_EST = TravelEstimator(AssemblyConfig())
_PROMPTS = Path(__file__).resolve().parents[3] / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})


def _poi(pid: str, name: str, lat: float, lng: float, cat: PoiCategory = PoiCategory.SIGHT) -> Poi:
    return Poi(PoiId(pid), name, cat, GeoPoint(lat, lng), (), None, None, DataQuality.FULL, PoiSource.SEED, None)


GYEONGNI = _poi("s0", "경리단길", 37.5385, 126.9888)
YEONNAM = _poi("s1", "연남동", 37.5600, 126.9230)
BASE = _poi("n0", "망원한강공원", 37.5552, 126.8950, PoiCategory.NATURE)  # 받은 기본 풀의 유일한 후보
FAR = _poi("x1", "효창공원", 37.5446, 126.9616, PoiCategory.NATURE)  # 기본 풀 밖 — 이름 조회로만 온다


class _Facade:
    def validate(self, solution, problem, deadline_ms, trace_id=None):
        return ()


class _Provider:
    def for_pool(self, poi_index):
        return _Facade()


class _RecordingLlm:
    """정해진 답 — 받은 프롬프트·시한을 적는다(번역 후보에 무엇이 실렸는지, 시한이 얼마였는지 본다)."""

    def __init__(self, canned: str) -> None:
        self.canned, self.requests = canned, []

    def invoke(self, request):
        self.requests.append(request)
        return LlmResponse(raw_text=self.canned, input_tokens=1, output_tokens=1, latency_ms=0, model_id=request.model_id)


class _Socket:
    """이름 장소 콘센트 — 받은 말을 적고 정해진 곳을 돌려준다(또는 터진다)."""

    def __init__(self, found: tuple[Poi, ...] = (), error: Exception | None = None) -> None:
        self.found, self.error, self.calls = found, error, []

    def __call__(self, words, spans):
        self.calls.append((words, spans))
        if self.error is not None:
            raise self.error
        return self.found


def _add(target: str, **anchors: str) -> str:
    return json.dumps({"editCommand": {"op": "ADD_SLOT", "params": {"targetPoiId": target, **anchors}, "affectedSlots": []}})


def _solution() -> ItinerarySolution:
    def slot(p: Poi, h: int, m: int, stay: int) -> VisitSlot:
        start = datetime.combine(D, time(h, m), tzinfo=KST)
        return VisitSlot(p.poi_id, start, start + timedelta(minutes=stay), stay, 0.5, True)

    day = DaySolution(D, (slot(GYEONGNI, 11, 0, 90), slot(YEONNAM, 15, 0, 90)), ())
    return ItinerarySolution(ScheduleId("s-named"), (day,), False, SolveMode.OR_TOOLS, None)


def _run(utterance: str | None, socket: _Socket | None, *, canned: str = _add("x1"), deadline_ms: int = 20_000,
         command: EditCommand | None = None, excluded: frozenset = frozenset()):
    llm = _RecordingLlm(canned)
    worker = EditTranslationWorker(GatewayFacade(llm, PromptRegistry(_PROMPTS), EditTranslationGate(), _CFG, InMemoryTrace()))
    agent = EditAgent(worker, _Provider(), _EST, lambda s: _problem_for(s, KST), tz=KST)
    pool = CandidatePool(poi_ids=frozenset({BASE.poi_id}), pois=(BASE,), generated_at=_NOW)
    out = agent.run(EditTask(
        solution=_solution(), target_date=D, pool=pool, poi_index={p.poi_id: p for p in (GYEONGNI, YEONNAM)},
        transport=TransportMode.PUBLIC, trace_id=TraceId("t-named"), now=_NOW, deadline_ms=deadline_ms,
        utterance=utterance, command=command, confirm=True, named_places=socket, excluded=excluded))
    return out, llm


def _ids(out) -> list[str]:
    return [str(s.poi_id) for d in out.solution.days for s in d.slots]


def _candidates(llm: _RecordingLlm) -> list[str]:
    """번역 프롬프트의 [교체·추가 가능 후보] 줄들."""
    prompt = llm.requests[0].prompt
    return prompt.rsplit("[교체·추가 가능 후보]", 1)[1].split("[출력 JSON 스키마]", 1)[0].strip().splitlines()[1:]


# ── 풀 밖 이름 장소 — 번역 후보와 INV-1 풀에 합친다 ─────────────────────────


def test_named_place_outside_the_pool_is_translated_and_applied_in_place() -> None:
    socket = _Socket((FAR,))
    out, llm = _run("효창공원을 경리단길 끝나고 넣어줘", socket)
    assert out.status is EditStatus.APPLIED, out.reason
    assert _ids(out) == ["s0", "x1", "s1"]  # 번역이 "무엇", 코드가 "어디"(기준점 채우기) — 종전 규칙 그대로
    assert "- x1 | NATURE | 효창공원" in _candidates(llm)  # 번역 후보에 실렸다
    (words, _), = socket.calls
    assert "효창공원" in words and "경리단길" not in words  # 지금 슬롯 이름은 말이 아니다
    assert out.pois[FAR.poi_id] == FAR  # ⑤ 검증·응답 거리가 같은 좌표를 본다


def test_a_place_excluded_by_a_reask_is_not_brought_back_by_its_name() -> None:
    """"다른 데는?"(spec 003 FR-015)으로 뺀 곳은 말이 이름으로 집어도 다시 들이지 않는다 — BE 가 원 요청을 그대로 다시 태우므로, 이름
    조회가 그 곳을 풀에 되돌리면 같은 곳이 또 나왔다. 게이트가 떨궈 정직한 실패다(BE 가 "넣을 만한 다른 곳을 찾지 못했어요")."""
    out, llm = _run("효창공원을 경리단길 끝나고 넣어줘", _Socket((FAR,)), excluded=frozenset({FAR.poi_id}))
    assert out.status is EditStatus.TRANSLATION_FAILED, out.status
    assert not any("효창공원" in line for line in _candidates(llm))


def test_without_the_socket_the_same_utterance_still_fails_the_closed_set() -> None:
    """미배선(장소 DB 없음)이면 종전 그대로 — 게이트가 풀 밖 id 를 버린다(INV-1, 정직한 실패)."""
    out, llm = _run("효창공원을 경리단길 끝나고 넣어줘", None)
    assert out.status is EditStatus.TRANSLATION_FAILED and "closed_set_violation" in (out.reason or "")
    assert _candidates(llm) == ["- n0 | NATURE | 망원한강공원"]


def test_socket_failure_translates_with_the_received_pool(caplog) -> None:
    caplog.set_level(logging.INFO)
    out, _ = _run("효창공원을 경리단길 끝나고 넣어줘", _Socket(error=RuntimeError("db down")))
    assert out.status is EditStatus.TRANSLATION_FAILED and "closed_set_violation" in (out.reason or "")
    (line,) = [r.getMessage() for r in caplog.records if r.getMessage().startswith("edit_named ")]
    assert json.loads(line.removeprefix("edit_named "))["error"] == "RuntimeError"


def test_inside_pool_named_place_is_rendered_but_not_added_twice() -> None:
    socket = _Socket((BASE,))
    out, llm = _run("망원한강공원 넣어줘", socket, canned=_add("n0"))
    assert out.status is EditStatus.APPLIED and _ids(out) == ["s0", "s1", "n0"]
    assert _candidates(llm) == ["- n0 | NATURE | 망원한강공원"]  # 이미 풀 안 — 한 번만


# ── 콘센트를 부르지 않는 길 ───────────────────────────────────────────────


def test_structured_command_never_calls_the_socket_and_stays_closed() -> None:
    """버튼(구조화) 진입은 말이 없다 — 풀 밖 id 는 종전처럼 closed-set 거절(INV-1)."""
    socket = _Socket((FAR,))
    out, _ = _run(None, socket, command=EditCommand(EditOp.ADD_SLOT, {"targetPoiId": "x1"}, ()))
    assert out.status is EditStatus.REJECTED and "closed-set" in (out.reason or "")
    assert socket.calls == []


def test_insert_between_path_does_not_call_the_socket() -> None:
    """①a 사이 넣기가 자리를 풀면 번역기로 가지 않는다 — 이름 조회도 없다(LLM·DB 0)."""
    socket = _Socket((FAR,))
    out, llm = _run("경리단길이랑 연남동 사이에 카페 하나 넣어줘", socket)
    assert out.status is EditStatus.REJECTED and "insert_between" in (out.reason or "")
    assert socket.calls == [] and llm.requests == []


def test_short_budget_skips_the_lookup() -> None:
    socket = _Socket((FAR,))
    out, _ = _run("효창공원을 경리단길 끝나고 넣어줘", socket, deadline_ms=1_500)
    assert socket.calls == [] and out.status is EditStatus.TRANSLATION_FAILED


def test_lookup_time_comes_out_of_the_translation_timeout(monkeypatch) -> None:
    ticks = iter([100.0, 100.4])  # 조회 전·후 — 400ms (에이전트 모듈의 시계만 바꾼다)
    monkeypatch.setattr(agent_module, "time", SimpleNamespace(monotonic=lambda: next(ticks)))
    out, llm = _run("효창공원을 경리단길 끝나고 넣어줘", _Socket((FAR,)), deadline_ms=6_000)
    assert out.status is EditStatus.APPLIED
    assert llm.requests[0].timeout_sec == 5.6  # 6.0s − 0.4s — 둘의 합이 시한을 넘지 않는다


def test_without_lookup_the_translation_timeout_is_unchanged() -> None:
    _, llm = _run("효창공원을 경리단길 끝나고 넣어줘", None, deadline_ms=6_000)
    assert llm.requests[0].timeout_sec == 6.0


# ── 무엇을 합치나 ─────────────────────────────────────────────────────────


def test_current_slots_are_never_named_and_the_count_is_capped(caplog) -> None:
    caplog.set_level(logging.INFO)
    many = tuple(_poi(f"m{i}", f"후보{i}", 37.55, 126.95) for i in range(7))
    socket = _Socket((GYEONGNI, *many))
    out, llm = _run("효창공원을 경리단길 끝나고 넣어줘", socket, canned=_add("m0"))
    assert out.status is EditStatus.APPLIED
    candidates = _candidates(llm)
    assert not any(line.startswith("- s0 |") for line in candidates)  # 지금 슬롯은 후보가 아니다
    assert sum(line.startswith("- m") for line in candidates) == agent_module._NAMED_MAX  # 상한 5
    (line,) = [r.getMessage() for r in caplog.records if r.getMessage().startswith("edit_named ")]
    logged = json.loads(line.removeprefix("edit_named "))
    assert (logged["found"], logged["named"], logged["added"]) == (8, 5, 5)
    assert "효창공원" not in line and "후보" not in line  # 말·이름은 로그에 싣지 않는다
