"""ShareCardCopyWorker — j06 공유 카드 캡션·해시태그 1회 호출 조립 (TRIP-429 후속).

**에이전트를 두지 않는다** — 후보 선택·다단 구성·예산 계단·하드 교체를 하나도 쓰지 않는
"판단 없는 단발 변환"(프롬프트 1회 + 게이트 + 정적 폴백)이라 U6 Reflect FD §2.1
**워커 직행 패턴**의 적용 대상이다 (`reflection_nudge` 와 동형). 경계(`api/wiring.py`)가
이 워커를 직접 부른다.

입력은 회고 생성과 **같은 재료**(`ReflectionRequest`) — 백엔드가 조립해 전달한다
(계약 §5, AI stateless · ContextResolver 미경유, `reflection_template` 워커와 같은 전제).
위반이면 재시도하지 않고 폴백 TypedResult를 그대로 반환한다 (BR-U4-09) — 폴백의
**실행**은 호출측 몫이고, 그 결정론 기본값만 여기서 정의한다:
`fallback_share_card_copy` (INV-4, 침묵 실패 금지).
"""

from __future__ import annotations

from datetime import datetime

from trippilot.llm_gateway.gates.share_card_copy import ShareCardCopyContext
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.domain.reflection import ReflectionRequest, ShareCardCopy

# 지역명을 못 쓸 때의 태그 — `_tag_allowed`가 항상 허용하는 브랜드 고정 태그.
# (게이트 규칙을 스스로 만족하는 폴백이어야 한다 — 테스트가 고정한다.)
_BRAND_HASHTAG = "#트립파일럿"


def build_share_card_copy_vars(request: ReflectionRequest) -> dict[str, str]:
    """값 전부 str·결정론(방문 순서 = 요청 visits 순서)·좌표 미포함 (G181 계열).

    시각·체류분·통계 숫자도 주입하지 않는다 — INV-3 원천 차단 + 숫자는 자리표시자로만
    (BR-U6R-02). poi_id도 싣지 않는다: 공유 문구는 id를 부르지 않고, 게이트의 장소
    교차는 상호명으로 한다 (필드 최소화).
    """
    visits = "\n".join(
        f"- {v.ref.date.isoformat()} | {v.category} | {v.poi_name}"
        for v in request.visits
    )
    events = "\n".join(
        f"- {e.kind.value} | {e.date.isoformat()} | {e.detail}" for e in request.events
    )
    return {
        "region": request.region.strip() or "미지정",
        "period": f"{request.start_date.isoformat()} ~ {request.end_date.isoformat()}",
        "visits": visits,  # post-init이 visits ≥ 1 보장 (BR-U6R-15)
        "events": events or "(이벤트 없음)",
        "persona_summary": request.persona_summary.strip() or "(요약 없음)",
        "weather_summary": request.weather_summary.strip() or "(요약 없음)",
    }


def fallback_share_card_copy(request: ReflectionRequest) -> ShareCardCopy:
    """INV-4 — LLM 실패·게이트 전량 탈락 시 호출측이 그대로 쓸 결정론 조립.

    **FE 종전 문구와 같지는 않다** — 거기(`ShareCardPage.tsx`)는 캡션을 여행 **제목**
    으로 시드하고(`{제목} 여행의 기록`) 해시태그를 목적지 수만큼 만든다. `ReflectionRequest`
    에는 여행 제목도 목적지 목록도 없으므로(백엔드가 조립해 보내는 재료는 지역 1개다)
    재현할 수 없다: 폴백은 **같은 꼴의 지역판**(`{지역} 여행의 기록` · `#{지역}여행`)이고,
    다목적지 여행에선 태그가 1개로 줄어든다. 강등 사실은 `is_fallback=True`로 드러난다.
    (제목·목적지를 폴백에 살리려면 요청 스키마에 필드가 늘어야 한다 — 후속 협의.)

    게이트 규칙(시간 표현·자리표시자·상한·태그 어휘)은 스스로 만족한다 — 다어절 지역
    ("제주 서귀포")까지 테스트가 고정한다.
    """
    region = request.region.strip()
    compact = "".join(region.split())  # 태그에 공백·구분자를 넣지 않는다
    return ShareCardCopy(
        caption=f"{region} 여행의 기록" if region else "여행의 기록",
        hashtags=(f"#{compact}여행",) if compact else (_BRAND_HASHTAG,),
        is_fallback=True,
    )


class ShareCardCopyWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def generate(
        self,
        request: ReflectionRequest,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,  # 시간 예산 미확정 (BR-U6R-14) — 호출측 관통
    ) -> TypedResult:
        context = ShareCardCopyContext(
            poi_names=tuple(v.poi_name for v in request.visits),
            region=request.region,
        )
        return self._gateway.call(
            LlmFeature.SHARE_CARD_COPY,
            build_share_card_copy_vars(request),
            context,  # pool 자리 = 게이트 검증 컨텍스트 (closed-set 정신의 대조 집합)
            trace_id,
            now,
            timeout_sec=timeout_sec,
        )
