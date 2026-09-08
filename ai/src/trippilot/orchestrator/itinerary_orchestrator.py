"""ItineraryOrchestrator — 소유 검증 → 시한 배분 → 정보 수집·소화 → ScheduleAgent 위임.

생성 파이프라인(점수·문제 조립·어셈블리 solve·설명)은 `agents/schedule/` 의
`ScheduleAgent` 가 소유한다. 이 모듈은 v2 §2 의 1단(오케스트레이터) 몫만 한다:

```
요청 → ⓪ 소유 검증 (fail-closed)   남의 persona_ref → 항상 403 (TRIP-333, 시한 무관)
     → allocate                    단계별 상한 + 어셈블리 잔여 전부 (TRIP-376)
     → ① 정보 수집 1회 (InfoCollector) 풀·페르소나·날씨·행사 — 풀 없으면 즉시 실패
     → ①′ 패킷 소화                 날씨 → daily_rain, 행사 → event_bonus (None = 무보정)
     → ScheduleTask 발행            재료를 봉투로 — 에이전트는 Provider·수집기를 모른다
     → ScheduleAgent.run            ② 점수 → ③ 문제 → ④ solve → ⑤ 설명 (agents/schedule/agent.py)
```

**INV-4**: `generate()`는 예외를 밖으로 던지지 않는다. 오케스트레이터 자기 단계의 실패는
**명시적 실패**(`FAILED` + error)로 수렴하고, 수집 단계에서 밟은 계단(날씨·행사 실패)은
`ScheduleTask.prior_degradations` 로 에이전트에 넘겨 결과 status 에 합산된다(침묵 금지).

**중복 관측 금지**: 오케스트레이터 스스로 내린 결정(풀 초과 관측, 날씨·행사 수집 실패,
풀 확보 실패)만 `orchestrator.itinerary` 이름으로 발행한다. 에이전트 단계의 강등은
에이전트가 `agents.schedule` 로 발행하고, 하류(게이트웨이·어셈블리 퍼사드)가 스스로 결정한
강등은 하류가 이미 발행했다.

공개 표면: 이 모듈에서 import 되던 결과·요청·예산 타입은 정의가 `agents/schedule/` 로
옮겨갔고 여기서 **재수출**한다 — `api/wiring.py` 의 `core.*` 와 테스트 import 는 그대로다.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Protocol

from trippilot.agents.schedule.agent import (
    AssemblyFacade,
    AssemblyProvider,
    Clock,
    GenerateItineraryRequest,
    ScheduleAgent,
    ScheduleTask,
)
from trippilot.agents.schedule.budget import (
    ZERO_BUDGET,
    DeadlineBudget,
    OrchestratorConfig,
    allocate,
)
from trippilot.agents.schedule.outcome import (
    CandidatesReport,
    Degradation,
    GenerationOutcome,
    GenerationStatus,
    ScoringMode,
    candidates_report,
    failed_outcome,
)
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.context import PermissionDeniedError, Principal, ResourceRef
from trippilot.domain.event import EventInfo
from trippilot.domain.freshness import InfoPacket, ProviderKind, ProviderStatus
from trippilot.domain.llm import CandidatePool
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.persona import PersonaSummary
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.orchestrator.event_affinity import event_bonus_map
from trippilot.orchestrator.info_collector import InfoCollector
from trippilot.ports.trace_port import TracePort

__all__ = [
    "AssemblyFacade",
    "AssemblyProvider",
    "CandidatesReport",
    "Clock",
    "DeadlineBudget",
    "Degradation",
    "GenerateItineraryRequest",
    "GenerationOutcome",
    "GenerationStatus",
    "ItineraryOrchestrator",
    "OrchestratorConfig",
    "OwnershipVerifier",
    "ScoringMode",
    "allocate",
    "candidates_report",
]

_COMPONENT = "orchestrator.itinerary"


# ── 협력자 계약 (주입) ──────────────────────────────────────────────


class OwnershipVerifier(Protocol):
    """ContextResolver의 소유 검증 갈래 (TRIP-333 fail-closed).

    보안 규칙의 권위는 게이트웨이 `llm_gateway.context.ContextResolver`에 있다 —
    오케스트레이터는 검사를 복제하지 않고 그 검증 전용 공개 메서드만 호출한다.
    저장소 조회·LLM 호출 없음.
    """

    def verify_ownership(
        self, principal: Principal, refs: tuple[ResourceRef, ...]
    ) -> None: ...


class ItineraryOrchestrator:
    def __init__(
        self,
        info: InfoCollector,
        agent: ScheduleAgent,
        clock: Clock,
        trace: TracePort,
        *,
        context_resolver: OwnershipVerifier,
        config: OrchestratorConfig | None = None,
    ) -> None:
        # 수집은 전부 InfoCollector 경유 (TRIP-406·407) — 풀(PLACE)은 필수,
        # 날씨(WEATHER)·페르소나(PERSONA)·행사(EVENT)는 미등록 시 기능 부재로 동작.
        self._info = info
        self._agent = agent
        self._clock = clock
        self._trace = trace
        self._resolver = context_resolver  # 소유 검증 갈래만 쓴다 (TRIP-333)
        self._cfg = config or OrchestratorConfig()

    # ── 공개 API ────────────────────────────────────────────────────

    def generate(
        self,
        request: GenerateItineraryRequest,
        deadline_ms: int,
        trace_id: TraceId,
        now: datetime,
    ) -> GenerationOutcome:
        """요청 → 일정. 예외를 던지지 않는다 (INV-4 — 결과 또는 명시적 실패)."""
        budget = ZERO_BUDGET
        try:
            budget = allocate(deadline_ms, self._cfg)
            return self._generate(request, budget, trace_id, now)
        except PermissionDeniedError as e:
            # D31: 권한 위반은 폴백 대상이 아니다 — 규칙 점수로 조용히 내려가면
            # 남의 페르소나 없이 "성공한 척"하게 된다. 부분 성공 0.
            return self._failed(budget, f"permission_denied: {e}", trace_id, now)
        except Exception as e:
            return self._failed(
                budget, f"orchestrator_error: {type(e).__name__}: {e}", trace_id, now
            )

    # ── ⓪ ① 수집·소화 → 위임 ────────────────────────────────────────

    def _generate(
        self,
        request: GenerateItineraryRequest,
        budget: DeadlineBudget,
        trace_id: TraceId,
        now: datetime,
    ) -> GenerationOutcome:
        t0 = self._clock.monotonic_ms()
        steps: list[Degradation] = []

        # ⓪ 소유 검증 — fail-closed (TRIP-333, 팀 결정 2026-08-11).
        #    권한 검사를 접근 시점(게이트웨이의 페르소나 재조회)에만 맡기면 DL-2 시한
        #    스킵으로 점수 단계가 통째로 건너뛰어질 때 남의 persona_ref가 403 없이 규칙
        #    점수 일정으로 "성공"한다. deadline이 어떤 값이어도 남의 persona_ref는 항상
        #    403 — 검사의 권위는 ContextResolver 한 곳이고, 여기서는 소유 검증 갈래만
        #    호출한다(저장소 조회·LLM 호출 없음, 검사 복제 아님). 위반이면
        #    PermissionDeniedError → generate가 FAILED(permission_denied)로 수렴 →
        #    경계에서 403 retryable=false (api/errors.py 기존 매핑 그대로).
        #    참고: 현 와이어에는 사용자 식별자가 없어 principal이 trip_id 파생
        #    자기참조라(api/wiring.py) 경계에서 403이 실제 발현되지는 않는다 —
        #    이 검사는 내부 계약을 미리 옳게 만드는 것으로, 실 식별자 합의 시
        #    그대로 동작한다.
        self._resolver.verify_ownership(request.principal, (request.persona_ref,))

        # ① 정보 수집 1회 (TRIP-407) — 요구표 GENERATE_SCHEDULE: 풀·날씨·페르소나·행사.
        #    풀(PLACE→poi_curation)은 closed-set의 유일한 출처(INV-1)이자 필수 — 요구표
        #    "풀 없으면 즉시 실패". 날씨·페르소나·행사는 없어도 일정은 나간다.
        packets = self._info.collect(
            "GENERATE_SCHEDULE",
            {
                "pool_request": CandidatePoolRequest(
                    anchor=request.anchor,
                    dates=request.days,  # 부분집합 그대로 (반경 규칙은 poi_curation 소관)
                    budget=request.budget,
                    transport=request.transport,
                    radius_override_km=request.radius_override_km,
                ),
                "anchor": request.anchor,
                "days": request.days,
                "now": now,
                "principal": request.principal,
                "persona_ref": request.persona_ref,
            },
        )
        pool = self._resolve_pool(packets)
        if pool is None:
            place = packets.get(ProviderKind.PLACE)
            reason = (place.data.get("reason", place.status.value)
                      if place is not None else "place_provider_unregistered")
            return self._failed(budget, f"pool_unavailable: {reason}", trace_id, now)
        persona = self._collected_persona(packets)
        summary = candidates_report(pool)  # 풀 실측 보고 (BR-U2-05 — 경계로 그대로 나간다)
        m7_elapsed = self._clock.monotonic_ms() - t0
        if budget.m7_ms and m7_elapsed > budget.m7_ms:
            # 풀 없이는 일정이 없으므로 풀 단계는 스킵 대상이 아니다 — 초과는 관측만 하고,
            # 실제 회수는 에이전트의 어셈블리 예산 계산(= 전체 − 경과)에서 자동으로 일어난다.
            self._observe(trace_id, now, "pool", "m7", "m7",
                          f"m7_overrun:{m7_elapsed}ms")

        # ①′ 패킷 소화 — 날씨(TRIP-383)·행사 보너스(TRIP-421)를 어셈블리 소프트 항 값으로.
        #    수집 실패 = 무보정 + 강등 기록(침묵 금지), 미등록 = 기능 부재(무보정).
        #    행사 보너스는 EVENT 패킷·풀·페르소나를 **함께** 봐야 해서 Provider 가 못 하는
        #    일이다(Provider 끼리는 서로의 데이터를 못 본다) — 수집 후 조립 단계인 여기서.
        daily_rain = self._daily_rain(request, packets, steps, trace_id, now)
        event_bonus = self._event_bonus(request, packets, pool, persona,
                                        steps, trace_id, now)

        # 위임 — 재료를 봉투에 담아 넘긴다. 시계 원점(t0)을 같이 넘겨 단계 시한이
        # 오케스트레이터와 한 원점으로 계산되게 한다(TRIP-376 배분 보존).
        return self._agent.run(ScheduleTask(
            request=request,
            pool=pool,
            persona=persona,
            daily_rain=daily_rain,
            event_bonus=event_bonus,
            candidates_summary=summary,
            budget=budget,
            started_ms=t0,
            trace_id=trace_id,
            now=now,
            prior_degradations=tuple(steps),
        ))

    # ── ① 패킷 → 실체 ────────────────────────────────────────────────

    def _resolve_pool(
        self, packets: dict[ProviderKind, InfoPacket]
    ) -> CandidatePool | None:
        """PLACE 패킷 → 풀 실체. None = 풀 확보 불가 (호출측이 FAILED로 수렴)."""
        packet = packets.get(ProviderKind.PLACE)
        if packet is None:
            return None
        ref = packet.data.get("pool_ref")
        if not isinstance(ref, str):  # 조립 예외 — ref 자체가 없다
            return None
        return self._info.resolve_pool(ref)

    def _collected_persona(
        self, packets: dict[ProviderKind, InfoPacket]
    ) -> PersonaSummary | None:
        """PERSONA 패킷 → PersonaSummary. 비가용이면 None (규칙 점수로 강등은 에이전트 ②)."""
        packet = packets.get(ProviderKind.PERSONA)
        if packet is None or packet.status is not ProviderStatus.OK:
            return None
        try:
            return PersonaSummary.from_dict(packet.data["persona"])
        except Exception:  # 패킷 형식 오류 — 비가용과 동일 취급
            return None

    def _event_bonus(
        self,
        request: GenerateItineraryRequest,
        packets: dict[ProviderKind, InfoPacket],
        pool: CandidatePool,
        persona: PersonaSummary | None,
        steps: list[Degradation],
        trace_id: TraceId,
        now: datetime,
    ) -> dict[PoiId, float] | None:
        """EVENT 패킷 → 풀 POI 보너스 맵 (event_affinity 순수 함수 조립, TRIP-421).

        - Provider 미등록(패킷 없음) = 기능 부재 — 무보정, 강등 아님.
        - 수집 실패(OK·LOW 밖 상태값) = 무보정 + Degradation (침묵 금지, INV-4).
        - 페르소나 비가용·적합 행사 없음·빈 맵 = 무보정 (정보 없음 ≠ 실패).
        """
        packet = packets.get(ProviderKind.EVENT)
        if packet is None:
            return None
        if packet.status not in (ProviderStatus.OK, ProviderStatus.LOW):
            self._degrade(steps, trace_id, now, "event", "event_bonus", "no_bonus",
                          f"event_error: {packet.data.get('reason', packet.status.value)}")
            return None
        try:
            events = tuple(EventInfo.from_dict(e)
                           for e in packet.data.get("events", ()))
        except Exception as e:  # 패킷 형식 오류 — 비가용과 동일 취급 (기록은 남긴다)
            self._degrade(steps, trace_id, now, "event", "event_bonus", "no_bonus",
                          f"event_parse_error: {type(e).__name__}: {e}")
            return None
        if not events:
            return None
        bonus = event_bonus_map(
            events, pool.pois,
            anchor=request.anchor,
            transport=request.transport,
            taste_tags=persona.taste_tags if persona is not None else (),
        )
        return bonus or None

    def _daily_rain(
        self,
        request: GenerateItineraryRequest,
        packets: dict[ProviderKind, InfoPacket],
        steps: list[Degradation],
        trace_id: TraceId,
        now: datetime,
    ) -> dict[date, int] | None:
        """여행 날짜들의 강수확률(%) — ①에서 수집된 패킷 소비 (재수집 없음, TRIP-407).

        오케스트레이터는 포트를 모르고 InfoPacket 상태값만 본다 (agent-structure-v2 §3).
        - **Provider 미등록(패킷 없음)**: 기능 부재 — 무보정, 강등으로 세지
          않는다(설명 워커의 "미배선 = 기능 부재" 선례와 동일).
        - **수집 실패(OK 아닌 상태값)**: 무보정 + Degradation + FallbackEvent
          (침묵 금지, INV-4 — 날씨 실패가 생성 실패가 되면 안 된다).
        - 반환은 요청 날짜로 한정한다(예보 지평 밖·무관 날짜는 problem에 싣지 않음).
          유효 예보가 없으면 None — 어셈블리 무보정 경로와 동일.
        """
        packet = packets.get(ProviderKind.WEATHER)
        if packet is None:  # Provider 미등록 — 기능 부재
            return None
        if packet.status is not ProviderStatus.OK:
            self._degrade(steps, trace_id, now, "weather", "weather_forecast",
                          "no_adjust",
                          f"weather_error: {packet.data.get('reason', packet.status.value)}")
            return None
        wanted = set(request.days)
        # 패킷 data는 JSON-safe(ISO 문자열 키) — problem 주입 전에 date로 복원
        filtered = {
            parsed: p for d, p in packet.data.get("daily", {}).items()
            if (parsed := date.fromisoformat(d)) in wanted
        }
        return filtered or None

    # ── 실패·관측 헬퍼 ──────────────────────────────────────────────

    def _failed(
        self,
        budget: DeadlineBudget,
        error: str,
        trace_id: TraceId,
        now: datetime,
    ) -> GenerationOutcome:
        # 예외 경로도 반드시 흔적을 남긴다 (침묵 실패 금지). 풀 이전 실패라
        # candidates_summary 는 None — 모름을 유지.
        self._observe(trace_id, now, "agent", "generate", "(none)", error)
        return failed_outcome(budget, error)

    def _degrade(
        self,
        steps: list[Degradation],
        trace_id: TraceId,
        now: datetime,
        stage: str,
        from_mode: str,
        to_mode: str,
        reason: str,
    ) -> None:
        """오케스트레이터가 **스스로 내린** 강등 — 결과에 싣고 이벤트도 발행한다."""
        steps.append(Degradation(stage=stage, reason=reason))
        self._observe(trace_id, now, stage, from_mode, to_mode, reason)

    def _observe(
        self,
        trace_id: TraceId,
        now: datetime,
        stage: str,
        from_mode: str,
        to_mode: str,
        reason: str,
    ) -> None:
        try:
            self._trace.emit(
                FallbackEvent(
                    trace_id=trace_id,
                    occurred_at=now,
                    component=_COMPONENT,
                    stage=stage,
                    from_mode=from_mode,
                    to_mode=to_mode,
                    reason=reason,
                )
            )
        except Exception:
            pass  # 계측 실패가 생성 실패가 되면 안 된다
