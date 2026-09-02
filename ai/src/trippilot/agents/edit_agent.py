"""EditAgent 코어 (TRIP-431) — 자연어·구조화 겸용 편집의 공통 처리 로직.

```
자연어 utterance → EDIT_TRANSLATION 워커(LLM) → EditCommand ─┐
구조화 command  → validate_command(동등 검증, INV-1) ────────┤
                                                            ├→ 확인 게이트(파괴적=CONFIRM_REQUIRED)
                                                            ├→ 시퀀스 변형(apply_command)
                                                            ├→ 결정론 재타이밍(retime_day)
                                                            └→ 어셈블리 validate → 통과분만 노출 (INV-2)
```

역할 경계 (팀 결정 2026-08-22, TRIP-431 코멘트):
- LLM은 **번역만** — 시각·순서·가능 여부는 전부 코드·어셈블리 소유.
- 구조화 진입은 게이트를 안 거치므로 `validate_command`가 게이트와 같은 규칙을
  적용한다(INV-1: affected ⊆ 현재 일정, `*PoiId` params ⊆ 후보 풀; 시각 키는
  게이트 ③과 **동일 함수** `is_time_param_key` 호출 — 목록 복사로 어긋날 수 없다).
- 재타이밍은 결정론(체류시간 보존 + 이동 추정 걷기)이고, 사용자 노출은 그 결과를
  **어셈블리 validate가 통과시킨 경우만**이다(INV-2) — 위반이면 REJECTED + 사유.
- REPLAN op는 1단계 범위 밖 — 편집이 아니라 재생성이라 `generate` 재호출이 정도다.
- 예약(고정) 슬롯은 **닻**(TRIP-526) — 편집 대상이 될 수 없고, 재타이밍은 원 window를
  그대로 둔 채 그 앞뒤로 커서를 흘린다. 앞 슬롯이 못 도착하면 밀지 않고 HC2가 거부.

# ponytail: 빈 날에 추가할 때의 시작 시각은 10:00 고정 — 요청에 창이 없다.
# 편집 요청에 day_window가 실리면 그 값으로 올린다.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta, timezone
from enum import Enum
from statistics import median

from trippilot.domain.common import PoiId, TransportMode
from trippilot.domain.edit import EditCommand, EditOp
from trippilot.domain.itinerary import DaySolution, ItinerarySolution, VisitSlot
from trippilot.domain.llm import CandidatePool
from trippilot.llm_gateway.gates.edit_translation import is_time_param_key

_DEFAULT_STAY_MIN = 60          # 그 날 기존 슬롯이 없을 때의 체류 기본값
_EMPTY_DAY_START = time(10, 0)  # 빈 날 시작 시각 (ponytail — docstring 참조)


class EditStatus(Enum):
    APPLIED = "APPLIED"
    CONFIRM_REQUIRED = "CONFIRM_REQUIRED"
    REJECTED = "REJECTED"
    TRANSLATION_FAILED = "TRANSLATION_FAILED"


class EditRejected(ValueError):
    """적용 불가 — 사유는 사용자 회신 문구(침묵 금지, INV-4)."""


def validate_command(
    command: EditCommand,
    current_ids: frozenset[PoiId],
    pool: CandidatePool,
    fixed_ids: frozenset[PoiId],
) -> None:
    """구조화 진입 검증 (자연어 진입은 EditTranslationGate가 이미 수행).

    - affected_slots ⊆ 현재 일정 (없는 슬롯 편집 불가)
    - affected_slots ∩ 대상 일자 예약(고정) 슬롯 = ∅ (TRIP-526 — 예약은 닻, 이동·삭제·
      교체 대상 불가). REORDER_DAY는 슬롯 전체 순열이라 제외 — 예약 위치는 retime이 판정
    - params의 `*PoiId` 값 ⊆ 후보 풀 (INV-1 — 풀 밖 POI 추가·교체 차단)
    - params에 시각·소요시간 키 금지 (시각은 어셈블리 소유 — INV-2·3):
      게이트 ③과 **동일 함수** `is_time_param_key` — 별도 목록을 두지 않는다
    """
    for poi_id in command.affected_slots:
        if poi_id not in current_ids:
            raise EditRejected(f"affected_slots의 {poi_id}가 현재 일정에 없음")
        if poi_id in fixed_ids and command.op is not EditOp.REORDER_DAY:
            raise EditRejected(f"예약(고정) 슬롯 {poi_id}는 편집 대상이 될 수 없음")
    for key, value in command.params.items():
        if is_time_param_key(key):
            raise EditRejected(f"params에 시각·소요시간 키 {key!r} — 시각은 어셈블리가 정함")
        if key.endswith("PoiId"):
            if not isinstance(value, str) or not pool.contains(PoiId(value)):
                raise EditRejected(
                    f"params {key}={value!r}가 후보 풀 밖 — closed-set 위반(INV-1)")


def apply_command(
    day: DaySolution, command: EditCommand
) -> tuple[PoiId, ...]:
    """시퀀스 변형 — 대상 일자의 새 poi_id 순서를 낸다 (시각은 여기서 안 만든다)."""
    order = [s.poi_id for s in day.slots]
    op = command.op
    if op is EditOp.REMOVE_SLOT:
        removed = set(command.affected_slots)
        return tuple(p for p in order if p not in removed)
    if op is EditOp.CLEAR_DAY:
        return ()
    if op is EditOp.ADD_SLOT:
        target = _target_poi(command)
        if target in order:
            raise EditRejected(f"{target}는 이미 그 날 일정에 있음")
        return tuple(order) + (target,)
    if op is EditOp.REPLACE_SLOT:
        if len(command.affected_slots) != 1:
            raise EditRejected("REPLACE_SLOT은 대상 슬롯 정확히 1개")
        old, new = command.affected_slots[0], _target_poi(command)
        if old not in order:
            raise EditRejected(f"교체 대상 {old}가 그 날 일정에 없음")
        return tuple(new if p == old else p for p in order)
    if op is EditOp.MOVE_SLOT:
        if len(command.affected_slots) != 1:
            raise EditRejected("MOVE_SLOT은 대상 슬롯 정확히 1개")
        moving = command.affected_slots[0]
        if moving not in order:
            raise EditRejected(f"이동 대상 {moving}가 그 날 일정에 없음")
        rest = [p for p in order if p != moving]
        after_raw = command.params.get("afterPoiId")
        if after_raw is None:
            return (moving, *rest)  # 기준 없음 = 맨 앞으로
        after = PoiId(after_raw)
        if after not in rest:
            raise EditRejected(f"afterPoiId {after}가 그 날 일정에 없음")
        idx = rest.index(after) + 1
        return tuple(rest[:idx]) + (moving,) + tuple(rest[idx:])
    if op is EditOp.REORDER_DAY:
        if sorted(command.affected_slots, key=str) != sorted(order, key=str):
            raise EditRejected("REORDER_DAY는 그 날 슬롯 전체의 순열이어야 함")
        return tuple(command.affected_slots)
    # REPLAN — 편집이 아니라 재생성 (1단계 범위 밖, TRIP-431 코멘트)
    raise EditRejected("REPLAN은 편집 경계 밖 — 일정 재생성(generate)을 호출하라")


def _target_poi(command: EditCommand) -> PoiId:
    raw = command.params.get("targetPoiId")
    if not isinstance(raw, str) or not raw:
        raise EditRejected(f"{command.op.value}에 targetPoiId 필요")
    return PoiId(raw)


@dataclass(frozen=True, slots=True)
class RetimeContext:
    """재타이밍 재료 — 좌표·체류시간 출처와 이동수단."""

    coords: dict  # PoiId → GeoPoint (미등록 POI는 없음 → 인접 편집 거부, TRIP-525)
    stay_min: dict  # PoiId → int (기존 슬롯의 체류 보존; 신규는 중앙값/기본)
    estimator: object  # TravelEstimator — estimate(a, b, mode).internal_minutes
    transport: TransportMode


def retime_day(
    day: DaySolution, new_order: tuple[PoiId, ...], ctx: RetimeContext, tz: timezone
) -> DaySolution:
    """새 순서 → 결정론 재타이밍. 체류시간 보존, 이동은 추정 걷기.

    시작점 = 기존 첫 슬롯 시각(사용자의 하루 시작 보존), 빈 날이었으면 10:00.
    예약(day.fixed_blocks)은 닻(TRIP-526) — 커서로 찍지 않고 원 window 그대로 두며
    커서만 window.end로 옮긴다. 커서가 예약보다 이르면 그 사이는 대기(빈 시간),
    늦어도 예약을 밀지 않는다 — HC2가 "이동 N분 필요, 간격 M분"으로 거부(INV-2).
    앞 슬롯의 **시작**이 예약 시각을 지나면 시간순 슬롯 자체가 성립하지 않아 거부.
    인접 구간 한쪽이라도 좌표가 없으면 거부(TRIP-525) — check_hc2 는 좌표 없음을
    건너뛰므로(c2 규칙 "정보 없음은 막지 않는다") 여기서 0분을 지어내면 검증 도장을
    달고 나간다. 예약 슬롯도 예외 없음. 그 날 슬롯이 하나뿐이면 인접이 없어 통과.
    이 시각은 제안일 뿐 — 노출 여부는 어셈블리 validate가 정한다(INV-2).
    """
    if not new_order:
        return replace(day, slots=())
    if day.slots:
        cursor = day.slots[0].start_at
    else:
        cursor = datetime.combine(day.date, _EMPTY_DAY_START, tzinfo=tz)
    default_stay = int(median(ctx.stay_min.values())) if ctx.stay_min else _DEFAULT_STAY_MIN
    old_by_id = {s.poi_id: s for s in day.slots}
    fixed_by_id = {fb.poi_id: fb.window for fb in day.fixed_blocks}
    slots = []
    prev: PoiId | None = None
    for poi_id in new_order:
        if prev is not None:
            a, b = ctx.coords.get(prev), ctx.coords.get(poi_id)
            if a is None or b is None:
                raise EditRejected(
                    f"좌표 미상 POI {prev if a is None else poi_id} 인접 — "
                    f"이동시간을 산출할 수 없어 편집 불가")
            gap = ctx.estimator.estimate(a, b, ctx.transport).internal_minutes
            cursor = cursor + timedelta(minutes=gap)
        window = fixed_by_id.get(poi_id)
        if window is not None:
            if slots and slots[-1].start_at > window.start:
                raise EditRejected(
                    f"예약(고정) 슬롯 {poi_id}의 시각({window.start:%H:%M})을 "
                    f"앞 슬롯이 이미 지남 — 그 순서로는 배치 불가")
            start, end = window.start, window.end
        else:
            start = cursor
            end = cursor + timedelta(minutes=ctx.stay_min.get(poi_id, default_stay))
        old = old_by_id.get(poi_id)
        slots.append(VisitSlot(
            poi_id=poi_id,
            start_at=start,
            end_at=end,
            stay_min=int((end - start).total_seconds() // 60),
            score=old.score if old is not None else 0.0,
            is_llm_score=old.is_llm_score if old is not None else False,
        ))
        cursor = end
        prev = poi_id
    return replace(day, slots=tuple(slots))


def edited_solution(
    solution: ItinerarySolution,
    target_date: date,
    command: EditCommand,
    ctx: RetimeContext,
    tz: timezone,
) -> ItinerarySolution:
    """대상 일자에 명령 적용 → 새 해. 대상 일자가 없으면 거부 (지어내지 않는다)."""
    for i, day in enumerate(solution.days):
        if day.date == target_date:
            new_order = apply_command(day, command)
            new_day = retime_day(day, new_order, ctx, tz)
            days = solution.days[:i] + (new_day,) + solution.days[i + 1:]
            return replace(solution, days=days)
    raise EditRejected(f"대상 일자 {target_date.isoformat()}가 일정에 없음")
