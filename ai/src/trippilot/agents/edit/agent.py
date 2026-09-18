"""EditAgent — 일정 편집 (해석 → 검증 → 반영, TRIP-431).

에이전트는 **워커를 감싸는 객체**다 — 번역 워커를 생성자로 받아 들고 있고, 경계는
`run(EditTask)` 하나만 안다. 종전에는 번역이 경계(`api/wiring.py`)에서 끝나고 이 계층은
검증·변형 함수 모음이라, "에이전트인데 LLM 을 안 부르는" 모양이었다.

```
EditTask ─▶ ① 명령 확보    자연어 → 번역 워커(게이트 검증 포함) / 구조화 → 그대로
         ─▶ ② 동등 검증    validate_command (INV-1 — 게이트와 같은 규칙)
         ─▶ ③ 확인 게이트  파괴적 편집은 confirm 전에는 반영하지 않는다
         ─▶ ④ 재타이밍     결정론 (체류 보존 + 이동 추정)
         ─▶ ⑤ 어셈블리 validate → 통과분만 노출 (INV-2)
```

**INV-4 · DL-5**: `run()` 은 예외를 밖으로 던지지 않는다 — 번역 실패·규칙 위반·하드
제약 위반이 전부 `EditOutcome` 상태값으로 수렴한다. 내부 `EditRejected` 는 순수 단계가
쓰는 신호일 뿐, 경계 밖으로 나가지 않는다.

**INV-2**: 사용자에게 나가는 시각·순서는 어셈블리 `validate` 를 통과한 것만이다 —
재타이밍 결과를 그대로 싣는 경로가 없다.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Protocol

from trippilot.agents.edit.commands import (
    EditRejected,
    EditStatus,
    RetimeContext,
    edited_solution,
    validate_command,
)
from trippilot.domain.common import PoiId, TraceId, TransportMode
from trippilot.domain.edit import ApplyMode, EditCommand, resolve_apply_mode
from trippilot.domain.itinerary import (
    ItineraryProblem,
    ItinerarySolution,
    Violation,
)
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import Poi
from trippilot.llm_gateway.workers.edit_translation import (
    EditTranslationInput,
    EditTranslationWorker,
)


# ── 협력자 계약 (주입) ──────────────────────────────────────────────


class AssemblyFacade(Protocol):
    """어셈블리 공개 경계 중 이 편집이 쓰는 한 갈래 — 검증만(재조립 없음)."""

    def validate(
        self,
        solution: ItinerarySolution,
        problem: ItineraryProblem,
        deadline_ms: int,
        trace_id: TraceId | None = None,
    ) -> tuple[Violation, ...]: ...


class AssemblyProvider(Protocol):
    """풀이 요청마다 다르므로 `poi_index` 도 요청 스코프 (ScheduleAgent 와 같은 콘센트)."""

    def for_pool(self, poi_index: Mapping[PoiId, Poi]) -> AssemblyFacade: ...


class ProblemBuilder(Protocol):
    """해 → 검증용 문제. 와이어에 없는 원 컨텍스트(창·수단)를 무엇으로 채울지는
    경계가 안다 — 에이전트는 그 규칙을 복제하지 않고 콘센트로 받는다.
    """

    def __call__(self, solution: ItinerarySolution) -> ItineraryProblem: ...


# ── 입출력 타입 ─────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class EditTask:
    """경계 → EditAgent 재료 봉투.

    `utterance`(자연어)와 `command`(구조화) 중 **정확히 하나** — 와이어 계약과 같은
    배타 규칙이고, 둘은 ② 이후 같은 처리 로직으로 수렴한다(팀 결정 2026-08-22).
    와이어 스키마 파싱(op 문자열 → EditOp)은 경계 몫이라 여기 도달 시점에는 이미
    도메인 타입이다.
    """

    solution: ItinerarySolution
    target_date: date
    pool: CandidatePool
    poi_index: Mapping[PoiId, Poi]  # 재구성이 받아온 등록 POI (풀 밖 슬롯의 이름·좌표)
    transport: TransportMode
    trace_id: TraceId
    now: datetime
    deadline_ms: int
    utterance: str | None = None
    command: EditCommand | None = None
    confirm: bool = False

    def __post_init__(self) -> None:
        if (self.utterance is None) == (self.command is None):
            raise ValueError("utterance와 command 중 정확히 하나여야 한다")


@dataclass(frozen=True, slots=True)
class EditOutcome:
    """편집 결과. 상태값 하나로 수렴하고, 서로 거짓말할 수 없게 불변식을 건다.

    - APPLIED ⇔ solution 존재 (어셈블리 통과분)
    - REJECTED · TRANSLATION_FAILED ⇒ reason 필수 (침묵 금지, INV-4)
    - CONFIRM_REQUIRED ⇒ command·apply_mode 필수 (사용자가 무엇을 확인하는지 알아야 한다)
    - violations 는 REJECTED 에만
    """

    status: EditStatus
    command: EditCommand | None = None
    apply_mode: ApplyMode | None = None
    solution: ItinerarySolution | None = None
    violations: tuple[Violation, ...] = ()
    reason: str | None = None

    def __post_init__(self) -> None:
        applied = self.status is EditStatus.APPLIED
        if applied != (self.solution is not None):
            raise ValueError("APPLIED ⇔ solution 존재 위반")
        if self.status in (EditStatus.REJECTED, EditStatus.TRANSLATION_FAILED):
            if not self.reason:
                raise ValueError(f"{self.status.value}는 사유 필수 (침묵 금지)")
        if self.status is EditStatus.CONFIRM_REQUIRED and (
            self.command is None or self.apply_mode is None
        ):
            raise ValueError("CONFIRM_REQUIRED는 command·apply_mode 필수")
        if self.violations and self.status is not EditStatus.REJECTED:
            raise ValueError("violations는 REJECTED에만 실린다")


class EditAgent:
    def __init__(
        self,
        translation_worker: EditTranslationWorker,
        assembly_provider: AssemblyProvider,
        estimator: object,  # TravelEstimator — RetimeContext 가 불투명하게 받는다
        problem_builder: ProblemBuilder,
        *,
        tz: timezone,
    ) -> None:
        self._translator = translation_worker
        self._assembly_provider = assembly_provider
        self._estimator = estimator
        self._problem_for = problem_builder
        self._tz = tz

    # ── 공개 API ────────────────────────────────────────────────────

    def run(self, task: EditTask) -> EditOutcome:
        """재료 → 편집 결과. 예외를 던지지 않는다 (INV-4 · DL-5)."""
        # ① 명령 확보 — 자연어는 번역 워커(게이트 검증 포함), 구조화는 그대로
        if task.utterance is not None:
            translated = self._translate(task, task.utterance)
            if isinstance(translated, EditOutcome):  # TRANSLATION_FAILED
                return translated
            command, apply_mode = translated
        else:
            assert task.command is not None  # __post_init__ 이 보장
            command, apply_mode = task.command, resolve_apply_mode(task.command)

        current_ids = frozenset(
            s.poi_id for day in task.solution.days for s in day.slots)
        # 대상 일자의 예약(is_fixed) 슬롯 — 편집 대상 불가·재타이밍 닻 (TRIP-526)
        fixed_ids = frozenset(
            fb.poi_id for day in task.solution.days if day.date == task.target_date
            for fb in day.fixed_blocks)
        pool_index = {p.poi_id: p for p in task.pool.pois}
        merged_index = {**pool_index, **dict(task.poi_index)}

        try:
            # ② 구조화 진입은 게이트를 안 거쳤다 — 동등 규칙을 양쪽 모두에 적용해
            #    (자연어도 재검증) 검증 권위를 한 곳으로 모은다.
            validate_command(command, current_ids, task.pool, fixed_ids)

            # ③ 확인 게이트 — 파괴적 편집은 사용자 확인 전에는 반영하지 않는다
            if apply_mode is ApplyMode.CONFIRM_REQUIRED and not task.confirm:
                return EditOutcome(
                    status=EditStatus.CONFIRM_REQUIRED,
                    command=command, apply_mode=apply_mode,
                    reason="파괴적·대규모 편집 — confirm=true로 재호출 시 반영",
                )

            # ④ 시퀀스 변형 + 결정론 재타이밍
            target_day_slots = next(
                (d.slots for d in task.solution.days
                 if d.date == task.target_date), ())
            ctx = RetimeContext(
                coords={pid: p.coord for pid, p in merged_index.items()},
                stay_min={s.poi_id: s.stay_min for s in target_day_slots},
                estimator=self._estimator,
                transport=task.transport,
            )
            mutated = edited_solution(
                task.solution, task.target_date, command, ctx, self._tz)
        except EditRejected as e:
            return EditOutcome(
                status=EditStatus.REJECTED,
                command=command, apply_mode=apply_mode, reason=str(e),
            )

        # ⑤ 어셈블리 검증 — 통과분만 노출 (INV-2)
        facade = self._assembly_provider.for_pool(merged_index)
        violations = tuple(facade.validate(
            mutated, self._problem_for(mutated), task.deadline_ms, task.trace_id))
        if violations:
            return EditOutcome(
                status=EditStatus.REJECTED,
                command=command, apply_mode=apply_mode, violations=violations,
                reason="편집 결과가 하드 제약을 위반 — 반영하지 않음",
            )
        return EditOutcome(
            status=EditStatus.APPLIED,
            command=command, apply_mode=apply_mode, solution=mutated,
        )

    # ── ① 자연어 번역 ───────────────────────────────────────────────

    def _translate(
        self, task: EditTask, utterance: str
    ) -> tuple[EditCommand, ApplyMode] | EditOutcome:
        """번역 성공이면 (명령, 적용모드), 실패면 TRANSLATION_FAILED 결과."""
        target_day_ids = tuple(
            s.poi_id
            for day in task.solution.days if day.date == task.target_date
            for s in day.slots
        )
        try:
            result = self._translator.translate(
                task.pool,
                EditTranslationInput(
                    utterance=utterance,
                    target_date=task.target_date.isoformat(),
                    current_slots=target_day_ids,
                    # 경계가 이미 받아온 등록 POI 재사용 (추가 I/O 없음) — 풀 밖
                    # 슬롯의 이름·카테고리는 여기서만 온다 (TRIP-527)
                    slot_pois=dict(task.poi_index),
                ),
                task.trace_id, task.now,
                timeout_sec=task.deadline_ms / 1000.0,
            )
        except Exception as e:  # 설정 버그 등 — explanations()와 같은 정직 보고.
            # 4xx 로 내보내면 백엔드가 MinimalItineraryFallback 을 켜 편집 한 번이
            # 일정을 최소본으로 갈아엎는다 (errors.py "에러 vs 폴백 이원화", TRIP-527).
            return EditOutcome(
                status=EditStatus.TRANSLATION_FAILED,
                reason=f"편집 의도 해석 실패: {type(e).__name__}: {e}",
            )
        if result.is_fallback or result.value is None:
            # 자연어 해석 실패는 자연어 경로만의 정직 실패 — 구조화 경로 무영향
            return EditOutcome(
                status=EditStatus.TRANSLATION_FAILED,
                reason=f"편집 의도 해석 실패: {result.error}",
            )
        return result.value.command, result.value.apply_mode
