"""RoutingLlm — 모델명 접두어로 벤더 어댑터를 고르는 합성 LlmPort (TRIP-513).

GPT·Claude 혼용의 접점: 게이트웨이는 기능→모델명(TierRouter, feature_models
오버라이드 포함)만 알고, **어느 벤더 SDK로 갈지는 모델명이 결정**한다 —
"claude*"는 Anthropic, 그 외는 기본(OpenAI 호환). 게이트웨이·워커 무변.

라우팅 실패 케이스가 없다 — 접두어 불일치는 전부 기본 어댑터로 (미지 모델명
거부는 벤더 API가 한다: 404가 폴백 계단으로 수렴, INV-4).
"""

from __future__ import annotations

from collections.abc import Mapping

from trippilot.ports.llm_port import LlmPort, LlmRequest, LlmResponse


class RoutingLlm:
    def __init__(self, default: LlmPort, routes: Mapping[str, LlmPort]) -> None:
        """routes: 모델명 접두어(소문자) → 어댑터. 예: {"claude": anthropic_adapter}."""
        self._default = default
        self._routes = dict(routes)

    def invoke(self, request: LlmRequest) -> LlmResponse:
        model = request.model_id.lower()
        for prefix, port in self._routes.items():
            if model.startswith(prefix):
                return port.invoke(request)
        return self._default.invoke(request)
