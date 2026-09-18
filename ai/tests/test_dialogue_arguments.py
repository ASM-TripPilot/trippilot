"""인자표 불변식 — `assistant-dialogue` FD §2.

이 표가 도구 스키마와 규칙 추출기 **양쪽의 재료**라, 표가 깨지면 두 곳이 조용히 갈라진다.
그래서 표 자체를 테스트한다.
"""

from __future__ import annotations

import json

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trippilot.domain.common import BudgetLevel, TransportMode
from trippilot.domain.dialogue import (
    ARGUMENT_TABLE,
    ArgumentKind,
    ArgumentSpec,
    missing_arguments,
    specs_of,
    tool_specs,
    tool_specs_json,
)
from trippilot.domain.edit import EditOp
from trippilot.domain.intent import ROUTABLE_INTENTS, Intent
from trippilot.domain.persona import CompanionType
from trippilot.domain.trigger import ReplanScope


def test_table_covers_every_routable_intent_and_nothing_else() -> None:
    """13종 전부 · 그 밖은 없음. `OUT_OF_SCOPE` 는 위임 대상이 아니라 인자가 없다."""
    assert set(ARGUMENT_TABLE) == ROUTABLE_INTENTS
    assert Intent.OUT_OF_SCOPE not in ARGUMENT_TABLE


def test_argument_names_are_unique_within_an_intent() -> None:
    for intent, specs in ARGUMENT_TABLE.items():
        names = [s.name for s in specs]
        assert len(names) == len(set(names)), f"{intent.value}: 인자 이름 중복 {names}"


def test_required_arguments_exist_in_exactly_four_intents() -> None:
    """**필수 인자는 4종에만 있다** (FD §2.0.1).

    이 숫자가 늘면 되묻기 범위가 늘어난다는 뜻이라 눈에 띄어야 한다. 초안은 6종이었고,
    코드 실측에서 4종으로 줄었다 — 도우미가 여행 화면에서 호출되기 때문이다.
    """
    with_required = {i.value for i, specs in ARGUMENT_TABLE.items()
                     if any(s.required for s in specs)}
    assert with_required == {
        "SUGGEST_ALTERNATIVE", "EDIT_SCHEDULE", "GET_DISTANCE", "GET_POI_INFO",
    }


def test_no_required_argument_lacks_a_landing_field() -> None:
    """받을 칸 없는 인자를 필수로 두면 **되묻기가 발생하고 채워도 버려진다** (FD §2.0 ⑤).

    타입이 이미 막지만, 표 전체에 대해서도 한 번 본다 — 나중에 `lands_in` 을 지우는 수정이
    들어오면 여기서 걸린다.
    """
    for intent, specs in ARGUMENT_TABLE.items():
        for s in specs:
            if s.required:
                assert s.lands_in, f"{intent.value}.{s.name}: 필수인데 lands_in 이 없다"


def test_enum_choices_come_from_real_enums_not_copies() -> None:
    """어휘를 손으로 베끼면 원본 enum 이 바뀔 때 조용히 갈라진다."""
    by = {(i, s.name): s for i, specs in ARGUMENT_TABLE.items() for s in specs}
    assert by[(Intent.EDIT_SCHEDULE, "op")].choices == tuple(m.value for m in EditOp)
    assert by[(Intent.REPLAN, "scope")].choices == tuple(m.value for m in ReplanScope)
    assert by[(Intent.GENERATE_SCHEDULE, "companions")].choices == tuple(m.value for m in CompanionType)
    assert by[(Intent.GENERATE_SCHEDULE, "budget_level")].choices == tuple(m.value for m in BudgetLevel)
    assert by[(Intent.GET_DISTANCE, "mode")].choices == tuple(m.value for m in TransportMode)


def test_empty_choices_mean_the_vocabulary_is_not_a_type_yet() -> None:
    """`choices` 가 비면 "코드에 enum 이 없고 주석 어휘뿐" 이라는 뜻이다.

    PlanB `reason` 이 그렇다 — 표에 †로 적은 그 자리다. 이 목록이 줄면 타입 승격이 있었다는 뜻이고,
    늘면 근거 없는 ENUM 을 새로 넣었다는 뜻이라 양방향으로 눈에 띄어야 한다.
    """
    untyped = {
        f"{i.value}.{s.name}"
        for i, specs in ARGUMENT_TABLE.items()
        for s in specs
        if ArgumentKind.ENUM in s.kinds and not s.choices
    }
    assert untyped == {
        "REPLAN.reason",
        "SUGGEST_ALTERNATIVE.reason",
        "STYLE_ANALYSIS.focus_axis",
    }


def test_union_kinds_are_where_both_forms_really_occur() -> None:
    """`kinds` 가 둘 이상인 자리 — 초안이 `A|B` 라고 적었지만 타입은 한 칸이던 그 자리다."""
    unions = {
        f"{i.value}.{s.name}"
        for i, specs in ARGUMENT_TABLE.items()
        for s in specs
        if len(s.kinds) > 1
    }
    assert unions == {
        "REGENERATE.keep",
        "SUGGEST_ALTERNATIVE.target",
        "EDIT_SCHEDULE.day",
        "EDIT_SCHEDULE.target",
        "GET_DISTANCE.destination",
        "GET_DISTANCE.origin",
    }


def test_multiple_marks_the_one_argument_the_handler_takes_as_a_list() -> None:
    """REPLAN 은 `reasons: list[str]`, SUGGEST_ALTERNATIVE 는 `reason: str`.

    같은 이름을 복사하면 **복수 사유가 조용히 잘린다** — 표가 그 차이를 들고 있어야 한다.
    """
    plural = {f"{i.value}.{s.name}"
              for i, specs in ARGUMENT_TABLE.items() for s in specs if s.multiple}
    assert plural == {"REPLAN.reason"}


# ── requires_group — bool 로 못 적는 조건 ────────────────────────────────


def test_edit_schedule_scope_group_is_satisfied_by_either_member() -> None:
    """"`day` 가 있거나 `target` 이 한 날짜로 해소되거나" 중 하나면 착수한다."""
    assert missing_arguments(Intent.EDIT_SCHEDULE, frozenset()) == ("day",)
    assert missing_arguments(Intent.EDIT_SCHEDULE, frozenset({"day"})) == ()
    assert missing_arguments(Intent.EDIT_SCHEDULE, frozenset({"target"})) == ()
    assert missing_arguments(Intent.EDIT_SCHEDULE, frozenset({"day", "target"})) == ()


def test_ungrouped_required_arguments_are_each_their_own_requirement() -> None:
    assert missing_arguments(Intent.GET_DISTANCE, frozenset()) == ("destination",)
    assert missing_arguments(Intent.GET_DISTANCE, frozenset({"destination"})) == ()
    # origin 은 필수가 아니다 — 현재 위치는 inline_context 가 싣는다
    assert missing_arguments(Intent.GET_DISTANCE, frozenset({"origin"})) == ("destination",)


def test_intents_without_required_arguments_never_ask() -> None:
    """필수 0인 9종은 되묻기가 구조적으로 불가능하다."""
    for intent in ROUTABLE_INTENTS:
        if any(s.required for s in specs_of(intent)):
            continue
        assert missing_arguments(intent, frozenset()) == (), intent.value


@given(filled=st.frozensets(st.sampled_from(["day", "target", "op", "replacement", "position"])))
def test_missing_is_deterministic_and_only_names_required_arguments(filled) -> None:
    once = missing_arguments(Intent.EDIT_SCHEDULE, filled)
    assert once == missing_arguments(Intent.EDIT_SCHEDULE, filled)
    required_names = {s.name for s in specs_of(Intent.EDIT_SCHEDULE) if s.required}
    assert set(once) <= required_names


# ── 도구 스키마 파생 ─────────────────────────────────────────────────────


def test_tool_specs_cover_the_closed_set_and_exclude_the_fallback_label() -> None:
    names = {t["name"] for t in tool_specs()}
    assert names == {i.value for i in ROUTABLE_INTENTS}
    assert "OUT_OF_SCOPE" not in names  # 고를 수 없는 라벨을 목록에 넣으면 모델이 그걸 고른다


def test_tool_specs_are_valid_json_schema_objects() -> None:
    for tool in tool_specs():
        params = tool["parameters"]
        assert params["type"] == "object"
        assert set(params["required"]) <= set(params["properties"]), tool["name"]
        for name, prop in params["properties"].items():
            assert prop["type"] in {"string", "integer", "array"}, (tool["name"], name)
            assert prop["description"]


def test_tool_specs_required_omits_group_members() -> None:
    """그룹 인자는 "둘 중 하나" 라 JSON Schema 의 required 로 표현되지 않는다.

    표현할 수 있는 것만 싣고 나머지는 우리 게이트가 본다 — 스키마에 `day` 를 required 로 넣으면
    `target` 만 말한 정당한 발화를 벤더가 거부한다.
    """
    edit = next(t for t in tool_specs() if t["name"] == "EDIT_SCHEDULE")
    assert edit["parameters"]["required"] == []
    assert {"day", "target"} <= set(edit["parameters"]["properties"])


def test_tool_specs_are_deterministic() -> None:
    assert tool_specs_json() == tool_specs_json()
    assert json.loads(tool_specs_json())[0]["name"] == sorted(i.value for i in ROUTABLE_INTENTS)[0]


def test_plural_argument_renders_as_an_array() -> None:
    replan = next(t for t in tool_specs() if t["name"] == "REPLAN")
    assert replan["parameters"]["properties"]["reason"]["type"] == "array"


# ── 규격 자체의 방어 ─────────────────────────────────────────────────────


def test_spec_rejects_required_without_landing_field() -> None:
    with pytest.raises(ValueError, match="필수가 될 수 없다"):
        ArgumentSpec(name="x", kinds=(ArgumentKind.DATE,), required=True, description="d")


def test_spec_rejects_choices_on_non_enum() -> None:
    with pytest.raises(ValueError, match="ENUM 인자에만"):
        ArgumentSpec(name="x", kinds=(ArgumentKind.DATE,), required=False, description="d",
                     choices=("A",))


def test_spec_rejects_empty_or_duplicated_kinds() -> None:
    with pytest.raises(ValueError, match="kinds 가 비었다"):
        ArgumentSpec(name="x", kinds=(), required=False, description="d")
    with pytest.raises(ValueError, match="중복"):
        ArgumentSpec(name="x", kinds=(ArgumentKind.DATE, ArgumentKind.DATE), required=False,
                     description="d")


def test_spec_rejects_group_on_optional_argument() -> None:
    with pytest.raises(ValueError, match="필수 인자끼리만"):
        ArgumentSpec(name="x", kinds=(ArgumentKind.DATE,), required=False, description="d",
                     requires_group="g", lands_in="somewhere")
