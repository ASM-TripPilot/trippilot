"""EditAgent 코어 (TRIP-431) — 자연어·구조화 겸용 편집의 공통 처리 로직.

```
자연어 utterance → EDIT_TRANSLATION 워커(LLM) → EditCommand ─┐
구조화 command  → validate_command(동등 검증, INV-1) ────────┤
                                                            ├→ 확인 게이트(파괴적=CONFIRM_REQUIRED)
                                                            ├→ 시퀀스 변형(apply_command)
                                                            ├→ 결정론 재타이밍(retime_day)
                                                            └→ 솔버 validate → 통과분만 노출 (INV-2)
```

역할 경계 (팀 결정 2026-08-22, TRIP-431 코멘트):
- LLM은 **번역만** — 시각·순서·가능 여부는 전부 코드·솔버 소유.
- 구조화 진입은 게이트를 안 거치므로 `validate_command`가 **게이트와 동등한 규칙**을
  적용한다(INV-1: affected ⊆ 현재 일정, `*PoiId` params ⊆ 후보 풀; 시각 키 금지).
- 재타이밍은 결정론(체류시간 보존 + 이동 추정 걷기)이고, 사용자 노출은 그 결과를
  **솔버 validate가 통과시킨 경우만**이다(INV-2) — 위반이면 REJECTED + 사유.
- REPLAN op는 1단계 범위 밖 — 편집이 아니라 재생성이라 `generate` 재호출이 정도다.

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

_DEFAULT_STAY_MIN = 60          # 그 날 기존 슬롯이 없을 때의 체류 기본값
_EMPTY_DAY_START = time(10, 0)  # 빈 날 시작 시각 (ponytail — docstring 참조)
# 게이트 ③과 동일한 금지 키(시각·소요시간) — 구조화 진입 방어
_BANNED_PARAM_TOKENS = ("time", "minute", "duration", "start", "end", "hour")


class EditStatus(Enum):
    APPLIED = "APPLIED"
    CONFIRM_REQUIRED = "CONFIRM_REQUIRED"
    REJECTED = "REJECTED"
    TRANSLATION_FAILED = "TRANSLATION_FAILED"


class EditRejected(ValueError):
    """적용 불가 — 사유는 사용자 회신 문구(침묵 금지, INV-4)."""


def validate_command(
    command: EditCommand, current_ids: frozenset[PoiId], pool: CandidatePool
) -> None:
    """구조화 진입의 게이트 동등 검증 (자연어 진입은 EditTranslationGate가 이미 수행).

    - affected_slots ⊆ 현재 일정 (없는 슬롯 편집 불가)
    - params의 `*PoiId` 값 ⊆ 후보 풀 (INV-1 — 풀 밖 POI 추가·교체 차단)
    - params에 시각·소요시간 키 금지 (시각은 솔버 소유 — INV-2·3)
    """
    for poi_id in command.affected_slots:
        if poi_id not in current_ids:
            raise EditRejected(f"affected_slots의 {poi_id}가 현재 일정에 없음")
    for key, value in command.params.items():
        lowered = key.lower()
        if any(token in lowered for token in _BANNED_PARAM_TOKENS):
            raise EditRejected(f"params에 시각·소요시간 키 {key!r} — 시각은 솔버가 정함")
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

    coords: dict  # PoiId → GeoPoint (미등록 POI는 없음 → 이동 0분 취급, validate가 판정)
    stay_min: dict  # PoiId → int (기존 슬롯의 체류 보존; 신규는 중앙값/기본)
    estimator: object  # TravelEstimator — estimate(a, b, mode).internal_minutes
    transport: TransportMode


def retime_day(
    day: DaySolution, new_order: tuple[PoiId, ...], ctx: RetimeContext, tz: timezone
) -> DaySolution:
    """새 순서 → 결정론 재타이밍. 체류시간 보존, 이동은 추정 걷기.

    시작점 = 기존 첫 슬롯 시각(사용자의 하루 시작 보존), 빈 날이었으면 10:00.
    이 시각은 제안일 뿐 — 노출 여부는 솔버 validate가 정한다(INV-2).
    """
    if not new_order:
        return replace(day, slots=())
    if day.slots:
        cursor = day.slots[0].start_at
    else:
        cursor = datetime.combine(day.date, _EMPTY_DAY_START, tzinfo=tz)
    default_stay = int(median(ctx.stay_min.values())) if ctx.stay_min else _DEFAULT_STAY_MIN
    old_by_id = {s.poi_id: s for s in day.slots}
    slots = []
    prev: PoiId | None = None
    for poi_id in new_order:
        if prev is not None:
            a, b = ctx.coords.get(prev), ctx.coords.get(poi_id)
            gap = ctx.estimator.estimate(a, b, ctx.transport).internal_minutes \
                if a is not None and b is not None else 0
            cursor = cursor + timedelta(minutes=gap)
        stay = ctx.stay_min.get(poi_id, default_stay)
        old = old_by_id.get(poi_id)
        slots.append(VisitSlot(
            poi_id=poi_id,
            start_at=cursor,
            end_at=cursor + timedelta(minutes=stay),
            stay_min=stay,
            score=old.score if old is not None else 0.0,
            is_llm_score=old.is_llm_score if old is not None else False,
        ))
        cursor = slots[-1].end_at
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
