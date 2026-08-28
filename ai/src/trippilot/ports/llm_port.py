"""LlmPort — 계측 가능한 LLM 호출 콘센트 (business-logic-model.md §2.1).

벤더 중립 (NFR-6.3). 실 어댑터(Anthropic API — AI-D06)는 U4에서 구현.
- 타임아웃 초과 → LlmTimeoutError (침묵 실패 금지 — 소비 측이 FallbackEvent 발행)
- 이미지 미지원 어댑터에 이미지가 실리면 → LlmUnsupportedError (조용한 무시 금지 —
  이미지를 버리고 텍스트만 보내면 사용자는 사진을 본 회고라고 믿는다)
- LlmResponse의 토큰·레이턴시 메타가 LlmCallRecord 생성의 원천 (계측이 구조적으로 가능)

멀티모달 (U6 Reflect Phase 2, TRIP-595): `LlmRequest.images` 후미 기본값 필드 —
기존 텍스트 호출은 전부 키워드 인자라 생성·직렬화가 무영향이다(FD §6.1 A안).
ports 순수성 유지: stdlib 타입만 노출하고 SDK 타입은 어댑터 안에 가둔다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from trippilot.domain.prompt import PromptRef


class LlmTimeoutError(Exception):
    """타임아웃 초과. 소비 측이 잡아서 FallbackEvent 발행."""


class LlmUnsupportedError(Exception):
    """어댑터가 요청의 기능(예: 이미지 입력)을 지원하지 않는다.

    타임아웃과 같은 자리에서 처리된다 — 게이트웨이가 폴백 신호로 전환하고
    호출측이 텍스트 경로로 강등한다(INV-4). **이미지를 조용히 떨구지 않는다.**
    """


# 이미지 media_type 허용 집합 — 게이트웨이 실측(2026-08-25) 기준.
# 여기 없는 형식은 어댑터가 아니라 생성 시점에 막는다(잘못된 바이트를 벤더까지 보내지 않는다).
IMAGE_MEDIA_TYPES: frozenset[str] = frozenset({"image/png", "image/jpeg", "image/webp"})


@dataclass(frozen=True, slots=True)
class LlmImagePart:
    """이미지 1장 — 바이트 그대로 (백엔드 저장소 설계와 무관, 미결 #2 확정).

    URL 전달로 전환할 여지는 남아 있다(게이트웨이 원격 fetch는 실측 확인) —
    그때는 이 타입에 필드를 더하면 되고 포트 표면은 그대로다.
    """

    media_type: str
    data: bytes

    def __post_init__(self) -> None:
        if self.media_type not in IMAGE_MEDIA_TYPES:
            raise ValueError(
                f"지원하지 않는 media_type: {self.media_type!r} "
                f"(허용: {sorted(IMAGE_MEDIA_TYPES)})"
            )
        if not self.data:
            raise ValueError("빈 이미지 데이터 — 빈 바이트는 벤더에서 400이 된다")


@dataclass(frozen=True, slots=True)
class LlmRequest:
    model_id: str
    prompt: str
    prompt_ref: PromptRef  # 버전 없는 호출은 타입상 불가능 (NFR-7.3)
    max_tokens: int
    temperature: float
    timeout_sec: float = 2.5  # NFR-1.2 기본값
    # 멀티모달 입력 (TRIP-595) — 후미 기본값이라 기존 호출 전부 무영향.
    # 비어있지 않은데 어댑터가 이미지를 못 받으면 LlmUnsupportedError.
    images: tuple[LlmImagePart, ...] = ()


@dataclass(frozen=True, slots=True)
class LlmResponse:
    raw_text: str
    input_tokens: int  # 사용량 메타 필수 반환
    output_tokens: int
    latency_ms: int
    model_id: str


class LlmPort(Protocol):
    def invoke(self, request: LlmRequest) -> LlmResponse: ...
