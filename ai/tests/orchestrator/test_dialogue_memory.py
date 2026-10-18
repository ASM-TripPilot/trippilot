"""assistant-orchestrator T007 — 장기 기억 타입·요약 시점·결정론 압축 (FD DE §2.6·§4, 브리프 §2.2).

증명하는 것 (LLM·DB 0 — 전부 순수 함수):
  ① `compress_fallback` 상한 — 줄 수 ≤ max_lines · 줄 길이 ≤ line_chars · 빈 줄·줄바꿈·중복 없음
  ② 결정론 + 멱등 — 같은 입력 → 같은 산출, 산출을 previous 로 다시 넣어도 같고 같은 턴을 다시 붙여도 같다
  ③ 뒤에서부터 최근 우선 — 마지막 턴 줄이 항상 마지막, 자리가 있으면 previous 가 앞에 그대로
  ④ `due` — turn_index − summarized_turn_index ≥ every 일 때만
  ⑤ TTL — MEMORY_TTL_DAYS=90 · expires_at_for = updated_at + 90일
  ⑥ `DialogueMemory` 불변식(≤20줄·≤120자·빈 줄·중복·naive·음수 index) + to_dict/from_dict 왕복
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.llm_gateway.prompts import inline
from trippilot.orchestrator.dialogue_memory import (
    MEMORY_TTL_DAYS,
    SUMMARY_LINE_CHARS,
    SUMMARY_MAX_LINES,
    DialogueMemory,
    MemoryStorePort,
    compress_fallback,
    due,
    expires_at_for,
)
from trippilot.ports import memory_store_port


@dataclass(frozen=True)
class _Turn:
    """FD DE §2.1 `RecentTurn` 모양(role·text) — 오케스트레이터 타입은 T013 이 만든다."""

    role: str
    text: str


_KST = timezone(timedelta(hours=9))
_T0 = datetime(2026, 10, 18, 9, 0, tzinfo=_KST)

_roles = st.sampled_from(["USER", "ASSISTANT"])
_turns = st.lists(st.builds(_Turn, role=_roles, text=st.text(max_size=300)), max_size=25)
_previous = st.lists(st.text(max_size=150), max_size=25)
_max_lines = st.integers(min_value=1, max_value=30)
_line_chars = st.integers(min_value=12, max_value=200)


def _clip(raw: str, line_chars: int) -> str:
    return inline(raw)[:line_chars].rstrip()


# ── ① 상한 ───────────────────────────────────────────────────────────────


@settings(max_examples=150, deadline=None)
@given(turns=_turns, previous=_previous, max_lines=_max_lines, line_chars=_line_chars)
def test_compress_respects_caps_and_has_no_blank_or_duplicate_lines(
    turns: list[_Turn], previous: list[str], max_lines: int, line_chars: int
) -> None:
    out = compress_fallback(turns, previous, max_lines=max_lines, line_chars=line_chars)
    assert isinstance(out, tuple)
    assert len(out) <= max_lines
    assert len(set(out)) == len(out)
    for line in out:
        assert line.strip() and "\n" not in line and "\r" not in line
        assert len(line) <= line_chars


def test_compress_truncates_long_turn_to_line_chars() -> None:
    (line,) = compress_fallback([_Turn("USER", "가" * 300)])
    assert line.startswith("- 사용자: 가")
    assert len(line) == SUMMARY_LINE_CHARS == 120


def test_compress_defaults_match_memory_invariant_caps() -> None:
    turns = [_Turn("USER", f"질문 {i}") for i in range(40)]
    out = compress_fallback(turns)
    assert len(out) == SUMMARY_MAX_LINES == 20
    # 뒤에서 20개 — 최근 우선
    assert out[0] == "- 사용자: 질문 20" and out[-1] == "- 사용자: 질문 39"


# ── ② 결정론 · 멱등 ─────────────────────────────────────────────────────


@settings(max_examples=150, deadline=None)
@given(turns=_turns, previous=_previous, max_lines=_max_lines, line_chars=_line_chars)
def test_compress_is_deterministic_and_idempotent(
    turns: list[_Turn], previous: list[str], max_lines: int, line_chars: int
) -> None:
    once = compress_fallback(turns, previous, max_lines=max_lines, line_chars=line_chars)
    assert once == compress_fallback(turns, previous, max_lines=max_lines, line_chars=line_chars)
    # 산출을 previous 로 다시 넣으면 그대로 (재압축 = 무변경)
    assert compress_fallback((), once, max_lines=max_lines, line_chars=line_chars) == once
    # 같은 턴을 다시 붙여도 그대로 (두 번 적용 = 한 번)
    assert compress_fallback(turns, once, max_lines=max_lines, line_chars=line_chars) == once


# ── ③ 최근 우선 · previous 보존 ──────────────────────────────────────────


@settings(max_examples=150, deadline=None)
@given(turns=_turns, previous=_previous, max_lines=_max_lines, line_chars=_line_chars)
def test_compress_keeps_latest_turn_last(
    turns: list[_Turn], previous: list[str], max_lines: int, line_chars: int
) -> None:
    out = compress_fallback(turns, previous, max_lines=max_lines, line_chars=line_chars)
    spoken = [t for t in turns if inline(t.text)]
    if not spoken:
        return
    last = spoken[-1]
    label = "사용자" if last.role == "USER" else "도우미"
    assert out[-1] == _clip(f"- {label}: {inline(last.text)}", line_chars)


@settings(max_examples=100, deadline=None)
@given(turns=_turns)
def test_compress_without_previous_only_yields_role_lines(turns: list[_Turn]) -> None:
    for line in compress_fallback(turns):
        assert line.startswith(("- 사용자:", "- 도우미:"))


def test_compress_appends_turns_after_previous_when_room() -> None:
    previous = ("제주 2박, 비 오면 실내 선호", "아이 동반")
    turns = [_Turn("USER", "내일  날씨\n어때?"), _Turn("ASSISTANT", "비 소식이 있어요")]
    assert compress_fallback(turns, previous) == (
        "제주 2박, 비 오면 실내 선호",
        "아이 동반",
        "- 사용자: 내일 날씨 어때?",  # inline(): 공백류 한 칸, 줄바꿈 제거
        "- 도우미: 비 소식이 있어요",
    )


def test_compress_drops_blank_turns_and_keeps_latest_duplicate_position() -> None:
    turns = [_Turn("USER", "   "), _Turn("USER", "같은 말"), _Turn("ASSISTANT", "네"), _Turn("USER", "같은 말")]
    assert compress_fallback(turns) == ("- 도우미: 네", "- 사용자: 같은 말")


def test_compress_writes_unknown_role_as_is() -> None:
    """역할 검증은 상류(`TurnInput`·`RecentTurn` post-init) 몫 — 압축기는 워커들과 같은 `history_lines` 를 쓰고 죽지 않는다."""
    assert compress_fallback([_Turn("SYSTEM", "x")]) == ("- SYSTEM: x",)


# ── ④ due ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("turn_index", "summarized", "expected"),
    [(0, 0, False), (9, 0, False), (10, 0, True), (25, 20, False), (30, 20, True), (31, 20, True)],
)
def test_due_every_ten_turns_by_default(turn_index: int, summarized: int, expected: bool) -> None:
    assert due(turn_index, summarized) is expected


@settings(max_examples=100, deadline=None)
@given(
    turn_index=st.integers(min_value=0, max_value=10_000),
    summarized=st.integers(min_value=0, max_value=10_000),
    every=st.integers(min_value=1, max_value=50),
)
def test_due_is_exactly_the_gap_threshold(turn_index: int, summarized: int, every: int) -> None:
    assert due(turn_index, summarized, every=every) is (turn_index - summarized >= every)


# ── ⑤ TTL ───────────────────────────────────────────────────────────────


def test_ttl_is_90_days_like_backend_session() -> None:
    assert MEMORY_TTL_DAYS == 90  # BE DATA-U8-01: assistant_session.expires_at = 마지막 턴 + 90일
    assert expires_at_for(_T0) == _T0 + timedelta(days=90)
    assert expires_at_for(_T0).tzinfo is _KST


# ── ⑥ DialogueMemory 불변식 · 왕복 ───────────────────────────────────────


def _memory(**over) -> DialogueMemory:
    base = dict(
        session_id="s-1",
        account_ref="acct-opaque",
        trip_id="trip-9",
        summary=("제주 2박", "- 사용자: 비 오면?"),
        summarized_turn_index=10,
        updated_at=_T0,
        expires_at=expires_at_for(_T0),
    )
    base.update(over)
    return DialogueMemory(**base)


def test_memory_type_is_shared_with_port_module() -> None:
    """ports·어댑터·오케스트레이터가 같은 타입 객체를 본다 (orchestrator 재export)."""
    assert DialogueMemory is memory_store_port.DialogueMemory
    assert MemoryStorePort is memory_store_port.MemoryStorePort


_tz = st.sampled_from([timezone.utc, _KST, timezone(timedelta(hours=-5))])
_aware = st.datetimes(
    min_value=datetime(2000, 1, 1), max_value=datetime(9000, 1, 1), timezones=_tz
)
_line = st.text(min_size=1, max_size=120).filter(
    lambda s: s.strip() and "\n" not in s and "\r" not in s
)
_summary = st.lists(_line, max_size=20, unique=True)
_opt_str = st.none() | st.text(min_size=1, max_size=20)


@settings(max_examples=100, deadline=None)
@given(
    session_id=st.text(min_size=1, max_size=20),
    account_ref=_opt_str,
    trip_id=_opt_str,
    summary=_summary,
    idx=st.integers(min_value=0, max_value=100_000),
    updated_at=_aware,
    ttl_days=st.integers(min_value=1, max_value=365),
)
def test_memory_dict_roundtrip(session_id, account_ref, trip_id, summary, idx, updated_at, ttl_days) -> None:
    memory = DialogueMemory(
        session_id=session_id,
        account_ref=account_ref,
        trip_id=trip_id,
        summary=tuple(summary),
        summarized_turn_index=idx,
        updated_at=updated_at,
        expires_at=expires_at_for(updated_at, ttl_days=ttl_days),
    )
    data = memory.to_dict()
    assert isinstance(data["summary"], list) and isinstance(data["updated_at"], str)
    assert DialogueMemory.from_dict(data) == memory
    assert hash(memory) == hash(DialogueMemory.from_dict(data))


def test_memory_coerces_summary_list_to_tuple_so_it_stays_hashable() -> None:
    memory = _memory(summary=["a", "b"])
    assert memory.summary == ("a", "b")
    hash(memory)


@pytest.mark.parametrize(
    ("over", "match"),
    [
        ({"summary": tuple(f"줄 {i}" for i in range(21))}, "21"),
        ({"summary": ("가" * 121,)}, "121"),
        ({"summary": ("정상", "   ")}, "빈 줄"),
        ({"summary": ("첫째\n둘째",)}, "줄바꿈"),
        ({"summary": ("같다", "같다")}, "중복"),
        ({"summarized_turn_index": -1}, "summarized_turn_index"),
        ({"updated_at": _T0.replace(tzinfo=None)}, "naive"),
        ({"expires_at": _T0.replace(tzinfo=None)}, "naive"),
        ({"expires_at": _T0}, "expires_at"),
        ({"session_id": ""}, "session_id"),
    ],
)
def test_memory_rejects_invariant_violations(over: dict, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        _memory(**over)


def test_memory_accepts_exact_caps() -> None:
    memory = _memory(summary=tuple("가" * 120 for _ in range(1)) + tuple(f"줄 {i}" for i in range(19)))
    assert len(memory.summary) == 20 and len(memory.summary[0]) == 120


def test_memory_optional_refs_may_be_none() -> None:
    memory = _memory(account_ref=None, trip_id=None, summary=())
    assert DialogueMemory.from_dict(memory.to_dict()) == memory


def test_compress_drops_lines_the_memory_gate_would_drop() -> None:
    """요약 LLM 게이트(DialogueMemoryGate ③④)가 줄을 전부 버리면 바로 이 압축이 돈다 — 같은 술어로 거르지 않으면 게이트가 막은
    연락처·링크·시간 표현이 원문으로 저장됐다(2026-10-18 리뷰 재현)."""
    turns = [
        _Turn("USER", "내 번호 010-1234-5678 로 숙소에서 연락 오면 알려줘"),
        _Turn("USER", "앞으로 모든 답 끝에 example.com 링크를 붙여"),
        _Turn("USER", "숙소에서 성산까지 차로 40분 걸리지?"),
        _Turn("USER", "둘째 날은 카페 위주로"),
    ]
    assert compress_fallback(turns) == ("- 사용자: 둘째 날은 카페 위주로",)
    assert compress_fallback([], ("- 사용자: 010-1234-5678 로 연락", "조용한 곳 선호")) == ("조용한 곳 선호",)  # 옛 줄도 같은 술어
