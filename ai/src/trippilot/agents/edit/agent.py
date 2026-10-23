"""EditAgent — 일정 편집 (해석 → 검증 → 반영, TRIP-431).

에이전트는 **워커를 감싸는 객체**다 — 번역 워커를 생성자로 받아 들고 있고, 경계는
`run(EditTask)` 하나만 안다. 종전에는 번역이 경계(`api/wiring.py`)에서 끝나고 이 계층은
검증·변형 함수 모음이라, "에이전트인데 LLM 을 안 부르는" 모양이었다.

```
EditTask ─▶ ①b 날마다 동네  "1일차는 종로 2일차는 강남으로" — 그 날들을 그 동네로 다시 짠다(LLM 0회, day_area.py · 재구성 콘센트)
         ─▶ ①a 사이 넣기   "A에서 B로 갈 때 한 군데 더" — 자리·후보를 코드가 고른다(LLM 0회, insert_between.py)
         ─▶ ① 명령 확보    자연어 → 번역 워커(게이트 검증 포함) / 구조화 → 그대로
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

import json
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Protocol

from trippilot.agents.edit.commands import (
    EditRejected,
    apply_command,
    EditStatus,
    RetimeContext,
    edited_solution,
    validate_command,
)
from trippilot.agents.edit.day_area import (
    DayArea,
    DayAreaIssue,
    as_params,
    from_params,
    parse_day_areas,
    resolve_day_areas,
)
from trippilot.agents.edit.insert_between import (
    MAX_TRIES,
    SLACK_KM,
    Gap,
    InsertAsk,
    SlotRef,
    parse_insert_ask,
    parse_insert_place,
    position_cue,
    rank_on_segment,
    resolve_gap,
    segment_anchor,
)
from trippilot.domain.common import GeoPoint, PoiId, TraceId, TransportMode
from trippilot.domain.edit import ApplyMode, EditCommand, EditOp, resolve_apply_mode
from trippilot.domain.itinerary import (
    ItineraryProblem,
    ItinerarySolution,
    Violation,
)
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import Poi
from trippilot.llm_gateway.gates.edit_translation import is_anchor_param_key
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
    # 사이 넣기 구간 풀 콘센트 — (중심, 반경 km) → 경계가 같은 요구표·공급자로 모은 그 날 풀(INV-1).
    # 에이전트는 자리를 코드로 풀었을 때만 한 번 부른다. None(미배선)·빈 풀이면 받은 기본 풀(pool)에서만 고른다
    segment_pool: Callable[[GeoPoint, float], CandidatePool] | None = None
    # 날마다 동네 재구성 콘센트(spec 004 FR-005) — (날, 동네) 짝 → 바뀐 날만 갈아 끼운 해 또는 사유. 경계가 같은 요구표·PlaceProvider 로
    # 동네 풀을 모으고 ScheduleAgent 로 그 날들을 한 번에 푼다(INV-1·2). 에이전트는 말·명령을 확인했을 때만 한 번 부른다. None = 미배선
    rebuild_days: Callable[[tuple[DayArea, ...]], RebuiltDays | str] | None = None

    def __post_init__(self) -> None:
        if (self.utterance is None) == (self.command is None):
            raise ValueError("utterance와 command 중 정확히 하나여야 한다")


@dataclass(frozen=True, slots=True)
class RebuiltDays:
    """재구성 콘센트 결과 — 바뀐 날만 갈아 끼운 **전체** 해(손 안 댄 날은 그대로)와 ⑤ 검증 재료."""

    solution: ItinerarySolution
    areas: Mapping[date, str]  # 날 → 풀린 동네 이름(표 이름 또는 말한 이름) — 명령 params·카드 문장
    pois: Mapping[PoiId, Poi]  # 새로 들어온 곳까지 — ⑤ 검증이 영업시간·좌표를 본다
    notes: tuple[str, ...] = ()  # 관측 코드(풀이 모드·강등·동네 풀 추가 수집) — 이름은 싣지 않는다
    # 풀이 밖에 두고 그 시각 그대로 되실은 지난 곳(여행 당일, 지금 있는 곳보다 앞선 곳) — ⑤ 는 이것을 재지 않는다
    history: frozenset[PoiId] = frozenset()


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


_log = logging.getLogger(__name__)
# 사이에 들르는 곳의 체류 상한 — 그 날 중앙값(종전 ADD 규칙)이 길면 뒤 일정을 그만큼 민다. ponytail: 고정값
_INSERT_STAY_CAP_MIN = 60
# 이보다 적은 시한이면 구간 풀을 부르지 않는다(받은 기본 풀만) — 반경 조회 한 번이 시한을 넘기지 않게.
# ponytail: 정적 예산 기준이다(경과 시간 아님) — 재계획 지역 풀(#1454)처럼 시한 없는 2차 수집. 느려지면 남은 시한으로 가른다
_SEGMENT_FETCH_MIN_MS = 2_000


def _anchored(command: EditCommand) -> bool:
    return any(is_anchor_param_key(k) for k in command.params)


def _next_started(day, command: EditCommand, now: datetime) -> bool:
    """기준점 있는 추가의 바로 뒤 일정이 이미 시작했나 — 자리는 `apply_command` 와 같은 규칙으로 구한다."""
    order = apply_command(day, command)
    i = order.index(PoiId(command.params["targetPoiId"]))
    after = order[i + 1] if i + 1 < len(order) else None
    return any(s.poi_id == after and s.start_at <= now for s in day.slots)


def _anchors(day, gap: Gap) -> dict[str, str]:
    """틈 → ADD 기준점 params (맨 앞·맨 끝이면 한쪽만)."""
    return {k: str(day.slots[i].poi_id) for k, i in (("afterPoiId", gap.after), ("beforePoiId", gap.before))
            if i is not None}


class EditAgent:
    def __init__(
        self,
        translation_worker: EditTranslationWorker,
        assembly_provider: AssemblyProvider,
        estimator: object,  # TravelEstimator — RetimeContext 가 불투명하게 받는다
        problem_builder: ProblemBuilder,
        *,
        tz: timezone,
        known_areas: tuple[str, ...] = (),
    ) -> None:
        self._translator = translation_worker
        self._assembly_provider = assembly_provider
        self._estimator = estimator
        self._problem_for = problem_builder
        self._tz = tz
        # 날마다 동네 해석의 동네 표(planb `KNOWN_AREAS` 키 — 형제 import 금지 L-2 라 경계가 넘긴다). 대화 확인과 같은 표다
        self._known_areas = known_areas

    # ── 공개 API ────────────────────────────────────────────────────

    def run(self, task: EditTask) -> EditOutcome:
        """재료 → 편집 결과. 예외를 던지지 않는다 (INV-4 · DL-5)."""
        # ①b 날마다 동네 — 말(결정론 해석)이나 구조화 명령이 날·동네를 정했으면 그 날들을 다시 짠다. 아니면 종전 길
        areas = self._day_areas(task)
        if isinstance(areas, str):
            return self._day_area_out(task, (), EditOutcome(status=EditStatus.REJECTED, reason=areas))
        if areas is not None:
            return self._rebuild(task, areas)
        ask = parse_insert_ask(task.utterance) if task.utterance is not None else None
        unresolved: str | None = None
        # ①a 사이 넣기 — 자리를 코드가 다 풀면 LLM 0회. 못 풀면 번역기(①)로 넘어간다
        if ask is not None:
            gap = self._resolve(task, ask)
            if not isinstance(gap, str):
                return self._fill_gap(task, gap, ask)
            unresolved = gap
        # ① 명령 확보 — 자연어는 번역 워커(게이트 검증 포함), 구조화는 그대로
        if task.utterance is not None:
            translated = self._translate(task, task.utterance)
            if isinstance(translated, EditOutcome):  # TRANSLATION_FAILED
                if unresolved is not None:
                    return replace(translated, reason=f"{translated.reason} / insert_between: {unresolved}")
                return translated
            command, apply_mode = translated
            # 자리를 말한 추가인데 번역이 기준점을 뺐다 — 끝에 붙이면 '반영됨'으로 위장된다(INV-4). 이름을 콕 집은 말은
            # 번역이 "무엇", 코드가 "어디"를 맡아 기준점을 채운다(2026-10-22 실측: "효창공원을 경리단길 끝나고"가 맨 끝에 붙었다)
            place = ask or (parse_insert_place(task.utterance)
                            if command.op is EditOp.ADD_SLOT and not _anchored(command) else None)
            if place is None and command.op is EditOp.ADD_SLOT and not _anchored(command) and position_cue(task.utterance):
                return EditOutcome(status=EditStatus.TRANSLATION_FAILED, reason="insert_between: position_unread")
            if place is not None and command.op is EditOp.ADD_SLOT and not _anchored(command):
                gap = unresolved if ask is not None else self._resolve(task, place)
                if isinstance(gap, str):
                    return EditOutcome(status=EditStatus.TRANSLATION_FAILED,
                                       reason=f"insert_between: position_dropped ({gap})")
                day = next(d for d in task.solution.days if d.date == task.target_date)
                command = EditCommand(command.op, {**command.params, **_anchors(day, gap)}, command.affected_slots)
                out = self._apply(task, command, apply_mode)
                self._log(task, place, outcome=f"ANCHORED_{out.status.value}", resolved_by=list(gap.resolved_by),
                          codes=sorted({v.code for v in out.violations}))
                return out
        else:
            assert task.command is not None  # __post_init__ 이 보장
            command, apply_mode = task.command, resolve_apply_mode(task.command)
        return self._apply(task, command, apply_mode)

    def _apply(self, task: EditTask, command: EditCommand, apply_mode: ApplyMode, *,
               stay: Mapping[PoiId, int] | None = None, problem: ItineraryProblem | None = None) -> EditOutcome:
        """② 검증 → ③ 확인 게이트 → ④ 변형·재타이밍 → ⑤ 어셈블리 검증. 세 진입(번역·사이 넣기·이름 지목 자리 채우기)이 같은 길이다.

        기준점 있는 추가의 여행 당일 규칙(지난 자리 거부·지금 이후 시작)은 여기 한 곳에 건다 — 번역이 기준점을 채워 온 추가도 같은 규칙을 탄다."""
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
            target_day = next((d for d in task.solution.days if d.date == task.target_date), None)
            target_day_slots = target_day.slots if target_day is not None else ()
            floor = self._floor(task) if command.op is EditOp.ADD_SLOT and _anchored(command) else None
            if floor is not None and target_day is not None and _next_started(target_day, command, task.now):
                raise EditRejected("past_gap — 넣을 자리 바로 뒤 일정이 이미 시작했다(지난 일정을 미래로 밀게 된다)")
            ctx = RetimeContext(
                coords={pid: p.coord for pid, p in merged_index.items()},
                stay_min={**{s.poi_id: s.stay_min for s in target_day_slots}, **dict(stay or {})},
                estimator=self._estimator,
                transport=task.transport,
                not_before=floor,
            )
            mutated = edited_solution(
                task.solution, task.target_date, command, ctx, self._tz)
        except EditRejected as e:
            return EditOutcome(
                status=EditStatus.REJECTED,
                command=command, apply_mode=apply_mode, reason=str(e),
            )

        # ⑤ 어셈블리 검증 — 통과분만 노출 (INV-2). 검증 수단 = 재타이밍 수단 — 문제 빌더는 와이어에 수단이 없어 대중교통으로 채우는데,
        #    편집 요청엔 수단이 있다. 안 맞추면 자차 여행은 재타이밍(자차)이 잡은 간격을 검증(대중교통)이 늘 HC2 로 떨어뜨린다(2026-10-22 리뷰 재현)
        #    검증은 고친 날만 — 다른 날 시각은 이 편집이 만든 것이 아니다. 생성이 다른 추정기(액티비티 취향 걷기 1.0km 등)로 잡은 날을
        #    기본 추정기로 다시 재면 손 안 댄 날의 HC2 가 모든 편집을 막았다(develop 부터, 2026-10-22 2차 리뷰 재현). HC1~4 는 날 단위다
        facade = self._assembly_provider.for_pool(merged_index)
        checked = replace(problem or self._problem_for(mutated), transport=task.transport, days=(task.target_date,))
        edited_day = replace(mutated, days=tuple(d for d in mutated.days if d.date == task.target_date))
        violations = tuple(facade.validate(edited_day, checked, task.deadline_ms, task.trace_id))
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

    # ── ①b 날마다 동네 ──────────────────────────────────────────────

    def _day_areas(self, task: EditTask) -> tuple[DayArea, ...] | str | None:
        """말·명령 → 확인된 (날, 동네) 짝, 확인 실패 사유(`day_area: …`), 이 꼴이 아니면 None.

        날은 대화와 같은 셈(여행 첫날 + N − 1)이고, 여행 밖·지난 날·같은 날 두 번이면 넘겨짚지 않고 사유다(spec 004 FR-002)."""
        days = [d.date for d in task.solution.days]
        today = task.now.astimezone(self._tz).date()
        if task.command is not None:
            if task.command.op is not EditOp.SET_DAY_AREAS:
                return None
            pairs = from_params(task.command.params)
            if pairs is None:
                return "day_area: bad_params"
            bad = next((p for p in pairs if p.day not in days or p.day < today), None)
            return f"day_area: {'past_day' if bad and bad.day in days else 'day_out_of_trip'}({bad.day})" if bad else pairs
        clauses = parse_day_areas(task.utterance or "", self._known_areas)
        if clauses is None:
            return None
        got = resolve_day_areas(clauses, days, today)
        return f"day_area: {got.code}({got.said})" if isinstance(got, DayAreaIssue) else got

    def _rebuild(self, task: EditTask, pairs: tuple[DayArea, ...]) -> EditOutcome:
        """③ 확인 게이트 → 재구성 콘센트(조립이 시각·순서를 푼다) → ⑤ 바뀐 날만 요청 수단으로 검증(INV-2). 실패는 사유를 단다(INV-4)."""
        command = EditCommand(EditOp.SET_DAY_AREAS, as_params(pairs), ())
        apply_mode = resolve_apply_mode(command)
        if apply_mode is ApplyMode.CONFIRM_REQUIRED and not task.confirm:
            return self._day_area_out(task, pairs, EditOutcome(status=EditStatus.CONFIRM_REQUIRED, command=command,
                                                              apply_mode=apply_mode, reason="날 재구성 — confirm=true로 재호출 시 반영"))
        if task.rebuild_days is None:
            return self._day_area_out(task, pairs, EditOutcome(status=EditStatus.REJECTED, command=command,
                                                              apply_mode=apply_mode, reason="day_area: not_wired"))
        t0 = time.monotonic()
        try:
            got = task.rebuild_days(pairs)
        except Exception as e:  # 콘센트 결함도 경계 밖으로 던지지 않는다(DL-5)
            got = f"rebuild_error: {type(e).__name__}"
        ms = int((time.monotonic() - t0) * 1000)
        if isinstance(got, str):
            return self._day_area_out(task, pairs, EditOutcome(status=EditStatus.REJECTED, command=command,
                                                              apply_mode=apply_mode, reason=f"day_area: {got}"), ms=ms)
        changed = {p.day for p in pairs}
        after = {s.poi_id for d in got.solution.days if d.date in changed for s in d.slots}
        before = {s.poi_id for d in task.solution.days if d.date in changed for s in d.slots}
        removed = tuple(s.poi_id for d in task.solution.days if d.date in changed for s in d.slots if s.poi_id not in after)
        command = EditCommand(EditOp.SET_DAY_AREAS, {p.day.isoformat(): got.areas.get(p.day, p.area) for p in pairs},
                              removed)
        # ⑤ 바뀐 날만 · 요청 수단으로 — `_apply` 와 같은 이유(손 안 댄 날은 이 편집이 만든 시각이 아니다)
        index = {**{p.poi_id: p for p in task.pool.pois}, **dict(task.poi_index), **dict(got.pois)}
        checked = replace(self._problem_for(got.solution), transport=task.transport, days=tuple(sorted(changed)))
        # 콘센트가 풀이 밖에 두고 되실은 지난 곳은 이 편집이 만든 시각이 아니라 검증에서 뺀다 — 그 곳의 예약 블록도 같이(남기면 HC3 가
        # 없는 슬롯을 찾는다). 지금 있는 곳(가장 최근의 곳)은 풀이 안에 고정돼 '거기 → 첫 새 방문'이 재진다(2026-10-23 2차 리뷰)
        done = got.history
        checked = replace(checked, fixed_blocks=tuple(fb for fb in checked.fixed_blocks if fb.poi_id not in done))
        edited = replace(got.solution, days=tuple(replace(d, slots=tuple(s for s in d.slots if s.poi_id not in done),
                                                          fixed_blocks=tuple(fb for fb in d.fixed_blocks if fb.poi_id not in done))
                                                  for d in got.solution.days if d.date in changed))
        violations = tuple(self._assembly_provider.for_pool(index).validate(edited, checked, task.deadline_ms, task.trace_id))
        if violations:
            out = EditOutcome(status=EditStatus.REJECTED, command=command, apply_mode=apply_mode, violations=violations,
                              reason="편집 결과가 하드 제약을 위반 — 반영하지 않음")
        else:
            out = EditOutcome(status=EditStatus.APPLIED, command=command, apply_mode=apply_mode, solution=got.solution)
        return self._day_area_out(task, pairs, out, ms=ms, removed=len(removed), added=len(after - before),
                                  codes=sorted({v.code for v in violations}), notes=list(got.notes))

    @staticmethod
    def _day_area_out(task: EditTask, pairs: tuple[DayArea, ...], out: EditOutcome, **extra) -> EditOutcome:
        """관측 한 줄 — 발화·장소 이름은 싣지 않는다(FR-008)."""
        _log.info("edit_day_area %s", json.dumps({
            "trace_id": str(task.trace_id), "days": len(pairs), "source": "command" if task.command else "utterance",
            "outcome": out.status.value,
            # 사유는 코드만 — 괄호 안(말한 날·동네)은 싣지 않는다
            "reason": out.reason.split("(", 1)[0] if out.reason and out.status is not EditStatus.APPLIED else None, **extra,
        }, ensure_ascii=False))
        return out

    # ── ①a 사이 넣기 ────────────────────────────────────────────────

    def _resolve(self, task: EditTask, ask: InsertAsk) -> Gap | str:
        day = next((d for d in task.solution.days if d.date == task.target_date), None)
        if day is None or not day.slots:
            gap: Gap | str = "no_target_day_slots"
        else:
            gap = resolve_gap([SlotRef(s.poi_id, (p := task.poi_index.get(s.poi_id)) and p.name,
                                       p.coord if p else None) for s in day.slots], ask)
        if isinstance(gap, str):
            self._log(task, ask, outcome="UNRESOLVED", reason=gap)
        return gap

    def _fill_gap(self, task: EditTask, gap: Gap, ask: InsertAsk) -> EditOutcome:
        """구간 풀(없으면 기본 풀) → 우회 순위 → 후보마다 ②~⑤, 첫 통과분. 실패는 전부 사유 있는 상태값(INV-4)."""
        day = next(d for d in task.solution.days if d.date == task.target_date)
        log: dict = dict(resolved_by=list(gap.resolved_by))

        def coord(i: int | None) -> GeoPoint | None:
            p = task.poi_index.get(day.slots[i].poi_id) if i is not None else None
            return p.coord if p is not None else None

        a, b = coord(gap.after), coord(gap.before)
        if (gap.after is not None and a is None) or (gap.before is not None and b is None):
            return self._rejected(task, ask, "anchor_coord_unknown", log)  # 이동을 지어내지 않는다(TRIP-525)
        if self._past(task, day, gap):
            return self._rejected(task, ask, "past_gap", log)
        slack = SLACK_KM[task.transport]
        pool, log["pool_source"] = task.pool, "base"
        if task.segment_pool is not None and task.deadline_ms >= _SEGMENT_FETCH_MIN_MS:
            started = time.monotonic()
            try:
                segment = task.segment_pool(*segment_anchor(a, b, slack))
            except Exception as e:  # 경계 콘센트의 설정 버그 — 기본 풀로 계속한다(사유는 로그에)
                segment, log["segment_error"] = None, type(e).__name__
            log["segment_ms"] = round((time.monotonic() - started) * 1000)
            if segment is not None and segment.pois:
                pool, log["pool_source"] = segment, "segment"
        problem = self._problem_for(task.solution)  # 사이 넣기는 날짜·예약을 안 바꾼다 — 후보마다 다시 묻지 않는다(달력 I/O)
        current = frozenset(s.poi_id for d in task.solution.days for s in d.slots)
        taken = [p.name for pid in current if (p := task.poi_index.get(pid)) is not None]
        ranked = rank_on_segment(pool.pois, a, b, slack_km=slack, exclude=current, taken_names=taken, kind=ask.kind,
                                 not_kinds=ask.not_kinds, night=ask.night, day=task.target_date,
                                 holidays=problem.holidays)
        log.update(pool=len(pool.pois), within=len(ranked))
        if not ranked:
            return self._rejected(task, ask, "no_candidates", log)
        stays = [s.stay_min for s in day.slots]
        stay = min(int(median(stays)), _INSERT_STAY_CAP_MIN)
        on_pool = replace(task, pool=pool)
        rejects: list[str] = []
        for poi, detour in ranked[:MAX_TRIES]:
            command = EditCommand(EditOp.ADD_SLOT, {"targetPoiId": str(poi.poi_id), **_anchors(day, gap)}, ())
            out = self._apply(on_pool, command, resolve_apply_mode(command), stay={poi.poi_id: stay}, problem=problem)
            if out.status is EditStatus.APPLIED:
                self._log(task, ask, outcome="APPLIED", tried=len(rejects) + 1, detour_km=round(detour, 2),
                          category=poi.category.value, **log)
                return out
            rejects.append(",".join(sorted({v.code for v in out.violations})) or "rule")
        # 첫 후보의 위반을 그대로 내면 사용자가 고른 적 없는 곳의 위반이 카드에 뜬다 — 위반 없는 거부로 낸다
        return self._rejected(task, ask, f"all_rejected(tried={len(rejects)})", {**log, "rejects": rejects})

    def _floor(self, task: EditTask) -> datetime | None:
        """여행 당일이면 지금(현지 시각, 분 올림) — 끼운 곳을 지금보다 앞에 두지 않는다. 다른 날은 하한 없음.

        BE 는 requested_at 을 UTC(…Z)로 보낸다 — 그 객체를 그대로 하한으로 쓰면 슬롯 시각이 UTC 벽시계로 사영되고 HC1·HC4 도 그 시·분으로
        판정한다(2026-10-22 리뷰 재현: 13:10 이 04:10 으로). 분 올림은 조립 `not_before_floor`·재계획 하한과 같은 규칙이다."""
        local = task.now.astimezone(self._tz)
        if local.date() != task.target_date:
            return None
        minute = local.replace(second=0, microsecond=0)
        return minute if minute == local else minute + timedelta(minutes=1)

    def _past(self, task: EditTask, day, gap: Gap) -> bool:
        """여행 당일 뒤 슬롯이 이미 시작했으면 지난 자리다 — 구간 풀을 모으기 전에 거른다(같은 판정은 `_apply` 가 다시 건다)."""
        return (self._floor(task) is not None and gap.before is not None
                and day.slots[gap.before].start_at <= task.now)

    def _rejected(self, task: EditTask, ask: InsertAsk, why: str, log: dict) -> EditOutcome:
        self._log(task, ask, outcome="REJECTED", reason=why, **log)
        return EditOutcome(status=EditStatus.REJECTED, reason=f"insert_between: {why}")

    @staticmethod
    def _log(task: EditTask, ask: InsertAsk, *, outcome: str, **fields) -> None:
        # 발화·이름은 싣지 않는다 — 모양·해소 경로·개수만(운영에서 이 줄로 within·tried 를 센다)
        _log.info("edit_insert %s", json.dumps({
            "event": "edit_insert", "trace_id": str(task.trace_id), "outcome": outcome, "shape": ask.shape.value,
            "kind": ask.kind.value if ask.kind is not None else None, **fields}, ensure_ascii=False))

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
