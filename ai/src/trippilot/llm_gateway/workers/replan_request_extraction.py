"""ReplanRequestExtractionWorker — 다시 짜기 자유입력에서 장소명·시각 제약·날씨 주장을 뽑는다.

뽑은 것은 **주장**이다. 일정에 쓰기 전에 `agents/planb/request_verification.verify` 가
등록 POI·지도 실재·영업시간·남은 시간창·기상청으로 하나씩 대조한다 — 이 워커는 그 대조의
재료만 만든다. 실패·시한 초과면 폴백 `TypedResult` 그대로이고 호출측은 추출 없이 진행한다
(칩·지시 번역·구성 LLM 은 원문을 그대로 읽으므로 잃는 것은 "풀 밖 장소·시간 제약"뿐이다).
"""

from __future__ import annotations

from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import inline


def build_extraction_vars(user_request: str, date_label: str, window: str) -> dict[str, str]:
    return {
        "user_request": inline(user_request).strip() or "(없음)",
        "date": date_label,
        "window": window,
    }


class ReplanRequestExtractionWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def extract(
        self,
        user_request: str,
        date_label: str,
        window: str,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult:
        return self._gateway.call(
            LlmFeature.REPLAN_REQUEST_EXTRACTION,
            build_extraction_vars(user_request, date_label, window),
            None,  # 대조 집합 없음 — 참·거짓은 호출측 검증
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
