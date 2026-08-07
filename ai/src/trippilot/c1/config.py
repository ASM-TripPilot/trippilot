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
    """FD domain-entities §1의 기능→티어 기본 매핑 (경량 5·상위 4).

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
    timeout_sec: float = 2.5  # BR-U4-04
    max_tokens: int = 1024
    temperature: float = 0.0  # 결정론 지향
