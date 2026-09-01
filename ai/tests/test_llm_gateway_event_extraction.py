"""TRIP-421 — EVENT_EXTRACTION 4종 세트: 프롬프트·게이트·워커·폴백.

게이트: 항목 단위 격리 (place_extraction 선례 동형) + 원문 스니펫 대조로
지어낸 행사명 차단 (closed-set 정신). 전량 드롭·파싱 실패는 폴백 신호 (INV-4).
워커: 조립 → gateway.call, 폴백 TypedResult 그대로 (BR-U4-09).
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.event_extraction import (
    EventExtractionContext,
    EventExtractionGate,
)
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.event_extraction import (
    EventExtractionWorker,
    build_event_extraction_vars,
)
from trippilot.domain.common import TraceId
from trippilot.domain.event import EventInfo, EventType
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.observability import FallbackEvent, GateDropEvent
from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace

_NOW = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)
_TID = TraceId("t-evx")
_FEAT = LlmFeature.EVENT_EXTRACTION
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})

_SNIPPETS = (
    ("부산불꽃축제 개최 안내", "10월 24일부터 25일까지 광안리해수욕장 일원"),
    ("가을 재즈 공연 소식", "부산 시민공원에서 10월 한 달간 주말 공연"),
)
_PERIOD = (date(2026, 10, 20), date(2026, 10, 27))
_CTX = EventExtractionContext(
    snippets_text=build_event_extraction_vars("부산", *_PERIOD, _SNIPPETS)["snippets"],
    period_start=_PERIOD[0],
    period_end=_PERIOD[1],
)


def _facade(llm, gate, trace=None):
    return GatewayFacade(
        llm, PromptRegistry(_PROMPTS), gate, _CFG, trace or InMemoryTrace()
    )


def _event(**overrides) -> dict:
    base = {
        "name": "부산불꽃축제",
        "event_type": "FESTIVAL",
        "start": "2026-10-24",
        "end": "2026-10-25",
        "address": "부산 수영구 광안리해수욕장",
    }
    return {**base, **overrides}


# ── EventExtractionGate: 항목 단위 격리 ──────────────────────


def test_gate_keeps_valid_and_isolates_violations() -> None:
    raw = json.dumps({"events": [
        _event(),                                                # 생존
        _event(name="서울재즈페스티벌"),                          # ⑤ 스니펫에 없는 이름 (지어냄)
        _event(event_type="CONCERT"),                            # ② 4값 밖 — 관대 매핑 금지
        _event(start="10월 24일"),                               # ③ ISO 파싱 실패
        _event(start="2026-10-25", end="2026-10-24"),            # ③ 기간 역전
        _event(start="2026-11-01", end="2026-11-03"),            # ④ 대상 기간과 비겹침
        {"event_type": "FESTIVAL", "start": "2026-10-24", "end": "2026-10-25"},  # ① name 누락
    ]})
    out = EventExtractionGate().apply(raw, _CTX, feature=_FEAT, trace_id=_TID, now=_NOW)
    assert out.error is None
    assert len(out.value) == 1 and isinstance(out.value[0], EventInfo)
    assert out.value[0].event_type is EventType.FESTIVAL
    assert out.value[0].coord is None  # 좌표는 다루지 않음
    assert out.drop_event is not None and out.drop_event.dropped_count == 6
    assert out.drop_event.dropped_ids == ()  # 행사명이 PoiId 지표를 오염하지 않는다


def test_gate_name_check_absorbs_spacing_and_requires_all_tokens() -> None:
    g = EventExtractionGate()
    # 띄어쓰기 차이 흡수: "부산 불꽃 축제" ↔ 원문 "부산불꽃축제"
    ok = json.dumps({"events": [_event(name="부산 불꽃 축제")]})
    out = g.apply(ok, _CTX, feature=_FEAT, trace_id=_TID, now=_NOW)
    assert out.error is None and len(out.value) == 1
    # 원문에 없는 토큰이 하나라도 섞이면 드롭 (보수적)
    bad = json.dumps({"events": [_event(name="부산불꽃축제 에프터파티")]})
    out2 = g.apply(bad, _CTX, feature=_FEAT, trace_id=_TID, now=_NOW)
    assert out2.value == () and out2.drop_event.dropped_count == 1


def test_gate_partial_period_overlap_survives() -> None:
    # 하루라도 겹치면 생존: 기간 끝(10-27)에 시작하는 행사
    raw = json.dumps({"events": [
        _event(name="가을 재즈 공연", event_type="PERFORMANCE",
               start="2026-10-27", end="2026-10-31", address=None),
    ]})
    out = EventExtractionGate().apply(raw, _CTX, feature=_FEAT, trace_id=_TID, now=_NOW)
    assert out.error is None
    assert out.value[0].address is None  # null 보존 — 주소 창작 없음


def test_gate_parse_error_and_missing_context() -> None:
    g = EventExtractionGate()
    assert g.apply("깨짐", _CTX, feature=_FEAT, trace_id=_TID, now=_NOW).error.startswith("parse_error:")
    assert g.apply("[]", _CTX, feature=_FEAT, trace_id=_TID, now=_NOW).error is not None
    bad_root = json.dumps({"events": {"name": "x"}})  # 배열 아님
    assert g.apply(bad_root, _CTX, feature=_FEAT, trace_id=_TID, now=_NOW).error is not None
    # 컨텍스트 없이는 원문 대조·기간 겹침 검증 불가 — 호출 계약 위반
    ok = json.dumps({"events": [_event()]})
    assert g.apply(ok, None, feature=_FEAT, trace_id=_TID, now=_NOW).error.startswith("gate_error:")


def test_gate_event_id_is_deterministic() -> None:
    raw = json.dumps({"events": [_event()]})
    g = EventExtractionGate()
    a = g.apply(raw, _CTX, feature=_FEAT, trace_id=_TID, now=_NOW).value[0]
    b = g.apply(raw, _CTX, feature=_FEAT, trace_id=_TID, now=_NOW).value[0]
    assert a.event_id == b.event_id and a.event_id.startswith("evx-")


def test_context_rejects_inverted_period() -> None:
    with pytest.raises(ValueError):
        EventExtractionContext(
            snippets_text="x", period_start=date(2026, 10, 27), period_end=date(2026, 10, 20)
        )


# ── 직렬화 왕복 ──────────────────────────────────────────────


def test_gate_output_event_info_roundtrip() -> None:
    raw = json.dumps({"events": [_event()]})
    ev = EventExtractionGate().apply(raw, _CTX, feature=_FEAT, trace_id=_TID, now=_NOW).value[0]
    assert EventInfo.from_dict(ev.to_dict()) == ev


# ── 워커: 변수 조립 결정론 ───────────────────────────────────


def test_build_vars_deterministic_and_stringly() -> None:
    v1 = build_event_extraction_vars("부산", *_PERIOD, _SNIPPETS)
    v2 = build_event_extraction_vars("부산", *_PERIOD, tuple(reversed(_SNIPPETS)))
    assert v1 == v2  # 입력 순서 무관 — 정렬 결정론
    assert all(isinstance(v, str) for v in v1.values())
    assert v1["period"] == "2026-10-20 ~ 2026-10-27"
    assert build_event_extraction_vars("", *_PERIOD, ())["snippets"] == "(스니펫 없음)"
    assert build_event_extraction_vars("", *_PERIOD, ())["region"] == "미지정"


# ── 워커 e2e (실물 레지스트리·게이트, fake LLM만 — D37) ──────


def test_worker_end_to_end() -> None:
    canned = json.dumps({"events": [_event()]})
    result = EventExtractionWorker(_facade(FakeLlm(canned=canned), EventExtractionGate())).extract(
        "부산", *_PERIOD, _SNIPPETS, _TID, _NOW
    )
    assert result.is_fallback is False
    assert result.value[0].name == "부산불꽃축제"
    assert result.value[0].coord is None
    assert result.call_record is not None and result.call_record.success is True


def test_worker_fallback_on_llm_failure() -> None:
    worker_fail = EventExtractionWorker(_facade(FailingLlm(), EventExtractionGate()))
    fb = worker_fail.extract("부산", *_PERIOD, _SNIPPETS, _TID, _NOW)
    assert fb.is_fallback is True and fb.value is None  # 폴백 실행은 호출측 (BR-U4-09)


def test_worker_zero_events_is_success_not_fallback() -> None:
    """행사 0건은 **정상 결과**다 — 입력이 검색 스니펫이라 "그 기간 그 지역에
    행사가 없음"이 흔하다. 실패로 뒤집던 동안 대전 6회 연속 0건의 원인을 찾는 데
    3단계 추론이 필요했다(2026-08-25). 대체 추출 경로도 없어 폴백이 바꿀 게 없다.
    """
    trace = InMemoryTrace()
    worker = EventExtractionWorker(
        _facade(FakeLlm(canned=json.dumps({"events": []})), EventExtractionGate(), trace)
    )
    empty = worker.extract("부산", *_PERIOD, _SNIPPETS, _TID, _NOW)
    assert empty.is_fallback is False and empty.error is None
    assert empty.value == ()  # 0건이라는 사실이 남는다
    assert trace.of_type(FallbackEvent) == []


def test_worker_all_dropped_is_zero_events_with_drop_event() -> None:
    """전량 드롭(지어낸 행사만)도 산출은 0건 — 침묵은 아니다: 환각 증빙은
    GateDropEvent 가 싣는다 (폴백으로 뒤집으면 그 0건마저 value=None 이 된다).
    """
    trace = InMemoryTrace()
    canned = json.dumps({"events": [_event(name="가짜페스티벌")]})
    worker_drop = EventExtractionWorker(
        _facade(FakeLlm(canned=canned), EventExtractionGate(), trace)
    )
    dropped = worker_drop.extract("부산", *_PERIOD, _SNIPPETS, _TID, _NOW)
    assert dropped.is_fallback is False and dropped.value == ()
    drops = trace.of_type(GateDropEvent)
    assert len(drops) == 1 and drops[0].dropped_count == 1


def test_registry_renders_event_extraction_prompt() -> None:
    reg = PromptRegistry(_PROMPTS)
    prompt, ref = reg.render(
        _FEAT, build_event_extraction_vars("부산", *_PERIOD, _SNIPPETS)
    )
    assert ref.version == "0.1.0" and ref.feature == _FEAT.value
    assert "JSON" in prompt and "부산불꽃축제" in prompt
    assert "duration" not in prompt.lower()  # INV-3 — 소요시간류 자리 없음


# ── 코드 펜스 포장 제거 (2026-08-20 첫 배치 실측 parse_error 재현) ────


def test_fenced_json_is_unwrapped_before_parse() -> None:
    from trippilot.llm_gateway.gates.base import _strip_code_fence

    body = '{"events": []}'
    assert _strip_code_fence(f"```json\n{body}\n```") == body
    assert _strip_code_fence(f"```\n{body}\n```") == body
    assert _strip_code_fence(body) == body  # 펜스 없으면 무변
    # 펜스를 벗겨도 JSON이 아니면 여전히 실패 — 관대화가 아니라 포장 제거
    import pytest as _pytest
    from trippilot.llm_gateway.gates.base import _load_json_object
    with _pytest.raises(ValueError):
        _load_json_object("```json\n행사 없음\n```", "events")
