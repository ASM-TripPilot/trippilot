"""ReminderCopyWorker — 리마인드 알림 문구 생성, 경량 티어.

**항목마다 한 번씩 부른다.** 한 요청에 하루치 여러 건이 오지만 배치 JSON 한 방으로
받지 않는다 — 작은 파인튜닝 모델은 단건 생성이 훨씬 안정적이고, 한 건이 망가져도
나머지가 산다(부분 성공이 이 기능의 정상 동작이다). 로컬 서빙이라 호출 수는 비용이
아니다.

실패·드롭 항목은 결과에서 **빠진다**. 그 자리는 백엔드가 기존 하드코딩 상수로
채운다(INV-4) — 그래서 이 워커에는 폴백 문구 상수가 없다. 빠진 건수는 호출측이
`degraded` 로 노출한다(침묵 금지).

예산은 게이트웨이 기본 타임아웃에 얹히지 않고 **관통**한다(TRIP-376 선례). 요청 예산을
항목 수로 나눠 항목마다 균등 배분하고, 항목의 몫이 최소 호출 시간(`MIN_CALL_SEC`)도
못 주는 상황이면 한 건도 부르지 않고 전체를 드롭으로 보고한다 — 어차피 타임아웃할
호출을 하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.gates.reminder_copy import ReminderCopyContext, ReminderCopyDraft

# 이보다 적은 예산으로는 호출하지 않는다 — 확정 타임아웃을 지불할 이유가 없다.
MIN_CALL_SEC = 0.5

_KIND_LABELS = {
    "TRIP_DAY": "여행 당일 아침 알림",
    "TRIP_PRE": "여행 하루 전 알림",
}


@dataclass(frozen=True, slots=True)
class ReminderCopyItem:
    """예약 1건 = 문구 1건. slot_names 순서는 호출측(백엔드)이 확정한 방문 순서."""

    schedule_key: str
    kind: str  # "TRIP_DAY" | "TRIP_PRE"
    date_label: str  # 표시용 날짜 문자열 (시각 아님 — INV-3)
    slot_names: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ReminderCopyInput:
    trip_title: str
    items: tuple[ReminderCopyItem, ...]


@dataclass(frozen=True, slots=True)
class ReminderCopyResult:
    schedule_key: str
    title: str
    body: str


def build_reminder_copy_vars(item: ReminderCopyItem, trip_title: str) -> dict[str, str]:
    """값 전부 str·결정론 — 좌표·시각 미포함."""
    return {
        "kind_label": _KIND_LABELS.get(item.kind, "여행 알림"),
        "trip_title": trip_title.strip() or "이번 여행",
        "date_label": item.date_label,
        "slot_names": " / ".join(item.slot_names) or "(일정 없음)",
    }


class ReminderCopyWorker:
    def __init__(self, gateway) -> None:
        self._gateway = gateway

    def generate(
        self,
        inp: ReminderCopyInput,
        trace_id: TraceId,
        now: datetime,
        *,
        budget_sec: float | None,
    ) -> tuple[tuple[ReminderCopyResult, ...], int]:
        copies: list[ReminderCopyResult] = []
        dropped = 0
        total = len(inp.items)
        if total == 0:
            return (), 0
        per_item = None if budget_sec is None else budget_sec / total
        # 항목의 몫이 최소값도 못 주면 한 건도 부르지 않고 전부 드롭으로 보고한다.
        if per_item is not None and per_item < MIN_CALL_SEC:
            return (), total
        for index, item in enumerate(inp.items):
            result = self._gateway.call(
                LlmFeature.REMINDER_COPY,
                build_reminder_copy_vars(item, inp.trip_title),
                self._context(inp.items, index),
                trace_id,
                now,
                timeout_sec=per_item,
            )
            draft = result.value
            if result.is_fallback or not isinstance(draft, ReminderCopyDraft):
                dropped += 1
                continue
            copies.append(
                ReminderCopyResult(
                    schedule_key=item.schedule_key, title=draft.title, body=draft.body
                )
            )
        return tuple(copies), dropped

    @staticmethod
    def _context(items: tuple[ReminderCopyItem, ...], index: int) -> ReminderCopyContext:
        """그날 장소 = allowed, 같은 여행의 다른 날 장소 = forbidden (중복은 allowed 우선)."""
        allowed = items[index].slot_names
        allowed_set = set(allowed)
        forbidden = tuple(
            dict.fromkeys(
                name
                for other_index, other in enumerate(items)
                if other_index != index
                for name in other.slot_names
                if name not in allowed_set
            )
        )
        return ReminderCopyContext(allowed=allowed, forbidden=forbidden)
