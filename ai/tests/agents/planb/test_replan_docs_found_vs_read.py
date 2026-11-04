"""다시 짜기 보고가 문서를 '찾은 것'과 '읽은 것'으로 가른다 (운영 2026-11-05 trip 8311ac19).

운영 로그 `replan KB 적중: SITUATION=4 · POI_DESC=8 · POI_DESC_FALLBACK=25` 가 두 군데서 틀렸다:
  - SITUATION=4 는 읽는 곳이 없는 검색이다. 다시 짜기는 선택 LLM 을 안 부르는데(`use_llm=False`) KB-3 벡터
    검색은 그대로 돌았다. 구성 프롬프트에 실린 상황 원칙은 사유 표지로 고른 다른 문서다(`situation_lines`).
  - run3 은 구성 LLM 이 7.8s 에 타임아웃했는데도 POI_DESC=8 이 적중으로 찍혔다. 구성 호출 전에 담은 입력을 센다.
그리고 구성 앞 4.9초 공백을 나눠 볼 단계별 시간이 없었다.

증명하는 것 (실 LLM·실 벡터 0):
  ① 선택 LLM 을 안 부르면 PlanB 는 KB-3 를 찾지 않고 `retrieved` 에 SITUATION 키도 싣지 않는다
  ② KB-2 는 그래도 찾는다 — 규칙 랭킹(저장 장소 우선)이 읽고, 그 순위가 구성 후보의 'PlanB 순위'로 간다
  ③ `retrieved.SITUATION_PROMPT` = 구성 프롬프트 [상황 대처 원칙] 칸에 실린 문서 수
  ④ 구성이 타임아웃·시한 생략이면 `compose_docs_unread` — 실은 문서가 최종 일정에 쓰이지 않았다
  ⑤ 단계별 시간 노트(`stage_ms: …`)와 진입 창 로그(`replan_window`)
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import replace

from fastapi.testclient import TestClient

from trippilot.agents.planb import rag
from trippilot.agents.planb.kb_retrieval import index_documents
from trippilot.agents.planb.rag import PlanBAgent, PlanBRagConfig, _persona_query
from trippilot.api import wiring
from trippilot.api.wiring import build_dev_app
from trippilot.domain.common import PoiId
from trippilot.domain.kb import KbKind
from trippilot.domain.llm.llm import TypedResult
from trippilot.llm_gateway.gates.replan.replan_request_extraction import ExtractedPlace, ExtractedRequest
from trippilot.ports.llm_port import LlmTimeoutError

from tests.agents.planb.test_planb_rag import _SMALL, _doc, _pool, _request
from tests.agents.planb.test_replan_composition import _DIRECTIVES, _FOOD, _ScriptedLlm, _body
from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.fake_existence import FakeExistence
from tests.fakes.in_memory_vector_store import InMemoryVectorStore

# KB-3 상황 원칙 — 사유 표지로 고른다(`composition.situation_lines`). weather 2건이 구성 프롬프트에 실린다.
_SITU = (
    ("비가 오면 실내 위주로 바꾼다.", ("weather",)),
    ("비 오는 날은 이동을 짧게 묶는다.", ("weather",)),
    ("휴무면 같은 종류의 가까운 곳으로 바꾼다.", ("closed",)),
)


def _spy(monkeypatch, name: str) -> list[str]:
    calls: list[str] = []
    real = getattr(rag, name)

    def wrapped(query, *a, **kw):
        calls.append(query)
        return real(query, *a, **kw)

    monkeypatch.setattr(rag, name, wrapped)
    return calls


# ── ①② PlanB — 선택 LLM 을 안 부르면 KB-3 를 찾지 않는다 ─────────────


def test_선택_LLM을_안_부르면_KB3_상황_검색을_하지_않고_키도_싣지_않는다(monkeypatch) -> None:
    situation = _spy(monkeypatch, "retrieve_situation")
    agent = PlanBAgent(FakeEmbedding(dim=_SMALL), InMemoryVectorStore())

    result = agent.run(replace(_request(_pool("p1", "p2")), use_llm=False))
    assert situation == []
    # 0 을 싣는 것도 거짓이다 — "찾았는데 없었다"로 읽힌다(TRIP-972 SCHEDULE 키와 같은 규칙)
    assert KbKind.SITUATION.value not in result.retrieved, result.retrieved

    # 대조 — 선택 LLM 이 읽는 경로(대체 카드)는 그대로 찾고 센다
    result = agent.run(_request(_pool("p1", "p2")))
    assert len(situation) == 1
    assert KbKind.SITUATION.value in result.retrieved


def test_선택_LLM을_안_불러도_KB2_저장_장소는_찾는다_규칙_랭킹이_읽는다(monkeypatch) -> None:
    """KB-2 히트는 선택 LLM 만의 재료가 아니다 — `_saved_refs` 를 거쳐 규칙 랭킹 1위가 되고, 다시 짜기는 그
    순위(`ranked_poi_ids`)를 구성 후보의 'PlanB 순위'로 넘긴다. 함께 끊으면 저장 장소 우선이 조용히 사라진다."""
    persona = _spy(monkeypatch, "retrieve_persona")
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    request = replace(_request(_pool("p1", "p2", "p3")), use_llm=False)
    index_documents([_doc(KbKind.PERSONA, "saved-p3", _persona_query(request) + " 카페", poi_ref="p3")],
                    emb, store)
    no_cut = PlanBRagConfig(min_score_ratio=0.0, min_score=-1.0)  # 랭킹을 본다 — 유사도 컷은 따로 검증한다

    result = PlanBAgent(emb, store, config=no_cut).run(request)
    assert len(persona) == 1
    assert result.ranked_poi_ids[0] == PoiId("p3"), result.ranked_poi_ids
    assert result.retrieved[KbKind.PERSONA.value] == 1


# ── ③④ 다시 짜기 — 구성 프롬프트에 실린 수와 읽혔는지 ──────────────────


class _ComposeTimesOut(_ScriptedLlm):
    """구성 호출만 시한 초과(운영 run3: opus 7.8s) — 나머지 기능은 파싱 실패."""

    def invoke(self, request):
        if request.prompt_ref.feature == "REPLAN_COMPOSITION":
            self.requests.append(request)
            raise LlmTimeoutError("compose 7.8s")
        return super().invoke(request)


def _replan(llm, *, app=None, **over) -> dict:
    app = app or build_dev_app(llm=llm, model_id="m", directives=_DIRECTIVES, situation_docs=_SITU)
    with TestClient(app, raise_server_exceptions=False) as c:
        response = c.post("/ai/v1/planb/replan", json=_body(reasons=["weather"], **over))
    assert response.status_code == 200, response.text
    return response.json()


def test_구성이_읽은_상황_원칙_수를_SITUATION_PROMPT로_싣는다() -> None:
    llm = _ScriptedLlm([_FOOD])
    body = _replan(llm)

    section = llm.compose_prompt().split("[상황 대처 원칙]")[1].split("[")[0]
    assert all(text in section for text, _ in _SITU[:2]), section  # 센 수가 실제로 실린 것이다
    assert body["retrieved"]["SITUATION_PROMPT"] == 2, body["retrieved"]
    assert "SITUATION" not in body["retrieved"], body["retrieved"]  # 다시 짜기는 KB-3 를 검색하지 않는다
    assert "compose_docs_unread" not in body["notes"], body["notes"]


def test_구성이_타임아웃이면_실은_문서를_안_읽었다고_남긴다() -> None:
    body = _replan(_ComposeTimesOut(None))

    assert any(n.startswith("llm_compose_fallback: timeout") for n in body["notes"]), body["notes"]
    assert "compose_docs_unread" in body["notes"], body["notes"]
    # 건수는 구성 입력에 실은 수 그대로다 — 찾은 것과 읽은 것은 노트가 가른다
    assert body["retrieved"]["SITUATION_PROMPT"] == 2 and "POI_DESC" in body["retrieved"], body["retrieved"]


def test_장소_지식을_찾은_뒤_시한으로_구성을_생략해도_안_읽었다고_남긴다(monkeypatch) -> None:
    """KB-5 조회가 시한을 먹어 구성을 부르지 않은 경우 — 찾은 문서가 응답 어디에도 안 남던 자리다."""
    app = build_dev_app(llm=_ScriptedLlm([_FOOD]), model_id="m", directives=_DIRECTIVES, situation_docs=_SITU)
    orch = app.state.orchestrator
    inner = orch._rag

    class _KnowledgeEatsDeadline:
        def run(self, request):
            return inner.run(request)

        def place_knowledge(self, request, pois):
            monkeypatch.setattr(wiring, "_COMPOSE_MIN_MS", 10**9)  # 조회가 끝나면 구성 바닥을 못 넘긴다
            return {str(pois[0].source_ref): "문서"}, ""

    orch._rag = _KnowledgeEatsDeadline()
    body = _replan(None, app=app)

    assert any(n.startswith("llm_compose_skipped: deadline") for n in body["notes"]), body["notes"]
    assert "compose_docs_unread" in body["notes"], body["notes"]
    assert body["retrieved"].get("POI_DESC") == 1, body["retrieved"]


# ── ⑤ 단계별 시간 · 진입 창 ─────────────────────────────────────────


class _StubExtractor:
    def extract(self, *a, **kw) -> TypedResult:
        return TypedResult(value=ExtractedRequest(places=(ExtractedPlace("한라산", "visit"),)),
                           is_fallback=False, error=None, call_record=None)


class _SlowTranslate:
    def translate(self, *a, **kw) -> TypedResult:
        time.sleep(0.03)
        return TypedResult(value=None, is_fallback=True, error="stub", call_record=None)


def _stage_ms(notes: list[str]) -> dict[str, int]:
    return {m[1]: int(m[2]) for n in notes if (m := re.fullmatch(r"stage_ms: (\w+)=(-?\d+)", n))}


def test_구성_앞_단계마다_걸린_시간을_남긴다(caplog) -> None:
    app = build_dev_app(llm=_ScriptedLlm([_FOOD]), model_id="m", directives=_DIRECTIVES, situation_docs=_SITU)
    orch = app.state.orchestrator
    orch._request_extractor = _StubExtractor()
    orch._existence = FakeExistence()
    orch._directive_translator = _SlowTranslate()
    orch._embedding = None  # 임베딩 매칭을 건너뛰어 번역까지 가게
    caplog.set_level(logging.INFO, logger="trippilot.wiring")

    body = _replan(None, app=app, free_text="한라산 꼭 가고 싶어",
                   time_window={"date": "2026-09-21", "start": "06:00", "end": "21:00"},
                   from_instant="2026-09-21T10:30:00+09:00")

    stages = _stage_ms(body["notes"])
    assert set(stages) == {"translate", "directives_wait", "extract_wait", "verify", "planb", "kb5",
                           "compose_left"}, body["notes"]
    assert stages["translate"] >= 30  # 번역 호출을 감싸 잰다
    assert all(v >= 0 for k, v in stages.items() if k != "compose_left")
    # 실제로 받은 창 — 운영 ①(06:00 설정인데 09:00 부터)을 로그 한 줄로 가른다
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("replan_window "))
    logged = json.loads(line.removeprefix("replan_window "))
    assert logged["time_window"] == "2026-09-21 06:00~21:00" and logged["not_before"] == "10:30", logged
