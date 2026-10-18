"""MOVE_SLOT 기준점 — 방향이 기준 슬롯으로만 정해진다 (commands.apply_command·validate_command).

결함 2건의 회귀: ① 기준 없음이 "맨 앞"이라 "더 늦게"가 앞으로 당겨졌다
② 기준점을 후보 풀과 교차해 풀 밖 현재 슬롯을 기준으로 삼으면 거부됐다.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from trippilot.agents.edit.commands import EditRejected, apply_command, validate_command
from trippilot.domain.common import PoiId
from trippilot.domain.edit import EditCommand, EditOp
from trippilot.domain.itinerary import DaySolution, VisitSlot
from trippilot.domain.llm import CandidatePool

_KST = timezone(timedelta(hours=9))
_DAY = date(2026, 8, 5)
# 오전 관광 → 점심 → 카페 → 저녁 (전부 풀 밖 — 원 일정 슬롯이 풀 밖인 건 정상, TRIP-527)
_ORDER = tuple(PoiId(p) for p in ("museum", "lunch", "cafe", "dinner"))
_EMPTY_POOL = CandidatePool(poi_ids=frozenset(), pois=(),
                            generated_at=datetime(2026, 8, 5, tzinfo=_KST))


def _day() -> DaySolution:
    slots = tuple(
        VisitSlot(poi_id=pid,
                  start_at=datetime(2026, 8, 5, 10 + 2 * i, tzinfo=_KST),
                  end_at=datetime(2026, 8, 5, 11 + 2 * i, tzinfo=_KST),
                  stay_min=60, score=0.0, is_llm_score=False)
        for i, pid in enumerate(_ORDER))
    return DaySolution(date=_DAY, slots=slots, fixed_blocks=())


def _move(target: str, **params: str) -> EditCommand:
    return EditCommand(op=EditOp.MOVE_SLOT, params=params, affected_slots=(PoiId(target),))


def test_later_moves_backward() -> None:
    """"점심 더 늦게" = 바로 다음 슬롯 뒤로."""
    assert apply_command(_day(), _move("lunch", afterPoiId="cafe")) == (
        "museum", "cafe", "lunch", "dinner")


def test_earlier_and_to_front_use_before_anchor() -> None:
    """"저녁 먼저"(카페 앞으로) · 맨 앞 = 첫 슬롯의 beforePoiId."""
    assert apply_command(_day(), _move("dinner", beforePoiId="cafe")) == (
        "museum", "lunch", "dinner", "cafe")
    assert apply_command(_day(), _move("dinner", beforePoiId="museum"))[0] == "dinner"


def test_cafe_last_uses_after_last_slot() -> None:
    assert apply_command(_day(), _move("cafe", afterPoiId="dinner"))[-1] == "cafe"


@pytest.mark.parametrize("params", [
    {},
    {"afterPoiId": "cafe", "beforePoiId": "dinner"},
    # 변형 키도 같은 판정으로 센다 — 정확 키만 읽던 초안은 하나를 조용히 버렸다
    {"after_poi_id": "cafe", "beforePoiId": "museum"},
])
def test_missing_or_double_anchor_is_rejected_not_moved_to_front(params: dict) -> None:
    """기준이 없거나 둘이면 옮기지 않고 사유와 함께 거부 — 조용히 반대로 옮기지 않는다 (INV-4)."""
    with pytest.raises(EditRejected, match="어디로 옮길지"):
        apply_command(_day(), _move("lunch", **params))


def test_variant_anchor_key_alone_is_read() -> None:
    assert apply_command(_day(), _move("lunch", after_poi_id="cafe")) == (
        "museum", "cafe", "lunch", "dinner")


@pytest.mark.parametrize("params", [{"afterPoiId": "lunch"}, {"afterPoiId": None}])
def test_anchor_must_be_another_slot_of_that_day(params: dict) -> None:
    with pytest.raises(EditRejected):
        apply_command(_day(), _move("lunch", **params))


@pytest.mark.parametrize("params", [{"afterPoiId": "museum"}, {"beforePoiId": "cafe"}])
def test_noop_move_is_rejected_not_applied(params: dict) -> None:
    """원래 이웃이 기준이면 순서가 그대로다 — APPLIED 로 위장하지 않는다 (INV-4)."""
    with pytest.raises(EditRejected, match="지금 순서와 같음"):
        apply_command(_day(), _move("lunch", **params))


def test_validate_accepts_pool_outside_current_slot_as_anchor() -> None:
    validate_command(_move("lunch", afterPoiId="cafe"), frozenset(_ORDER), _EMPTY_POOL,
                     frozenset())


def test_validate_rejects_anchor_not_in_itinerary() -> None:
    with pytest.raises(EditRejected, match="현재 일정에 없음"):
        validate_command(_move("lunch", afterPoiId="ghost"), frozenset(_ORDER),
                         _EMPTY_POOL, frozenset())


def test_validate_rejects_null_anchor() -> None:
    with pytest.raises(EditRejected):
        validate_command(_move("lunch", afterPoiId=None), frozenset(_ORDER), _EMPTY_POOL,
                         frozenset())


def test_validate_still_rejects_add_outside_pool() -> None:
    """INV-1 무변 — 새로 넣는 장소는 현재 일정에 있든 없든 풀 안이어야 한다."""
    for params in ({"targetPoiId": "cafe"},
                   {"targetPoiId": "cafe", "afterPoiId": "lunch"}):  # 기준점이 섞여도
        add = EditCommand(op=EditOp.ADD_SLOT, params=params, affected_slots=())
        with pytest.raises(EditRejected, match="closed-set"):
            validate_command(add, frozenset(_ORDER), _EMPTY_POOL, frozenset())
