"""대화 해석 경계 ↔ 해석기·오케스트레이터 사영 (U8 FD §3 · assistant-orchestrator FD DE §2.1·§3).

와이어 스키마를 도메인 입력(`DialogueContext`·`TripView`·`TurnInput`)으로 풀고, 결과를 다시 와이어로
싼다. `wiring.py` 는 경합이 잦은 파일이라 변환과 **오케스트레이터 조립**(`build_dialogue_orchestrator`)을 여기 둔다 —
거기엔 생성자 인자·위임 한 줄·팩토리 호출 한 줄만 있다(BR-AO-13).

두 경로 (BLM §3 머리 · BR-AO-13):
- 오케스트레이터가 주입되면 `TurnInput` 을 조립해 `DialogueOrchestrator.turn()` — `ANSWER` 는 `answer` 를 채우고,
  FRAME/ARGUMENT_CLARIFY/OUT_OF_SCOPE 는 종전 모양 그대로(`answer` null).
- 미주입(`TRIPPILOT_DIALOGUE_ORCHESTRATOR=off`)이면 종전 `DialogueInterpreter` 경로 **그대로** — 되돌리기는 시크릿 한 줄이다(BLM §13).
"""

from __future__ import annotations

import logging
import random
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone, tzinfo

from trippilot.agents.planb.rag import PlanBAgent
from trippilot.agents.schedule.agent import Clock
from trippilot.api import schemas
from trippilot.domain.common import TraceId
from trippilot.domain.freshness import ProviderKind
from trippilot.domain.intent import Intent
from trippilot.domain.llm import LlmFeature
from trippilot.domain.plan_tools import PLAN_TOOLS, plan_tool_specs_json
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.dialogue_answer import DialogueAnswerGate
from trippilot.llm_gateway.gates.dialogue_memory import DialogueMemoryGate
from trippilot.llm_gateway.gates.dialogue_plan import DialoguePlanGate
from trippilot.llm_gateway.gates.intent import IntentGate
from trippilot.llm_gateway.gates.paraphrase import ParaphraseGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.dialogue_answer import DialogueAnswerWorker
from trippilot.llm_gateway.workers.dialogue_intent import DialogueIntentWorker
from trippilot.llm_gateway.workers.dialogue_memory import DialogueMemoryWorker
from trippilot.llm_gateway.workers.dialogue_plan import DialoguePlanWorker
from trippilot.orchestrator.dialogue_handlers import DayView, HandlerPorts, SlotView, TripInfo, TurnSnapshot
from trippilot.orchestrator.dialogue_interpreter import (
    Clarify,
    DialogueContext,
    DialogueInterpreter,
    Frame,
    TripView,
)
from trippilot.orchestrator.dialogue_orchestrator import (
    DEFAULT_DEADLINE_MS,
    DialogueAnswer,
    DialogueOrchestrator,
    RecentTurn,
    TurnInput,
)
from trippilot.orchestrator.dialogue_plan import plan_tools
from trippilot.orchestrator.intent_router import IntentRouter, IntentRouterConfig
from trippilot.orchestrator.question_bank import BankEntry, bank_fingerprint
from trippilot.orchestrator.shadow_probe import ShadowCountingLlm, ShadowIntentProbe, TaggedTrace
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.llm_port import LlmPort
from trippilot.ports.memory_store_port import MemoryStorePort, delete_selector
from trippilot.ports.trace_port import TracePort
from trippilot.ports.vector_store_port import VectorStorePort
from trippilot.providers.base import Provider

log = logging.getLogger(__name__)

# 백엔드가 `deadline_ms` 를 안 보냈을 때 쓰는 `DEFAULT_DEADLINE_MS` — 종전 경로의 "시간제약 없음(600_000)" 을 그대로 쓰면
# 분류·답변 시한 배분표(BLM §4)가 상한에 걸리지 않아 10s 기본으로 나간다. 값의 정본은 오케스트레이터 모듈 상수 한 곳
# (BR-AO-01 · 미결 #5) — 여기서는 import 해 쓴다.


def _trip_view(snapshot: schemas.DialogueContextSnapshot) -> TripView:
    """되묻기 보기의 재료 — 일수와 **아직 남은 순서대로의** 슬롯 이름."""
    days = 0
    if snapshot.trip is not None:
        days = (snapshot.trip.end_date - snapshot.trip.start_date).days + 1
    names: list[str] = []
    if snapshot.itinerary is not None:
        for day in snapshot.itinerary.days:
            names.extend(s.name for s in day.slots if s.name)
    return TripView(day_count=max(days, 0), slot_names=tuple(names))


def _snapshot(wire: schemas.DialogueContextSnapshot) -> TurnSnapshot:
    """와이어 스냅샷 → `TurnSnapshot` (DE §2.1). 값은 백엔드 화이트리스트 그대로 — 좌표·가격 칸이 없다."""
    trip = wire.trip
    itinerary = wire.itinerary
    return TurnSnapshot(
        surface=wire.surface.value,
        trip=(TripInfo(trip.trip_id, tuple(trip.regions), trip.start_date, trip.end_date, trip.phase)
              if trip is not None else None),
        base_stays=tuple(wire.base_stays),
        itinerary_status=itinerary.status if itinerary is not None else None,
        days=tuple(
            DayView(d.date, tuple(SlotView.from_wire(s.slot_key, s.name, s.start_at, s.category) for s in d.slots))
            for d in (itinerary.days if itinerary is not None else ())
        ),
    )


def _turn_input(request: schemas.DialogueInterpretRequest, now: datetime, started_ms: int) -> TurnInput:
    meta = request.request_meta
    return TurnInput(
        utterance=request.utterance,
        context=DialogueContext.from_dict(request.dialogue_context),
        snapshot=_snapshot(request.context),
        session_id=request.session_id,
        account_ref=request.account_ref,
        recent_turns=tuple(RecentTurn(t.role, t.text) for t in request.recent_turns),
        trace_id=TraceId(meta.request_id),
        now=now,
        deadline_ms=meta.deadline_ms if meta.deadline_ms is not None else DEFAULT_DEADLINE_MS,  # 오케스트레이터 상수
        started_ms=started_ms,
    )


def _wire(
    outcome: str,
    frames: Sequence[Frame],
    clarify: Clarify | None,
    context: DialogueContext,
    llm_calls: int,
    answer: DialogueAnswer | None = None,
) -> schemas.DialogueInterpretResponse:
    """두 경로가 같은 응답 모양을 쓴다 — `answer` 만 오케스트레이터 ANSWER 에서 채워진다."""
    return schemas.DialogueInterpretResponse(
        outcome=outcome,
        frames=[
            schemas.DialogueFrameSchema(
                intent=f.intent.value, arguments=dict(f.arguments), missing=list(f.missing),
                confidence=max(0.0, min(1.0, f.confidence)), match_route=f.match_route,
            )
            for f in frames
        ],
        clarify=(
            schemas.DialogueClarifySchema(
                frame_index=clarify.frame_index, argument=clarify.argument, question=clarify.question,
                options=list(clarify.options) if clarify.options is not None else None,
            )
            if clarify is not None else None
        ),
        dialogue_context=context.to_dict(),
        llm_calls=llm_calls,
        # `to_dict` 는 와이어 모양 — 스키마가 kind·next_actions ≥1 을 한 번 더 검증한다
        answer=schemas.DialogueAnswerSchema(**answer.to_dict()) if answer is not None else None,
    )


def interpret(
    interpreter: DialogueInterpreter,
    request: schemas.DialogueInterpretRequest,
    tz: timezone,
    *,
    orchestrator: DialogueOrchestrator | None = None,
    clock: Clock | None = None,
) -> schemas.DialogueInterpretResponse:
    """`orchestrator` 가 있으면 한 턴을 AI 안에서 끝내고(ANSWER 가능), 없으면 종전 해석 경로 그대로.

    `clock` 은 오케스트레이터에 준 **그 시계**여야 한다 — `started_ms`(잔여 시한의 원점, DE §2.1)를 여기서 1회 잡는데,
    시계가 다르면 잔여 계산이 어긋나 시한 배분(BR-AO-01)이 거짓이 된다. 그래서 빠지면 조립 오류로 바로 드러낸다.
    """
    meta = request.request_meta
    now: datetime = meta.requested_at
    if now.tzinfo is None:
        now = now.replace(tzinfo=tz)
    if orchestrator is not None:
        if clock is None:
            raise ValueError("오케스트레이터 경로는 clock 필수 — started_ms 의 시계가 오케스트레이터와 같아야 한다")
        turn = orchestrator.turn(_turn_input(request, now, clock.monotonic_ms()))
        return _wire(turn.outcome, turn.frames, turn.clarify, turn.context, turn.llm_calls, turn.answer)
    result = interpreter.interpret(
        request.utterance,
        DialogueContext.from_dict(request.dialogue_context),
        _trip_view(request.context),
        TraceId(meta.request_id),
        now,
    )
    return _wire(result.outcome, result.frames, result.clarify, result.context, result.llm_calls)


# ───────── 오케스트레이터 조립 (FD BLM §3·§9.1 — wiring 은 이 함수를 한 줄로 부른다, BR-AO-13) ─────────


def build_dialogue_orchestrator(
    *,
    llm: LlmPort,
    counted: LlmPort,
    renderer: PromptRegistry,
    c1_config: C1Config,
    trace: TracePort,
    embedding: EmbeddingPort,
    bank_store: VectorStorePort,
    bank_ready: Callable[[], bool],
    bank: Sequence[BankEntry],
    confident_intent: Callable[[str], Intent | None],
    providers: Mapping[ProviderKind, Provider],
    pool_builder: CandidatePoolBuilder,
    rag: PlanBAgent,
    memory_store: MemoryStorePort,
    clock: Clock,
    tz: tzinfo,
    shadow_rate: float,
    shadow_rng: random.Random | None,
) -> DialogueOrchestrator:
    """서비스 워커 3종(`counted` 공유 — 백엔드 사용량 상한의 원천) + 섀도 전용 3단 라우터 + 핸들러 포트를 묶는다.

    섀도 라우터는 같은 `IntentRouter` 클래스·같은 뱅크 스토어(읽기 전용)를 LLM 카운터(인스턴스, contextvar 아님)·트레이스
    표지(`c1.gateway.shadow`)만 바꿔 한 번 더 조립한다 — 서비스 `llm_calls` 에 섀도 호출이 섞이지 않는다(BR-AO-07).
    `providers`·`pool_builder`·`rag` 는 wiring 이 이미 만든 **그 인스턴스**다(새로 만들면 배선이 갈라진다).
    계획 워커(2‴, BR-AO-28)는 `DIALOGUE_PLAN` 이 기능별 모델에 배정됐을 때만 조립한다 — 배정이 곧 켜기다(DEC-AO-18).
    """
    shadow_llm, shadow_trace, shadow_cfg = ShadowCountingLlm(llm), TaggedTrace(trace), IntentRouterConfig()
    shadow_router = IntentRouter(
        embedding, bank_store, config=shadow_cfg,
        intent_gateway=GatewayFacade(shadow_llm, renderer, IntentGate(), c1_config, shadow_trace),
        paraphrase_gateway=GatewayFacade(shadow_llm, renderer, ParaphraseGate(), c1_config, shadow_trace),
        bank_ready=bank_ready,
    )
    ports = HandlerPorts(poi_info=providers[ProviderKind.POI_INFO], weather=providers.get(ProviderKind.WEATHER),
                         transit=providers[ProviderKind.TRANSIT], pool_builder=pool_builder, planb=rag)
    tools = plan_tools(ports)  # 배선된 도구 → 설명(여행 필요 꼬리표 포함) — 게이트 closed-set 과 `$tools` 가 같은 사전에서 나온다
    planner = None
    if LlmFeature.DIALOGUE_PLAN in c1_config.feature_models:  # DEC-AO-18 — 배정이 곧 켜기(env 무증가)
        planner = DialoguePlanWorker(
            GatewayFacade(counted, renderer, DialoguePlanGate(frozenset(tools)), c1_config, trace),  # counted 공유 → llm_calls
            plan_tool_specs_json(tools))
    unwired = sorted(i.value for i in PLAN_TOOLS if i not in tools)
    # 두 줄 모두 표식 `미배선` 을 담는다 — 배포 smoke 의 `ai-wiring:` 이 끌어올린다(deploy/eks/runtime_smoke.py _WIRING_MARKERS)
    if planner is not None:
        log.info("도우미 계획 단계 on — 도구 %d종(%s) · 미배선 도구 %d종(%s)", len(tools),
                 ",".join(sorted(i.value for i in tools)), len(unwired), ",".join(unwired) or "-")
    else:
        log.info("도우미 계획 단계 off — DIALOGUE_PLAN 미배정이라 미배선(범위 밖 질문은 종전 SCOPE 카드)")
    return DialogueOrchestrator(
        # 분류는 기존 IntentGate(closed-set) 재사용 — 프롬프트만 다르다(dialogue_intent.yaml, BR-AO-14)
        intent_worker=DialogueIntentWorker(GatewayFacade(counted, renderer, IntentGate(), c1_config, trace)),
        answer_worker=DialogueAnswerWorker(GatewayFacade(counted, renderer, DialogueAnswerGate(), c1_config, trace)),
        memory_worker=DialogueMemoryWorker(GatewayFacade(counted, renderer, DialogueMemoryGate(), c1_config, trace)),
        memory_store=memory_store,
        ports=ports,
        planner=planner,
        clock=clock, trace=trace, tz=tz,
        shadow=ShadowIntentProbe(shadow_router, rate=shadow_rate, rng=shadow_rng, counting=shadow_llm),
        shadow_meta=shadow_meta(renderer, bank, shadow_cfg),
        confident_intent=confident_intent,  # 보류 되묻기 답 vs 새 요청 판정 — 뱅크 1차만, LLM 0회
    )


# ───────── 섀도 측정 조건 (`intent_shadow` 로그 meta — FD DE §5, BLM §9.2) ─────────
# 조립이 기동 때 한 번 만들어 `DialogueOrchestrator(shadow_meta=)` 로 넘긴다 — 조건이 바뀐 전후 기록이 한 집계에
# 섞이지 않게 뱅크 지문·임계 4종·프롬프트 판본 2종을 줄마다 싣는다.


class _BlankVars(dict):
    """렌더 변수 자리를 빈 문자열로 채우는 매핑 — 판본만 읽을 때 쓴다."""

    def __missing__(self, key: str) -> str:
        return ""


def _prompt_tag(renderer: PromptRegistry, feature: LlmFeature) -> str:
    # ponytail: `PromptRegistry` 에 판본 조회가 없어 빈 변수로 한 번 렌더해 `PromptRef` 만 읽는다(기동 1회, 호출 0).
    # 레지스트리에 접근자를 더하는 일은 그 파일 소유 작업에서.
    _, ref = renderer.render(feature, _BlankVars())
    return f"{ref.prompt_id}@{ref.version}"


def shadow_meta(renderer: PromptRegistry, bank: Sequence[BankEntry], cfg: IntentRouterConfig) -> dict[str, object]:
    """`bank_sha`(뱅크 지문 앞 12자) · 섀도 라우터 임계 4종 · 서비스/섀도 프롬프트 판본. 발화·account_ref 칸은 없다."""
    return {
        "bank_sha": bank_fingerprint(bank)[:12],
        "t_high": cfg.t_high,
        "t_mid": cfg.t_mid,
        "vote_ratio": cfg.vote_ratio,
        "intent_margin": cfg.intent_margin,
        "intent_prompt": _prompt_tag(renderer, LlmFeature.DIALOGUE_INTENT),
        "shadow_prompt": _prompt_tag(renderer, LlmFeature.INTENT),
    }


# ───────── 장기 기억 경계 (`DELETE/GET /ai/v1/dialogue/memory` — FD DE §3.3·§4.1, BR-AO-10) ─────────
# 스토어 예외는 여기서 삼키지 않는다 — 500 으로 올려 백엔드가 재시도한다(DATA-U8-02, BR-AO-22 의 의도된 예외).

# 내보내기 상한. 세션은 (계정, 여행) 단위 + 일반 세션 1 이고 90일 TTL 이라 이 수는 실질적으로 전량이다.
# ponytail: 포트에 "계정 전체" 조회가 없어 `recent_for_account` 를 쓴다 — 페이징 없음, 상한 초과분은 잘린다(측정 뒤).
EXPORT_MAX_SESSIONS = 100


def memory_delete(
    store: MemoryStorePort,
    *,
    session_id: str | None,
    trip_id: str | None,
    account_ref: str | None,
) -> schemas.DialogueMemoryDeleteResponse:
    """파기 — session_id·trip_id·account_ref 중 **정확히 하나**, 아니면 ValueError(경계에서 422).

    멱등: 지울 것이 없으면 `deleted: 0`(DEC-AO-8). 어댑터도 같은 검사를 하지만 파기는 스토어 구현과
    무관하게 경계가 먼저 막는다 — 셋 다 None 을 "전부 지우기"로 읽는 구현이 생겨도 여기서 끝난다.
    `delete_selector` 메시지에는 필드명만 실린다(account_ref 값 비노출).
    """
    delete_selector(session_id=session_id, trip_id=trip_id, account_ref=account_ref)
    return schemas.DialogueMemoryDeleteResponse(
        deleted=store.delete(session_id=session_id, trip_id=trip_id, account_ref=account_ref)
    )


def memory_export(
    store: MemoryStorePort, account_ref: str
) -> schemas.DialogueMemoryExportResponse:
    """내보내기(DATA-U8-06) — 그 계정의 세션 기억 전부, updated_at DESC. account_ref 는 항목에 되돌리지 않는다."""
    rows = store.recent_for_account(
        # session_id 는 빈 문자열이 될 수 없다(`DialogueMemory` post-init) → 제외되는 세션 없음
        account_ref, exclude_session="", limit=EXPORT_MAX_SESSIONS,
    )
    return schemas.DialogueMemoryExportResponse(
        memories=[
            schemas.DialogueMemoryItemSchema(
                session_id=m.session_id, trip_id=m.trip_id, summary=list(m.summary),
                summarized_turn_index=m.summarized_turn_index,
                updated_at=m.updated_at, expires_at=m.expires_at,
            )
            for m in rows
        ]
    )
