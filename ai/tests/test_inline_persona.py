"""요청에 실려 온 취향(`preference_profile` + `trip_context.companion_type`)이 LLM 에 닿는다.

종전: 페르소나는 주입된 `ContextStore` 만 공급했고 `main.py` 는 그것을 안 넘겨
`StaticPersonaStore`(취향 없음·SOLO·MID)가 **모든 사용자의** 페르소나였다 — 커플·미식
사용자 설명에 "#혼자여행" 이 실측됐다. 캐시 지문도 상수라 같은 지역 두 번째 생성부터
다른 사용자의 점수를 재사용했다.

증명하는 것 (실 LLM 0 — D37):
  (a) 같은 풀·다른 프로필 → PREFERENCE_SCORING 프롬프트의 취향 줄이 다르다
  (b) 취향이 다르면 캐시를 공유하지 않는다, 같으면 적중한다
  (c) 프로필이 비면 종전(StaticPersonaStore) 그대로
  (d) replan 도 인라인 프로필이 반영된다
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from trippilot.api.wiring import DEMO_ANCHOR, build_dev_app, demo_poi_seed
from trippilot.domain.common import BudgetLevel
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from trippilot.ports.llm_port import LlmRequest, LlmResponse

from tests.test_api_replan_wired import _body as _replan_body
from tests.test_preference_cache import FakeInner, _pool, _NOW, _TRACE
from trippilot.llm_gateway.workers.preference_cache import CachingScoringWorker

_IDS = tuple(str(p.poi_id) for p in demo_poi_seed())
_DAY = "2026-09-21"
_COUPLE_FOODIE = {
    "styles": ["미식"], "activities": ["카페"], "food_tastes": ["한식"],
    "companion_types": ["커플"], "budget_tier": "고급",
}
_SOLO_NATURE = {"styles": ["자연"], "companion_types": ["혼자"]}


class _RecordingLlm:
    """점수 프롬프트만 성공 응답, 나머지는 파싱 실패(폴백) — 받은 요청을 기록한다."""

    def __init__(self) -> None:
        self.requests: list[LlmRequest] = []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        text = json.dumps({"scores": [{"poiId": i, "score": 0.9} for i in _IDS]})
        return LlmResponse(raw_text=text, input_tokens=1, output_tokens=1,
                           latency_ms=0, model_id=request.model_id)

    def scoring_prompts(self) -> list[str]:
        return [r.prompt for r in self.requests
                if r.prompt_ref.feature == "PREFERENCE_SCORING"]


def _persona_block(prompt: str) -> str:
    start = prompt.index("[사용자 취향]")
    return prompt[start:prompt.index("예산:", start)]


def _generate(client: TestClient, profile: dict, *, trip_id: str = "trip-a",
              companion_type: str | None = None) -> None:
    body = {
        "trip_id": trip_id,
        "generation_mode": "FULLY_AI",
        "trip_context": {"destinations": ["제주"], "start_date": _DAY, "end_date": _DAY,
                         "companion_type": companion_type},
        "anchors": [{"date": _DAY, "lat": DEMO_ANCHOR.lat, "lng": DEMO_ANCHOR.lng}],
        "time_windows": [{"date": _DAY, "start": "09:00", "end": "21:00"}],
        "preference_profile": profile,
        "include_explanations": False,
        "request_meta": {"request_id": f"r-{trip_id}", "requested_at": f"{_DAY}T08:00:00+09:00",
                         "deadline_ms": 20000},
    }
    response = client.post("/ai/v1/itinerary/generate", json=body)
    assert response.status_code == 200, response.text


def test_다른_취향은_다른_프롬프트와_별도_LLM_호출을_낸다() -> None:  # (a)(b)
    llm = _RecordingLlm()
    with TestClient(build_dev_app(llm=llm, model_id="m")) as client:
        _generate(client, _COUPLE_FOODIE, trip_id="trip-a")
        _generate(client, _SOLO_NATURE, trip_id="trip-b")
    prompts = llm.scoring_prompts()
    assert len(prompts) == 2  # 두 번째도 캐시 적중이 아니다
    first, second = (_persona_block(p) for p in prompts)
    assert first != second
    assert "FOOD" in first and "COUPLE" in first and "카페" in first and "한식" in first
    assert "NATURE" in second and "SOLO" in second
    assert "HIGH" in prompts[0]


def test_같은_취향이면_다른_여행이어도_캐시_적중() -> None:  # (b)
    llm = _RecordingLlm()
    with TestClient(build_dev_app(llm=llm, model_id="m")) as client:
        _generate(client, _COUPLE_FOODIE, trip_id="trip-a")
        _generate(client, _COUPLE_FOODIE, trip_id="trip-b")
    assert len(llm.scoring_prompts()) == 1


def test_이번_여행의_동행이_계정_평소_동행보다_우선한다() -> None:
    llm = _RecordingLlm()
    with TestClient(build_dev_app(llm=llm, model_id="m")) as client:
        _generate(client, _SOLO_NATURE, companion_type="연인")
    assert "동반자: COUPLE" in llm.scoring_prompts()[0]


def test_프로필이_비면_종전_고정_요약_그대로() -> None:  # (c)
    llm = _RecordingLlm()
    with TestClient(build_dev_app(llm=llm, model_id="m")) as client:
        _generate(client, {})
    block = _persona_block(llm.scoring_prompts()[0])
    # 동반자는 "미설정" — 고르지 않은 사람을 혼자 여행자로 단정하지 않는다(PersonaSummary).
    # 종전 SOLO 고정이 취향 미입력 사용자 근거에 "#혼자여행" 을 붙였다(2026-10-02 실측).
    assert "취향 태그: 미설정" in block and "동반자: 미설정" in block


def test_replan_도_인라인_프로필을_싣는다() -> None:  # (d)
    llm = _RecordingLlm()
    with TestClient(build_dev_app(llm=llm, model_id="m")) as client:
        response = client.post("/ai/v1/planb/replan",
                               json=_replan_body(preference_profile=_COUPLE_FOODIE))
    assert response.status_code == 200, response.text
    block = _persona_block(llm.scoring_prompts()[0])
    assert "FOOD" in block and "COUPLE" in block and "한식" in block


def test_캐시_지문이_활동_음식_선호를_구분한다() -> None:
    inner = FakeInner()
    worker = CachingScoringWorker(inner)
    base = PersonaSummary(taste_tags=(TasteTag.FOOD,), companion=CompanionType.COUPLE,
                          budget=BudgetLevel.MID)
    for persona in (base,
                    PersonaSummary(base.taste_tags, base.companion, base.budget,
                                   activities=("카페",)),
                    PersonaSummary(base.taste_tags, base.companion, base.budget,
                                   cuisines=("한식",))):
        worker.score(_pool("a"), persona, _TRACE, _NOW)
    assert len(inner.calls) == 3
