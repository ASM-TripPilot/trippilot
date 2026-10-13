"""LLM 비용 집계 (소비 측, `api/cost.py`).

여기서 고정하는 것:
1. 단가는 설정에서만 온다 — 미설정이면 집계 자체가 꺼진다(비용 0 을 지어내지 않는다)
2. 단가표에 없는 모델은 `call_cost: null` + `unpriced_calls` — 0 으로 세지 않는다
3. 요청당 누계는 trace_id 별이고 다른 trace 와 섞이지 않는다
4. 깨진 설정은 조용히 무시되지 않고 예외(기동 실패)
5. `LoggingTrace.emit` 은 어떤 경우에도 예외를 밖으로 던지지 않는다
6. 비용 줄마다 `trip_id` — 로그만으로 여행 단위 호출 수·비용 합이 나온다(TRIP-1312)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import pytest

from fastapi.testclient import TestClient

from trippilot.api.app import create_app
from trippilot.api.cost import (
    PRICE_FILE_ENV,
    PRICES_ENV,
    CostLedger,
    PriceConfigError,
    bind_trip,
    load_prices,
)
from trippilot.api.middleware import MiddlewareSettings, parse_wire_meta
from trippilot.api.wiring import LoggingTrace
from trippilot.domain.common import TraceId
from trippilot.domain.observability import FallbackEvent, LlmCallRecord
from trippilot.domain.prompt import PromptRef

from tests.test_api_contract import BACKEND_REQUEST, FakeOrchestrator, make_outcome
from tests.test_api_replan import _body as replan_body

_NOW = datetime(2026, 9, 9, tzinfo=timezone.utc)
_PRICES = {
    "currency": "USD",
    "models": {"claude-haiku-4-5": {"input": 1.0, "output": 5.0}},
}


def _record(
    *, model_id: str = "claude-haiku-4-5", trace: str = "t-1",
    input_tokens: int = 1_000_000, output_tokens: int = 0, success: bool = True,
) -> LlmCallRecord:
    return LlmCallRecord(
        trace_id=TraceId(trace),
        occurred_at=_NOW,
        component="c1.gateway",
        feature="preference_scoring",
        model_id=model_id,
        prompt_ref=PromptRef(
            prompt_id="prompts/preference_scoring.yaml",
            version="1.0.0",
            feature="preference_scoring",
        ),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        latency_ms=1234,
        success=success,
        agent=None,
    )


def _ledger() -> CostLedger:
    return CostLedger(load_prices({PRICES_ENV: json.dumps(_PRICES)}))


# ── 1. 단가 출처 ────────────────────────────────────────────────────


def test_no_price_config_disables_aggregation() -> None:
    """미설정 = 모름 — ledger 가 없다(0 을 지어내지 않는다)."""
    assert load_prices({}) is None
    assert load_prices({PRICES_ENV: ""}) is None  # 빈 문자열도 미설정
    assert CostLedger.from_env({}) is None


def test_price_file_takes_precedence(tmp_path) -> None:
    path = tmp_path / "prices.json"
    path.write_text(json.dumps(_PRICES), encoding="utf-8")
    prices = load_prices({PRICE_FILE_ENV: str(path), PRICES_ENV: "{invalid"})
    assert prices is not None
    assert prices.currency == "USD"
    assert prices.per_million["claude-haiku-4-5"] == (1.0, 5.0)


# ── 2·3. 계산과 누계 ────────────────────────────────────────────────


def test_cost_is_per_million_tokens() -> None:
    entry = _ledger().add(_record(input_tokens=1_000_000, output_tokens=200_000))
    # 입력 1M × $1 + 출력 0.2M × $5 = $2.0
    assert entry["call_cost"] == pytest.approx(2.0)
    assert entry["request_cost"] == pytest.approx(2.0)
    assert entry["unpriced_calls"] == 0
    assert entry["currency"] == "USD"


def test_unknown_model_is_null_not_zero() -> None:
    ledger = _ledger()
    entry = ledger.add(_record(model_id="gpt-5.6-sol"))
    assert entry["call_cost"] is None  # 0 이면 "공짜로 돌았다"는 거짓
    assert entry["unpriced_calls"] == 1
    assert entry["request_cost"] == 0.0  # 누계는 아는 만큼의 하한


def test_request_total_accumulates_per_trace() -> None:
    ledger = _ledger()
    ledger.add(_record(trace="t-1", input_tokens=1_000_000))
    second = ledger.add(_record(trace="t-1", input_tokens=0, output_tokens=1_000_000))
    other = ledger.add(_record(trace="t-2", input_tokens=1_000_000))
    assert second["request_cost"] == pytest.approx(6.0)  # $1 + $5
    assert other["request_cost"] == pytest.approx(1.0)  # 다른 요청과 안 섞인다


def test_failed_call_still_counts_tokens() -> None:
    """실패해도 토큰은 과금된다 — success=False 를 제외하면 비용이 과소 보고된다."""
    entry = _ledger().add(_record(success=False, input_tokens=1_000_000))
    assert entry["call_cost"] == pytest.approx(1.0)
    assert entry["success"] is False


def test_lru_evicts_oldest_traces() -> None:
    ledger = CostLedger(load_prices({PRICES_ENV: json.dumps(_PRICES)}), max_traces=2)
    for trace in ("a", "b", "c"):
        ledger.add(_record(trace=trace, input_tokens=1_000_000))
    # a 는 밀려났으므로 누계가 새로 시작한다 (무한 증가 방지의 대가)
    assert ledger.add(_record(trace="a", input_tokens=0))["request_cost"] == 0.0
    assert ledger.add(_record(trace="c", input_tokens=0))["request_cost"] == pytest.approx(1.0)


# ── 4. 설정 오류는 드러난다 ─────────────────────────────────────────


@pytest.mark.parametrize(
    "raw",
    [
        "{not json",
        json.dumps([]),  # 루트가 객체가 아님
        json.dumps({"models": {}}),  # 비어있음
        json.dumps({"models": {"m": {"input": 1.0}}}),  # output 누락
        json.dumps({"models": {"m": {"input": "1.0", "output": 5.0}}}),  # 문자열 단가
        json.dumps({"models": {"m": {"input": True, "output": 5.0}}}),  # bool 은 숫자 아님
        json.dumps({"models": {"m": {"input": -1.0, "output": 5.0}}}),  # 음수
        json.dumps({"currency": "", "models": {"m": {"input": 1.0, "output": 5.0}}}),
    ],
)
def test_broken_config_raises(raw: str) -> None:
    with pytest.raises(PriceConfigError):
        load_prices({PRICES_ENV: raw})


def test_missing_price_file_raises(tmp_path) -> None:
    with pytest.raises(PriceConfigError):
        load_prices({PRICE_FILE_ENV: str(tmp_path / "없는파일.json")})


# ── 5. LoggingTrace 결선 ────────────────────────────────────────────


def test_logging_trace_emits_cost_line(caplog) -> None:
    trace = LoggingTrace(_ledger())
    with caplog.at_level(logging.INFO, logger="trippilot.wiring"):
        trace.emit(_record(input_tokens=1_000_000))
        trace.emit(FallbackEvent(
            trace_id=TraceId("t-1"), occurred_at=_NOW, component="c1.gateway",
            stage="llm", from_mode="llm_score", to_mode="rule_score", reason="timeout",
        ))
    costs = [m for m in caplog.messages if m.startswith("llm_cost ")]
    assert len(costs) == 1  # LLM 호출에만 붙는다 (다른 이벤트엔 안 붙는다)
    assert json.loads(costs[0][len("llm_cost "):])["call_cost"] == pytest.approx(1.0)


def test_logging_trace_without_prices_is_unchanged(caplog) -> None:
    trace = LoggingTrace(CostLedger.from_env({}))
    with caplog.at_level(logging.INFO, logger="trippilot.wiring"):
        trace.emit(_record())
    assert not [m for m in caplog.messages if m.startswith("llm_cost ")]


def test_emit_never_raises() -> None:
    """계측 실패 ≠ 비즈니스 실패 — ledger 가 터져도 emit 은 조용히 넘어간다."""

    class Exploding:
        def add(self, record: object) -> dict:
            raise RuntimeError("boom")

    LoggingTrace(Exploding()).emit(_record())  # 예외가 새면 여기서 실패한다


# ── 6. 여행 단위 집계 (TRIP-1312) ───────────────────────────────────


def test_cost_line_carries_bound_trip_id() -> None:
    ledger = _ledger()
    bind_trip("t-bound", "trip-1")
    assert ledger.add(_record(trace="t-bound"))["trip_id"] == "trip-1"
    assert ledger.add(_record(trace="t-unbound"))["trip_id"] is None  # 여행 없는 경계


def test_wire_trip_id_keeps_identifier_chars_only() -> None:
    """자유서술이 trip_id 자리로 와도 로그에 실리지 않는다 — 식별자 문자만 남는다."""
    meta = b'{"request_meta": {"request_id": "r"}, "trip_id": "%s"}'
    assert parse_wire_meta(meta % b"33333333-3333-4333-8333-333333333333").trip_id == (
        "33333333-3333-4333-8333-333333333333")
    assert parse_wire_meta(meta % "카페 가고 싶다".encode()).trip_id is None
    assert parse_wire_meta(b'{"request_meta": {"request_id": "r"}}').trip_id is None


class _Spending(FakeOrchestrator):
    """경계마다 LLM 1회($1)를 쓴다 — 실 조립처럼 trace_id 는 바디 request_id."""

    def __init__(self, trace: LoggingTrace) -> None:
        super().__init__(make_outcome())
        self.trace = trace

    def _spend(self, request) -> None:  # noqa: ANN001
        self.trace.emit(_record(trace=request.request_meta.request_id))

    def generate(self, request):  # noqa: ANN001
        self._spend(request)
        return super().generate(request)

    def replan(self, request):  # noqa: ANN001
        self._spend(request)
        raise RuntimeError("응답 사영은 이 테스트 밖 — 실패한 요청도 쓴 토큰은 센다")


def test_trip_totals_come_from_log_lines_alone(caplog) -> None:
    """AC — 한 여행에서 생성 2회·재계획 1회를 돌리면 로그에서 그 여행의 호출 수·비용 합이 나온다."""
    client = TestClient(
        create_app(_Spending(LoggingTrace(_ledger())), middleware=MiddlewareSettings()),
        raise_server_exceptions=False,
    )

    def generate(request_id: str, trip_id: str) -> None:
        client.post("/ai/v1/itinerary/generate", json={
            **BACKEND_REQUEST, "trip_id": trip_id,
            "request_meta": {**BACKEND_REQUEST["request_meta"], "request_id": request_id},
        })

    with caplog.at_level(logging.INFO):
        generate("g-1312-1", "trip-A")
        generate("g-1312-2", "trip-A")
        generate("g-1312-3", "trip-B")
        client.post("/ai/v1/planb/replan", json=replan_body(
            trip_id="trip-A",
            request_meta={"request_id": "r-1312-1", "requested_at": "2026-09-21T14:00:00+09:00"},
        ))

    lines = [json.loads(m[len("llm_cost "):]) for m in caplog.messages if m.startswith("llm_cost ")]
    trip_a = [line["call_cost"] for line in lines if line["trip_id"] == "trip-A"]
    assert len(trip_a) == 3 and sum(trip_a) == pytest.approx(3.0)
    assert [line["trip_id"] for line in lines].count("trip-B") == 1
    # 금지 — 발화·메모 같은 자유서술은 어떤 로그 줄에도 없다
    assert not [m for m in caplog.messages if "비 와서" in m]
