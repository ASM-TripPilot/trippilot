"""ReflectionNudgeWorker — 회고 유도 푸시 문구 생성, 경량 티어 (TRIP-347).

여행 종료 후 회고를 유도하는 알림 문구 1문장을 개인화 생성한다 —
ReflectionTemplateWorker(회고 본문·연출, 정본 §2.8)와 별개 기능. 입력(여행지·기간·페르소나
요약·대표 방문지)은 이미 확정된 문자열 요약으로 들어온다 — 조립은 호출측 몫
(edit_translation 워커와 같은 전제).

실패·게이트 드롭이면 폴백 TypedResult를 그대로 반환 (BR-U4-09). 알림이 안 나가는
침묵 실패는 금지(INV-4) — 폴백 문구의 **사용**은 호출측(백엔드 notification/FCM)
소유지만, 결정론 기본값은 여기서 정의한다: `FALLBACK_NUDGE_MESSAGE`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult

# INV-4 — LLM 폴백 시 호출측이 그대로 쓸 결정론 기본 문구.
# 게이트 규칙(60자 이내·금지 토큰 없음·비어 있지 않음)을 스스로 만족한다 (테스트가 고정).
FALLBACK_NUDGE_MESSAGE = "이번 여행은 어떠셨나요? 한 줄로 남겨보세요"


@dataclass(frozen=True, slots=True)
class ReflectionNudgeInput:
    """문구 입력 요약 — 실제 여행 기록만 (지어내기 금지 가드의 입력측 전제)."""

    destination: str  # 여행지 표시명 (예: "제주")
    duration_days: int  # 여행 기간 (일수)
    persona_summary: str  # 페르소나 요약 1~2문장
    highlight_places: tuple[str, ...] = ()  # 대표 방문지 0~2곳 (호출측이 대표성 순서 확정)

    def __post_init__(self) -> None:
        if self.duration_days < 1:
            raise ValueError("duration_days ≥ 1")
        if len(self.highlight_places) > 2:
            raise ValueError("highlight_places는 최대 2곳")


def build_reflection_nudge_vars(inp: ReflectionNudgeInput) -> dict[str, str]:
    """값 전부 str·결정론(튜플 순서 = 호출측 확정 순서)·좌표 미포함 (G181 계열)."""
    return {
        "destination": inp.destination.strip() or "이번 여행지",
        "duration_days": str(inp.duration_days),
        "persona_summary": inp.persona_summary.strip() or "(요약 없음)",
        "highlight_places": " / ".join(inp.highlight_places) or "(정보 없음)",
    }


class ReflectionNudgeWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def nudge(
        self, inp: ReflectionNudgeInput, trace_id: TraceId, now: datetime
    ) -> TypedResult:
        return self._gateway.call(
            LlmFeature.REFLECTION_NUDGE,
            build_reflection_nudge_vars(inp),
            None,  # poi 선택 없음 — 풀 불필요
            trace_id,
            now,
        )
