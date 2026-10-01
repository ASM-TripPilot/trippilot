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

# 제3자 문자열(웹 수집 상호명·위키 발췌·네이버 스니펫)은 줄에 넣기 전에 한 줄로 누른다 —
# 줄바꿈이 남으면 우리 프롬프트 골격을 위조한다 (inline() docstring 에 실측).
from trippilot.llm_gateway.prompts import inline
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
    """예약 1건 = 문구 1건. slot_names 순서는 호출측(백엔드)이 확정한 방문 순서.

    slot_categories 는 slot_names 와 같은 순서·길이로 짝을 이루는 표시용 보조 필드다
    (호출측이 맞춰 채운다). **게이트의 allowed 대조는 여전히 slot_names 만** 본다 —
    카테고리를 섞으면 부분 문자열 대조(INV-1)가 깨진다. 프롬프트 렌더링
    (build_reminder_copy_vars)에서만 합쳐 쓴다.
    """

    schedule_key: str
    kind: str  # "TRIP_DAY" | "TRIP_PRE"
    date_label: str  # 표시용 날짜 문자열 (시각 아님 — INV-3)
    slot_names: tuple[str, ...]
    slot_categories: tuple[str, ...] = ()  # 미지정(과거 호출)이면 전부 빈 문자열 취급


@dataclass(frozen=True, slots=True)
class ReminderCopyInput:
    trip_title: str
    items: tuple[ReminderCopyItem, ...]


@dataclass(frozen=True, slots=True)
class ReminderCopyResult:
    schedule_key: str
    title: str
    body: str


# 경계 카테고리 코드 → 프롬프트에 쓸 한국어 라벨.
# 백엔드는 모든 경계에서 **영문 코드**를 내보낸다(`PoiCategory` docstring: 백엔드
# read 포트가 한글 정본 `Poi.kt` 를 코드로 변환해 내보낸다). 그 코드를 그대로
# 프롬프트에 박으면 한국어 문구를 쓰는 모델이 "우리밀 · FOOD" 를 읽게 되므로,
# 여기서 백엔드가 쓰는 한글 정본 어휘로 되돌린다. **와이어는 코드, 프롬프트는 한글** —
# 다른 경계와 어휘를 맞추면서 모델에는 자연어를 준다.
_CATEGORY_LABELS = {
    "FOOD": "맛집",
    "CAFE": "카페",
    "SIGHT": "명소",
    "NIGHT_VIEW": "야경",
    "NATURE": "자연",
    "CULTURE": "문화",
    "ACTIVITY": "액티비티",
    "SHOPPING": "쇼핑",
    "STAY": "숙소",
}


def _slot_line(name: str, category: str) -> str:
    """빈 카테고리·모르는 코드는 구분자 없이 이름만 — 대롱거리는 " · " 와
    프롬프트에 새는 원시 코드를 동시에 막는다."""
    label = _CATEGORY_LABELS.get(category.strip().upper(), "")
    return f"{inline(name)} · {label}" if label else inline(name)


def build_reminder_copy_vars(item: ReminderCopyItem, trip_title: str) -> dict[str, str]:
    """값 전부 str·결정론 — 좌표·시각 미포함.

    slot_categories 가 없으면(과거 호출) 전부 빈 카테고리로 취급해 이름만 렌더한다.
    """
    categories = item.slot_categories or ("",) * len(item.slot_names)
    slot_list = " / ".join(
        _slot_line(name, category) for name, category in zip(item.slot_names, categories)
    )
    return {
        "kind_label": _KIND_LABELS.get(item.kind, "여행 알림"),
        "trip_title": trip_title.strip() or "이번 여행",
        "date_label": item.date_label,
        "slot_list": slot_list or "(일정 없음)",
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
        """그날 장소 = allowed, 같은 여행의 다른 날 장소 = forbidden (중복은 allowed 우선).

        다른 날 이름이 오늘 이름의 **부분 문자열**이면(한라산 ⊂ 한라산 1100고지,
        성산 ⊂ 성산일출봉처럼 한국어 지명은 이렇게 자주 겹친다) forbidden 에서 뺀다.
        게이트(reminder_copy.py)의 forbidden 대조가 부분 문자열 매칭이라, 안 빼면
        오늘 장소만 말한 정상 문구도 다른 날 이름을 "포함"한다는 이유로 매번 드롭된다
        (한쪽 날짜가 매 재시도 영구 드롭). allowed 의 exact-match 로직은 그대로 둔다 —
        그 방향은 이미 맞다.
        """
        allowed = items[index].slot_names
        allowed_set = set(allowed)
        forbidden = tuple(
            dict.fromkeys(
                name
                for other_index, other in enumerate(items)
                if other_index != index
                for name in other.slot_names
                if name not in allowed_set and not any(name in today for today in allowed_set)
            )
        )
        return ReminderCopyContext(allowed=allowed, forbidden=forbidden)
