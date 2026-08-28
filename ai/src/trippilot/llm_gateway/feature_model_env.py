"""`TRIPPILOT_LLM_FEATURE_MODELS` 파서 — 앱 조립과 리허설이 **같은 설정**을 읽게 한다.

`main.py` 에만 있던 것을 여기로 옮겼다. 리허설이 자기만의 모델 결정을 갖고 있으면
"운영은 sol, 리허설은 terra" 같은 어긋남이 조용히 생긴다 — 리허설의 값은 운영과 같은
것을 태우는 데 있으므로, 모델 결정도 한 곳에서 온다.

형식: `"FEATURE=model,FEATURE=model"` (예: `ALTERNATIVE_SELECTION=gpt-5.6-sol`).
미지 feature 이름은 조용히 무시하지 않고 즉시 실패한다 — 오타가 "그 기능만 몰래 기본
모델"이 되는 것을 막는다(BR-U4-08 하드코딩 금지의 취지).
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from trippilot.domain.llm import LlmFeature

ENV_VAR = "TRIPPILOT_LLM_FEATURE_MODELS"


def feature_models_from_env(raw: str | None = None) -> Mapping[LlmFeature, str]:
    """env(또는 주어진 문자열) → {LlmFeature: model_id}. 미설정이면 빈 매핑."""
    if raw is None:
        raw = os.environ.get(ENV_VAR) or None
    if raw is None:
        return {}
    overrides: dict[LlmFeature, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if not pair:
            continue
        name, _, model = pair.partition("=")
        if not model.strip():
            raise RuntimeError(f"{ENV_VAR} 형식 오류: {pair!r} — FEATURE=model 이어야 한다")
        try:
            feature = LlmFeature(name.strip().upper())
        except ValueError as e:
            raise RuntimeError(
                f"{ENV_VAR} 미지 feature: {name.strip()!r} "
                f"(유효: {[f.value for f in LlmFeature]})"
            ) from e
        overrides[feature] = model.strip()
    return overrides
