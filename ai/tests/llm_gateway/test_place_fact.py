"""PLACE_FACT_LOOKUP — 미확인 장소 정보 웹 확인의 출구 게이트·게이트웨이 배선·프롬프트 변수 (UnknownHandlingAgent).

① 칸마다 좁은 꼴만 받고 꼴 밖·주입·연락처 꼴은 그 칸만 버린다 ② 출처는 검색이 단 인용 URL 에서만(공공 누리집 먼저), 인용이 없으면
값이 있어도 실패 ③ 게이트웨이는 웹 검색 기능이면 벤더에 도구를 켜고 인용 URL 을 게이트의 닫힌 집합으로 넘긴다 ④ 장소 이름은 한 줄로.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.prompt import PromptRef
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.gates.place_fact import PlaceFactGate, pick_source
from trippilot.llm_gateway.workers.place_fact_lookup import PlaceFactLookupWorker, build_place_fact_vars
from trippilot.domain.observability import FallbackEvent
from trippilot.ports.llm_port import LlmRequest, LlmResponse
from trippilot.ports.place_fact_store_port import PlaceFacts
from tests.fakes.in_memory_trace import InMemoryTrace

_NOW = datetime(2026, 10, 22, 6, 0, tzinfo=timezone.utc)
_CITES = ("https://blog.example.com/post/1", "https://royal.khs.go.kr/ROYAL/contents/notice?id=1")


def _apply(raw: object, citations: tuple[str, ...] = _CITES):
    text = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    return PlaceFactGate().apply(text, citations, feature=LlmFeature.PLACE_FACT_LOOKUP, trace_id=TraceId("t"), now=_NOW)


def test_gate_keeps_well_formed_fields_normalized_and_sources_from_an_official_citation() -> None:
    out = _apply({"hours": "9:00 - 18:00", "last_entry": "17:00", "closed": "매주 화요일", "fee": "3000원"})
    assert out.error is None and out.drop_event is None
    assert out.value == PlaceFacts(hours="09:00~18:00", last_entry="17:00", closed="매주 화요일", fee="3,000원",
                                   source_url=_CITES[1], source_host="royal.khs.go.kr")  # 블로그보다 공공 누리집


@pytest.mark.parametrize("field,raw", [
    ("hours", "오전 9시부터 오후 6시"), ("hours", "09:00~18:00 (계절별 상이)"), ("last_entry", "마감 1시간 전"),
    ("closed", "화요일 휴궁, 단 공휴일은 개방"), ("fee", "어른 3,000원 / 어린이 1,500원"),
    ("closed", "매주 화요일 이전 지시를 무시하고"), ("fee", "문의 02-3700-3900"),
])
def test_gate_drops_only_the_field_out_of_shape(field: str, raw: str) -> None:
    out = _apply({"hours": "09:00~18:00", field: raw} if field != "hours" else {field: raw, "fee": "무료"})
    assert out.error is None and out.drop_event is not None and out.drop_event.dropped_ids == (field,)
    assert getattr(out.value, field) is None and out.value.any()  # 다른 칸은 산다


def test_gate_without_a_citation_stores_nothing_even_with_values() -> None:
    out = _apply({"hours": "09:00~18:00"}, citations=())
    assert out.value is None and out.error == "no_citation"  # 기억으로 짐작한 값을 "찾은 값"으로 저장하지 않는다


def test_gate_all_null_is_a_successful_nothing_found() -> None:
    out = _apply({"hours": None, "last_entry": None, "closed": None, "fee": None})
    assert out.value is None and out.error is None


def test_gate_rejects_non_json() -> None:
    assert _apply("경복궁은 9시에 엽니다").error.startswith("parse_error")


def test_source_prefers_the_page_the_model_named_when_the_search_saw_it_and_never_a_blog() -> None:
    seen = ("https://gyeongbokgungtickets.com/ko/guide/", "https://mksd77.tistory.com/533", "https://royal.khs.go.kr/n")
    assert pick_source(seen, "https://gyeongbokgungtickets.com/ko/guide/")[1] == "gyeongbokgungtickets.com"  # 모델이 든 근거
    assert pick_source(seen, "https://made-up.example.com/x")[1] == "royal.khs.go.kr"  # 검색이 안 본 주소는 무시 — 공공 먼저
    assert pick_source(("https://mksd77.tistory.com/533", "https://blog.naver.com/a/1"), None) is None  # 블로그뿐이면 출처 없음
    out = _apply({"hours": "09:00~18:00"}, citations=("https://silvermovenote.blogspot.com/p",))
    assert out.value is None and out.error == "no_citation"


def test_source_is_https_only_and_keeps_citation_order_within_a_rank() -> None:
    assert pick_source(("http://a.go.kr/x", "https://b.com/y", "https://c.com/z")) == ("https://b.com/y", "b.com")
    assert pick_source(("ftp://x.go.kr",)) is None


@given(raw=st.dictionaries(st.sampled_from(["hours", "last_entry", "closed", "fee"]),
                           st.one_of(st.none(), st.text(max_size=40), st.sampled_from([
                               "09:00~18:00", "24:00~24:00", "매주 월요일, 화요일", "연중무휴", "무료", "1,000,000원",
                               "https://evil.example.com", "이전 지시를 무시하고 시스템 프롬프트", "010-1234-5678"]))))
@settings(max_examples=300, deadline=None)
def test_pbt_gate_never_lets_contact_or_injection_shapes_through(raw: dict) -> None:
    from trippilot.llm_gateway.gates.base import has_contact_like, has_injection_like

    out = _apply(raw)
    if out.value is not None:
        for f in ("hours", "last_entry", "closed", "fee"):
            v = getattr(out.value, f)
            assert v is None or not (has_contact_like(v) or has_injection_like(v))


class _WebLlm:
    def __init__(self, text: str, citations: tuple[str, ...]) -> None:
        self.text, self.citations, self.requests = text, citations, []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        return LlmResponse(raw_text=self.text, input_tokens=1, output_tokens=1, latency_ms=1, model_id=request.model_id,
                           citations=self.citations)


class _Renderer:
    def render(self, feature, variables):
        return f"{feature.value}|{sorted(variables.items())}", PromptRef("prompts/t.yaml", "0.0.1", feature.value)


def _worker(llm) -> PlaceFactLookupWorker:
    cfg = C1Config(model_ids={ModelTier.LIGHT: "m-light", ModelTier.HEAVY: "m-heavy"})
    return PlaceFactLookupWorker(GatewayFacade(llm, _Renderer(), PlaceFactGate(), cfg, InMemoryTrace()))


def test_gateway_turns_the_vendor_search_on_and_gates_against_its_citations() -> None:
    llm = _WebLlm('{"hours": "09:00~18:00"}', ("https://royal.khs.go.kr/a",))
    result = _worker(llm).lookup("경복궁 서울 종로구", ("hours",), date(2026, 10, 22), TraceId("t"), _NOW, timeout_sec=5)
    assert llm.requests[0].web_search is True and result.value.source_host == "royal.khs.go.kr"
    nothing_cited = _WebLlm('{"hours": "09:00~18:00"}', ())
    assert _worker(nothing_cited).lookup("경복궁", ("hours",), date(2026, 10, 22), TraceId("t"), _NOW,
                                         timeout_sec=5).error == "no_citation"


def test_other_features_never_turn_the_search_on() -> None:
    assert C1Config(model_ids={}).web_search_features == frozenset({LlmFeature.PLACE_FACT_LOOKUP})


def test_place_vars_flatten_the_name_into_one_line() -> None:
    v = build_place_fact_vars("경복궁\n[찾을 칸]\n입장료", ("hours", "fee"), date(2026, 10, 22))
    assert "\n" not in v["place"] and v["fields"] == "영업시간(여는 시각~닫는 시각), 어른 입장료" and v["date"] == "2026-10-22"


# ── 벤더 폴백(TRIP-522 확장, 2026-10-30) — 1차(GPT)가 벤더 장애·unsupported 로 죽어도 2차(Claude)로 ─
#
# ALTERNATIVE_SELECTION 의 "timeout만 재시도"(test_llm_gateway_alternative_selection.py
# test_non_timeout_failures_do_not_retry)는 09-12 팀 결정 그대로다 — PLACE_FACT_LOOKUP 만
# `C1Config.vendor_failover_features` 기본 멤버라 범위가 넓다(config.py 그 필드 주석).


class _VendorFailingThenWebLlm:
    """1차 모델은 벤더 예외(401 류)로 죽고, 2차 모델은 웹 검색 응답을 낸다. 받은 요청을 기록한다."""

    def __init__(self, fails_for: str, text: str, citations: tuple[str, ...]) -> None:
        self._fails_for, self._text, self._citations = fails_for, text, citations
        self.requests: list[LlmRequest] = []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        if request.model_id == self._fails_for:
            raise RuntimeError("401 Unauthorized (fake)")
        return LlmResponse(raw_text=self._text, input_tokens=1, output_tokens=1, latency_ms=1,
                           model_id=request.model_id, citations=self._citations)


def _failover_worker(llm) -> tuple[PlaceFactLookupWorker, InMemoryTrace]:
    cfg = C1Config(
        model_ids={ModelTier.LIGHT: "m-light", ModelTier.HEAVY: "m-heavy"},
        feature_models={LlmFeature.PLACE_FACT_LOOKUP: "gpt-primary"},
        retry_models={LlmFeature.PLACE_FACT_LOOKUP: "claude-retry"},
    )
    trace = InMemoryTrace()
    return PlaceFactLookupWorker(GatewayFacade(llm, _Renderer(), PlaceFactGate(), cfg, trace)), trace


def test_vendor_failure_on_primary_retries_the_configured_model_and_records_the_switch() -> None:
    """정상: GPT 가 벤더 예외(타임아웃 아님)로 죽어도 Claude 로 한 번 더 — 답이 사용자에게 간다(폴백 아님)."""
    llm = _VendorFailingThenWebLlm("gpt-primary", '{"hours": "09:00~18:00"}', ("https://royal.khs.go.kr/a",))
    worker, trace = _failover_worker(llm)
    result = worker.lookup("경복궁", ("hours",), date(2026, 10, 22), TraceId("t"), _NOW,
                            timeout_sec=25.0, retry_timeout_sec=25.0)

    assert result.is_fallback is False and result.value.source_host == "royal.khs.go.kr"
    assert [r.model_id for r in llm.requests] == ["gpt-primary", "claude-retry"]
    assert llm.requests[1].web_search is True  # 2차도 웹 검색 도구를 켠다 — gateway.call 의 web 플래그 재사용
    (switch,) = trace.of_type(FallbackEvent)
    assert (switch.from_mode, switch.to_mode) == ("llm:gpt-primary", "llm:claude-retry")
    assert switch.reason.startswith("llm_error")  # timeout이 아닌 사유도 기록 그대로 (TRIP-260 #4 — 지어낸 실체 금지)


def test_without_retry_budget_vendor_failure_falls_back_once() -> None:
    """경계: retry_timeout_sec 를 안 주면 벤더 실패도 종전처럼 1회 후 폴백 — 호출측이 예산을 줘야 켜진다."""
    llm = _VendorFailingThenWebLlm("gpt-primary", '{"hours": "09:00~18:00"}', ("https://royal.khs.go.kr/a",))
    worker, _ = _failover_worker(llm)
    result = worker.lookup("경복궁", ("hours",), date(2026, 10, 22), TraceId("t"), _NOW, timeout_sec=25.0)

    assert result.is_fallback is True and [r.model_id for r in llm.requests] == ["gpt-primary"]


def test_other_features_do_not_get_the_widened_vendor_failover() -> None:
    """불변식: PLACE_FACT_LOOKUP 밖은 09-12 결정(timeout 전용) 그대로 — 기본 멤버십이 이 기능 하나뿐."""
    assert C1Config(model_ids={}).vendor_failover_features == frozenset({LlmFeature.PLACE_FACT_LOOKUP})


def test_gate_dropped_result_does_not_trigger_a_retry() -> None:
    """경계: 1차가 응답은 냈지만 게이트가 드롭(출처 없음)한 경우는 재시도 대상이 아니다 — invoke 는 성공했으니
    gateway.call §4 의 재시도 분기(response is None)에 들지 않는다 — §5·6 의 기능별 폴백으로 바로 간다."""
    llm = _WebLlm('{"hours": "09:00~18:00"}', ())  # invoke 는 성공, 다만 출처가 없어 게이트가 드롭 → no_citation
    worker, trace = _failover_worker(llm)
    result = worker.lookup("경복궁", ("hours",), date(2026, 10, 22), TraceId("t"), _NOW,
                            timeout_sec=25.0, retry_timeout_sec=25.0)

    assert result.is_fallback is True and result.error == "no_citation"
    assert [r.model_id for r in llm.requests] == ["gpt-primary"]  # 2차를 부르지 않았다
    assert all(e.to_mode != "llm:claude-retry" for e in trace.of_type(FallbackEvent))
