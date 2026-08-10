"""PlaceExtractionWorker — 자유 웹 텍스트에서 구조화 POI 추출 (정본 §2.5, AI-D03).

Places API로 못 채운 후보 보강 시에만 동작 (백그라운드·상위 티어).
반환은 ExtractedPlace(게이트 전 원시)까지 — M7 수집 게이트(U6 sourcing)를
통과해야만 후보가 된다 (INV-1). 여기서 후보 편입은 일어나지 않는다.
"""

from __future__ import annotations

from datetime import datetime

from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult


def build_extraction_vars(document: str, region: str, category_hint: str) -> dict[str, str]:
    return {
        "document": document.strip() or "(빈 문서)",
        "region": region or "미지정",
        "category": category_hint or "전체",
    }


class PlaceExtractionWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def extract(
        self,
        document: str,
        region: str,
        category_hint: str,
        trace_id: TraceId,
        now: datetime,
    ) -> TypedResult:
        return self._gateway.call(
            LlmFeature.PLACE_EXTRACTION,
            build_extraction_vars(document, region, category_hint),
            None,  # closed-set 교차 대상 아님 — 항목 격리는 게이트가 수행
            trace_id,
            now,
        )
