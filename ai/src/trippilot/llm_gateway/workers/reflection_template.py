"""ReflectionTemplateWorker — 회고 연출 템플릿 1회 호출 조립, 상위 티어 (TRIP-429).

N회 생성 루프(≤3)·결정론 랭킹·장면/필드 교체·봉투 조립·고정 폴백 템플릿은
agents/reflect(composer·fallback, 후속) 소유 (FD business-logic §3 ③~⑥) —
워커는 vars 조립 → gateway.call 1회까지만 (reflection_nudge 워커와 같은 형).

입력(방문 기록·이벤트·페르소나 요약)은 백엔드가 조립해 전달한다 (계약 §5,
AI stateless — alternative_selection 워커와 같은 전제, ContextResolver 미경유).
실패·파싱 불가면 폴백 TypedResult를 그대로 반환 (BR-U4-09) — 침묵 실패는 없다
(INV-4). 위반이 있어도 파싱이 성립하면 폴백이 아니라 TemplateCandidate(위반
동봉)가 온다 — "드롭이 아니라 최선 채택" (계약 §4).
"""

from __future__ import annotations

from datetime import datetime

from trippilot.llm_gateway.gates.reflection_template import ReflectionTemplateContext
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.domain.reflection import ReflectionRequest


def build_reflection_template_vars(request: ReflectionRequest) -> dict[str, str]:
    """값 전부 str·결정론(방문 순서 = 요청 visits 순서 = {poi:i} 인덱스)·
    좌표·시각·체류분·통계 숫자 미주입 (G181 계열 + INV-3 원천 차단 + BR-U6R-02).
    """
    visits = "\n".join(
        f"- poi:{i} | {v.ref.date.isoformat()} | {v.order_in_day}번째"
        f" | {v.ref.poi_id} | {v.category} | {v.poi_name} | 사진 {v.photo_count}장"
        for i, v in enumerate(request.visits)
    )
    events = "\n".join(
        f"- {e.kind.value} | {e.date.isoformat()} | {e.detail}" for e in request.events
    )
    return {
        "kind": request.kind.value,
        "region": request.region.strip() or "미지정",
        "period": f"{request.start_date.isoformat()} ~ {request.end_date.isoformat()}",
        "visits": visits,  # post-init이 visits ≥ 1 보장 (BR-U6R-15) — 빈 목록 없음
        "events": events or "(이벤트 없음)",
        "persona_summary": request.persona_summary.strip() or "(요약 없음)",
        "weather_summary": request.weather_summary.strip() or "(요약 없음)",
    }


class ReflectionTemplateWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def generate(
        self,
        request: ReflectionRequest,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,  # 시간 예산 수치 미확정 (BR-U6R-14) — 호출측 관통
    ) -> TypedResult:
        context = ReflectionTemplateContext(
            kind=request.kind,
            visit_refs=tuple(v.ref for v in request.visits),
            event_kinds=frozenset(e.kind for e in request.events),
        )
        return self._gateway.call(
            LlmFeature.REFLECTION_TEMPLATE,
            build_reflection_template_vars(request),
            context,  # pool 자리 = 게이트 검증 컨텍스트 (closed-set 정신의 대조 집합)
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
