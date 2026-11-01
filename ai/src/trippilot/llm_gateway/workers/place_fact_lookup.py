"""PlaceFactLookupWorker — 등록 장소의 미확인 칸(영업시간·휴무일·입장료)을 벤더 웹 검색으로 찾는다(UnknownHandlingAgent 의 손).

장소 이름·지역은 DB 값이지만 제3자 문자열이라 `inline()` 으로 한 줄씩 눌러 넣는다(골격 위조 차단). 성공 value 는 게이트가 거른
`PlaceFacts`(없으면 None = 찾아봤지만 없음). 실패·시한·출처 없음은 폴백 `TypedResult` 그대로 — 저장 여부는 에이전트 몫이다.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline

FIELD_WORDS = {"hours": "영업시간(여는 시각~닫는 시각)", "last_entry": "입장 마감 시각", "closed": "정기 휴무일", "fee": "어른 입장료"}


def build_place_fact_vars(place: str, fields: Sequence[str], on: date) -> dict[str, str]:
    """프롬프트 변수 — 전부 str · 결정론."""
    return {
        "place": inline(place),
        "fields": ", ".join(FIELD_WORDS[f] for f in fields if f in FIELD_WORDS),
        "date": on.isoformat(),
    }


class PlaceFactLookupWorker:
    """게이트 = `PlaceFactGate()` — 호출측이 `GatewayFacade(llm, renderer, gate, c1_config, trace)` 로 조립한다."""

    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def lookup(self, place: str, fields: Sequence[str], on: date, trace_id: TraceId, now: datetime,
               *, timeout_sec: float, retry_timeout_sec: float | None = None) -> TypedResult:
        """`retry_timeout_sec` 는 1차(sonnet)가 벤더 장애·unsupported·timeout 으로 죽었을 때 2차
        (`C1Config.retry_models[PLACE_FACT_LOOKUP]`, 보통 opus)로 한 번 더 부르는 예산 —
        PLACE_FACT_LOOKUP 이 `C1Config.vendor_failover_features` 기본 멤버라 게이트웨이가 timeout
        만이 아니라 벤더 예외도 트리거로 본다(gateway.py `call` 참조). None 이면 종전처럼 1회."""
        return self._gateway.call(
            LlmFeature.PLACE_FACT_LOOKUP,
            build_place_fact_vars(place, fields, on),
            None,  # 닫힌 집합은 게이트웨이가 응답의 인용 URL 로 채운다(웹 검색 기능)
            trace_id,
            now,
            timeout_sec=timeout_sec,
            retry_timeout_sec=retry_timeout_sec,
        )
