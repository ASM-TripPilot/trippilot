"""UnknownHandlingAgent — 먼저 답하고 뒤에서 찾기(2026-10-22 사용자 결정). `run(UnknownTask)` 하나로 찾았음·찾는 중·없음 셋이
갈리고, 저장·중복 제거·하루 상한·실패 미저장·장애 수렴 · 물은 칸을 다 찾아본 기록만 답이 된다(안 찾아본 칸이면 저장된 칸까지 다시 찾는다,
2026-10-30). (저장소 구현 2종의 계약은 `tests/agents/adapters/test_place_fact_stores.py`,
폴백 문장이 답변 검사를 넘는다는 PBT 는 핸들러 몫 — `tests/orchestrator/test_web_sentence.py`)"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest

from trippilot.agents.adapters.memory_place_fact_store import InMemoryPlaceFactStore
from trippilot.agents.unknown_handling import agent as uh
from trippilot.agents.unknown_handling.agent import UnknownHandlingAgent, UnknownOutcome, UnknownTask
from trippilot.domain.common import TraceId
from trippilot.domain.llm import TypedResult
from trippilot.ports.place_fact_store_port import FIELDS, FactRecord, PlaceFacts

_NOW = datetime(2026, 10, 22, 6, 0, tzinfo=timezone.utc)
_ON = date(2026, 10, 22)
_FACTS = PlaceFacts(hours="09:00~18:00", last_entry="17:00", closed="매주 화요일", fee="3,000원",
                    source_url="https://royal.khs.go.kr/a", source_host="royal.khs.go.kr")


class _Worker:
    def __init__(self, result: TypedResult) -> None:
        self.result, self.calls = result, []

    def lookup(self, place, fields, on, trace_id, now, *, timeout_sec, retry_timeout_sec=None):
        self.calls.append((place, fields, on, timeout_sec, retry_timeout_sec))
        return self.result


class _Later:
    """뒤에서 돌 일을 모아 두었다가 테스트가 원할 때 돌린다 — 이번 턴이 기다리지 않는다는 것을 보인다."""

    def __init__(self) -> None:
        self.jobs: list = []

    def __call__(self, fn, *args):
        self.jobs.append((fn, args))

    def run(self) -> None:
        jobs, self.jobs = self.jobs, []
        for fn, args in jobs:
            fn(*args)


def _ok(value) -> TypedResult:
    return TypedResult(value=value, is_fallback=False, error=None, call_record=None)


def _agent(result: TypedResult):
    later, store, worker = _Later(), InMemoryPlaceFactStore(), _Worker(result)
    return UnknownHandlingAgent(worker, store, submit=later), later, store, worker


def _task(poi_id="p1", place="경복궁 서울 종로구", fields=("hours", "last_entry"), *, now=_NOW, trace="t") -> UnknownTask:
    return UnknownTask(poi_id=poi_id, place=place, fields=tuple(fields), on=_ON, trace_id=TraceId(trace), now=now)


def test_run_says_pending_at_once_and_the_next_ask_sees_the_found_value() -> None:
    agent, later, _, worker = _agent(_ok(_FACTS))
    assert agent.run(_task()) == UnknownOutcome(pending=True)
    assert worker.calls == []  # 이번 턴은 찾기를 기다리지 않는다
    later.run()
    assert agent.run(_task(now=_NOW + timedelta(minutes=1))) == UnknownOutcome(facts=_FACTS)
    # 저장된 값을 돌려줬다 — 다시 찾지 않는다. retry_timeout_sec 도 같은 예산(LOOKUP_TIMEOUT_S)으로 넘어갔다(2026-10-30 벤더 폴백).
    assert worker.calls == [("경복궁 서울 종로구", ("hours", "last_entry"), _ON, uh.LOOKUP_TIMEOUT_S, uh.LOOKUP_TIMEOUT_S)]
    assert agent.run(_task(now=_NOW + uh.FOUND_TTL - timedelta(seconds=1))) == UnknownOutcome(facts=_FACTS)  # 일주일 안에는 그대로
    assert agent.run(_task(now=_NOW + uh.FOUND_TTL)) == UnknownOutcome(pending=True)  # 일주일이 되면 다시 찾는다
    assert len(later.jobs) == 1  # 새로 냈다


def test_the_same_place_is_not_looked_up_twice_while_in_flight() -> None:
    agent, later, _, _ = _agent(_ok(_FACTS))
    assert agent.run(_task(trace="a")).pending
    assert agent.run(_task(trace="b")).pending  # 찾는 중 — "찾는 중"이라 답하는 것이 맞다
    assert len(later.jobs) == 1


def test_nothing_found_is_stored_briefly_and_a_failure_is_not_stored() -> None:
    agent, later, _, _ = _agent(_ok(None))
    agent.run(_task())
    later.run()
    assert agent.run(_task()) == UnknownOutcome() and later.jobs == []  # 못 찾음 — 하루는 다시 찾지 않고 종전대로 "미확인"
    assert agent.run(_task(now=_NOW + uh.MISS_TTL)).pending  # 하루 뒤 다시 찾는다
    failing, later2, _, _ = _agent(TypedResult(value=None, is_fallback=True, error="timeout", call_record=None))
    failing.run(_task("p2", "남산서울타워", ("hours",)))
    later2.run()
    assert failing.run(_task("p2", "남산서울타워", ("hours",), trace="t2")).pending  # 시한·형식·출처 없음은 저장하지 않는다
    assert len(later2.jobs) == 1  # 찾는 중 표시가 풀려 새로 냈다 — 다음에 물으면 다시 찾는다


class _AskedOnly:
    """[찾을 칸]만 찾는 워커 — 실 모델처럼 물은 칸만 채운다(2026-10-30 Codex 리뷰 재현). `values` 에 없는 칸은 웹에도 없다."""

    def __init__(self, **values: str) -> None:
        self.values, self.calls = values, []

    def lookup(self, place, fields, on, trace_id, now, *, timeout_sec, retry_timeout_sec=None):
        self.calls.append(fields)
        found = {f: self.values.get(f) if f in fields else None for f in FIELDS}
        return _ok(PlaceFacts(**found, source_url=_FACTS.source_url, source_host=_FACTS.source_host) if any(found.values()) else None)


def _asking(worker: _AskedOnly, store=None):
    later = _Later()
    return UnknownHandlingAgent(worker, store or InMemoryPlaceFactStore(), submit=later), later


def test_a_record_that_did_not_look_up_the_asked_field_looks_again_with_the_stored_ones() -> None:
    """영업시간만 찾은 기록이 입장료 물음에 그대로 나가 일주일 "미확인"이었다(2026-10-30 Codex 리뷰 재현) — 물은 칸을 다 찾아본 기록만
    답이 된다. 다시 찾을 때는 저장된 칸까지 함께 찾아 한 기록으로 덮는다(출처 칸이 하나라 두 조회의 값을 섞지 않는다)."""
    worker = _AskedOnly(hours="09:00~18:00", last_entry="17:00", fee="3,000원")
    agent, later = _asking(worker)
    agent.run(_task())  # 영업시간 먼저
    later.run()
    soon = _NOW + timedelta(minutes=1)
    assert agent.run(_task(fields=("fee",), now=soon)) == UnknownOutcome(pending=True)  # 입장료는 찾아본 적이 없다
    later.run()
    assert worker.calls == [("hours", "last_entry"), ("hours", "last_entry", "fee")]
    found = agent.run(_task(fields=("fee",), now=soon)).facts
    assert (found.hours, found.last_entry, found.fee) == ("09:00~18:00", "17:00", "3,000원")
    assert agent.run(_task(now=soon)).facts == found and len(worker.calls) == 2  # 영업시간도 그 기록으로 — 다시 찾지 않는다


def test_a_miss_holds_back_only_the_fields_it_looked_up() -> None:
    worker = _AskedOnly(hours="09:00~18:00")  # 입장료는 웹에도 없다
    agent, later = _asking(worker)
    agent.run(_task(fields=("fee",)))
    later.run()  # 입장료 못 찾음 — 하루 보관
    assert agent.run(_task(fields=("fee",), trace="t2")) == UnknownOutcome() and later.jobs == []
    assert agent.run(_task(trace="t3")) == UnknownOutcome(pending=True)  # 영업시간은 찾아본 적이 없다 — 입장료 못 찾음이 막지 않는다
    later.run()
    assert worker.calls == [("fee",), ("hours", "last_entry", "fee")]
    # 찾은 기록 안의 빈 칸(입장 마감·입장료)도 찾아본 칸이다 — 기록이 살아 있는 동안 영업시간·입장료 물음 모두 다시 찾지 않는다
    assert agent.run(_task(now=_NOW + uh.FOUND_TTL - timedelta(seconds=1))).facts.hours == "09:00~18:00"
    assert agent.run(_task(fields=("fee",), trace="t4")).facts.fee is None and later.jobs == []


def test_an_old_record_without_looked_up_fields_counts_only_its_values() -> None:
    store = InMemoryPlaceFactStore()
    store.put(FactRecord("p1", replace(_FACTS, fee=None), _NOW, _NOW + uh.FOUND_TTL))  # 2026-10-30 전 행 — searched 없음
    agent, later = _asking(_AskedOnly(fee="3,000원"), store)
    assert agent.run(_task()).facts.hours == "09:00~18:00" and later.jobs == []  # 값이 있는 칸은 찾아본 칸이다
    assert agent.run(_task(fields=("fee",))) == UnknownOutcome(pending=True)  # 값 없는 칸은 찾아봤는지 몰라 다시 찾는다


def test_daily_cap_stops_new_lookups_until_the_next_day(monkeypatch) -> None:
    monkeypatch.setattr(uh, "DAILY_CAP", 2)
    agent, _, _, _ = _agent(_ok(_FACTS))
    assert agent.run(_task("a", "a", ("hours",))).pending and agent.run(_task("b", "b", ("hours",))).pending
    assert agent.run(_task("c", "c", ("hours",))) == UnknownOutcome()  # 상한 — "찾는 중"이라 말하지 않는다
    assert agent.run(_task("c", "c", ("hours",), now=_NOW + timedelta(days=1))).pending


def test_a_broken_store_reads_as_unknown_and_nothing_leaks_out() -> None:
    class _Broken(InMemoryPlaceFactStore):
        def get(self, poi_id, now):
            raise ConnectionError("db down")

        def put(self, record):
            raise ConnectionError("db down")

    later = _Later()
    agent = UnknownHandlingAgent(_Worker(_ok(_FACTS)), _Broken(), submit=later)
    assert agent.run(_task()) == UnknownOutcome(pending=True)  # 저장소 장애는 "없음"과 같다(INV-4) — 그래도 뒤에서 찾기는 낸다
    later.run()  # 저장 실패도 밖으로 새지 않는다 — 사유만 남긴다
    assert agent.run(_task(trace="t2")) == UnknownOutcome(pending=True) and len(later.jobs) == 1  # 찾는 중 표시가 풀려 새로 냈다


def test_a_refused_submit_is_not_pending_and_does_not_leave_the_place_in_flight() -> None:
    later, refusals = _Later(), [RuntimeError("pool closed")]

    def flaky(fn, *args):
        if refusals:
            raise refusals.pop()
        later(fn, *args)

    agent = UnknownHandlingAgent(_Worker(_ok(_FACTS)), InMemoryPlaceFactStore(), submit=flaky)
    assert agent.run(_task()) == UnknownOutcome()  # 못 냈으면 "찾는 중"이라 말하지 않는다
    assert agent.run(_task(trace="t2")) == UnknownOutcome(pending=True) and len(later.jobs) == 1  # 찾는 중 표시를 되돌렸다 — 다음엔 낸다


def test_outcome_cannot_be_found_and_pending_at_once() -> None:
    with pytest.raises(ValueError):
        UnknownOutcome(facts=_FACTS, pending=True)


# ── 일반 지식 즉답 (KnowledgeTask, BR-AO-32 · 2026-10-23 사용자 결정) ─────────────────────────────


class _Knowing:
    """지식 워커 대역 — 게이트웨이처럼 TypedResult 를 돌려준다(던지게도 할 수 있다)."""

    def __init__(self, result: TypedResult | Exception) -> None:
        self.result, self.calls = result, []

    def answer(self, utterance, recent_turns, memory_lines, trip_summary, trace_id, now, *, timeout_sec):
        self.calls.append((utterance, tuple(memory_lines), trip_summary, timeout_sec))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _ask(question: str = "부산은 언제 가는 게 좋아?") -> uh.KnowledgeTask:
    return uh.KnowledgeTask(question, (), ("제약: 아이와 함께라 많이 걷기 힘들다",), "여행 부산", TraceId("k"), _NOW, timeout_sec=3.0)


def test_knowledge_is_answered_this_turn_without_touching_the_place_fact_side() -> None:
    from trippilot.llm_gateway.gates.dialogue_answer import DialogueAnswerDraft

    knowing = _Knowing(_ok(DialogueAnswerDraft("부산은 보통 봄과 가을이 걷기 좋아요.")))
    agent = UnknownHandlingAgent(None, None, knowledge=knowing)
    assert agent.knows_general is True
    assert agent.run(_ask()) == UnknownOutcome(answer="부산은 보통 봄과 가을이 걷기 좋아요.")
    assert knowing.calls == [("부산은 언제 가는 게 좋아?", ("제약: 아이와 함께라 많이 걷기 힘들다",), "여행 부산", 3.0)]
    assert agent.run(_task()) == UnknownOutcome()  # 장소 사실 웹 확인은 미배선 — 종전 "미확인"


@pytest.mark.parametrize("result", [
    _ok(None),  # 모른다고 닫음(text=null) — 판단, 실패 아님
    TypedResult(value=None, is_fallback=True, error="gate_dropped_all", call_record=None),  # 가격·날짜·연도 등 — 게이트웨이가 보고했다
])
def test_knowledge_declined_or_failed_is_nothing(result) -> None:
    agent = UnknownHandlingAgent(None, None, knowledge=_Knowing(result))
    assert agent.run(_ask()) == UnknownOutcome()


def test_a_knowledge_worker_exception_is_nothing_with_its_reason() -> None:
    """게이트웨이를 부르지 못한 실패(프롬프트 변수 누락 등)는 던지지 않고 없음 — 단 사유를 싣는다. 게이트웨이가 보고하지 못했으니 호출측이
    이벤트를 낸다(모른다고 닫음과 가르지 못하면 침묵 실패였다, 2026-10-23 리뷰 재현)."""
    agent = UnknownHandlingAgent(None, None, knowledge=_Knowing(ValueError("template variable missing")))
    assert agent.run(_ask()) == UnknownOutcome(error="ValueError")


def test_without_the_knowledge_worker_the_agent_does_not_know_general_things() -> None:
    agent, _, _, worker = _agent(_ok(_FACTS))
    assert agent.knows_general is False and agent.run(_ask()) == UnknownOutcome() and worker.calls == []


@pytest.mark.parametrize("kwargs", [
    {"facts": _FACTS, "pending": True}, {"facts": _FACTS, "answer": "a"}, {"pending": True, "answer": "a"}, {"answer": "  "},
    {"answer": "a", "error": "ValueError"}, {"pending": True, "error": "ValueError"},
])
def test_outcome_shapes_cannot_lie_to_each_other(kwargs: dict) -> None:
    with pytest.raises(ValueError):
        UnknownOutcome(**kwargs)


@pytest.mark.parametrize("over", [{"question": "  "}, {"timeout_sec": 0.0}])
def test_knowledge_task_rejects_an_empty_question_or_no_time(over: dict) -> None:
    base = dict(question="언제 가?", history=(), memory_lines=(), trip_summary="", trace_id=TraceId("k"), now=_NOW, timeout_sec=1.0)
    with pytest.raises(ValueError):
        uh.KnowledgeTask(**{**base, **over})
