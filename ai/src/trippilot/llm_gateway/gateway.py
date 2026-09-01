"""TierRouter + GatewayFacade — LLM 호출 파이프라인의 유일한 관문 (U4 FD §2).

7단계: feature 검증 → 라우팅 → 렌더 → LlmPort.invoke → 파서 → 게이트 → TypedResult 조립.
실패 경로(타임아웃·벤더 예외·게이트가 error 를 설정한 경우)는 전부 동일 형태로 수렴:
TypedResult(is_fallback=True) + FallbackEvent + LlmCallRecord(success=False).
예외를 위로 던지지 않고 폴백 신호로 변환하는 것이 게이트웨이의 책임 (INV-4, BR-U4-02).

폴백의 **실행**은 호출측 몫 (BR-U4-09) — c1은 신호만 낸다. 다만 그 신호가 싣는
from_mode/to_mode는 호출측이 실제로 하는 일이어야 한다: feature마다 다르므로
C1Config.fallback_modes에서 읽는다 (TRIP-260 #4).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Protocol

from trippilot.llm_gateway.config import C1Config, UNMAPPED_FALLBACK_MODES
from trippilot.llm_gateway.gates.base import ExitGate
from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, ScoredPoi, TypedResult
from trippilot.domain.observability import FallbackEvent, LlmCallRecord
from trippilot.domain.prompt import PromptRef
from trippilot.ports.llm_port import (
    LlmImagePart,
    LlmPort,
    LlmRequest,
    LlmResponse,
    LlmTimeoutError,
    LlmUnsupportedError,
)
from trippilot.ports.trace_port import TracePort

_COMPONENT = "c1.gateway"


class PromptRenderer(Protocol):
    """PromptRegistry 계약 (실체는 U4-05 prompts.py). 렌더는 결정론 (BR-U4-06)."""

    def render(
        self, feature: LlmFeature, variables: Mapping[str, object]
    ) -> tuple[str, PromptRef]: ...


class TierRouter:
    """feature → tier → model_id. 전부 C1Config 조회 — 결정론 (§2 2단).

    매핑 누락은 폴백이 아니라 설정 버그 → ValueError.
    """

    def __init__(self, config: C1Config) -> None:
        self._cfg = config

    def route(self, feature: LlmFeature) -> str:
        override = self._cfg.feature_models.get(feature)
        if override is not None:  # 기능별 오버라이드 우선 (TRIP-513) — 결정론 유지
            return override
        tier = self._cfg.tier_map.get(feature)
        if tier is None:
            raise ValueError(f"tier_map에 없는 feature: {feature}")
        model_id = self._cfg.model_ids.get(tier)
        if model_id is None:
            raise ValueError(f"model_ids에 없는 tier: {tier}")
        return model_id


class GatewayFacade:
    def __init__(
        self,
        llm: LlmPort,
        renderer: PromptRenderer,
        gate: ExitGate,
        config: C1Config,
        trace: TracePort,
    ) -> None:
        self._llm = llm
        self._renderer = renderer
        self._gate = gate
        self._cfg = config
        self._router = TierRouter(config)
        self._trace = trace

    @property
    def config(self) -> C1Config:
        """주입 설정 노출(읽기 전용) — 워커 계층 청킹 정책이 같은 설정을 본다 (TRIP-378)."""
        return self._cfg

    @property
    def trace(self) -> TracePort:
        """관측 콘센트 노출(읽기 전용) — 워커 계층 이벤트도 같은 곳으로 발행 (INV-4)."""
        return self._trace

    def call(
        self,
        feature: LlmFeature,
        prompt_vars: Mapping[str, object],
        pool: CandidatePool | None,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
        images: tuple[LlmImagePart, ...] = (),
        consent_ref: str | None = None,
    ) -> TypedResult[tuple[ScoredPoi, ...]]:
        """images는 멀티모달 feature 전용 후미 기본값 (TRIP-595, FD §6.1 A안) —
        기존 텍스트 호출은 전부 무영향이고, 강등은 "같은 파이프라인, images만 비움"으로
        표현된다. 이미지도 게이트웨이를 지나야 계측(LlmCallRecord)이 빠지지 않는다.

        **사진은 동의 증빙과 짝으로만 나간다** (BR-U6R-09): images가 있는데
        consent_ref가 없으면 호출 자체가 버그다 — 폴백이 아니라 ValueError.
        타입 강제(VisionInput)는 워커 안의 관례라 다른 워커가 우회할 수 있지만,
        이미지는 이 게이트웨이 경유로만 벤더에 나간다(규약 — LlmRequest에
        images를 싣는 곳은 여기뿐이며, 게이트웨이 밖 탑재는 시각 seam 테스트가
        스캔으로 막는다). 여기서 막으면 우회로가 없다.
        """
        # 1 feature ∈ LlmFeature — 밖이면 호출 자체가 버그 (BR-U4-05, 폴백 아님)
        if not isinstance(feature, LlmFeature):
            raise ValueError(f"LlmFeature 밖의 기능 호출: {feature!r}")
        if images and not (consent_ref or "").strip():
            raise ValueError(
                "동의 증빙 없이 이미지를 보낼 수 없다 — consent_ref 필요 (BR-U6R-09)")
        # 2 라우팅 (설정 버그면 ValueError 그대로)
        model_id = self._router.route(feature)
        # 3 렌더
        prompt, prompt_ref = self._renderer.render(feature, prompt_vars)
        # 4 호출 — SDK가 닿는 유일한 지점
        try:
            response = self._llm.invoke(
                LlmRequest(
                    model_id=model_id,
                    prompt=prompt,
                    prompt_ref=prompt_ref,
                    max_tokens=self._cfg.max_tokens,
                    temperature=self._cfg.temperature,
                    # 호출측 단계 예산 override (TRIP-376) — PREFERENCE_SCORING처럼
                    # 단계 상한이 있는 호출이 넘긴다. 미지정이면 설정 기본
                    # (INTENT 등 즉답성 feature는 그대로 2.5s).
                    timeout_sec=(
                        self._cfg.timeout_sec if timeout_sec is None else timeout_sec
                    ),
                    images=images,
                )
            )
        except LlmTimeoutError as e:
            return self._fallback(
                feature, model_id, prompt_ref, trace_id, now, None, f"timeout: {e}",
                consent_ref=consent_ref,
            )
        except LlmUnsupportedError as e:
            # 타임아웃과 같은 자리 — 다만 사유를 가른다. 비지원은 재시도해도 같은 결과라
            # 호출측 처방이 "이번엔 실패"가 아니라 "이 경로를 포기하고 강등"이다
            # (BR-U6R-10 — 조용한 이미지 무시 금지, 강등은 명시 신호로).
            return self._fallback(
                feature, model_id, prompt_ref, trace_id, now, None, f"unsupported: {e}",
                consent_ref=consent_ref,
            )
        except Exception as e:  # 벤더 예외 포함 전부 폴백 신호로 (BR-U4-02)
            return self._fallback(
                feature, model_id, prompt_ref, trace_id, now, None, f"llm_error: {e}",
                consent_ref=consent_ref,
            )
        # 5·6 파서 + closed-set 게이트 (INV-1)
        outcome = self._gate.apply(
            response.raw_text, pool, feature=feature, trace_id=trace_id, now=now
        )
        if outcome.drop_event is not None:
            self._trace.emit(outcome.drop_event)
        if outcome.error is not None:
            # "빈 결과가 실패인가"는 feature 의미론이라 게이트가 정한다 (TRIP-260 #5).
            # 여기서 `not outcome.value` 를 함께 보던 동안, 추출 계열이 내는
            # **성공·0건**(그 기간 그 지역에 행사가 없음)이 폴백으로 뒤집혔다.
            # 사유 라벨 2종(gate_dropped_all / llm_empty_result)은 게이트의
            # `empty_result_error` 가 그대로 유지한다 — 2026-08-25 사고의 산물이다.
            return self._fallback(
                feature, model_id, prompt_ref, trace_id, now, response, outcome.error,
                consent_ref=consent_ref,
            )
        # 7 성공 조립 + 계측 (BR-U4-03)
        record = self._record(
            feature, model_id, prompt_ref, trace_id, now, response, success=True,
            consent_ref=consent_ref,
        )
        self._trace.emit(record)
        return TypedResult(
            value=outcome.value, is_fallback=False, error=None, call_record=record
        )

    def _fallback(
        self,
        feature: LlmFeature,
        model_id: str,
        prompt_ref: PromptRef,
        trace_id: TraceId,
        now: datetime,
        response: LlmResponse | None,
        reason: str,
        consent_ref: str | None = None,
    ) -> TypedResult[tuple[ScoredPoi, ...]]:
        record = self._record(
            feature, model_id, prompt_ref, trace_id, now, response, success=False,
            consent_ref=consent_ref,
        )
        self._trace.emit(record)
        # 폴백 모드는 feature별 실체 — 매핑에 없으면 지어내지 않고 unmapped로 드러낸다
        from_mode, to_mode = self._cfg.fallback_modes.get(
            feature, UNMAPPED_FALLBACK_MODES
        )
        self._trace.emit(
            FallbackEvent(
                trace_id=trace_id,
                occurred_at=now,
                component=_COMPONENT,
                stage="llm",
                from_mode=from_mode,
                to_mode=to_mode,  # 실행은 호출측 (BR-U4-09) — 여기는 그 실체를 싣는다
                reason=reason,
            )
        )
        return TypedResult(value=None, is_fallback=True, error=reason, call_record=record)

    def _record(
        self,
        feature: LlmFeature,
        model_id: str,
        prompt_ref: PromptRef,
        trace_id: TraceId,
        now: datetime,
        response: LlmResponse | None,
        *,
        success: bool,
        consent_ref: str | None = None,
    ) -> LlmCallRecord:
        return LlmCallRecord(
            trace_id=trace_id,
            occurred_at=now,
            component=_COMPONENT,
            feature=feature.value,
            model_id=model_id,
            prompt_ref=prompt_ref,
            input_tokens=response.input_tokens if response else 0,
            output_tokens=response.output_tokens if response else 0,
            latency_ms=response.latency_ms if response else 0,
            success=success,
            agent=None,
            consent_ref=consent_ref,  # 이미지 호출의 동의 근거 (BR-U6R-09)
        )
