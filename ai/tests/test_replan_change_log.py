"""변경 이력이 다시 짜기 구성 프롬프트에 닿는다 (TRIP-975).

정본 KB-1 표의 마지막 항목 — "같은 제안 반복 방지". 실서비스에서 하루를 고르는 것은 구성 LLM 이라
(구성이 있으면 PlanB 선택 LLM 은 안 돈다) 이력은 **구성 프롬프트**에 실려야 효과가 있다.

증명하는 것:
  ① 와이어 → 구성 입력 → 렌더된 프롬프트까지 실제로 닿는다
  ② 이름은 풀에서, 못 찾은 id 는 빠지고, 양쪽 다 못 찾으면 항목째 빠진다
  ③ 시각을 싣지 않는다 — 시간표현 게이트가 `09:00` 을 통과시키므로 재료에서 막는다
  ④ 이력이 없으면 "(없음)" — 종전 프롬프트와 같다(그 줄 외)
"""

from __future__ import annotations

import re
from types import SimpleNamespace

from fastapi.testclient import TestClient

from trippilot.agents.planb.composition import recent_change_lines
from trippilot.api.wiring import build_dev_app
from trippilot.domain.common import PoiId
from trippilot.domain.llm import TypedResult
from trippilot.llm_gateway.workers.replan_composition import build_compose_vars

from tests.test_api_replan_wired import _DIRECTIVES, _body

_CLOCK = re.compile(r"\d{1,2}\s*:\s*\d{2}")
_NAMES = {PoiId("p1"): "성산일출봉", PoiId("p2"): "제주민속촌", PoiId("p3"): "흑돼지거리"}


def _ev(source="PLAN_B", reason=None, removed=(), added=()):
    return SimpleNamespace(source=source, reason=reason,
                           removed_poi_ids=list(removed), added_poi_ids=list(added))


def test_lines_name_the_change_without_times_or_ids() -> None:
    lines = recent_change_lines(
        [_ev("PLAN_B", "비 예보", ["p1"], ["p2"]),
         _ev("MANUAL", None, ["유령"], ["p3"]),
         _ev("MANUAL", None, ["유령1"], ["유령2"])], _NAMES)
    assert lines == ("다시 짜기(비 예보): 성산일출봉 빠짐 / 제주민속촌 들어옴",
                     "직접 편집: 흑돼지거리 들어옴")
    assert not any(_CLOCK.search(line) or "유령" in line for line in lines)


class _SpyComposer:
    def __init__(self) -> None:
        self.inputs = []

    def compose(self, pool, inp, trace_id, now, *, timeout_sec=None):
        self.inputs.append((pool, inp))
        return TypedResult(value=None, is_fallback=True, error="spy", call_record=None)


def _replan(**body):
    app = build_dev_app(directives=_DIRECTIVES)
    spy = _SpyComposer()
    app.state.orchestrator._composer = spy
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ai/v1/planb/replan", json=_body(**body))
    assert r.status_code == 200, r.text
    return spy


def test_change_log_reaches_the_rendered_composition_prompt() -> None:
    """와이어에서 렌더된 프롬프트 변수까지 — 이걸 안 보면 배선만 하고 효과 0 이어도 초록이다."""
    seed = "e0000000-0000-4000-8000-000000000002"  # 흑돼지거리 — 데모 풀 안
    spy = _replan(change_log=[{"source": "MANUAL", "reason": None, "at": "2026-09-21T07:30:00+09:00",
                               "removed_poi_ids": [seed], "added_poi_ids": []}])
    assert spy.inputs, "구성 LLM 이 불리지 않았다"
    pool, inp = spy.inputs[0]
    rendered = build_compose_vars(pool, inp)["recent_changes"]
    assert "직접 편집: 제주 흑돼지거리 빠짐" in rendered, rendered
    assert not _CLOCK.search(rendered)


def test_no_change_log_renders_none() -> None:
    spy = _replan()
    pool, inp = spy.inputs[0]
    assert build_compose_vars(pool, inp)["recent_changes"] == "- (없음)"
