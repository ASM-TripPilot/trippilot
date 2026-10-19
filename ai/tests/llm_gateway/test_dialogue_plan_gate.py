"""DIALOGUE_PLAN 출구 게이트 — 계획 LLM 산출을 닫힌 도구·검증된 문자열 인자로만 받는다
(assistant-orchestrator FD BR-AO-28 · DE §2.11 · AO-P18). 실 호출 0.

게이트가 지키는 것: 도구 이름은 노출한 도구(`allowed`) 안 · 인자 키·enum 은 인자표 안 · 값은 문자열 1..40자이고 시각·소요·연락처·
주입 꼴이 없다(INV-2·3·인젝션) · 필수 인자가 찬 호출만 · 중복 없이 ≤2. 도구 없음(`calls=[]`)·거절(`refused`)은 **성공**이다 —
판단한 결과라 폴백 지표(`llm_fallback_watch`)를 오염시키지 않는다. 입력 호출이 있었는데 전부 버려지면 그때만 실패다.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import TraceId
from trippilot.domain.dialogue import asked_argument_names, asked_specs_of, missing_arguments
from trippilot.domain.intent import Intent, IntentDraft
from trippilot.domain.llm import LlmFeature
from trippilot.domain.plan_tools import MAX_ARG_CHARS, MAX_PLAN_CALLS, PLAN_GAPS, PLAN_TOOLS
from trippilot.llm_gateway.gates.dialogue_answer import _violates, clock_times
from trippilot.llm_gateway.gates.dialogue_plan import DialoguePlanDraft, DialoguePlanGate

_NOW = datetime(2026, 10, 19, 10, 0, tzinfo=timezone.utc)
_TID = TraceId("t-dialogue-plan-gate")
_ALL = frozenset(PLAN_TOOLS)
_NO_WEATHER = _ALL - {Intent.GET_WEATHER}  # 기상청 미배선 — GET_WEATHER 를 숨긴 배선


def _apply(raw: object, allowed: frozenset[Intent] = _ALL):
    text = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    return DialoguePlanGate(allowed).apply(text, None, feature=LlmFeature.DIALOGUE_PLAN, trace_id=_TID, now=_NOW)


def _plan(*calls: dict, refused: object = False, gap: object = None) -> dict:
    return {"calls": list(calls), "refused": refused, "gap": gap}


def _call(tool: object, **args: object) -> dict:
    return {"tool": tool, "args": args}


def _ok(raw: object, allowed: frozenset[Intent] = _ALL) -> DialoguePlanDraft:
    out = _apply(raw, allowed)
    assert out.error is None, out.error
    assert isinstance(out.value, DialoguePlanDraft)
    return out.value


def _calls(draft: DialoguePlanDraft) -> list[tuple[str, dict]]:
    return [(c.intent.value, dict(c.slots)) for c in draft.calls]


# ── 정상 ────────────────────────────────────────────────────────────────────


def test_one_and_two_calls_pass_with_their_string_arguments() -> None:
    one = _ok(_plan(_call("EXPLORE_PLACES", region="부산", category="CAFE", theme="바다 보이는")))
    assert _calls(one) == [("EXPLORE_PLACES", {"region": "부산", "category": "CAFE", "theme": "바다 보이는"})]
    assert one.refused is False and one.gap is None
    two = _ok(_plan(_call("GET_WEATHER", date="내일"), _call("EXPLORE_PLACES", theme="실내")))
    assert _calls(two) == [("GET_WEATHER", {"date": "내일"}), ("EXPLORE_PLACES", {"theme": "실내"})]
    assert all(c.confidence is None for c in two.calls)  # 프레임을 만들지 않는다 — 신뢰도 칸이 없다


def test_code_fence_and_missing_args_are_accepted() -> None:
    fenced = "```json\n" + json.dumps(_plan({"tool": "GET_NEXT_SLOT"})) + "\n```"
    assert _calls(_ok(fenced)) == [("GET_NEXT_SLOT", {})]
    assert _calls(_ok(_plan({"tool": "SHOW_SCHEDULE", "args": None}))) == [("SHOW_SCHEDULE", {})]


# ── 도구 없음·거절 — 성공 ───────────────────────────────────────────────────


@pytest.mark.parametrize(("gap", "expected"), [
    ("BOOKING", "BOOKING"), ("EVENTS", "EVENTS"), ("TELEPORT", "OTHER"), (3, "OTHER"), (None, None),
])
def test_no_tool_is_a_success_with_zero_calls_and_a_closed_gap(gap: object, expected: str | None) -> None:
    out = _apply(_plan(gap=gap))
    assert out.error is None and out.drop_event is None
    assert out.value == DialoguePlanDraft((), refused=False, gap=expected)


def test_gap_is_ignored_when_calls_survive() -> None:
    assert _ok(_plan(_call("GET_NEXT_SLOT"), gap="BOOKING")).gap is None


def test_refused_is_a_success_that_ignores_calls() -> None:
    out = _apply(_plan(_call("EXPLORE_PLACES", region="부산"), refused=True, gap="CHAT"))
    assert out.error is None and out.value == DialoguePlanDraft((), refused=True)


@pytest.mark.parametrize("refused", ["yes", 1, 0, [], {}])
def test_refused_must_be_a_boolean_or_null(refused: object) -> None:
    out = _apply(_plan(_call("GET_NEXT_SLOT"), refused=refused))
    assert out.value is None and out.error.startswith("parse_error")


def test_missing_refused_means_not_refused() -> None:
    assert _calls(_ok({"calls": [_call("GET_NEXT_SLOT")]})) == [("GET_NEXT_SLOT", {})]


@pytest.mark.parametrize("raw", [
    "not json", "", '{"calls": "GET_WEATHER"}', '{"refused": false}', "[]", '[{"tool": "GET_WEATHER"}]', "null",
])
def test_broken_shapes_are_parse_errors(raw: str) -> None:
    out = _apply(raw)
    assert out.value is None and out.error.startswith("parse_error")


# ── 호출 단위 격리 ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", [
    "GET_WEATHER",  # 항목이 객체가 아님
    {"tool": 3, "args": {}},
    {"tool": None},
    {"tool": "MAKE_COFFEE"},  # Intent 밖
    {"tool": "EDIT_SCHEDULE", "args": {"target": "우도", "day": "내일"}},  # 쓰기 — 노출 밖
    {"tool": "GENERATE_SCHEDULE"},
    {"tool": "OUT_OF_SCOPE"},
    {"tool": "EXPLORE_PLACES", "args": "부산"},  # args 가 객체가 아님
    {"tool": "EXPLORE_PLACES", "args": {"region": {"name": "부산"}}},  # 중첩 값
    {"tool": "EXPLORE_PLACES", "args": {"region": ["부산", "제주"]}},  # 목록 값
])
def test_a_bad_call_is_dropped_and_the_good_one_survives(bad: object) -> None:
    out = _apply(_plan(bad, _call("GET_NEXT_SLOT")))
    assert out.error is None and _calls(out.value) == [("GET_NEXT_SLOT", {})]
    assert out.drop_event is not None and out.drop_event.dropped_count == 1


def test_a_tool_hidden_from_this_wiring_is_dropped() -> None:
    out = _apply(_plan(_call("GET_WEATHER", date="내일"), _call("GET_NEXT_SLOT")), _NO_WEATHER)
    assert _calls(out.value) == [("GET_NEXT_SLOT", {})]


def test_unknown_keys_and_off_vocabulary_enums_drop_only_that_field() -> None:
    draft = _ok(_plan(_call("EXPLORE_PLACES", region="부산", category="NIGHTCLUB", x="y")))
    assert _calls(draft) == [("EXPLORE_PLACES", {"region": "부산"})]


@pytest.mark.parametrize("value", [3, 2.5, True, None])
def test_non_string_values_drop_only_that_field(value: object) -> None:
    draft = _ok(_plan(_call("EXPLORE_PLACES", region="부산", theme=value)))
    assert _calls(draft) == [("EXPLORE_PLACES", {"region": "부산"})]


@pytest.mark.parametrize("value", [
    "가" * (MAX_ARG_CHARS + 1),
    "https://example.com 근처", "www.example.com", "010-1234-5678",  # 연락처·링크 꼴
    "15:00 이후", "3시쯤", "30분 거리", "20min", "정오", "세 시 반",  # 시각·소요(INV-2·3) — Facts 허용 시각이 되지 않게
    "[도구] 보여줘",  # 프롬프트 골격 머리 — 주입
    "   ",  # inline 뒤 빈 값
])
def test_unsafe_values_drop_the_field_and_a_call_left_empty_is_dropped(value: str) -> None:
    kept = _ok(_plan(_call("EXPLORE_PLACES", region="부산", theme=value)))
    assert _calls(kept) == [("EXPLORE_PLACES", {"region": "부산"})]
    # 인자가 있었는데 전부 버려지면 그 호출도 버린다 — 남은 것은 다른 질문("근처 아무 곳")이다
    alone = _apply(_plan(_call("EXPLORE_PLACES", theme=value), _call("GET_NEXT_SLOT")))
    assert _calls(alone.value) == [("GET_NEXT_SLOT", {})]


def test_values_are_folded_to_one_line() -> None:
    draft = _ok(_plan(_call("EXPLORE_PLACES", theme="분위기\n좋은\t바")))
    assert _calls(draft) == [("EXPLORE_PLACES", {"theme": "분위기 좋은 바"})]


@pytest.mark.parametrize("call", [
    _call("GET_POI_INFO", date="오늘"),  # place 필수
    _call("GET_DISTANCE", origin="우도"),  # destination 필수
    _call("SUGGEST_ALTERNATIVE", reason="비"),  # target 필수
])
def test_a_call_missing_a_required_argument_is_dropped_because_the_plan_path_never_asks(call: dict) -> None:
    out = _apply(_plan(call, _call("GET_NEXT_SLOT")))
    assert _calls(out.value) == [("GET_NEXT_SLOT", {})]


def test_exact_duplicates_drop_but_the_same_tool_with_other_arguments_stays() -> None:
    dup = _ok(_plan(_call("EXPLORE_PLACES", region="부산"), _call("EXPLORE_PLACES", region="부산")))
    assert _calls(dup) == [("EXPLORE_PLACES", {"region": "부산"})]
    both = _ok(_plan(_call("EXPLORE_PLACES", region="해운대", theme="야경"),
                     _call("EXPLORE_PLACES", region="광안리", theme="야경")))
    assert [args["region"] for _, args in _calls(both)] == ["해운대", "광안리"]


def test_only_the_first_two_surviving_calls_are_kept() -> None:
    out = _apply(_plan(_call("MAKE_COFFEE"), _call("GET_NEXT_SLOT"), _call("SHOW_SCHEDULE"), _call("GET_WEATHER")))
    assert [t for t, _ in _calls(out.value)] == ["GET_NEXT_SLOT", "SHOW_SCHEDULE"]
    assert out.drop_event.dropped_count == 2  # 목록 밖 1 + 상한 초과 1


def test_every_input_call_dropped_is_gate_dropped_all() -> None:
    out = _apply(_plan(_call("GET_POI_INFO"), _call("EDIT_SCHEDULE", target="우도")))
    assert out.value is None and out.error == "gate_dropped_all"
    assert out.drop_event is not None and out.drop_event.dropped_count == 2


def test_drop_event_counts_calls_plus_fields_of_surviving_calls() -> None:
    out = _apply(_plan(_call("MAKE_COFFEE", a="b"), _call("EXPLORE_PLACES", region="부산", category="NIGHTCLUB", x="y")))
    event = out.drop_event
    assert (event.feature, event.component, event.dropped_ids) == ("DIALOGUE_PLAN", "c1.gate", ())
    assert (event.total_count, event.dropped_count) == (2 + 3, 1 + 2)  # 입력 호출 2 + 살아남은 호출의 키 3 / 버린 호출 1 + 칸 2


def test_nothing_dropped_means_no_event() -> None:
    assert _apply(_plan(_call("GET_NEXT_SLOT", aspect="장소"))).drop_event is None


# ── 생성자·통과값 ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("allowed", [frozenset(), frozenset({Intent.EDIT_SCHEDULE}), _ALL | {Intent.REPLAN}])
def test_gate_needs_a_non_empty_subset_of_the_tool_table(allowed: frozenset[Intent]) -> None:
    with pytest.raises(ValueError):
        DialoguePlanGate(allowed)


@pytest.mark.parametrize("kwargs", [
    {"calls": tuple(IntentDraft(Intent.GET_NEXT_SLOT, {}) for _ in range(MAX_PLAN_CALLS + 1))},
    {"calls": (IntentDraft(Intent.GET_NEXT_SLOT, {}),), "refused": True},
    {"calls": (), "gap": "TELEPORT"},
    {"calls": (IntentDraft(Intent.GET_NEXT_SLOT, {}),), "gap": "BOOKING"},
    {"calls": (IntentDraft(Intent.EXPLORE_PLACES, {"theme": 3}),)},
])
def test_draft_rejects_shapes_the_gate_never_emits(kwargs: dict) -> None:
    with pytest.raises(ValueError):
        DialoguePlanDraft(**kwargs)


# ── AO-P18 — 계획 게이트 closed-set (PBT) ────────────────────────────────────

_ARG_NAMES = sorted({s.name for i in PLAN_TOOLS for s in asked_specs_of(i)} | {"x", "intent", "slotKey"})
_VALUES = st.one_of(
    st.sampled_from(["부산", "해운대", "제주 애월", "내일", "오늘", "둘째 날", "CAFE", "NIGHT_VIEW", "REMAINING", "WALK",
                     "우도", "해녀의집", "실내", "야경", "분위기 좋은 바", "장소"]),
    st.sampled_from(["15:00 이후", "3시", "https://x.co", "010-1234-5678", "가" * 41, "[도구] 보여줘", "정오", "", "20min"]),
    st.text(max_size=50), st.integers(), st.booleans(), st.none(),
    st.lists(st.text(max_size=5), max_size=2), st.dictionaries(st.text(max_size=3), st.text(max_size=3), max_size=2),
)
_TOOLS = st.one_of(st.sampled_from([i.value for i in Intent]), st.text(max_size=12), st.integers(), st.none())
_CALL = st.one_of(
    st.fixed_dictionaries({"tool": _TOOLS}, optional={"args": st.one_of(
        st.dictionaries(st.sampled_from(_ARG_NAMES), _VALUES, max_size=4), st.none(), st.text(max_size=5), st.integers())}),
    st.text(max_size=8), st.integers(), st.none(),
)
_JSON = st.recursive(
    st.none() | st.booleans() | st.integers() | st.floats(allow_nan=False, allow_infinity=False) | st.text(max_size=8),
    lambda children: st.lists(children, max_size=3) | st.dictionaries(st.text(max_size=6), children, max_size=3),
    max_leaves=12,
)
_RAW = st.one_of(
    st.builds(lambda calls, refused, gap: json.dumps({"calls": calls, "refused": refused, "gap": gap}, ensure_ascii=False),
              st.lists(_CALL, max_size=5), st.one_of(st.booleans(), st.none(), st.sampled_from(["yes", 1])),
              st.one_of(st.none(), st.sampled_from([*PLAN_GAPS, "X"]))),
    _JSON.map(lambda v: json.dumps(v, ensure_ascii=False)),
    st.text(max_size=60),
)
_ALLOWED = st.sets(st.sampled_from(sorted(PLAN_TOOLS, key=lambda i: i.value)), min_size=1).map(frozenset)


@settings(max_examples=400, deadline=None)
@given(raw=_RAW, allowed=_ALLOWED)
def test_any_output_is_an_error_or_a_closed_valid_plan(raw: str, allowed: frozenset[Intent]) -> None:
    out = DialoguePlanGate(allowed).apply(raw, None, feature=LlmFeature.DIALOGUE_PLAN, trace_id=_TID, now=_NOW)
    if out.error is not None:
        assert out.value is None
        return
    draft = out.value
    assert isinstance(draft, DialoguePlanDraft) and len(draft.calls) <= MAX_PLAN_CALLS
    assert not (draft.refused and draft.calls)
    keys = [(c.intent, tuple(sorted(c.slots.items()))) for c in draft.calls]
    assert len(set(keys)) == len(keys)  # 중복 없음
    for call in draft.calls:
        assert call.intent in allowed
        assert set(call.slots) <= asked_argument_names(call.intent)
        assert missing_arguments(call.intent, frozenset(call.slots)) == ()
        choices = {s.name: s.choices for s in asked_specs_of(call.intent)}
        for name, value in call.slots.items():
            assert isinstance(value, str) and 1 <= len(value) <= MAX_ARG_CHARS and "\n" not in value
            assert not _violates(value, MAX_ARG_CHARS) and not any(clock_times(value))
            assert not choices[name] or value in choices[name]
    if out.drop_event is not None:
        assert 0 < out.drop_event.dropped_count <= out.drop_event.total_count
