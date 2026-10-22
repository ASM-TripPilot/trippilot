"""도구 계획(DIALOGUE_PLAN) 레지스트리 — 표 하나에서 파생 (assistant-orchestrator FD BR-AO-28 · DE §2.11).

도구를 새로 만들지 않는다: 실행자는 `HANDLERS[intent]`, 인자 스키마는 인자표의 asked 인자(분류 `$intents` 와 같은
`tool_specs`), 손으로 쓰는 것은 도구마다 설명 한 줄과 쓰는 포트뿐이다. 실 호출 0.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import fields

import pytest

from trippilot.domain.dialogue import ArgumentKind, asked_specs_of, tool_specs, tool_specs_json
from trippilot.domain.intent import DIALOGUE_INTENTS, Intent
from trippilot.domain.plan_tools import (
    MAX_ARG_CHARS,
    MAX_PLAN_CALLS,
    NEVER_TOOLS,
    PLAN_GAPS,
    PLAN_TOOLS,
    PlanTool,
    plan_argument_names,
    plan_tool_specs_json,
    validate_plan_tools,
)
from trippilot.orchestrator.dialogue_handlers import HandlerPorts

_INFO_HANDLERS = frozenset({
    Intent.SHOW_SCHEDULE, Intent.GET_NEXT_SLOT, Intent.GET_WEATHER, Intent.GET_DISTANCE, Intent.GET_POI_INFO,
    Intent.SUGGEST_ALTERNATIVE, Intent.EXPLORE_PLACES, Intent.RECOMMEND_PLACES,
})


def test_registry_is_the_information_handlers_and_nothing_that_writes_or_hands_off() -> None:
    assert set(PLAN_TOOLS) == _INFO_HANDLERS
    assert not set(PLAN_TOOLS) & NEVER_TOOLS
    assert set(PLAN_TOOLS) <= DIALOGUE_INTENTS
    # 도우미 의도는 전부 어느 한쪽에 적혀 있다 — 의도가 늘면 도구인지 아닌지를 정해야 기동한다(조용한 빈칸 금지)
    assert set(PLAN_TOOLS) | NEVER_TOOLS == DIALOGUE_INTENTS | {Intent.OUT_OF_SCOPE}


def test_every_tool_argument_is_a_string_scalar() -> None:
    """게이트가 값을 문자열 하나로만 받는다 — 목록·개수 인자가 생기면 표부터 깨진다."""
    for intent in PLAN_TOOLS:
        for spec in asked_specs_of(intent):
            assert not spec.multiple and spec.kinds[0] is not ArgumentKind.COUNT, (intent, spec.name)


def test_summaries_are_one_short_line_and_needs_are_handler_port_fields() -> None:
    ports = {f.name for f in fields(HandlerPorts)}
    for intent, tool in PLAN_TOOLS.items():
        assert 1 <= len(tool.summary) <= 80 and "\n" not in tool.summary, intent
        assert set(tool.needs) <= ports, intent


@pytest.mark.parametrize("summary", ["", "가" * 81, "두 줄\n설명"])
def test_plan_tool_rejects_empty_long_or_multiline_summaries(summary: str) -> None:
    with pytest.raises(ValueError):
        PlanTool(summary)


@pytest.mark.parametrize("bad", [
    {Intent.EDIT_SCHEDULE: PlanTool("편집")},  # 저장 경로로 이어진다
    {Intent.REPLAN: PlanTool("다시 짜기")},  # 넘기기 — 사실 없이 화면 이동뿐
    {Intent.OUT_OF_SCOPE: PlanTool("범위 밖")},
])
def test_registry_check_rejects_tools_that_write_hand_off_or_are_not_intents(bad) -> None:
    with pytest.raises(ValueError):
        validate_plan_tools({**PLAN_TOOLS, **bad})


def test_constants() -> None:
    assert (MAX_PLAN_CALLS, MAX_ARG_CHARS) == (2, 40)
    assert len(set(PLAN_GAPS)) == len(PLAN_GAPS) and "OTHER" in PLAN_GAPS


def test_tools_json_reuses_the_argument_table_parameters_and_swaps_only_the_description() -> None:
    descriptions = {i: f"{i.value} 설명" for i in PLAN_TOOLS}
    rendered = plan_tool_specs_json(descriptions)
    assert rendered == plan_tool_specs_json(dict(reversed(list(descriptions.items()))))  # 결정론(입력 순서 무관)
    specs = json.loads(rendered)
    assert {s["name"] for s in specs} == {i.value for i in descriptions}
    for spec in specs:
        intent = Intent(spec["name"])
        (classified,) = tool_specs(frozenset({intent}), dialogue=True)  # 도우미 분류와 같은 렌더(dialogue_only 포함)
        hidden = set(PLAN_TOOLS[intent].hide)
        expected = {**classified["parameters"],
                    "properties": {k: v for k, v in classified["parameters"]["properties"].items() if k not in hidden}}
        assert spec["parameters"] == expected  # 분류와 같은 함수 — 한 표(숨긴 인자만 뺀다)
        assert spec["description"] == descriptions[intent]


def test_weather_hides_the_period_it_cannot_answer() -> None:
    """핸들러가 date 만 읽는다 — period 를 광고하면 "주말에 비 오면"에 오늘 강수확률이 나간다(C7 실측). 숨긴 인자는 광고에서도
    게이트 허용 키에서도 빠진다."""
    assert PLAN_TOOLS[Intent.GET_WEATHER].hide == ("period",)
    (weather,) = json.loads(plan_tool_specs_json({Intent.GET_WEATHER: "날씨"}))
    assert set(weather["parameters"]["properties"]) == {"date", "region"}  # region 은 도우미 전용 인자 — 계획 도구엔 싣는다
    assert plan_argument_names(Intent.GET_WEATHER) == frozenset({"date", "region"})
    assert "주말·기간은 못 본다" in PLAN_TOOLS[Intent.GET_WEATHER].summary


def test_hidden_arguments_must_be_asked_and_optional() -> None:
    with pytest.raises(ValueError):
        validate_plan_tools({Intent.GET_POI_INFO: PlanTool("장소", hide=("place",))})  # 필수를 숨기면 영영 못 부른다
    with pytest.raises(ValueError):
        validate_plan_tools({Intent.GET_WEATHER: PlanTool("날씨", hide=("aspect",))})  # 묻지 않는 인자 — 숨길 것이 없다


def test_tools_json_carries_only_the_exposed_tools() -> None:
    exposed = {Intent.GET_NEXT_SLOT: "다음", Intent.EXPLORE_PLACES: "탐색"}
    assert [s["name"] for s in json.loads(plan_tool_specs_json(exposed))] == ["EXPLORE_PLACES", "GET_NEXT_SLOT"]


def test_classification_schemas_stay_byte_identical() -> None:
    """도구 표는 분류 `$intents` 를 건드리지 않는다 — intent.yaml(3단 라우터·재생 픽스처)은 기본값 13종,
    도우미 분류는 15종(+탐색·추천 — RECOMMEND_PLACES 로 2026-10-20 의도적으로 바뀌었다). 이 두 바이트가 바뀌면 재생 기록 전건 미스·분류 판본 실측 무효다(BR-AO-14)."""
    golden = {
        "intent.yaml($intents)": ("fffa98ade2f9f39654922dd98f25477f6f32e7917d5668f8ea41db1ea478e820", tool_specs_json()),
        # 2026-10-20 갱신: GET_WEATHER.region(dialogue_only, #1475) · RECOMMEND_PLACES 추가 — intent.yaml 쪽은 그대로다
        "dialogue_intent.yaml($intents)": ("bf750b1e8e05c482238fd1540f39d803489f96276dca49c1c781477473e6d939",
                                           tool_specs_json(DIALOGUE_INTENTS, dialogue=True)),
    }
    for name, (sha, text) in golden.items():
        assert hashlib.sha256(text.encode()).hexdigest() == sha, name
