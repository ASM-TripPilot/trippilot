"""C1Config — 게이트웨이 설정 컨테이너 (U4 FD business-logic-model §1).

model_id는 항상 설정값 주입 (BR-U4-08) — 코드에 모델 문자열 하드코딩 금지.
temperature=0.0 기본 (결정론 지향), timeout 2.5s (요청 예산 5초의 절반 이하, BR-U4-04).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from trippilot.domain.llm import LlmFeature, ModelTier


def default_tier_map() -> Mapping[LlmFeature, ModelTier]:
    """FD domain-entities §1의 기능→티어 기본 매핑 (경량 6·상위 4).

    OFFLINE 티어는 배치·회귀 전용 — 기능 매핑에 등장하지 않는다.
    """
    return MappingProxyType(
        {
            LlmFeature.PREFERENCE_SCORING: ModelTier.LIGHT,
            LlmFeature.INTENT: ModelTier.LIGHT,
            LlmFeature.PARAPHRASE: ModelTier.LIGHT,
            LlmFeature.REASON_INTERPRETATION: ModelTier.LIGHT,
            # INTENT·PARAPHRASE와 동급 과업 — LIGHT 확정 여부는 K-2 실모델 검증 대기
            # (agent-foundation FD 미결 #4)
            LlmFeature.EDIT_TRANSLATION: ModelTier.LIGHT,
            # 푸시 문구 1문장 — 저비용 모델로 충분 (TRIP-347)
            LlmFeature.REFLECTION_NUDGE: ModelTier.LIGHT,
            LlmFeature.EXPLANATION: ModelTier.HEAVY,
            LlmFeature.ALTERNATIVE_SELECTION: ModelTier.HEAVY,
            LlmFeature.REFLECTION: ModelTier.HEAVY,
            LlmFeature.PLACE_EXTRACTION: ModelTier.HEAVY,
        }
    )


@dataclass(frozen=True)
class C1Config:
    model_ids: Mapping[ModelTier, str]  # 주입 필수 — 하드코딩 금지 (BR-U4-08)
    tier_map: Mapping[LlmFeature, ModelTier] = field(default_factory=default_tier_map)
    # BR-U4-04 기본값 — 즉답성 feature(INTENT 등) 기준. 단계 예산이 있는 호출
    # (PREFERENCE_SCORING)은 GatewayFacade.call(timeout_sec=...)로 관통 (TRIP-376).
    timeout_sec: float = 2.5
    max_tokens: int = 1024
    temperature: float = 0.0  # 결정론 지향
    # PREFERENCE_SCORING 병렬 청킹 (TRIP-378) — 실측(TRIP-373·376): 점수 지연 ≈
    # 바닥 ~3s + 건당 ~0.2s 선형, 실전 풀 193건 단일 호출 44.5s로 단계 예산
    # 14s(TRIP-376) 밖. 청크 20건 ≈ 6s — 변동 2배에도 예산 안이다.
    # 풀 ≤ chunk_size면 단일 호출 현행 경로 그대로 (분기 비용 0).
    score_chunk_size: int = 20
    # 병렬수 N = ⌈풀 ÷ chunk_size⌉의 상한 — 실전 풀 193건에서 N=10 (동시 호출 폭주 방지).
    score_max_parallel: int = 10

    def __post_init__(self) -> None:
        if self.score_chunk_size <= 0:
            raise ValueError("score_chunk_size는 양수여야 함")
        if self.score_max_parallel <= 0:
            raise ValueError("score_max_parallel은 양수여야 함")
