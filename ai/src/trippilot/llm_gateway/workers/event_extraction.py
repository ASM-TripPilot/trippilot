"""EventExtractionWorker — 웹 검색 스니펫에서 행사(축제·공연·전시) 구조화 추출 (TRIP-421).

place_extraction 선례와 동형: 조립 → gateway.call, 실패 시 폴백 TypedResult
그대로 반환 (BR-U4-09 — 폴백 실행은 호출측 몫). 반환 값은 게이트를 통과한
EventInfo 튜플(coord=None)까지 — 지오코딩·후보 반영은 여기서 일어나지 않는다.
행사는 POI가 아니라 후보 풀에 편입되지 않는다 (INV-1, domain/event.py).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime

from trippilot.llm_gateway.gates.event_extraction import EventExtractionContext
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult


def build_event_extraction_vars(
    region: str,
    period_start: date,
    period_end: date,
    snippets: Sequence[tuple[str, str]],
) -> dict[str, str]:
    """스니펫 (제목, 요약) → "- 제목 | 요약" 줄 목록 문자열화.

    값 전부 str + 정렬 결정론 (같은 입력 집합 → 같은 프롬프트, BR-U4-06).
    좌표는 프롬프트에 싣지 않는다 (place_extraction G181 가드 동형).
    """
    lines = sorted(
        f"- {title.strip()} | {summary.strip()}" for title, summary in snippets
    )
    return {
        "region": region or "미지정",
        "period": f"{period_start.isoformat()} ~ {period_end.isoformat()}",
        "snippets": "\n".join(lines) or "(스니펫 없음)",
    }


class EventExtractionWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def extract(
        self,
        region: str,
        period_start: date,
        period_end: date,
        snippets: Sequence[tuple[str, str]],
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult:
        variables = build_event_extraction_vars(region, period_start, period_end, snippets)
        # 게이트 대조 원문 = LLM이 본 스니펫 문자열 그대로 (변수와 컨텍스트 단일 조립)
        context = EventExtractionContext(
            snippets_text=variables["snippets"],
            period_start=period_start,
            period_end=period_end,
        )
        return self._gateway.call(
            LlmFeature.EVENT_EXTRACTION,
            variables,
            context,  # pool 자리 = 게이트 검증 컨텍스트 (원문 대조·기간 겹침)
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
