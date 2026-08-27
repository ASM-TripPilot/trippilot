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
    """FD domain-entities §1의 기능→티어 기본 매핑 (경량 6·상위 6).

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
            # 장면 시퀀스 연출 생성 — 회고 본문 생성의 정본(구 REFLECTION 흡수), 백그라운드 N회 생성 전제
            # (TRIP-429, BR-U6R-13: 티어·모델 실체는 항상 설정값)
            LlmFeature.REFLECTION_TEMPLATE: ModelTier.HEAVY,
            LlmFeature.PLACE_EXTRACTION: ModelTier.HEAVY,
            # 자유 텍스트 구조화 추출 — PLACE_EXTRACTION과 동급 과업 (TRIP-421)
            LlmFeature.EVENT_EXTRACTION: ModelTier.HEAVY,
        }
    )


@dataclass(frozen=True)
class C1Config:
    model_ids: Mapping[ModelTier, str]  # 주입 필수 — 하드코딩 금지 (BR-U4-08)
    tier_map: Mapping[LlmFeature, ModelTier] = field(default_factory=default_tier_map)
    # 기능별 모델 오버라이드 (TRIP-513 — GPT·Claude 혼용). 있으면 tier 해석보다
    # 우선한다. 벤더 선택은 모델명이 결정 — RoutingLlm이 접두어로 어댑터를 고른다.
    feature_models: Mapping[LlmFeature, str] = field(default_factory=dict)
    # BR-U4-04 기본값 — 즉답성 feature(INTENT 등) 기준. 단계 예산이 있는 호출
    # (PREFERENCE_SCORING)은 GatewayFacade.call(timeout_sec=...)로 관통 (TRIP-376).
    timeout_sec: float = 2.5
    max_tokens: int = 1024
    temperature: float = 0.0  # 결정론 지향
    # PREFERENCE_SCORING 병렬 청킹 (TRIP-378) — 청크 크기는 고정 상수가 아니라
    # 단계 예산에서 유도한다 (TRIP-380 적응형 공식, workers/preference.py
    # adaptive_chunk_size). 종전 score_chunk_size=20 상수는 공식이 대체 — 예산
    # 14s·기본 파라미터에서 공식이 정확히 20을 재현한다(현행 동등).
    #
    # 선형 지연 모델 (TRIP-373 실측): 청크 소요 ≈ base + per_item × 청크크기.
    # 바닥 ~3s(7건 3.2s), 건당 ~0.2s (193건 단일 호출 44.5s).
    score_base_ms: int = 3_000
    score_per_item_ms: int = 200
    # 안전율 — 실측 변동이 3~4배(TRIP-373)이고 청크 편차 4.8~19.5s(TRIP-380
    # 계측)라, 기대 소요가 예산의 절반에 오도록 목표 시간을 예산/2로 잡는다.
    score_safety: float = 2.0
    # 청크 크기 클램프 — 너무 작으면 호출 바닥(base)만 반복 지불, 너무 크면
    # 슬로 테일 한 방이 단계 전체를 삼킨다.
    score_chunk_min: int = 5
    score_chunk_max: int = 40
    # 병렬수 N = ⌈풀 ÷ c*⌉의 상한 — 실전 풀 193건에서 N=10 (동시 호출 폭주 방지).
    score_max_parallel: int = 10

    def __post_init__(self) -> None:
        if self.score_base_ms < 0:
            raise ValueError("score_base_ms는 음수 불가")
        if self.score_per_item_ms <= 0:
            raise ValueError("score_per_item_ms는 양수여야 함")
        if self.score_safety < 1.0:
            raise ValueError("score_safety는 1.0 이상이어야 함 (목표 ≤ 예산)")
        if self.score_chunk_min <= 0:
            raise ValueError("score_chunk_min은 양수여야 함")
        if self.score_chunk_max < self.score_chunk_min:
            raise ValueError("score_chunk_max ≥ score_chunk_min이어야 함")
        if self.score_max_parallel <= 0:
            raise ValueError("score_max_parallel은 양수여야 함")
