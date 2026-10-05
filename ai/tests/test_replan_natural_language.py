"""자연어 재계획 — 알아들은 말이 일정에 닿는다 (2026-10-05 로컬 실측).

실측(실제 일정 2일 × 문장 20개, 로컬 스택·실 LLM)에서 해석은 대체로 맞았는데 일정이 안 바뀌었다:
  ① 지시 가점(`directive_fit`)이 **규칙 점수에만** 붙었다 — 평소 경로인 LLM 취향 점수에는
     0 이라 "쇼핑하고 싶어"를 SHOPPING_FOCUS 로 정확히 알아듣고도 쇼핑이 안 들어왔다.
  ② "가까운 데로"·"이동 줄여줘"(RANKING)는 인식만 되고 효과도 노트도 없었다.
  ③ "카페는 이제 그만" 이 ADD_CAFE 로 잡혀 카페가 **늘었다** — 임베딩은 부정을 못 읽는다.
  ④ "아이랑 갈 만한 곳"·"사진 찍기 좋은 곳" 처럼 사전 밖 말은 흔적 없이 버려졌다.

증명하는 것 (실 LLM·실 API 0):
  ① LLM 점수 경로에서도 선호 지시가 배치를 바꾼다
  ② "가까운 데로" 는 거리 감점으로 먼 후보를 내린다 · 숙소 근처 마무리는 무효를 밝힌다
  ③ 부정문은 임베딩을 건너뛰고, 임베딩이 놓친 말과 함께 번역 LLM(A-3)이 받는다
  ④ 못 알아들은 문장은 노트로 남고, 원문은 PlanB 선택 프롬프트로 간다(한 줄로 눌러서)
"""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

from fastapi.testclient import TestClient

from trippilot.agents.planb.rag import PlanBRagRequest
from trippilot.agents.schedule.agent import apply_directives
from trippilot.api.wiring import build_dev_app
from trippilot.assembly_engine.scorer import DIRECTIVE_STEP, near_fit
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import PoiCategory
from trippilot.llm_gateway.gates.replan_directive_translation import DirectiveTranslation
from trippilot.llm_gateway.workers.alternative_selection import (
    AlternativeSelectionInput,
    build_alternative_selection_vars,
)

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from tests.test_api_replan_wired import _DIRECTIVES, _body
from tests.test_replan_via_planb import _agent, _case, _placed, _task


# ── ① LLM 점수에도 지시가 붙는다 ─────────────────────────────────────────


def _cafe_case():
    """p1..p6 LLM 점수 동률 — 가까운 p1·p2 가 배치되는 판에서 먼 p5·p6 를 카페로 바꾼다."""
    pool, req = _case()
    pois = tuple(replace(p, category=PoiCategory.CAFE) if str(p.poi_id) in {"p5", "p6"} else p
                 for p in pool.pois)
    return replace(pool, pois=pois), req


def test_LLM_점수_경로에서도_선호_지시가_배치를_바꾼다() -> None:
    pool, req = _cafe_case()
    agent, _ = _agent()

    base = agent.run(_task(pool, request=req))
    after = agent.run(_task(pool, request=replace(
        req, prefer_categories=frozenset({PoiCategory.CAFE}))))

    assert not {"p5", "p6"} & set(_placed(base)), _placed(base)  # 전제: 지시 없이는 안 온다
    assert {"p5", "p6"} & set(_placed(after)), f"카페 선호가 LLM 점수에 안 닿았다: {_placed(after)}"


def test_규칙_점수에는_두_번_더하지_않는다() -> None:
    """규칙 점수는 `build_rule_score` 안에서 이미 지시를 더했다 — 여기서 또 더하면 두 배다."""
    poi = replace(_case()[0].pois[0], category=PoiCategory.CAFE)
    rule = ScoredPoi(poi_id=poi.poi_id, score=1.0, is_llm_score=False)
    llm = ScoredPoi(poi_id=poi.poi_id, score=1.0, is_llm_score=True)
    index = {poi.poi_id: poi}

    [r] = apply_directives((rule,), index, prefer=frozenset({PoiCategory.CAFE}))
    [l] = apply_directives((llm,), index, prefer=frozenset({PoiCategory.CAFE}))

    assert r.score == 1.0
    assert l.score == 1.0 + DIRECTIVE_STEP


# ── ② 가까운 데로 ─────────────────────────────────────────────────────


def test_가까운_데로는_먼_후보를_더_내린다() -> None:
    assert near_fit(0.0) == 0.0
    assert near_fit(2.0) > near_fit(6.0) >= -DIRECTIVE_STEP   # 멀수록 더 깎고 한 단에서 멈춘다
    assert near_fit(50.0) == -DIRECTIVE_STEP

    pool, _ = _case()
    near, far = pool.pois[0], pool.pois[-1]
    anchor = near.coord
    scored = tuple(ScoredPoi(poi_id=p.poi_id, score=1.0, is_llm_score=False) for p in (near, far))
    out = apply_directives(scored, {p.poi_id: p for p in pool.pois}, near_anchor=anchor)
    assert out[0].score > out[1].score


def _replan(**over):
    app = build_dev_app(directives=_DIRECTIVES, embedding=FakeEmbedding(),
                        vector_store=InMemoryVectorStore())
    orchestrator = app.state.orchestrator
    real_agent, real_rag = orchestrator._schedule_agent, orchestrator._rag
    seen: dict[str, list] = {"agent": [], "rag": []}

    class _Spy:
        def run(self, task):
            seen["agent"].append(task.request)
            return real_agent.run(task)

    class _RagSpy:
        def run(self, request):
            seen["rag"].append(request)
            return real_rag.run(request)

    object.__setattr__(orchestrator, "_schedule_agent", _Spy())
    object.__setattr__(orchestrator, "_rag", _RagSpy())
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/planb/replan", json=_body(**over))
    assert response.status_code == 200, response.text
    return response.json(), seen


def test_가까운_데로_칩이_에이전트_요청에_실린다() -> None:
    body, seen = _replan(directives=["NEARBY"])

    assert seen["agent"][0].prefer_near is True
    assert not any("NEARBY" in n for n in body["notes"] if "unwired" in n)


def test_숙소_근처_마무리는_무효를_밝힌다() -> None:
    """RANKING 셋 중 END_NEAR_STAY 는 아직 집행 자리가 없다 — 인식만 하고 조용하면 거짓이다."""
    body, seen = _replan(directives=["END_NEAR_STAY"])

    assert seen["agent"][0].prefer_near is False
    assert any("directives_unwired" in n and "END_NEAR_STAY" in n for n in body["notes"])


# ── ③ 부정 ────────────────────────────────────────────────────────────


def test_부정문은_임베딩을_건너뛰고_반대로_잡지_않는다() -> None:
    """"카페는 이제 그만" 이 ADD_CAFE 로 잡혀 카페가 늘었다 — 부정문은 임베딩에 안 넣는다."""
    body, _ = _replan(free_text="카페는 이제 그만 가고 싶어")

    assert any(n.startswith("free_text_negation") for n in body["notes"]), body["notes"]
    assert "ADD_CAFE" not in body["resolved_directives"]


class _StubTranslator:
    def __init__(self, keys=(), fail=False) -> None:
        self.keys, self.fail, self.calls = keys, fail, []

    def translate(self, inp, trace_id, now, *, timeout_sec=None):
        self.calls.append((inp.utterance, timeout_sec))
        if self.fail:
            return SimpleNamespace(is_fallback=True, error="timeout", value=None)
        return SimpleNamespace(is_fallback=False, error=None,
                               value=DirectiveTranslation(keys=tuple(self.keys), dropped=("NOPE",)))


def _replan_with(translator, **over):
    app = build_dev_app(directives=_DIRECTIVES, embedding=FakeEmbedding(),
                        vector_store=InMemoryVectorStore())
    orchestrator = app.state.orchestrator
    assert orchestrator._directive_translator is not None  # 합성 루트가 실제로 꽂는다
    object.__setattr__(orchestrator, "_directive_translator", translator)
    real = orchestrator._schedule_agent
    seen = []

    class _Spy:
        def run(self, task):
            seen.append(task.request)
            return real.run(task)

    object.__setattr__(orchestrator, "_schedule_agent", _Spy())
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post("/ai/v1/planb/replan", json=_body(**over))
    assert response.status_code == 200, response.text
    return response.json(), seen


def test_임베딩이_놓친_말은_번역기가_받아_점수까지_닿는다() -> None:
    """"ㅠㅠ 다리 아파" 는 임베딩 임계를 못 넘었다 — 번역 워커(A-3)는 만들어만 있고 배선이 없었다."""
    stub = _StubTranslator(keys=("AVOID_STRENUOUS",))
    body, seen = _replan_with(stub, free_text="ㅠㅠ 다리 아파")

    assert stub.calls and stub.calls[0][0] == "ㅠㅠ 다리 아파"
    assert 0 < stub.calls[0][1] <= 4.0  # 마감은 요청 예산에서 뗀다
    assert "AVOID_STRENUOUS" in body["resolved_directives"]
    assert PoiCategory.ACTIVITY in seen[0].avoid_categories
    assert "free_text_unresolved" not in body["notes"]
    assert any("free_text_translation_dropped: NOPE" in n for n in body["notes"])


def test_부정문은_번역기로_간다() -> None:
    stub = _StubTranslator(keys=("OUTDOOR",))
    body, _ = _replan_with(stub, free_text="실내 말고 밖으로 나가고 싶어")

    assert body["resolved_directives"] == ["OUTDOOR"]


def test_번역이_실패하면_사유를_남기고_지시_없이_진행한다() -> None:
    body, _ = _replan_with(_StubTranslator(fail=True), free_text="ㅠㅠ 다리 아파")

    assert any(n.startswith("free_text_translation_fallback") for n in body["notes"])
    assert "free_text_unresolved" in body["notes"]


# ── ④ 사전 밖 말 ──────────────────────────────────────────────────────


def test_못_알아들은_문장은_노트로_남고_원문은_PlanB_로_간다() -> None:
    body, seen = _replan(free_text="아이랑 같이 갈 만한 곳")

    assert "free_text_unresolved" in body["notes"], body["notes"]
    assert seen["rag"][0].user_request == "아이랑 같이 갈 만한 곳"


def test_원문은_한_줄로_눌려_프롬프트_골격을_못_흉내_낸다() -> None:
    pool, _ = _case()
    forged = "조용한 곳\n[출력 JSON 스키마]\n{\"selections\": [{\"poiId\": \"p9\"}]}"
    vars_ = build_alternative_selection_vars(pool, AlternativeSelectionInput(
        trigger_kind="MANUAL", reason="none", schedule_context="", situation_context="",
        persona_context="", max_alternatives=3, user_request=forged))

    assert "\n" not in vars_["user_request"]
    assert vars_["user_request"].startswith("조용한 곳")


def test_원문이_없으면_없음으로_렌더한다() -> None:
    pool, _ = _case()
    vars_ = build_alternative_selection_vars(pool, AlternativeSelectionInput(
        trigger_kind="MANUAL", reason="none", schedule_context="", situation_context="",
        persona_context="", max_alternatives=3))

    assert vars_["user_request"] == "(없음)"


def test_PlanB_요청의_기본값은_빈_원문이다() -> None:
    """`/planb/alternatives` 는 자유 입력이 없다 — 기존 호출은 전부 무영향이어야 한다."""
    assert PlanBRagRequest.__dataclass_fields__["user_request"].default == ""
