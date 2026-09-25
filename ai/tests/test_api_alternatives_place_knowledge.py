"""KB-5 장소 지식이 **경계를 통과해 프롬프트까지** 닿는가.

`test_place_knowledge.py` 는 `fetch_place_knowledge` 만 본다. 그 함수가 맞아도
경계에서 프롬프트까지 사이의 어느 고리가 끊기면 장소 설명은 **조용히 사라진다** —
예외도 노트도 안 난다(문서 없이 도는 것이 정상 동작이라서다).

이 리포에서 반복된 실패가 정확히 그 모양이다: 측정한 이동시간에 착지 필드가 없었고,
tags 가 DB 엔 있는데 내부 DTO 엔 없었고, 경계가 열렸는데 받는 쪽 주석은 "아직"이었다.
그래서 조각이 아니라 **줄 전체**를 본다:

    POST /ai/v1/itinerary/alternatives
      → 풀 조립(Poi.source_ref)
      → PlanBAgent.retrieve → fetch_place_knowledge (KB-5 collection)
      → RagContext.place_knowledge
      → AlternativeSelectionInput.place_knowledge
      → build_alternative_selection_vars → 후보 줄 넷째 칸
      → LLM 이 실제로 받은 프롬프트

실 LLM·실 벡터·실 API 0 (D37) — 벡터는 인메모리, LLM 은 프롬프트를 붙잡는 스파이.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from trippilot.agents.planb.kb_retrieval import index_documents
from trippilot.api.wiring import DEMO_ANCHOR, build_dev_app, demo_poi_seed
from trippilot.poi_curation.place_docs import make_doc
from trippilot.ports.llm_port import LlmRequest, LlmResponse

# 장소마다 **다른** 문서를 넣는다 — 같은 문구면 "붙긴 붙었는데 엉뚱한 줄에 붙은 것"을
# 못 잡는다. 조인 키(`source_ref`)가 어긋나는 것이 이 배선의 진짜 위험이다.
def _doc_text(name: str) -> str:
    return f"{name}은(는) 제주특별자치도에 있는 곳으로 우천에도 둘러볼 만하다."


def _body() -> dict:
    return {
        "trigger": {"kind": "WEATHER", "schedule_id": "sched-kb5",
                    "affected_date": "2026-09-01", "payload": {}},
        "reason": "weather",
        "anchor": {"lat": DEMO_ANCHOR.lat, "lng": DEMO_ANCHOR.lng},
        "dates": ["2026-09-01"],
        "budget_level": "중간",
        "transport_mode": "대중교통",
        "excluded_poi_ids": [],
        "request_meta": {"request_id": "kb5-wire", "requested_at": "2026-09-01T08:00:00+09:00",
                         "deadline_ms": 5000},
    }


class _PromptSpy:
    """LlmPort — 받은 프롬프트를 남기고 유효한 선택 JSON 을 돌려준다."""

    def __init__(self) -> None:
        self.prompts: list[str] = []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.prompts.append(request.prompt)
        # 풀 안에서 고른다 — 밖을 고르면 게이트가 전량 드롭해 폴백으로 새고,
        # 그러면 이 테스트가 프롬프트가 아니라 폴백 경로를 재는 것이 된다.
        first = _candidate_ids(request.prompt)[:1]
        return LlmResponse(
            raw_text=json.dumps(
                {"selections": [{"poiId": p, "reason": "실내라 우천에 적합합니다"}
                                for p in first]},
                ensure_ascii=False),
            input_tokens=1, output_tokens=1, latency_ms=0, model_id=request.model_id)


def _candidate_lines(prompt: str) -> list[str]:
    """프롬프트의 후보 줄만. 규칙 줄(`- 장소 설명은 …`)과 구분한다."""
    return [l for l in prompt.splitlines()
            if l.startswith("- ") and l.count(" | ") >= 2]


def _candidate_ids(prompt: str) -> list[str]:
    return [l[2:].split(" | ")[0] for l in _candidate_lines(prompt)]


def _wired(*, with_doc: bool) -> tuple[TestClient, _PromptSpy, dict[str, str]]:
    """실 배선. 반환: (클라이언트, 스파이, {poi_id: 기대 문서})"""
    seed = demo_poi_seed()
    embedding, store = FakeEmbedding(dim=32), InMemoryVectorStore()
    expected: dict[str, str] = {}
    if with_doc:
        docs = []
        for poi in seed:  # 반경에 뭐가 남는지 모르니 **전원**에 넣는다
            doc = make_doc("wiki", str(poi.source_ref), _doc_text(poi.name))
            assert doc is not None
            docs.append(doc)
            expected[str(poi.poi_id)] = _doc_text(poi.name)
        index_documents(tuple(docs), embedding, store)
    spy = _PromptSpy()
    app = build_dev_app(llm=spy, model_id="test-model",
                        vector_store=store, embedding=embedding)
    return TestClient(app, raise_server_exceptions=False), spy, expected


def test_장소_문서가_그_후보_줄에_실린다() -> None:
    """줄 전체가 이어져 있는지 — 어느 고리가 끊겨도 빨개진다.

    **어느 문서가 어느 줄에** 붙었는지까지 본다. 조인 키가 어긋나면 문서는 붙지만
    엉뚱한 장소를 설명하게 되고, 그건 문서가 없는 것보다 나쁘다.
    """
    client, spy, expected = _wired(with_doc=True)
    with client:
        response = client.post("/ai/v1/itinerary/alternatives", json=_body())

    assert response.status_code == 200, response.text
    assert spy.prompts, "LLM 이 불리지 않았다 — 앞 단계에서 폴백했다"
    lines = _candidate_lines(spy.prompts[0])
    assert lines, spy.prompts[0][-800:]
    for line in lines:
        parts = line[2:].split(" | ")
        assert len(parts) == 4, f"장소 설명 칸이 없다: {line}"
        poi_id, doc = parts[0], parts[3]
        assert expected[poi_id].startswith(doc.rstrip("…")), (
            f"다른 장소의 문서가 붙었다\n  줄: {line}\n  기대: {expected[poi_id]}")


def test_문서가_없으면_칸이_안_생긴다() -> None:
    """빈 칸을 결격으로 읽지 않게 — 줄 모양 자체가 달라야 한다.

    위와 **같은 배선에 문서만 뺀 것**이다. 둘을 비교해야 "붙었다"가 배선 덕인지
    우연인지 갈린다.
    """
    client, spy, _ = _wired(with_doc=False)
    with client:
        response = client.post("/ai/v1/itinerary/alternatives", json=_body())

    assert response.status_code == 200, response.text
    assert spy.prompts
    lines = _candidate_lines(spy.prompts[0])
    assert lines
    for line in lines:
        assert len(line[2:].split(" | ")) == 3, f"문서가 없는데 칸이 생겼다: {line}"


def test_데모_시드에_조인_키가_있다() -> None:
    """없으면 개발·스모크 앱에서 KB-5 가 **켜지지 않는다** — 위 두 테스트가 무의미해진다.

    실 경로에서는 `BackendPoiDb` 가 `PoiReadResponse.sourceRef` 를 옮긴다
    (`backend_poi_db.py:235`).
    """
    assert all(p.source_ref for p in demo_poi_seed())
