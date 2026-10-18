"""LlmPort fake 3종 (business-logic-model.md §3).

FakeLlm  : seed 기반 결정론 응답. 토큰 수는 문자열 길이 비례로 합성
           → call_record 파이프라인까지 테스트 가능.
FailingLlm: 항상 실패 (폴백 경로·FallbackEvent 발행 테스트용).
SlowLlm  : 항상 타임아웃 유발 (LlmTimeoutError).
TimeoutForModelsLlm: 지정 모델만 타임아웃, 나머지는 canned 응답 — 2단 폴백(모델 전환) 테스트용.
FeatureRoutingLlm: feature 별 canned|예외, 미지정은 echo — 한 턴에 여러 feature 를 부르는 오케스트레이터 테스트용.
"""

from __future__ import annotations

from collections.abc import Mapping

from trippilot.domain.llm import LlmFeature
from trippilot.ports.llm_port import LlmRequest, LlmResponse, LlmUnsupportedError, LlmTimeoutError


class FakeLlm:
    """LlmPort Protocol 만족. 같은 요청 → 같은 응답 (결정론)."""

    def __init__(self, canned: str | None = None) -> None:
        self._canned = canned

    def respond_with(self, text: str) -> "FakeLlm":
        return FakeLlm(canned=text)

    def invoke(self, request: LlmRequest) -> LlmResponse:
        text = self._canned if self._canned is not None else f"echo:{request.prompt}"
        return LlmResponse(
            raw_text=text,
            input_tokens=len(request.prompt),
            output_tokens=len(text),
            latency_ms=len(request.prompt) % 50,
            model_id=request.model_id,
        )


class FailingLlm:
    def invoke(self, request: LlmRequest) -> LlmResponse:
        raise RuntimeError("LLM unavailable (fake)")


class SlowLlm:
    def invoke(self, request: LlmRequest) -> LlmResponse:
        raise LlmTimeoutError(f"timeout > {request.timeout_sec}s (fake)")


class TimeoutForModelsLlm:
    """`timeout_models` 에 든 모델은 타임아웃, 나머지는 canned. 받은 요청을 기록한다."""

    def __init__(self, canned: str, *timeout_models: str) -> None:
        self._canned = canned
        self._timeout_models = frozenset(timeout_models)
        self.requests: list[LlmRequest] = []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        if request.model_id in self._timeout_models:
            raise LlmTimeoutError(f"timeout > {request.timeout_sec}s (fake, {request.model_id})")
        return LlmResponse(
            raw_text=self._canned, input_tokens=1, output_tokens=1, latency_ms=0,
            model_id=request.model_id,
        )


class FeatureRoutingLlm:
    """feature 별로 canned(str) 또는 예외(Exception 인스턴스)를 내는 LlmPort — `request.prompt_ref.feature` 로 분기.

    한 턴에 분류·답변·요약 세 feature 를 부르는 도우미 오케스트레이터 테스트 공용(assistant-orchestrator FD §8).
    `FakeLlm` 은 feature 무관 canned 1개라 부족했다. 미지정 feature 는 FakeLlm 과 같은 `echo:` 응답(결정론, D37).
    받은 요청을 `requests` 에 기록한다 — "어느 feature 가 몇 번, 어떤 timeout 으로 나갔나"를 단언하는 창구.
    """

    def __init__(self, by_feature: Mapping[LlmFeature, str | Exception]) -> None:
        self._by_feature = {feature.value: step for feature, step in by_feature.items()}
        self.requests: list[LlmRequest] = []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        step = self._by_feature.get(request.prompt_ref.feature)
        if isinstance(step, Exception):
            raise step
        text = step if step is not None else f"echo:{request.prompt}"
        return LlmResponse(
            raw_text=text,
            input_tokens=len(request.prompt),
            output_tokens=len(text),
            latency_ms=0,
            model_id=request.model_id,
        )

    def features(self) -> list[str]:
        """호출 순서대로의 feature 값 — 서비스·섀도 호출 분리 단언용."""
        return [r.prompt_ref.feature for r in self.requests]


class VisionSpyLlm:
    """수신한 이미지를 기록하는 LlmPort — "동의 없이는 이미지가 실리지 않는다"를
    관측 가능하게 만든다 (VIS-P1). 응답은 FakeLlm과 동형(결정론)."""

    def __init__(self, canned: str | None = None) -> None:
        self._canned = canned
        self.seen_images: list[tuple] = []  # 호출별 images 튜플

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.seen_images.append(request.images)
        text = self._canned if self._canned is not None else f"echo:{request.prompt}"
        return LlmResponse(
            raw_text=text,
            input_tokens=len(request.prompt),
            output_tokens=len(text),
            latency_ms=0,
            model_id=request.model_id,
        )


class TextOnlyLlm:
    """이미지를 못 받는 어댑터의 대역 — images가 실리면 LlmUnsupportedError.

    실 어댑터(Anthropic·chat.completions 경로)와 같은 계약이라 강등 경로를
    fake로 재현할 수 있다 (VIS-P4).
    """

    def invoke(self, request: LlmRequest) -> LlmResponse:
        if request.images:
            raise LlmUnsupportedError("이미지 미지원 어댑터")
        return LlmResponse(
            raw_text="{}", input_tokens=1, output_tokens=1,
            latency_ms=0, model_id=request.model_id,
        )


class ScriptedVisionLlm:
    """호출 순서대로 대본을 실행하는 LlmPort — 항목이 str이면 canned 응답,
    Exception 인스턴스면 raise (대본 소진 시 마지막 항목 반복). 결정론 (D37).

    호출별 images 튜플·프롬프트를 기록한다 — compose_vision 예산 공유(#9)의
    "vision이 k번째에 죽으면 이후 이미지 실린 호출 0 ∧ 템플릿 생성 호출 총합
    ≤ MAX_ATTEMPTS"를 호출 단위로 관측하는 계수 스파이 (TRIP-595).
    """

    def __init__(self, *script: str | Exception) -> None:
        if not script:
            raise ValueError("대본 ≥ 1 — 빈 대본은 응답을 지어내야 한다")
        self._script = script
        self.calls = 0
        self.seen_images: list[tuple] = []  # 호출별 images 튜플
        self.prompts: list[str] = []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        step = self._script[min(self.calls, len(self._script) - 1)]
        self.calls += 1
        self.seen_images.append(request.images)
        self.prompts.append(request.prompt)
        if isinstance(step, Exception):
            raise step
        return LlmResponse(
            raw_text=step, input_tokens=len(request.prompt),
            output_tokens=len(step), latency_ms=0, model_id=request.model_id,
        )


class SplitVisionLlm:
    """images 유무로 행동이 갈리는 LlmPort — vision 호출(images ≠ ())은 on_vision,
    텍스트 호출은 on_text (str=canned 응답, Exception 인스턴스=raise). 결정론 (D37).

    용도: "vision만 죽고 텍스트는 사는" 강등 계단 대역 (VIS-P3 드롭인 스윕 —
    타임아웃·비지원·벤더 예외·파싱 실패를 실 어댑터 없이 재현). 호출 순서가
    아니라 이미지 유무로 가르므로 구현의 호출 순서 변경에도 강건하다.
    seen_images로 "텍스트 강등 후 호출엔 images == ()"를 관측한다 (VIS-P1 사영).
    """

    def __init__(self, *, on_vision: str | Exception, on_text: str | Exception) -> None:
        self._on_vision = on_vision
        self._on_text = on_text
        self.calls = 0
        self.seen_images: list[tuple] = []
        self.prompts: list[str] = []

    def invoke(self, request: LlmRequest) -> LlmResponse:
        self.calls += 1
        self.seen_images.append(request.images)
        self.prompts.append(request.prompt)
        step = self._on_vision if request.images else self._on_text
        if isinstance(step, Exception):
            raise step
        return LlmResponse(
            raw_text=step, input_tokens=len(request.prompt),
            output_tokens=len(step), latency_ms=0, model_id=request.model_id,
        )
