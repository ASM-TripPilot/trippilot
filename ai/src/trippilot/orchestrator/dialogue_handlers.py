"""도우미 의도별 핸들러(순수) · 슬롯 해소 (assistant-orchestrator FD DE §2.4·§2.5, BLM §5).

한 턴에서 오케스트레이터(`dialogue_orchestrator`)가 하는 일은 셋이다 — `HANDLERS[intent].plan(ctx)` 로 작업
목록을 받아 공유 풀에 던지고, 돌아온 것을 `TaskResult` 로 모아 `assemble(ctx, results)` 에 넘겨 `Facts` 를 받는다.
이 모듈은 그 둘(`plan`·`assemble`)과 슬롯 해소만 가지고 **I/O 를 직접 하지 않는다**:

- `plan` 은 `HandlerTask(name, fn)` 을 돌려준다. Provider·PlanBAgent·풀 조립 호출은 전부 `fn` 콜러블 안에 있고,
  `fn` 은 **호출측이 `TurnContext.ports` 로 주입한 인스턴스**만 쓴다 — 이 모듈은 ports·providers·agents 의 타입을
  import 하되 인스턴스를 만들지 않는다. 좌표가 먼저 필요한 작업(날씨·거리·대안)은 콜러블 안에서 `PoiInfo` 조회 뒤
  이어 간다. DE §2.4 의 "파(wave) ≤ 2" 는 그래서 이 모양에서는 **콜러블 안의 순차**로 접힌다(파 사이 결과 전달을
  오케스트레이터가 할 필요가 없다).
- `assemble` 은 **순수**다 — 같은 `ctx`·같은 `results` 면 같은 `Facts`(BR-AO-16). 결과는 작업 `name` 으로만 읽어 도착
  순서에 무관하고, 없는 작업·TIMEOUT·UNAVAILABLE 은 상태값으로 읽어 있는 것만 조립한다(INV-4, BLM §6 PARTIAL).
- `Facts` 가 답변의 뼈대다(DEC-AO-10): kind·payload·next_actions·quick_replies·template_text 를 여기서 결정론으로
  만들고 LLM 은 문장만 짓는다. `template_text` 는 BE 화면 문장 이식본(`workers.dialogue_answer.fallback_answer_text`)
  이고 post-init 이 답변 게이트와 **같은 검사**(`gates.dialogue_answer._violates`)를 통과시킨다 — Facts 만으로
  유효한 답이 항상 만들어진다는 INV-4 의 구조적 보장이다.
- 보이는 시각은 스냅샷 `start_at` 만, 순서는 스냅샷 순서만(INV-2). 거리는 문자열만(INV-3) — Transit 패킷의
  `internal_minutes` 는 콜러블이 떨어뜨린다. 후보는 반경 풀 안에서 PlanB 가 고른 것만(INV-1).

슬롯 해소(`resolve_slot`)는 BE `QueryCards.mentioned` 와 같은 규칙이다 — 이름 부분일치는 **유일할 때만**(둘 이상이면
None, 2자 미만 무시), 날짜·'N일차'·상대 날짜로 날을 좁히고, '점심'/'저녁'은 FOOD 카테고리 ∧ 시각대로 고른다.
못 풀면 None 이고 지어내지 않는다 — 호출측이 일정 화면 안내 템플릿으로 가되 `Facts.notes` 에 "미해소"를 남겨
'없다'와 가른다(spec Edge Case · DE §2.4).
"""

from __future__ import annotations

import re
import uuid
from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, tzinfo
from enum import Enum

from trippilot.agents.planb.rag import _REASON_KO, PlanBAgent, PlanBRagRequest
from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TraceId,
    TransportMode,
)
from trippilot.domain.dialogue import ArgumentKind
from trippilot.domain.intent import DIALOGUE_INTENTS, Intent
from trippilot.domain.poi import NIGHTLIFE_TAG, TRENDING_TAG, Poi, PoiCategory, counts_as_food, reputation_bonus
from trippilot.domain.theme_tags import themes_in
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.region_centers import region_center
from trippilot.domain.transit import TransitPurpose
from trippilot.domain.trigger import TriggerKind, TriggerParams
from trippilot.llm_gateway.gates.dialogue_answer import _MAX_FOOTNOTE, _MAX_LENGTH, _violates
from trippilot.llm_gateway.workers.dialogue_answer import EXPLORE_ASK_REGION_TEXT, fallback_answer_text
from trippilot.orchestrator.arguments import extract_kind
from trippilot.orchestrator.intent_router import normalize
from trippilot.orchestrator.opportunity import _displayable
from trippilot.orchestrator.place_intro import PlaceIntro
from trippilot.orchestrator.place_sql import PlaceSqlLookup
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder, restrict_pool_to_target_role
from trippilot.providers.base import Provider
from trippilot.providers.transit import _format_distance_range

__all__ = [
    "CANDIDATE_REASON", "HANDLERS", "INFO_KINDS", "NEXT_ACTION_TYPES", "QUICK_REPLY_ACTIONS", "TASK_STATUSES",
    "AnswerKind", "DayView", "FactPlace", "FactRow", "FactStatus", "Facts", "Handler", "HandlerPorts",
    "HandlerTask", "NextAction", "QuickReplyDraft", "SlotView", "TaskResult", "TripInfo", "TurnContext",
    "TurnSnapshot", "edit_arguments", "explore_needs_region", "need_trip_facts", "needs_trip", "next_slot_after",
    "parse_slot_key", "resolve_day", "resolve_slot", "validate_answer_shape", "validate_answer_text",
]

# ── closed-set 어휘 (BE assistant 모듈과 같은 집합 — 여기 한 곳) ──────────────────

# BE `NextAction.TYPES` 17종 (AssistantMessage.kt) = FE 라우트 표. 모르는 type 은 FE 가 버튼을 지운다.
NEXT_ACTION_TYPES: frozenset[str] = frozenset({
    "OPEN_ITINERARY", "OPEN_ITINERARY_EDIT", "OPEN_ITINERARY_METHOD", "OPEN_REGENERATE", "OPEN_REPLAN", "OPEN_LIVE",
    "OPEN_PLACE", "OPEN_STAY_SEARCH", "OPEN_OTA", "OPEN_REFLECTION", "OPEN_TRIP_SUMMARY", "OPEN_STYLE", "CREATE_TRIP",
    "RETRY_TURN", "CONTINUE_WITHOUT_ASSISTANT", "SHOW_CAPABILITIES", "RESTORE_REVISION",
})
# AI 가 내는 빠른 답 종류 (DE §2.3) — REVIEW·PICK_OPTION 은 BE 가 발급한다.
QUICK_REPLY_ACTIONS: frozenset[str] = frozenset({"SEND_TEXT", "PICK_CANDIDATE", "SHOW_CAPABILITIES", "RETRY"})
INFO_KINDS: frozenset[str] = frozenset({"NEXT_SLOT", "DISTANCE", "PLACE", "WEATHER"})
TASK_STATUSES: frozenset[str] = frozenset({"OK", "UNAVAILABLE", "TIMEOUT", "SKIPPED"})
MAX_CANDIDATES = 5  # DE §2.3 CANDIDATES 1..5
_LABEL_MAX = 30

# 버튼 문구 — BE IntentDispatcher·QueryCards·AssistantTemplates 원문 (DEC-U8-6: 화면 문장은 한 벌)
_LABELS: Mapping[str, str] = {
    "OPEN_ITINERARY": "일정 보기", "OPEN_ITINERARY_EDIT": "일정 편집", "OPEN_ITINERARY_METHOD": "일정 만들기",
    "OPEN_REGENERATE": "일정 다시 만들기", "OPEN_REPLAN": "다시 짜기", "OPEN_LIVE": "여행 중 화면 열기",
    "OPEN_PLACE": "장소 보기", "OPEN_STAY_SEARCH": "숙소 검색 열기", "OPEN_REFLECTION": "기록 열기",
    "OPEN_TRIP_SUMMARY": "여행 요약 보기", "OPEN_STYLE": "내 여행 스타일", "CREATE_TRIP": "여행 만들기",
}
_UNNAMED = "이름 미확인 장소"  # BE QueryCards: `nameKo ?: "이름 미확인 장소"`
_UNKNOWN = "미확인"  # BLM §5: 모르는 값(fee None·장소 정보 없음)은 "미확인"
# 행이 있는데 hours_label 이 None = 그 요일이 휴무로 읽혔다(providers.poi_info.hours_label) — 모르는 것이 아니다. 단정하지 않는다:
# 런타임 파서가 "매월 둘째·넷째 일요일" 같은 월 단위 휴무를 일정 배치용으로 매주로 넓혀 읽는다(poi_curation/sourcing/mapping.py).
_CLOSED = "휴무일 수 있음"
# CANDIDATES 후보의 reason — 결정론 라벨 한 벌. `use_llm=False` 의 `Alternative.rationale` 은 PlanB 내부 출처 표기
# (`"{trigger}/{reason} · rule_ranking"`)라 사용자 문장이 아니고, LLM 슬롯 값(`reason`)이 섞여 들어오는 자리다 — 싣지 않는다(DEC-AO-10).
CANDIDATE_REASON = "근처의 대안"
# 대상 슬롯을 못 푼 EMPTY 의 notes — "없다"가 아니라 "못 풀었다"(spec Edge Case: 여럿 겹치면 지어내지 않는다). LLM 재료이자 관측 표지.
_UNRESOLVED = "대상 슬롯 미해소 — 일정에서 찾지 못했거나 이름이 여럿에 걸렸다(없다는 뜻이 아니다)"
_UNRESOLVED_LEG = "구간 미해소 — 목적지를 일정에서 찾지 못했거나 직전 구간이 없다(없다는 뜻이 아니다)"
# 스냅샷 category 는 BE 한글 정본(PlannedSlotView.category) — POI_INFO 패킷의 경계 코드를 같은 어휘로 접는다
_CATEGORY_KO: Mapping[str, str] = {
    "SIGHT": "명소", "FOOD": "맛집", "CAFE": "카페", "NIGHT_VIEW": "야경", "NATURE": "자연", "SHOPPING": "쇼핑",
    "CULTURE": "문화", "ACTIVITY": "액티비티",
}
_FOOD_LABELS = frozenset({PoiCategory.FOOD.value, _CATEGORY_KO[PoiCategory.FOOD.value]})


class AnswerKind(Enum):
    TEXT = "TEXT"
    INFO = "INFO"
    CANDIDATES = "CANDIDATES"


class FactStatus(Enum):
    OK = "OK"
    PARTIAL = "PARTIAL"  # 일부 작업 실패·누락 — 있는 것만 조립했다
    EMPTY = "EMPTY"  # 조회는 됐는데 답할 것이 없다 (남은 일정 없음·해소 실패)
    UNAVAILABLE = "UNAVAILABLE"  # 출처 불통·시한 소진


# ── 스냅샷 뷰 (DE §2.1 — 경계 사영이 와이어 요청을 이 타입으로 바꾼다) ────────────

_SLOT_KEY = re.compile(r"(\d{4}-\d{2}-\d{2})#([^#]+)")


def parse_slot_key(slot_key: str) -> tuple[date, PoiId] | None:
    """`"{date}#{poiId}"`(BR-U2-04, BE PlannedSlotView.slotKey) → (날짜, POI id). 모양이 다르면 None."""
    m = _SLOT_KEY.fullmatch(slot_key) if isinstance(slot_key, str) else None
    if m is None:
        return None
    try:
        on = date.fromisoformat(m.group(1))
        uuid.UUID(m.group(2))
    except ValueError:
        return None
    return on, PoiId(m.group(2))


@dataclass(frozen=True, slots=True)
class SlotView:
    slot_key: str
    poi_id: str | None  # slot_key 에서 판 값 — 모양이 다르면 None(해소 실패로 다룬다)
    name: str | None
    start_at: time  # 저장된(검증된) 계획 시각 — 그대로 보여도 되는 유일한 시각 (INV-2)
    category: str | None  # BE 한글 정본

    @classmethod
    def from_wire(cls, slot_key: str, name: str | None, start_at: time, category: str | None) -> "SlotView":
        parsed = parse_slot_key(slot_key)
        return cls(slot_key, str(parsed[1]) if parsed else None, name, start_at, category)


@dataclass(frozen=True, slots=True)
class DayView:
    date: date
    slots: tuple[SlotView, ...]


@dataclass(frozen=True, slots=True)
class TripInfo:
    trip_id: str
    regions: tuple[str, ...]
    start_date: date
    end_date: date
    phase: str  # PLANNING | IN_TRIP | ENDED


@dataclass(frozen=True, slots=True)
class TurnSnapshot:
    surface: str
    trip: TripInfo | None
    base_stays: tuple[str, ...]  # 이름뿐 — 좌표 없음
    itinerary_status: str | None  # None = 일정 자체가 없다
    days: tuple[DayView, ...]

    def slots(self) -> tuple[tuple[date, SlotView], ...]:
        """(날짜, 슬롯) 를 날짜순·슬롯은 스냅샷 순서대로 — 순서는 스냅샷 것이다 (INV-2)."""
        return tuple((d.date, s) for d in sorted(self.days, key=lambda d: d.date) for s in d.slots)

    def on(self, day: date) -> tuple[SlotView, ...]:
        return tuple(s for d in self.days if d.date == day for s in d.slots)

    def day_of(self, slot: SlotView) -> date | None:
        return next((d.date for d in self.days if any(s.slot_key == slot.slot_key for s in d.slots)), None)


# ── 핸들러 입력 ───────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class HandlerPorts:
    """오케스트레이터가 주입하는 실행자 — 핸들러 모듈은 어느 것도 만들지 않는다. None = 미배선(기능 부재)."""

    poi_info: Provider | None = None  # PoiInfoProvider.fetch({poi_ids, on, now})
    weather: Provider | None = None  # WeatherProvider.fetch({anchor, days, now})
    transit: Provider | None = None  # TransitProvider.fetch({origin, destination, mode, now, purpose})
    pool_builder: CandidatePoolBuilder | None = None
    planb: PlanBAgent | None = None
    place_sql: PlaceSqlLookup | None = None  # 장소 탐색 NL2SQL — DIALOGUE_SQL 배정 + 장소 DB DSN 이 있을 때만
    place_intro: PlaceIntro | None = None  # 장소 소개 한 조각(KB-5) — 벡터 스토어가 배선됐을 때만


@dataclass(frozen=True, slots=True)
class TurnContext:
    """한 턴의 읽기 전용 뷰 — 스냅샷·분류 인자·시각·주입 포트. `remaining_ms` 는 콜러블이 실행 시점에 읽는다(DL-4)."""

    snapshot: TurnSnapshot
    arguments: Mapping[str, str]
    now: datetime  # tz-aware
    tz: tzinfo  # 여행지 시간대 — 오늘·지금 판정의 기준
    trace_id: TraceId
    remaining_ms: Callable[[], int]
    ports: HandlerPorts = field(default_factory=HandlerPorts)
    utterance: str = ""  # 사용자 발화 원문 — 장소 탐색 NL2SQL 의 재료로만 쓴다(Facts 에는 싣지 않는다, INV-2)

    def __post_init__(self) -> None:
        if self.now.tzinfo is None:
            raise ValueError("TurnContext.now 는 tz-aware 만")

    @property
    def local_now(self) -> datetime:
        return self.now.astimezone(self.tz)

    @property
    def today(self) -> date:
        return self.local_now.date()


# ── 작업과 결과 ───────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class HandlerTask:
    """팬아웃 한 건 — `name` 은 플랜 안에서 유일한 병합 키, `fn` 은 JSON-safe dict 를 돌려주는 콜러블."""

    name: str
    fn: Callable[[], dict]


@dataclass(frozen=True, slots=True)
class TaskResult:
    """작업 하나의 **전송** 결과. Provider 자체의 상태(OK·LOW·WEATHER_UNKNOWN…)는 `value["status"]` 에 있다."""

    name: str
    status: str  # OK | UNAVAILABLE(예외) | TIMEOUT(미완) | SKIPPED(미제출)
    value: Mapping[str, object] | None = None

    def __post_init__(self) -> None:
        if self.status not in TASK_STATUSES:
            raise ValueError(f"TaskResult.status 는 {sorted(TASK_STATUSES)} 중 하나: {self.status!r}")
        if (self.status == "OK") != (self.value is not None):
            raise ValueError("OK ⇔ value 있음")

    @classmethod
    def ok(cls, name: str, value: Mapping[str, object]) -> "TaskResult":
        return cls(name, "OK", value)

    @classmethod
    def failed(cls, name: str, status: str) -> "TaskResult":
        return cls(name, status, None)


def _value(results: Mapping[str, TaskResult], name: str) -> Mapping[str, object] | None:
    r = results.get(name)
    return r.value if r is not None and r.status == "OK" else None


def _fresh(packet: Mapping[str, object] | None) -> bool:
    return packet is not None and packet.get("status") in ("OK", "LOW")


# ── 답변 뼈대 (DE §2.3·§2.5) ──────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class NextAction:
    type: str
    label: str
    params: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.type not in NEXT_ACTION_TYPES:
            raise ValueError(f"NextAction.type 은 BE TYPES 17종 안: {self.type!r}")
        if not 1 <= len(self.label) <= _LABEL_MAX:
            raise ValueError(f"NextAction.label 은 1..{_LABEL_MAX}자: {self.label!r}")
        if self.type == "OPEN_PLACE" and "poiId" not in self.params:
            raise ValueError("OPEN_PLACE 는 params.poiId 필수")

    def to_dict(self) -> dict:
        return {"type": self.type, "label": self.label, "params": dict(self.params)}


@dataclass(frozen=True, slots=True)
class QuickReplyDraft:
    """id 가 없다 — 서버 발급(`qr-ai-{8자}-{i}`)은 백엔드 몫."""

    label: str
    action: str
    params: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.action not in QUICK_REPLY_ACTIONS:
            raise ValueError(f"QuickReplyDraft.action 은 {sorted(QUICK_REPLY_ACTIONS)} 중 하나: {self.action!r}")
        if not 1 <= len(self.label) <= _LABEL_MAX:
            raise ValueError(f"QuickReplyDraft.label 은 1..{_LABEL_MAX}자: {self.label!r}")
        if self.action == "PICK_CANDIDATE" and not {"poiId", "slotKey"} <= set(self.params):
            raise ValueError("PICK_CANDIDATE 는 params.poiId·slotKey 필수")

    def to_dict(self) -> dict:
        return {"label": self.label, "action": self.action, "params": dict(self.params)}


@dataclass(frozen=True, slots=True)
class FactRow:
    label: str
    value: str


@dataclass(frozen=True, slots=True)
class FactPlace:
    """답변 문장에 등장해도 되는 장소 — 배치 조회·풀에서 온 닫힌 목록의 한 줄. 좌표는 싣지 않는다."""

    poi_id: str | None
    name: str
    category: str | None = None
    hours_label: str | None = None
    fee: int | None = None
    distance_range: str | None = None
    reason: str | None = None


def validate_answer_text(text: str, *, max_chars: int = _MAX_LENGTH) -> None:
    """답변 게이트(`gates.dialogue_answer`)와 같은 검사 — 비어 있음·길이·줄 수·시간 표현(INV-3)·연락처."""
    if not isinstance(text, str) or _violates(text, max_chars):
        raise ValueError(f"답변 문장이 게이트 규칙을 어긴다(빈 문장·{max_chars}자·6줄·시간 표현·연락처): {text!r}")


def validate_answer_shape(
    kind: AnswerKind,
    payload: Mapping[str, object] | None,
    next_actions: tuple[NextAction, ...],
    quick_replies: tuple[QuickReplyDraft, ...] | None,
) -> None:
    """kind 별 payload 모양 — FE 카드가 필수 배열 누락에 크래시한다(ErrorBoundary 없음)."""
    if not next_actions:
        raise ValueError("next_actions ≥ 1 (BR-U8-06)")
    if kind is AnswerKind.TEXT:
        if payload is not None:
            raise ValueError("TEXT 는 payload 없음")
        return
    if not isinstance(payload, Mapping):
        raise ValueError(f"{kind.value} 는 payload 객체 필수")
    if kind is AnswerKind.INFO:
        if payload.get("infoKind") not in INFO_KINDS:
            raise ValueError(f"INFO.infoKind 는 {sorted(INFO_KINDS)} 중 하나")
        if not isinstance(payload.get("title"), str):
            raise ValueError("INFO.title 문자열 필수")
        rows = payload.get("rows")
        if not isinstance(rows, list) or not all(
            isinstance(r, Mapping) and isinstance(r.get("label"), str) and isinstance(r.get("value"), str) for r in rows
        ):
            raise ValueError("INFO.rows 는 {label, value} 문자열 행의 list (빈 배열 허용, 누락 금지)")
        return
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= MAX_CANDIDATES:
        raise ValueError(f"CANDIDATES.candidates 는 1..{MAX_CANDIDATES} 건")
    picks = [q for q in (quick_replies or ()) if q.action == "PICK_CANDIDATE"]
    for c in candidates:
        if not (isinstance(c, Mapping) and isinstance(c.get("poiId"), str) and isinstance(c.get("name"), str)
                and isinstance(c.get("reason"), str)):
            raise ValueError("후보는 {poiId, name, reason} 문자열 필수 (+distanceRange 선택)")
        if _violates(c["reason"], _MAX_FOOTNOTE):  # FE 가 그대로 그리는 문자열 — 문장 게이트와 같은 검사(INV-3·연락처)
            raise ValueError(f"후보 reason 이 게이트 규칙을 어긴다(빈 값·{_MAX_FOOTNOTE}자·시간 표현·연락처): {c['reason']!r}")
        # 고르기 버튼은 전부 있거나(대안 — 바꿀 슬롯이 있다) 전부 없다(장소 탐색 — 바꿀 슬롯이 없다). 있으면 후보마다 정확히 하나
        if picks and sum(1 for q in picks if q.params.get("poiId") == c["poiId"]) != 1:
            raise ValueError(f"후보 {c['poiId']} 의 PICK_CANDIDATE 빠른 답은 정확히 하나")


_RESERVED_FACT_KEYS = frozenset({"intent", "status", "needs_trip", "rows", "places", "notes"})


@dataclass(frozen=True, slots=True)
class Facts:
    """답변의 결정론 뼈대 + LLM 재료. post-init 이 지키는 것: Facts 만으로 유효한 `DialogueAnswer` 가 항상 만들어진다."""

    intent: Intent
    status: FactStatus
    kind: AnswerKind
    rows: tuple[FactRow, ...]  # INFO 의 rows 와 동형 — 라벨·값은 BE QueryCards 어휘
    places: tuple[FactPlace, ...]  # 문장에 등장해도 되는 장소의 닫힌 목록
    notes: tuple[str, ...]  # "날씨 미확인" 류 — 사용자 문장 재료이자 PARTIAL 보고
    payload: dict | None  # kind 별 모양 (DE §2.3) — LLM 이 건드리지 않는다
    next_actions: tuple[NextAction, ...]
    quick_replies: tuple[QuickReplyDraft, ...] | None  # () = 상시 칩만 · None = 시작 칩 복귀
    template_text: str  # 결정론 폴백 문장 (정본 workers.dialogue_answer — BE 템플릿 이식 + ★ 신설)
    footnote: str | None = None
    needs_trip: bool = False
    detail: Mapping[str, object] = field(default_factory=dict)  # 의도별 추가 사실(JSON-safe) — `$facts` 에 그대로 합쳐진다

    def __post_init__(self) -> None:
        validate_answer_shape(self.kind, self.payload, self.next_actions, self.quick_replies)
        validate_answer_text(self.template_text)
        if self.footnote is not None:
            validate_answer_text(self.footnote, max_chars=_MAX_FOOTNOTE)
        clash = _RESERVED_FACT_KEYS & set(self.detail)
        if clash:
            raise ValueError(f"Facts.detail 이 예약 키를 덮는다: {sorted(clash)}")
        # BR-AO-20 — 대안 후보는 고르기(바꿀 슬롯)가 후보마다 하나다. 모양 검사는 "전부 있거나 전부 없다"(탐색은 없다)라 여기서 조인다
        if self.intent is Intent.SUGGEST_ALTERNATIVE and self.kind is AnswerKind.CANDIDATES and not any(
                q.action == "PICK_CANDIDATE" for q in self.quick_replies or ()):
            raise ValueError("SUGGEST_ALTERNATIVE 후보는 후보마다 PICK_CANDIDATE 가 하나씩 있어야 한다 (BR-AO-20)")

    def to_prompt_dict(self) -> dict:
        """`$facts` 재료 — 좌표·poi_id 는 넣지 않는다 (DE §2.5). `fallback_answer_text` 가 읽는 키(status·needs_trip·target)도 여기."""
        return {
            "intent": self.intent.value,
            "status": self.status.value,
            "needs_trip": self.needs_trip,
            # 모르는 입장료는 물었든 안 물었든 답이 "확인할 수 없다"로 같다 — 카드(payload)에는 두고 여기선 뺀다. 실었더니 카페 답마다
            # "입장료도 미확인이에요"·"대신 입장료도 미확인이에요"가 붙었다(답변 0.3.2 측정, 2026-10-20). 물으면 사실이 없어 "확인되지
            # 않았어요"로 답한다(단독 경로 14/14). 계획 병합 답에서 장소 정보가 대표가 아니면 카드도 없다 — 그때도 같은 프롬프트 규칙에 기댄다
            "rows": [{"label": r.label, "value": r.value} for r in self.rows if (r.label, r.value) != ("입장료", _UNKNOWN)],
            "places": [{"name": p.name, "category": p.category, "hours_label": p.hours_label, "fee": p.fee,
                        "distance_range": p.distance_range, "reason": p.reason} for p in self.places],
            "notes": list(self.notes),
            **dict(self.detail),
        }


def _template(intent: Intent, status: FactStatus, *, needs_trip: bool = False, target: str | None = None) -> str:
    """결정론 문장 한 벌 — BE 문구 이식본은 `workers.dialogue_answer` 가 들고 있다. 여기서 두 번 적지 않는다."""
    return fallback_answer_text(intent, {"status": status.value, "needs_trip": needs_trip, "target": target})


def _action(type_: str, **params: str) -> NextAction:
    return NextAction(type_, _LABELS[type_], params)


def _info(kind: str, title: str, rows: tuple[FactRow, ...]) -> dict:
    return {"infoKind": kind, "title": title, "rows": [{"label": r.label, "value": r.value} for r in rows]}


def _text_facts(intent: Intent, status: FactStatus, actions: tuple[NextAction, ...], *, notes: tuple[str, ...] = (),
                detail: Mapping[str, object] | None = None, target: str | None = None) -> Facts:
    return Facts(intent, status, AnswerKind.TEXT, rows=(), places=(), notes=notes, payload=None, next_actions=actions,
                 quick_replies=(), template_text=_template(intent, status, target=target), detail=dict(detail or {}))


def _itinerary_action(snapshot: TurnSnapshot) -> NextAction:
    """일정이 없으면 만들기로, 있으면 보기로 (BE QueryCards.noItinerary·viewItinerary)."""
    return _action("OPEN_ITINERARY_METHOD" if snapshot.itinerary_status is None else "OPEN_ITINERARY")


def _date_label(d: date) -> str:
    return f"{d.month}월 {d.day}일"  # BE QueryCards DATE 포맷 "M월 d일"


def _hm(t: time) -> str:
    return t.strftime("%H:%M")  # BE QueryCards TIME 포맷 — 스냅샷 값을 그대로 옮긴다 (INV-2)


def _clip(label: str) -> str:
    return label[:_LABEL_MAX] or _UNNAMED


# ── 슬롯 해소 ─────────────────────────────────────────────────────────────────

MIN_MENTION_CHARS = 2  # BE `MIN_MENTION_LENGTH` — 한 글자("카")로 엉뚱한 곳이 잡히지 않게
_MEALS: Mapping[str, tuple[int, int]] = {"점심": (11, 14), "저녁": (17, 21)}  # FOOD ∧ 시각대(시, 포함)

_ISO = re.compile(r"\d{4}-\d{2}-\d{2}")
_RELATIVE: Mapping[str, int] = {"어제": -1, "오늘": 0, "내일": 1, "낼": 1, "모레": 2, "글피": 3}
_MONTH_DAY = re.compile(r"(?:(\d{2,4})년\s*)?(\d{1,2})월\s*(\d{1,2})일")
_SLASH = re.compile(r"(\d{1,2})/(\d{1,2})")
_KO_ORDINAL = {"첫": 1, "둘": 2, "셋": 3, "넷": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9, "열": 10}
_KO_COUNT = {"첫": 1, "한": 1, "두": 2, "세": 3, "네": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9, "열": 10, "열두": 12}
_KO_SPAN = {"하루": 1, "이틀": 2, "사흘": 3, "나흘": 4, "닷새": 5}
_KO_SINO = {"일": 1, "이": 2, "삼": 3, "사": 4, "오": 5}
_ORDINALS: tuple[tuple[re.Pattern[str], Mapping[str, int] | None], ...] = (
    (re.compile(r"(\d{1,2})\s*일\s*(?:차|째)"), None),
    (re.compile(r"(첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)째"), _KO_ORDINAL),
    (re.compile(r"(열두|첫|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*번째"), _KO_COUNT),
    (re.compile(r"(하루|이틀|사흘|나흘|닷새)\s*째"), _KO_SPAN),
    (re.compile(r"([일이삼사오])\s*일\s*째"), _KO_SINO),
)


def _ordinal(text: str) -> int | None:
    for pattern, table in _ORDINALS:
        m = pattern.search(text)
        if m:
            return int(m.group(1)) if table is None else table[m.group(1)]
    if "첫날" in text:
        return 1
    return int(text) if re.fullmatch(r"\d{1,2}", text) else None  # BE targetDate 와 같은 맨 숫자 N


def resolve_day(text: str, snapshot: TurnSnapshot, today: date) -> date | None:
    """날 표현 → 날짜. ISO · 상대('오늘'·'내일') · 'M월 D일' · 'M/D' · 순번('2일차'·'둘째 날'·'세 번째 날'·맨 숫자) ·
    '마지막 날'. 요일·'다음 달 N일' 은 해석하지 않는다(None) — 넘겨짚지 않는다(BE ProposalCards.targetDate 와 같은 태도)."""
    t = normalize(text)
    if not t:
        return None
    if _ISO.fullmatch(t):
        return _safe_date(int(t[:4]), int(t[5:7]), int(t[8:]))
    if re.search(r"내일\s*모레", t):
        return today + timedelta(days=2)
    for word, offset in _RELATIVE.items():
        if word in t:
            return today + timedelta(days=offset)
    m = _MONTH_DAY.search(t)
    if m:
        return _safe_date(int(m.group(1)) if m.group(1) else today.year, int(m.group(2)), int(m.group(3)))
    m = _SLASH.fullmatch(t)
    if m:
        return _safe_date(today.year, int(m.group(1)), int(m.group(2)))
    trip_days = _trip_days(snapshot)
    if trip_days is None:
        return None
    first, last = trip_days
    if "마지막" in t or "막날" in t:
        return last
    n = _ordinal(t)
    return first + timedelta(days=n - 1) if n is not None and n >= 1 else None


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _trip_days(snapshot: TurnSnapshot) -> tuple[date, date] | None:
    if snapshot.trip is not None:
        return snapshot.trip.start_date, snapshot.trip.end_date
    if snapshot.days:
        dates = sorted(d.date for d in snapshot.days)
        return dates[0], dates[-1]
    return None


def _split_day(text: str, snapshot: TurnSnapshot, today: date) -> tuple[date | None, str]:
    """'둘째 날 카페' → (둘째 날, '카페'). 날 표현이 없거나 못 읽으면 (None, 원문)."""
    span = extract_kind(text, ArgumentKind.ORDINAL) or extract_kind(text, ArgumentKind.DATE)
    if span is None:
        return None, text
    on = resolve_day(span, snapshot, today)
    if on is None:
        return None, text
    return on, normalize(text.replace(span, " "))


def _is_meal(slot: SlotView, window: tuple[int, int]) -> bool:
    lo, hi = window
    return slot.category in _FOOD_LABELS and lo <= slot.start_at.hour <= hi


def _next_after(snapshot: TurnSnapshot, now: datetime, tz: tzinfo) -> tuple[date, SlotView] | None:
    local = now.astimezone(tz)
    today, at = local.date(), local.time()
    for d, s in snapshot.slots():
        if d > today or (d == today and s.start_at >= at):
            return d, s
    return None


def next_slot_after(snapshot: TurnSnapshot, now: datetime, tz: tzinfo) -> tuple[date, SlotView] | None:
    """계획 시각이 지금 이후인 첫 슬롯 — BE QueryCards.nextSlot 과 같은 규칙(방문 여부는 따지지 않는다)."""
    return _next_after(snapshot, now, tz)


def resolve_slot(
    snapshot: TurnSnapshot, *, day: str | None, target: str | None, now: datetime, tz: tzinfo,
) -> SlotView | None:
    """발화 인자 → 일정 안의 슬롯 하나. 못 풀면 None — 이름이 여럿에 걸려도 None 이다(지어내지 않는다, DE §2.4).

    순서: ① `day`(없으면 `target` 안의 날 표현)로 날을 좁힌다 — 날을 받았는데 못 읽으면 None ② 가리킨 말이 없으면 그 날
    (날도 없으면 오늘)의 첫 슬롯 ③ 이름 부분일치(양방향, ≥2자) — 유일할 때만 ④ '점심'/'저녁' → FOOD ∧ 시각대 — 날이
    없으면 오늘 것을 먼저, 그래도 여럿이면 None ⑤ '다음' → 지금 이후 첫 슬롯.
    """
    today = now.astimezone(tz).date()
    on: date | None = None
    if day:
        on = resolve_day(day, snapshot, today)
        if on is None:
            return None
    rest = normalize(target) if target else ""
    if on is None and rest:
        on, rest = _split_day(rest, snapshot, today)
    candidates = snapshot.on(on) if on is not None else tuple(s for _, s in snapshot.slots())
    if not rest:
        pool = candidates if on is not None else snapshot.on(today)
        return pool[0] if pool else None
    if len(rest) >= MIN_MENTION_CHARS:
        hits = [s for s in candidates if s.name and len(s.name) >= MIN_MENTION_CHARS
                and (rest in normalize(s.name) or normalize(s.name) in rest)]
        if hits:  # 둘 이상은 None — 어느 것인지 고르지 않는다
            return hits[0] if len(hits) == 1 else None
    window = next((w for word, w in _MEALS.items() if word in rest), None)
    if window is not None:
        if on is None:
            todays = [s for s in snapshot.on(today) if _is_meal(s, window)]
            if len(todays) == 1:
                return todays[0]
        meals = [s for s in candidates if _is_meal(s, window)]
        return meals[0] if len(meals) == 1 else None
    if "다음" in rest:
        found = _next_after(snapshot, now, tz)
        return found[1] if found else None
    return None


# ── 공통: 여행 필수 ────────────────────────────────────────────────────────────

_NEED_TRIP_ACTIONS = ("CREATE_TRIP", "OPEN_STAY_SEARCH")


def needs_trip(intent: Intent) -> bool:
    """여행이 있어야 넘길 화면이 있는 의도 — BE IntentDispatcher.NEEDS_TRIP 과 같은 집합."""
    return intent not in (Intent.STYLE_ANALYSIS, Intent.EXPLORE_PLACES, Intent.OUT_OF_SCOPE)


def need_trip_facts(intent: Intent) -> Facts:
    """BE AssistantTemplates.needTrip — 막지 않고 길을 준다 (BR-U8-05)."""
    return Facts(intent, FactStatus.EMPTY, AnswerKind.TEXT, rows=(), places=(), notes=(), payload=None,
                 next_actions=tuple(_action(t) for t in _NEED_TRIP_ACTIONS), quick_replies=(),
                 template_text=_template(intent, FactStatus.EMPTY, needs_trip=True), needs_trip=True)


# ── 콜러블 안에서 쓰는 조회 (주입 포트만) ─────────────────────────────────────


def _lookup(ctx: TurnContext, poi_ids: Iterable[str], on: date) -> dict[str, dict]:
    """POI_INFO 배치 조회 → poi_id 별 행. 미배선·실패·누락은 빈 dict/빠진 키 — 호출측이 상태값으로 적는다."""
    port = ctx.ports.poi_info
    if port is None:
        return {}
    packet = port.fetch({"poi_ids": frozenset(PoiId(p) for p in poi_ids), "on": on, "now": ctx.now})
    if packet.status.value not in ("OK", "LOW"):
        return {}
    return {row["poi_id"]: row for row in packet.data.get("pois", ())}


def _coord(row: Mapping[str, object] | None) -> GeoPoint | None:
    return GeoPoint(float(row["lat"]), float(row["lng"])) if row else None


# ── 의도별 핸들러 ──────────────────────────────────────────────────────────────


def _plan_nothing(ctx: TurnContext) -> tuple[HandlerTask, ...]:
    return ()


# SHOW_SCHEDULE — 스냅샷 요약 (LLM 이 `days` 를 보고 문장을 쓴다; 템플릿은 날짜·곳 수 한 줄)


def _schedule_days(ctx: TurnContext) -> tuple[tuple[DayView, ...], str, tuple[str, ...]]:
    snap, today = ctx.snapshot, ctx.today
    notes: list[str] = []
    said = ctx.arguments.get("date") or ctx.arguments.get("day")
    on = resolve_day(said, snap, today) if said else None
    if said and on is None:
        notes.append("날짜 표현 미해석 — 전체 일정으로 답한다")
    days = [d for d in sorted(snap.days, key=lambda d: d.date) if on is None or d.date == on]
    scope = ctx.arguments.get("scope") or "ALL"
    if scope == "REMAINING":
        at = ctx.local_now.time()
        days = [DayView(d.date, tuple(s for s in d.slots if d.date > today or s.start_at >= at))
                for d in days if d.date >= today]
    return tuple(d for d in days if d.slots), scope, tuple(notes)


def _assemble_show_schedule(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
    intent = Intent.SHOW_SCHEDULE
    days, scope, notes = _schedule_days(ctx)
    detail = {"scope": scope, "days": [
        {"date": d.date.isoformat(),
         "slots": [{"name": s.name, "start_at": _hm(s.start_at), "category": s.category} for s in d.slots]}
        for d in days]}
    if not days:
        return _text_facts(intent, FactStatus.EMPTY, (_itinerary_action(ctx.snapshot),), notes=notes, detail=detail)
    summary = ", ".join(f"{_date_label(d.date)} {len(d.slots)}곳" for d in days) + " 일정이 있어요."
    text = summary if not _violates(summary, _MAX_LENGTH) else _template(intent, FactStatus.OK)
    return Facts(
        intent, FactStatus.OK, AnswerKind.TEXT,
        rows=tuple(FactRow(_date_label(d.date), f"{len(d.slots)}곳") for d in days),
        places=tuple(FactPlace(s.poi_id, s.name or _UNNAMED, s.category) for d in days for s in d.slots),
        notes=notes, payload=None, next_actions=(_action("OPEN_ITINERARY"),), quick_replies=(),
        template_text=text, detail=detail,
    )


# GET_NEXT_SLOT — now 이후 첫 슬롯 (BE QueryCards.nextSlot)


def _changeable(ctx: TurnContext) -> bool:
    """대체 후보 빠른 답을 줄 수 있는 일정인가 — 확정 일정은 여행이 시작돼야 바뀐다 (BE QueryCards 규칙)."""
    status, trip = ctx.snapshot.itinerary_status, ctx.snapshot.trip
    return status == "PLANNED" or (status == "CONFIRMED" and trip is not None and ctx.today >= trip.start_date)


def _assemble_next_slot(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
    intent = Intent.GET_NEXT_SLOT
    found = _next_after(ctx.snapshot, ctx.now, ctx.tz)
    if found is None and ctx.snapshot.itinerary_status is None:  # 일정 자체가 없다 — "남은 일정이 없어요"·[일정 보기]가 아니라 만들기로
        return Facts(intent, FactStatus.EMPTY, AnswerKind.TEXT, rows=(), places=(), notes=(), payload=None,
                     next_actions=(_itinerary_action(ctx.snapshot),), quick_replies=(),
                     template_text=_template(Intent.SHOW_SCHEDULE, FactStatus.EMPTY))
    if found is None:
        return _text_facts(intent, FactStatus.EMPTY, (_action("OPEN_ITINERARY"),))
    on, slot = found
    rows = ((FactRow("날짜", _date_label(on)),) if on != ctx.today else ()) + (FactRow("계획 시각", _hm(slot.start_at)),)
    trip = ctx.snapshot.trip
    action = _action("OPEN_LIVE") if trip is not None and trip.phase == "IN_TRIP" else _action("OPEN_ITINERARY")
    quick = (QuickReplyDraft("다른 곳 추천", "SEND_TEXT", {"intent": Intent.SUGGEST_ALTERNATIVE.value, "slotKey": slot.slot_key}),
             ) if _changeable(ctx) else ()
    return Facts(
        intent, FactStatus.OK, AnswerKind.INFO, rows=rows,
        places=(FactPlace(slot.poi_id, slot.name or _UNNAMED, slot.category),), notes=(),
        payload=_info("NEXT_SLOT", slot.name or _UNNAMED, rows), next_actions=(action,), quick_replies=quick,
        template_text=_template(intent, FactStatus.OK),
        detail={"next": {"date": on.isoformat(), "name": slot.name, "start_at": _hm(slot.start_at), "category": slot.category}},
    )


# GET_WEATHER — 1파 POI_INFO(앵커 좌표) → 2파 WEATHER, 한 콜러블 안에서


@dataclass(frozen=True, slots=True)
class _WeatherAnchor:
    """어느 날·어느 좌표의 날씨인가. `slot` 이면 좌표를 POI_INFO 로 얻고, `coord` 면 지역 중심이라 조회 없이 바로 묻는다."""

    on: date
    label: str  # 제목·detail 에 쓰는 이름 — 슬롯명 또는 표의 지역명
    slot: SlotView | None = None
    coord: GeoPoint | None = None


def _weather_default_day(snap: TurnSnapshot, today: date) -> date:
    """날짜를 안 말했고 슬롯도 없을 때 — 여행 전이면 첫날(슬롯 규칙 "앞으로 올 첫 슬롯"과 같은 날), 아니면 오늘."""
    trip = snap.trip
    return trip.start_date if trip is not None and trip.start_date > today else today


def _weather_anchor(ctx: TurnContext) -> _WeatherAnchor | None:
    """① 말한 지역(`region`)의 중심 → ② 그 날(또는 오늘 이후 첫) 슬롯 → ③ 여행 지역 중심. 셋 다 없으면 None(EMPTY).

    ②만 있던 동안 일정이 없거나 오늘이 여행일이 아니면 "지금 날씨를 확인할 수 없어요" 만 나갔다 — 좌표는 지역 중심표
    (`region_centers`)로 충분하다. 표에 없는 지역은 지어내지 않는다 — 말한 지역이 표 밖이면 일정 지역으로 바꿔 답하지
    않고 None("부산 날씨" 에 제주 값을 내지 않는다). `region` 은 도우미 분류에서만 묻는다(인자표 `dialogue_only`).
    """
    snap, today = ctx.snapshot, ctx.today
    said_day = ctx.arguments.get("date")
    on = resolve_day(said_day, snap, today) if said_day else None
    if said_day and on is None:
        return None
    said_region = ctx.arguments.get("region")
    if said_region:
        return region_weather_anchor(said_region, on if on is not None else _weather_default_day(snap, today))
    if on is not None:
        slot = next((s for s in snap.on(on) if s.poi_id), None)
        if slot is not None:
            return _WeatherAnchor(on, slot.name or "여행지", slot=slot)
    else:
        found = next(((d, s) for d, s in snap.slots() if d >= today and s.poi_id), None)
        if found is not None:
            return _WeatherAnchor(found[0], found[1].name or "여행지", slot=found[1])
    trip = snap.trip
    fallback_day = on if on is not None else _weather_default_day(snap, today)
    for region in (trip.regions if trip is not None else ()):
        anchor = region_weather_anchor(region, fallback_day)
        if anchor is not None:
            return anchor
    return None


def region_weather_anchor(region: str, on: date) -> _WeatherAnchor | None:
    """지역 표현 → 그 지역 중심 좌표의 날씨 앵커. 표(`region_centers`)에 없으면 None — 지어내지 않는다.

    여행 지역 폴백이 쓰고, 말한 지역(`region` 인자)이 분류에 실리면 그것도 이 함수로 푼다(탐색·거리 핸들러와 같은 표·같은 정규화).
    """
    hit = region_center(normalize(region))
    if hit is None:
        return None
    name, coord, _ = hit
    return _WeatherAnchor(on, name, coord=coord)


def _plan_weather(ctx: TurnContext) -> tuple[HandlerTask, ...]:
    anchor = _weather_anchor(ctx)
    weather = ctx.ports.weather
    if anchor is None or weather is None or (anchor.slot is not None and ctx.ports.poi_info is None):
        return ()
    on, slot = anchor.on, anchor.slot

    def fn() -> dict:
        coord = anchor.coord if slot is None else _coord(_lookup(ctx, (slot.poi_id,), on).get(slot.poi_id))
        if coord is None:
            return {"status": "UNAVAILABLE", "reason": "anchor_coord_unknown", "date": on.isoformat()}
        packet = weather.fetch({"anchor": coord, "days": (on,), "now": ctx.now})
        return {"status": packet.status.value, "data": packet.data, "date": on.isoformat()}

    return (HandlerTask("weather", fn),)


def _assemble_weather(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
    intent = Intent.GET_WEATHER
    anchor = _weather_anchor(ctx)
    if anchor is None:
        return _text_facts(intent, FactStatus.EMPTY, (_itinerary_action(ctx.snapshot),),
                           notes=("날씨 앵커 없음 — 그 날 좌표를 얻을 슬롯이 없고 여행·말한 지역도 중심표에 없다",))
    on = anchor.on
    value = _value(results, "weather")
    if value is None or value.get("status") == "UNAVAILABLE":
        return _text_facts(intent, FactStatus.UNAVAILABLE, (_itinerary_action(ctx.snapshot),), notes=("날씨 미확인",),
                           detail={"date": on.isoformat()})
    pop = value.get("data", {}).get("daily", {}).get(on.isoformat()) if _fresh(value) else None
    if pop is None:
        return _text_facts(intent, FactStatus.EMPTY, (_itinerary_action(ctx.snapshot),), notes=("날씨 미확인",),
                           detail={"date": on.isoformat()})
    trip = ctx.snapshot.trip
    # 슬롯 앵커면 여행 지역(없으면 슬롯명), 지역 중심 앵커면 그 지역 — "부산 날씨" 에 일정 지역 이름을 달지 않는다
    region = anchor.label if anchor.coord is not None else (trip.regions[0] if trip is not None and trip.regions else anchor.label)
    label = "오늘 최대 강수확률" if on == ctx.today else f"{_date_label(on)} 최대 강수확률"  # BE 행 라벨 — 그 날의 최댓값
    rows = (FactRow(label, f"{pop}%"),)
    return Facts(
        intent, FactStatus.OK, AnswerKind.INFO, rows=rows, places=(), notes=(),
        payload=_info("WEATHER", f"{region} 날씨", rows), next_actions=(_itinerary_action(ctx.snapshot),), quick_replies=(),
        template_text=_template(intent, FactStatus.OK), detail={"date": on.isoformat(), "anchor": anchor.label},
    )


# GET_DISTANCE — 일정상 그 장소의 **직전 구간**만 (BE QueryCards.distance, G-U8-5)


def _distance_leg(ctx: TurnContext) -> tuple[date, SlotView, SlotView] | None:
    said = ctx.arguments.get("destination")
    if not said:
        return None
    dest = resolve_slot(ctx.snapshot, day=None, target=said, now=ctx.now, tz=ctx.tz)
    if dest is None:
        return None
    on = ctx.snapshot.day_of(dest)
    if on is None:
        return None
    slots = ctx.snapshot.on(on)
    idx = next(i for i, s in enumerate(slots) if s.slot_key == dest.slot_key)
    if idx == 0:
        return None
    prev = slots[idx - 1]
    origin_said = ctx.arguments.get("origin")
    if origin_said:  # 출발지를 말했는데 직전 장소가 아니면 적힌 거리는 묻는 구간의 것이 아니다
        origin = resolve_slot(ctx.snapshot, day=None, target=origin_said, now=ctx.now, tz=ctx.tz)
        if origin is None or origin.slot_key != prev.slot_key:
            return None
    return on, prev, dest


def _transport_mode(ctx: TurnContext) -> tuple[str, bool]:
    """(수단, 기본값을 썼는가). 발화에 수단이 거의 없어 호출측이 PUBLIC 을 채운다 — 채운 사실은 notes 로 남긴다(인자표 註)."""
    said = ctx.arguments.get("mode")
    return (said, False) if said in {m.value for m in TransportMode} else (TransportMode.PUBLIC.value, True)


@dataclass(frozen=True, slots=True)
class _End:
    """일정 밖 구간의 한 끝 — 일정 슬롯·지역 중심(표)·등록 장소(이름 완전 일치) 중 하나. label 은 일정·표·DB 값(발화 원문 아님)."""

    label: str
    poi_id: str | None = None
    center: GeoPoint | None = None  # 지역 중심 — 근사(그 지역의 한 점)


def _known_end(ctx: TurnContext, said: str) -> _End | None:
    """I/O 없이 풀리는 끝 — 일정 슬롯이 먼저, 그다음 지역 표("강남"·"홍대"). 등록 장소 찾기는 콜러블 안에서."""
    slot = resolve_slot(ctx.snapshot, day=None, target=said, now=ctx.now, tz=ctx.tz)
    if slot is not None and slot.poi_id:
        return _End(slot.name or _UNNAMED, slot.poi_id)
    hit = region_center(normalize(said))
    return _End(hit[0], None, hit[1]) if hit else None


def _plan_free_distance(ctx: TurnContext) -> tuple[HandlerTask, ...]:
    """일정 밖 구간("강남에서 홍대 어떻게 가?", 일정의 떨어진 두 곳) — 출발지·목적지를 둘 다 말했을 때만. 거리만(INV-3)."""
    said = ctx.arguments.get("origin"), ctx.arguments.get("destination")
    transit, finder = ctx.ports.transit, ctx.ports.place_sql
    if not all(said) or transit is None:
        return ()
    known = tuple(_known_end(ctx, s) for s in said)
    if None in known and finder is None:
        return ()
    mode, _ = _transport_mode(ctx)
    sido = _trip_sido(ctx)

    def fn() -> dict:
        ends: list[_End] = []
        for text, end in zip(said, known):
            if end is None:
                found = finder.find_place(text, sido, ctx.trace_id)
                if found is None:  # 없거나 여럿 — 고르지 않는다
                    return {"status": "EMPTY", "reason": "place_not_found"}
                end = _End(found.name, found.poi_id)
            ends.append(end)
        ids = tuple(e.poi_id for e in ends if e.center is None and e.poi_id)
        rows = _lookup(ctx, ids, ctx.today) if ids else {}
        coords = [e.center or _coord(rows.get(e.poi_id)) for e in ends]
        if None in coords:
            return {"status": "UNAVAILABLE", "reason": "coord_unknown"}
        packet = transit.fetch({"origin": coords[0], "destination": coords[1], "mode": mode, "now": ctx.now,
                                "purpose": TransitPurpose.INFO_DISPLAY.value})
        # 거리만 — internal_minutes 는 여기서 떨어진다 (INV-3)
        return {"status": packet.status.value, "distance_range": packet.data.get("distance_range"),
                "confidence": packet.data.get("confidence"), "mode": mode,
                "ends": [{"label": e.label, "poi_id": e.poi_id, "area": e.center is not None} for e in ends]}

    return (HandlerTask("transit", fn),)


def _plan_distance(ctx: TurnContext) -> tuple[HandlerTask, ...]:
    leg = _distance_leg(ctx)
    transit = ctx.ports.transit
    if leg is None:
        return _plan_free_distance(ctx)
    if transit is None or ctx.ports.poi_info is None:
        return ()
    on, prev, dest = leg
    if not (prev.poi_id and dest.poi_id):
        return ()
    mode, _ = _transport_mode(ctx)

    def fn() -> dict:
        rows = _lookup(ctx, (prev.poi_id, dest.poi_id), on)
        origin, destination = _coord(rows.get(prev.poi_id)), _coord(rows.get(dest.poi_id))
        if origin is None or destination is None:
            return {"status": "UNAVAILABLE", "reason": "coord_unknown"}
        packet = transit.fetch({"origin": origin, "destination": destination, "mode": mode, "now": ctx.now,
                                "purpose": TransitPurpose.INFO_DISPLAY.value})
        # 거리만 — 패킷의 internal_minutes 는 여기서 떨어진다 (INV-3, TransitInfo.to_public_dict 와 같은 자름)
        return {"status": packet.status.value, "distance_m": packet.data.get("distance_m"),
                "distance_range": packet.data.get("distance_range"), "confidence": packet.data.get("confidence"), "mode": mode}

    return (HandlerTask("transit", fn),)


def _assemble_free_distance(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
    intent = Intent.GET_DISTANCE
    value = _value(results, "transit")
    ends = value.get("ends") if isinstance(value, Mapping) else None
    if not (isinstance(ends, list) and len(ends) == 2):
        return _text_facts(intent, FactStatus.EMPTY, (_action("OPEN_ITINERARY"),), notes=(_UNRESOLVED_LEG,))
    origin, dest = ends
    mode, assumed = _transport_mode(ctx)
    notes = (f"이동 수단 가정: {mode}",) if assumed else ()
    detail = {"origin": origin["label"], "destination": dest["label"], "mode": mode}
    distance = value.get("distance_range") if value.get("status") == "OK" else None
    if not isinstance(distance, str) or not distance:
        return _text_facts(intent, FactStatus.UNAVAILABLE, (_action("OPEN_ITINERARY"),), notes=notes + ("거리 미확인",), detail=detail)
    if value.get("confidence") == "LOW":
        distance = f"{distance}(추정)"
        notes = notes + ("거리는 실제 경로가 아니라 직선 거리로 어림한 값",)
    if origin.get("area") or dest.get("area"):
        distance = f"{distance}(지역 중심 기준)"
        notes = notes + ("지역 이름은 그 지역 중심 한 점으로 잰 어림값",)
    rows = (FactRow("구간", distance),)
    places = tuple(FactPlace(e["poi_id"], e["label"], None, distance_range=distance if e is dest else None)
                   for e in ends if e.get("poi_id"))
    actions = (_action("OPEN_PLACE", poiId=dest["poi_id"]),) if dest.get("poi_id") else (_action("OPEN_ITINERARY"),)
    return Facts(
        intent, FactStatus.OK, AnswerKind.INFO, rows=rows, places=places, notes=notes,
        payload=_info("DISTANCE", dest["label"], rows), next_actions=actions, quick_replies=(),
        template_text=_template(intent, FactStatus.OK), detail=detail,
    )


def _assemble_distance(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
    intent = Intent.GET_DISTANCE
    leg = _distance_leg(ctx)
    if leg is None:
        return _assemble_free_distance(ctx, results)
    on, prev, dest = leg
    mode, assumed = _transport_mode(ctx)
    notes = (f"이동 수단 가정: {mode}",) if assumed else ()
    detail = {"origin": prev.name, "destination": dest.name, "mode": mode}
    value = _value(results, "transit")
    distance = value.get("distance_range") if value is not None and value.get("status") == "OK" else None
    if not isinstance(distance, str) or not distance:
        return _text_facts(intent, FactStatus.UNAVAILABLE, (_action("OPEN_ITINERARY"),), notes=notes + ("거리 미확인",), detail=detail)
    # 경로 API(ODsay·TMAP)가 빠지면 Provider 는 하버사인×우회계수(confidence LOW)로도 상태 OK 를 낸다 — 경로 거리처럼 보이면
    # "약 3.1km"(실제 경로 5.8km)가 된다(2026-10-19 E2E, 경로 키 일일 한도 초과). LOW 는 추정으로 밝힌다.
    if value.get("confidence") == "LOW":
        distance = f"{distance}(추정)"
        notes = notes + ("거리는 실제 경로가 아니라 직선 거리로 어림한 값",)
    rows = (FactRow("직전 구간", distance),)
    return Facts(
        intent, FactStatus.OK, AnswerKind.INFO, rows=rows,
        places=(FactPlace(prev.poi_id, prev.name or _UNNAMED, prev.category),
                FactPlace(dest.poi_id, dest.name or _UNNAMED, dest.category, distance_range=distance)),
        notes=notes, payload=_info("DISTANCE", dest.name or _UNNAMED, rows), next_actions=(_action("OPEN_ITINERARY"),),
        quick_replies=(), template_text=_template(intent, FactStatus.OK), detail=detail,
    )


# GET_POI_INFO — 일정 안의 슬롯이 먼저(이름·분류는 일정 값), 못 풀면 등록 장소를 이름으로(완전 일치, `place_sql.find_place`).
# 영업시간·입장료는 어느 쪽이든 장소 정본(PoiInfoProvider, BE QueryCards.place).


def _place_slot(ctx: TurnContext) -> SlotView | None:
    said = ctx.arguments.get("place")
    if not said:
        return None
    return resolve_slot(ctx.snapshot, day=ctx.arguments.get("date"), target=said, now=ctx.now, tz=ctx.tz)


def _trip_sido(ctx: TurnContext) -> str | None:
    """여행 지역 중 시·도 급 이름 — 이름 찾기에서 같은 이름이 여럿일 때 좁히는 데만 쓴다."""
    trip = ctx.snapshot.trip
    hits = (region_center(normalize(name)) for name in (trip.regions if trip is not None else ()))
    return next((h[0] for h in hits if h is not None and h[0] in _SIDO_LEVEL), None)


def _outside_day(ctx: TurnContext) -> date:
    said = ctx.arguments.get("date")
    return (resolve_day(said, ctx.snapshot, ctx.today) if said else None) or ctx.today


# 영업시간·요금을 묻는 말 — 이때는 소개를 붙이지 않는다(답에 소개가 섞이면 묻지 않은 말이 늘어난다)
_HOURS_FEE = re.compile(r"영업|시간|몇\s?시|열어|열려|여는|닫|입장료|요금|가격|얼마|휴무|쉬는|쉬어|주차")


def _intro_for(ctx: TurnContext, packet: Mapping[str, object], poi_id: str) -> str:
    """장소 소개 한 조각(KB-5) — 소개를 물을 때만(영업시간·요금 질문이면 빈 문자열). 조인 키는 POI_INFO 행의 source_ref."""
    port, aspect = ctx.ports.place_intro, ctx.arguments.get("aspect") or ""
    if port is None or _HOURS_FEE.search(aspect) or _HOURS_FEE.search(ctx.utterance):
        return ""
    data = packet.get("data") if isinstance(packet, Mapping) else None
    pois = data.get("pois", ()) if isinstance(data, Mapping) else ()
    ref = next((p.get("source_ref") for p in pois if isinstance(p, Mapping) and p.get("poi_id") == poi_id), None)
    if not ref:
        return ""
    try:
        return port.intro(str(ref), aspect or "소개")
    except Exception:  # noqa: BLE001 — 부가 정보라 없이 간다(INV-4), 사유는 PlaceIntro 가 남긴다
        return ""


def _plan_poi_info(ctx: TurnContext) -> tuple[HandlerTask, ...]:
    slot = _place_slot(ctx)
    port = ctx.ports.poi_info
    if port is None:
        return ()
    if slot is not None:
        if slot.poi_id is None:
            return ()
        on = ctx.snapshot.day_of(slot) or ctx.today

        def fn() -> dict:
            packet = port.fetch({"poi_ids": frozenset({PoiId(slot.poi_id)}), "on": on, "now": ctx.now}).to_dict()
            return {**packet, "intro": _intro_for(ctx, packet, slot.poi_id)}

        return (HandlerTask("poi_info", fn),)
    said, finder = ctx.arguments.get("place"), ctx.ports.place_sql
    if not said or finder is None:
        return ()
    on, sido = _outside_day(ctx), _trip_sido(ctx)

    def find() -> dict:
        found = finder.find_place(said, sido, ctx.trace_id)
        if found is None:  # 없거나 여럿(체인점) — 하나를 골라 다른 곳의 영업시간을 말하지 않는다
            return {"status": "EMPTY", "reason": "place_not_found"}
        packet = port.fetch({"poi_ids": frozenset({PoiId(found.poi_id)}), "on": on, "now": ctx.now}).to_dict()
        return {**packet, "lookup": {"poi_id": found.poi_id, "name": found.name, "category": found.category},
                "intro": _intro_for(ctx, packet, found.poi_id)}

    return (HandlerTask("poi_info", find),)


def _fee_label(fee: object) -> str:
    if fee is None:
        return _UNKNOWN
    return "무료" if fee == 0 else f"{int(fee):,}원"


def _assemble_poi_info(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
    intent = Intent.GET_POI_INFO
    slot = _place_slot(ctx)
    value = _value(results, "poi_info")
    lookup = value.get("lookup") if slot is None and isinstance(value, Mapping) else None
    if slot is None and not isinstance(lookup, Mapping):
        return _text_facts(intent, FactStatus.EMPTY, (_action("OPEN_ITINERARY"),), notes=(_UNRESOLVED,))
    # 일정 밖이면 이름·분류·poi_id 는 등록 장소(DB) 값 — 발화 원문이 아니다(INV-1·INV-2)
    poi_id = slot.poi_id if slot is not None else str(lookup["poi_id"])
    row = None
    if _fresh(value):
        row = next((p for p in value.get("data", {}).get("pois", ()) if p.get("poi_id") == poi_id), None)
    known = slot.category if slot is not None else lookup.get("category")
    category = known or (_CATEGORY_KO.get(str(row["category"]), str(row["category"])) if row else None)
    hours = row.get("hours_label") if row else None
    if row is not None and "hours_label" in row and hours is None:
        hours = _CLOSED  # "미확인"으로 뭉개면 "오늘 영업 여부는 확인할 수 없어요"가 된다(2026-10-19 E2E: 제주문학관 월요일)
    fee = row.get("fee") if row else None
    # 영업시간은 이 날 기준(_plan_poi_info 와 같은 날) — 오늘이 아니면 날짜를 밝힌다
    on = (ctx.snapshot.day_of(slot) if slot is not None else _outside_day(ctx)) or ctx.today
    rows = ((FactRow("날짜", _date_label(on)),) if on != ctx.today else ()) + (
        FactRow("분류", category or _UNKNOWN), FactRow("영업시간", hours or _UNKNOWN), FactRow("입장료", _fee_label(fee)))
    name = (slot.name if slot is not None else str(lookup.get("name") or "")) or (str(row["name"]) if row else _UNNAMED)
    status, notes = (FactStatus.OK, ()) if row else (FactStatus.PARTIAL, ("장소 정보 미확인 — 일정 값만 보인다",))
    if slot is None:
        notes = notes + ("일정 밖 장소 — 등록 장소에서 이름으로 찾았다",)
    actions = (_action("OPEN_PLACE", poiId=poi_id),) if poi_id else (_action("OPEN_ITINERARY"),)
    # 소개(KB-5)는 카드(payload)에 싣지 않고 답변 재료로만 — 위키 원문을 그대로 보이면 출처 표기가 걸린다(place_intro 註)
    intro = value.get("intro") if isinstance(value, Mapping) else None
    detail = {"target": name, **({"intro": intro} if isinstance(intro, str) and intro else {})}
    return Facts(
        intent, status, AnswerKind.INFO, rows=rows,
        places=(FactPlace(poi_id, name, category, hours_label=hours, fee=fee if isinstance(fee, int) else None),),
        notes=notes, payload=_info("PLACE", name, rows), next_actions=actions, quick_replies=(),
        template_text=_template(intent, status), detail=detail,
    )


# SUGGEST_ALTERNATIVE — POI_INFO(대상 좌표) → 풀 조립 → WEATHER → PlanBAgent.run, 한 스레드 체인 (BLM §6 — 풀은 한 번만 꺼낸다)


def _alt_target(ctx: TurnContext) -> SlotView | None:
    said = ctx.arguments.get("target")
    if not said:
        return None
    return resolve_slot(ctx.snapshot, day=None, target=said, now=ctx.now, tz=ctx.tz)


# '먹을 곳을 달라'(2026-10-19 결정 3) — 식사 칸이 아니어도 식사 후보로. **오탐보다 미탐**(미탐은 식당 아닌 대안 — 종전과 같다):
# "밥 먹고 갈 만한 데"는 식후에 갈 곳이라 '먹고'·'식사하고'는 잡지 않고, "맛집 말고"는 부정이다(#1366 날씨 사유 오탐과 같은 꼴).
_WANTS_FOOD = re.compile(r"먹을\s?(데|곳|거|만한)|식당|맛집|밥집|음식점|식사\s?할|끼니|배고프|배고파")
_NOT_FOOD = re.compile(r"(식당|맛집|밥집|음식점)\s?(은|는|이|가)?\s?(말고|빼고|제외|아니|싫)")


def _wants_food(*said: object) -> bool:
    return any(isinstance(s, str) and _WANTS_FOOD.search(s) and not _NOT_FOOD.search(s) for s in said)


# SUGGEST_ALTERNATIVE 의 reason 슬롯은 한글 자유문("오늘 휴관")이라 `_REASON_KO` 키와 같을 때만 넘기면 늘 none 이었다(2026-10-19
# E2E — 휴관 대신 찾기가 사유 없이 돌았다). 앞에서부터 첫 일치. **오탐보다 미탐**(미탐은 지금처럼 none): weather 는 PlanB 가
# 야외 후보를 내리는 유일한 사유라 오탐이 순위를 바꾼다 — "주차비가 비싸서"·"준비가"의 비, "날씨 좋으니까", "비가 안 와서"를
# 날씨로 읽지 않게 낱말 경계·말꼴로 적는다(셀프 리뷰 실측). 휴관이 날씨보다 앞이다("비 와서 문 닫았대"는 그곳이 닫힌 것이 사유).
_REASON_WORDS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("closed", re.compile(r"휴관|휴무|휴업|휴점|폐관|폐점|폐업|문\s?닫|영업\s?(안|종료|마감)|안\s?열|쉬는\s?날|정기\s?휴일")),
    ("fully_booked", re.compile(r"예약이?\s?마감|매진|만석|꽉\s?찼|자리가?\s?없")),
    ("canceled", re.compile(r"예약이?\s?취소|취소\s?(됐|되)")),
    ("weather", re.compile(r"(?<![가-힣])(비|눈)(가|이)?\s?(와|온|오|내리|내려|올|소식|예보|많이|계속)|우천|소나기|폭우|폭설|태풍|강풍"
                           r"|폭염|한파|미세\s?먼지|날씨가?\s?(안\s?좋|나빠|나쁘|궂|별로)")),
    ("delay", re.compile(r"늦(어|었|잠)|늦게\s?일어|지연|막혀|밀려")),
    ("fatigue", re.compile(r"피곤|지쳐|지쳤|다리\s?아|체력|쉬고\s?싶|컨디션|몸이\s?안\s?좋")),
)


def _planb_reason(said: object) -> str:
    """발화에서 뽑힌 대체 사유 → PlanB 어휘(`_REASON_KO` 키). 모르면 "none"(사용자 요청 교체)."""
    if not isinstance(said, str):
        return "none"
    text = said.strip()
    if text in _REASON_KO:
        return text
    return next((key for key, pattern in _REASON_WORDS if pattern.search(text)), "none")


def _plan_alternatives(ctx: TurnContext) -> tuple[HandlerTask, ...]:
    target = _alt_target(ctx)
    builder, planb, trip = ctx.ports.pool_builder, ctx.ports.planb, ctx.snapshot.trip
    if target is None or target.poi_id is None or builder is None or planb is None or ctx.ports.poi_info is None or trip is None:
        return ()
    on = ctx.snapshot.day_of(target) or ctx.today
    excluded = frozenset(PoiId(s.poi_id) for _, s in ctx.snapshot.slots() if s.poi_id)  # 일정 전부 (INV-1 — 있는 곳은 대안이 아니다)
    # LLM 슬롯 `reason` 은 스펙이 `choices=()` 라 IntentGate 가 값을 거르지 않는다 — PlanB 가 아는 어휘(`_REASON_KO` 키)로 사상해 넘긴다.
    # ponytail: 인자표에 choices 를 채우는 것이 바른 자리지만 `$intents` 가 바뀌어 intent.yaml 재생 픽스처가 전건 미스다(BR-AO-14).
    reason = _planb_reason(ctx.arguments.get("reason"))
    wants_food = _wants_food(ctx.arguments.get("constraint"), ctx.arguments.get("reason"))
    weather = ctx.ports.weather

    def fn() -> dict:
        anchor = _coord(_lookup(ctx, (target.poi_id,), on).get(target.poi_id))
        if anchor is None:
            return {"status": "UNAVAILABLE", "reason": "anchor_coord_unknown"}
        try:
            pool = builder.build(CandidatePoolRequest(anchor=anchor, dates=(on,), budget=BudgetLevel.MID,
                                                      transport=TransportMode.PUBLIC), ctx.now)
        except Exception as e:  # 풀 조립은 Provider 가 아니라 상태값 계약이 없다 — 여기서 수렴 (DL-5)
            return {"status": "UNAVAILABLE", "reason": f"pool_error:{type(e).__name__}"}  # 메시지는 싣지 않는다(키 든 URL)
        pool, _ = restrict_pool_to_target_role(pool, target.poi_id, excluded, wants_food=wants_food)
        same = next((p.category for p in pool.pois if str(p.poi_id) == target.poi_id), None)
        rain: dict[date, int] = {}
        if weather is not None:
            packet = weather.fetch({"anchor": anchor, "days": (on,), "now": ctx.now})
            pop = packet.data.get("daily", {}).get(on.isoformat()) if packet.status.value in ("OK", "LOW") else None
            if pop is not None:
                rain[on] = int(pop)
        result = planb.run(PlanBRagRequest(
            trigger=TriggerParams(TriggerKind.MANUAL, ScheduleId(trip.trip_id), on, {}),
            reason=reason, pool=pool, trace_id=ctx.trace_id, now=ctx.now, excluded_poi_ids=excluded,
            deadline_ms=max(ctx.remaining_ms(), 0) or None, rain_prob_by_date=rain, use_llm=False,
        ))
        if result.empty_reason == "pipeline_error":  # KB·DB 장애 — "대안이 없다"(EMPTY)가 아니라 "확인할 수 없다"다
            return {"status": "UNAVAILABLE", "reason": "planb_pipeline_error"}
        by_id = {str(p.poi_id): p for p in pool.pois}
        candidates: list[dict] = []
        for alt in result.alternatives:  # 풀 안의 것만 — PlanB 가 이미 그렇게 고르지만 이름·좌표도 풀에서 읽는다
            for pid in alt.poi_ids:
                poi = by_id.get(str(pid))
                if poi is None or any(c["poi_id"] == str(pid) for c in candidates):
                    continue
                candidates.append({"poi_id": str(pid), "name": poi.name, "category": _CATEGORY_KO.get(poi.category.value),
                                   "distance_range": _km_label(haversine_km(anchor, poi.coord)), "reason": CANDIDATE_REASON})
        candidates.sort(key=lambda c: by_id[c["poi_id"]].category is not same)  # 같은 분류 먼저(결정 3) — 안정 정렬, 그 안은 PlanB 순서
        return {"status": "OK", "candidates": candidates[:MAX_CANDIDATES], "notes": list(result.notes),
                "empty_reason": result.empty_reason}

    return (HandlerTask("alternatives", fn),)


def _km_label(km: float) -> str:
    # ponytail: 직선거리다 — 실 경로 거리(wiring._render_distance 는 TravelPort 호출)는 후보마다 외부 호출이 늘어 팬아웃
    # 예산(≤3s)에 들지 않는다. "약" 이 붙은 어림값이고 소요시간은 없다(INV-3).
    return _format_distance_range((km, km))


def _assemble_alternatives(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
    intent = Intent.SUGGEST_ALTERNATIVE
    target = _alt_target(ctx)
    if target is None:
        return _text_facts(intent, FactStatus.EMPTY, (_action("OPEN_ITINERARY"),), notes=(_UNRESOLVED,))
    name = target.name or _UNNAMED
    detail = {"target": name}
    value = _value(results, "alternatives")
    if value is None or value.get("status") != "OK":
        return _text_facts(intent, FactStatus.UNAVAILABLE, (_action("OPEN_ITINERARY"),), notes=("대안 미확인",), detail=detail, target=name)
    candidates = [c for c in value.get("candidates", ()) if isinstance(c, Mapping)][:MAX_CANDIDATES]
    notes = tuple(str(n) for n in value.get("notes", ()))
    if not candidates:
        reason = value.get("empty_reason")
        return _text_facts(intent, FactStatus.EMPTY, (_action("OPEN_ITINERARY"),),
                           notes=notes + ((f"empty_reason: {reason}",) if reason else ()), detail=detail, target=name)
    payload = {"candidates": [{"poiId": c["poi_id"], "name": c["name"], "distanceRange": c.get("distance_range"),
                               "reason": c["reason"]} for c in candidates]}
    quick = tuple(QuickReplyDraft(_clip(c["name"]), "PICK_CANDIDATE", {"poiId": c["poi_id"], "slotKey": target.slot_key})
                  for c in candidates)
    places = tuple(FactPlace(c["poi_id"], c["name"], c.get("category"), distance_range=c.get("distance_range"),
                             reason=c["reason"]) for c in candidates)
    return Facts(
        intent, FactStatus.OK, AnswerKind.CANDIDATES, rows=(), places=places, notes=notes, payload=payload,
        next_actions=(_action("OPEN_ITINERARY"),), quick_replies=quick,
        template_text=_template(intent, FactStatus.OK, target=name), detail=detail,
    )


# EXPLORE_PLACES — 지역(또는 일정 근처) 반경의 등록 POI 풀 → 결정론 정렬 → 상위 ≤5 (INV-1: 이름·좌표는 풀에서만)
# 앵커 순서: 발화 region(지역 중심 표) → 일정 슬롯(다음 일정, 없으면 첫 일정 — 좌표는 POI_INFO 조회) → 여행 목적지 이름(지역 표).
# 셋 다 없으면 지역을 묻는 고정 문장. region 을 말했는데 표에 없으면 EMPTY — 다른 곳(여행 목적지)으로 바꿔 찾지 않는다.

_NEAR_SLOT_KM = 3.0  # 일정 근처 탐색 반경
_FANOUT_SQL_CAP_S, _SQL_MIN_S = 2.8, 0.8  # NL2SQL LLM 시한 상한·하한 — 하한보다 적게 남으면 반경 탐색만
# 시·도 급 지역 표 이름 — NL2SQL 결과를 이 시·도로 다시 거른다(분류 인자가 이긴다: 계획 경로에서 한 발화가 도구 둘로 나뉘면 발화의
# 다른 지역을 SQL 이 읽을 수 있다 — "부산 실내 갈 데랑 서울 맛집"의 부산 몫이 서울을 찾지 않게). 구·동 급은 행의 시도로 못 가른다.
_SIDO_LEVEL = frozenset({"서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "제주"})
_PER_CATEGORY = 2  # 종류를 안 정했을 때 한 종류가 후보를 다 차지하지 않게(서울 반경 풀의 89% 가 FOOD — pool_builder._fair_cut 註)
# 밤·야경 주제 — 이때만 나이트라이프 태그 장소를 권한다(평소엔 기회 카드와 같이 뺀다, opportunity._eligible)
_NIGHT = re.compile(r"야경|야간|밤|나이트|(?<![가-힣])바(?![가-힣])|술집|펍|클럽|칵테일|와인|이자카야")
_THEME_WORD = re.compile(r"[가-힣A-Za-z]{2,}")
# 구경·관광·놀거리 주제 — 종류를 안 정했으면 식당을 뺀다("가볼 만한 곳"에 기사식당이 섞였다 · 계획 경로 "실내 데이트할 곳"에
# 몸국·반점이 섞였다, 2026-10-20 테스트 화면·실 스택 E2E). 먹을 곳을 말하면 분류가 category=FOOD 를 채우므로 여기 안 온다.
_SIGHTSEEING = re.compile(r"가\s?볼|구경|볼거리|관광|명소|놀러|둘러|놀\s?거리|할\s?거리|실내|데이트")


@dataclass(frozen=True, slots=True)
class _Anchor:
    label: str  # 사용자 문장 재료 — 지역 이름·슬롯 이름
    kind: str  # region | itinerary
    center: GeoPoint | None  # None = 슬롯 좌표를 콜러블 안에서 조회한다
    radius_km: float
    slot: SlotView | None = None


def _explore_anchor(ctx: TurnContext) -> _Anchor | None:
    said = ctx.arguments.get("region")
    if said:
        hit = region_center(normalize(said))
        return _Anchor(hit[0], "region", hit[1], hit[2]) if hit else None
    if ctx.ports.poi_info is not None:
        found = next_slot_after(ctx.snapshot, ctx.now, ctx.tz)
        slot = found[1] if found else next((s for _, s in ctx.snapshot.slots() if s.poi_id), None)
        if slot is not None and slot.poi_id:
            return _Anchor(slot.name or _UNNAMED, "itinerary", None, _NEAR_SLOT_KM, slot)
    trip = ctx.snapshot.trip
    for name in trip.regions if trip is not None else ():
        hit = region_center(normalize(name))
        if hit:
            return _Anchor(hit[0], "region", hit[1], hit[2])
    return None


def explore_needs_region(ctx: TurnContext) -> bool:
    """지역을 되물어야 하는가 — 발화에 지역이 없고 일정·여행 목적지로도 앵커를 못 잡을 때만(인자표 required 로는 못 적는 조건)."""
    return not ctx.arguments.get("region") and _explore_anchor(ctx) is None


def _explore_rank(pois: Iterable[Poi], category: str | None, theme: str | None) -> list[Poi]:
    """결정론 정렬 — 주제 맞음(밤·야경 주제면 야경·나이트라이프) → 주제 낱말이 태그·이름에 든 수 → '요즘 인기' 태그 →
    저장 수 → 별점 → 영업시간 보유 → poi_id. 숙소·표시 불가 이름은 뺀다."""
    night = bool(theme and _NIGHT.search(theme)) or category == PoiCategory.NIGHT_VIEW.value
    words = tuple(_THEME_WORD.findall(theme or ""))
    themes = frozenset(themes_in(theme))   # "혼자 가기 좋은"·"아이랑" → 혼밥·혼술·아이동반 (태그 글자와 안 맞는 말을 잇는다)
    no_food = category is None and bool(theme and _SIGHTSEEING.search(theme))

    def fits(p: Poi) -> bool:
        return (p.category is not PoiCategory.STAY and (category is None or p.category.value == category)
                and (night or NIGHTLIFE_TAG not in p.tags) and _displayable(p.name) and not (no_food and counts_as_food(p)))

    def key(p: Poi) -> tuple:
        is_night = p.category is PoiCategory.NIGHT_VIEW or NIGHTLIFE_TAG in p.tags
        hits = sum(1 for w in words if w in p.name or any(w in t for t in p.tags)) + len(themes & set(p.tags))
        # 평판(인기·평점높음)은 저장 수 뒤, 별점 앞 — 저장 수가 0 인 지금은 사실상 첫 기준이다. 태그가 없으면 0 이라 불이익이 없다
        return (night and not is_night, -hits, TRENDING_TAG not in p.tags, -p.saved_count, -reputation_bonus(p.tags), -(p.rating or 0.0),
                0 if p.open_hours else 1, str(p.poi_id))

    picked: list[Poi] = []
    per: dict[PoiCategory, int] = {}
    for p in sorted(filter(fits, pois), key=key):
        if category is None and per.get(p.category, 0) >= _PER_CATEGORY:
            continue
        picked.append(p)
        per[p.category] = per.get(p.category, 0) + 1
        if len(picked) == MAX_CANDIDATES:
            break
    return picked


def _explore_by_sql(ctx: TurnContext, anchor: _Anchor | None, category: str | None, theme: str | None) -> HandlerTask:
    """NL2SQL 탐색 작업 — 반경 탐색과 나란히 돈다(팬아웃). 행은 등록 POI 의 보여 줄 칸뿐(`PlaceRow`, INV-1).
    거리는 싣지 않는다(지역 탐색은 지역 중심에서의 거리가 뜻이 없다 — 반경 경로와 같다). 앵커가 없으면(지역 표에 없는 동네·구)
    행의 구군 이름(DB 값)을 앵커로 쓴다 — 발화 원문은 사실 칸에 싣지 않는다(INV-2)."""
    port = ctx.ports.place_sql
    args = {k: v for k, v in (("region", ctx.arguments.get("region")), ("theme", theme),
                              ("category", _CATEGORY_KO.get(category or "", category))) if v}
    night = bool(theme and _NIGHT.search(theme)) or category == PoiCategory.NIGHT_VIEW.value
    sido = anchor.label if anchor is not None and anchor.kind == "region" and anchor.label in _SIDO_LEVEL else None

    def fn() -> dict:
        budget = min(_FANOUT_SQL_CAP_S, ctx.remaining_ms() * 0.4 / 1000)  # 팬아웃 예산(오케스트레이터 min(3s, 잔여×0.4)) 안
        if budget < _SQL_MIN_S:
            return {"status": "UNAVAILABLE", "reason": "budget"}
        rows = port.lookup(ctx.utterance, args, ctx.trace_id, ctx.now, timeout_sec=budget)
        if rows is None:
            return {"status": "UNAVAILABLE", "reason": "place_sql"}
        picked = [r for r in rows if _displayable(r.name) and (night or not r.nightlife)
                  and (sido is None or (r.sido or "").startswith(sido))][:MAX_CANDIDATES]
        areas = Counter(r.sigungu for r in picked if r.sigungu).most_common(1)
        label = anchor.label if anchor is not None else (areas[0][0] if areas else None)
        return {"status": "OK", "anchor": label, "candidates": [{
            "poi_id": r.poi_id, "name": r.name, "category": r.category, "distance_range": None,
            "reason": "요즘 인기" if r.trending else r.category,
        } for r in picked]}

    return HandlerTask("explore_sql", fn)


def _plan_explore(ctx: TurnContext) -> tuple[HandlerTask, ...]:
    anchor, builder = _explore_anchor(ctx), ctx.ports.pool_builder
    category, theme = ctx.arguments.get("category"), ctx.arguments.get("theme")
    # NL2SQL 은 사용자가 지역을 말했을 때만 — 일정 근처 탐색은 거리가 핵심이라 반경 풀이 맞다(뷰에 좌표가 없다)
    # 발화가 없어도(계획 경로 — 인자만 넘어온다) 인자로 SQL 을 쓴다. 발화는 보조 재료이고 지역·종류·주제는 인자가 이긴다
    sql = (_explore_by_sql(ctx, anchor, category, theme),) if (
        ctx.ports.place_sql is not None and ctx.ports.place_sql.writes_sql and ctx.arguments.get("region")) else ()
    if anchor is None or builder is None:
        return sql

    def fn() -> dict:
        center = anchor.center
        if center is None:  # 일정 근처 — 그 슬롯 날짜 기준으로 좌표만 읽는다
            on = ctx.snapshot.day_of(anchor.slot) or ctx.today
            center = _coord(_lookup(ctx, (anchor.slot.poi_id,), on).get(anchor.slot.poi_id))
            if center is None:
                return {"status": "UNAVAILABLE", "reason": "anchor_coord_unknown"}
        try:
            pool = builder.build(CandidatePoolRequest(anchor=center, dates=(ctx.today,), budget=BudgetLevel.HIGH,
                                                      transport=TransportMode.PUBLIC, radius_override_km=anchor.radius_km),
                                 ctx.now)
        except Exception as e:  # 풀 조립은 상태값 계약이 없다 — 여기서 수렴 (DL-5), 메시지는 싣지 않는다(키 든 URL)
            return {"status": "UNAVAILABLE", "reason": f"pool_error:{type(e).__name__}"}
        candidates = [{
            "poi_id": str(p.poi_id), "name": p.name, "category": _CATEGORY_KO.get(p.category.value),
            # 지역 중심에서의 거리는 사용자에게 뜻이 없다 — 일정 근처일 때만 그 일정에서의 거리를 싣는다(INV-3 거리만)
            "distance_range": _km_label(haversine_km(center, p.coord)) if anchor.kind == "itinerary" else None,
            "reason": "요즘 인기" if TRENDING_TAG in p.tags else (_CATEGORY_KO.get(p.category.value) or "가 볼 만한 곳"),
        } for p in _explore_rank(pool.pois, category, theme)]
        return {"status": "OK", "candidates": candidates}

    return (HandlerTask("explore", fn), *sql)


def _assemble_explore(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
    intent = Intent.EXPLORE_PLACES
    home = (_itinerary_action(ctx.snapshot),) if ctx.snapshot.trip is not None else (_action("CREATE_TRIP"),)
    said = ctx.arguments.get("region")
    anchor = _explore_anchor(ctx)
    # NL2SQL 결과가 있으면 그것을 쓴다(지역 표에 없는 동네·구도 찾는다) — 실패·0건이면 반경 탐색 결과(INV-4)
    by_sql = _value(results, "explore_sql")
    if not (by_sql and by_sql.get("status") == "OK" and by_sql.get("candidates")):
        by_sql = None
    if anchor is None and by_sql is not None and by_sql.get("anchor"):
        anchor = _Anchor(by_sql["anchor"], "region", None, 0.0)
    if anchor is None and said:  # 말한 지역이 표에 없다 — 없는 곳이 아니라 "아직 못 찾는 지역"이다
        # 발화 원문은 사실 칸에 싣지 않는다 — 시각 허용 집합(INV-2)이 Facts 를 보고, 답변 프롬프트는 발화를 따로 받는다
        return _text_facts(intent, FactStatus.EMPTY, home, notes=("지역 미확인 — 그 지역은 아직 찾아 줄 수 없다(없다는 뜻이 아니다)",))
    if anchor is None:  # 앵커가 하나도 없다 — 지역을 묻는다 (사실 없음 → LLM 없이 이 문장 그대로, BR-AO-25)
        return Facts(intent, FactStatus.EMPTY, AnswerKind.TEXT, rows=(), places=(), notes=(), payload=None,
                     next_actions=home, quick_replies=(), template_text=EXPLORE_ASK_REGION_TEXT)
    # theme(발화 자유문)은 싣지 않는다 — "22:00 이후 야경"의 시각이 Facts 시각으로 허용된다(INV-2). 답변 프롬프트는 발화를 따로 받는다
    detail = {"anchor": anchor.label, "anchor_kind": anchor.kind}
    value = by_sql or _value(results, "explore")
    if value is None or value.get("status") != "OK":
        return _text_facts(intent, FactStatus.UNAVAILABLE, home, notes=("장소 탐색 미확인",), detail=detail)
    candidates = [c for c in value.get("candidates", ()) if isinstance(c, Mapping)][:MAX_CANDIDATES]
    if not candidates:
        return _text_facts(intent, FactStatus.EMPTY, home, notes=("조건에 맞는 등록 장소 없음",), detail=detail)
    payload = {"candidates": [{"poiId": c["poi_id"], "name": c["name"], "distanceRange": c.get("distance_range"),
                               "reason": c["reason"]} for c in candidates]}
    places = tuple(FactPlace(c["poi_id"], c["name"], c.get("category"), distance_range=c.get("distance_range"),
                             reason=c["reason"]) for c in candidates)
    # 고르기(PICK_CANDIDATE)는 바꿀 슬롯이 있어야 한다 — 탐색엔 없으니 후보마다 장소 보기 버튼으로 연다
    actions = tuple(NextAction("OPEN_PLACE", _clip(c["name"]), {"poiId": c["poi_id"]}) for c in candidates)
    return Facts(intent, FactStatus.OK, AnswerKind.CANDIDATES, rows=(), places=places, notes=(), payload=payload,
                 next_actions=actions, quick_replies=(), template_text=_template(intent, FactStatus.OK), detail=detail)


# 넘기기(handoff) — 화면으로 보낸다. 실행이 아니라 이동이다 (BE IntentDispatcher)


def _handoff_to(intent: Intent, action_type: str) -> Callable[[TurnContext, Mapping[str, TaskResult]], Facts]:
    def assemble(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
        return _text_facts(intent, FactStatus.OK, (_action(action_type),))
    return assemble


def _assemble_replan(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
    """재계획은 여행 중에만 있다 — 그 밖에는 다시 만들기로 (BE IntentDispatcher REPLAN 분기, 문장도 그쪽 것)."""
    trip = ctx.snapshot.trip
    if trip is not None and trip.phase == "IN_TRIP":
        return _text_facts(Intent.REPLAN, FactStatus.OK, (_action("OPEN_REPLAN"),))
    return Facts(Intent.REPLAN, FactStatus.OK, AnswerKind.TEXT, rows=(), places=(), notes=(), payload=None,
                 next_actions=(_action("OPEN_REGENERATE"),), quick_replies=(),
                 template_text=_template(Intent.REGENERATE, FactStatus.OK))


def edit_arguments(ctx: TurnContext) -> dict[str, str]:
    """EDIT_SCHEDULE 은 1단계에서 FRAME 이다(DEC-AO-6) — 인자만 정리한다: `day` 를 읽을 수 있으면 ISO 날짜로
    (BE ProposalCards.targetDate 가 ISO·맨 숫자만 읽는다), 못 읽으면 손대지 않는다. `target` 은 BE `mentioned` 가 푼다."""
    out = dict(ctx.arguments)
    said = out.get("day")
    if said:
        on = resolve_day(said, ctx.snapshot, ctx.today)
        if on is not None:
            out["day"] = on.isoformat()
    return out


# ── 표 ───────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Handler:
    """의도 하나의 처리 계획. `plan`·`assemble` 은 순수 함수(I/O 는 HandlerTask.fn 안에만).

    답변 종류·낼 수 있는 next_action 종류는 선언하지 않는다 — 산출 `Facts` 가 post-init 으로 닫힌 집합을 지키고(AO-P1·P8)
    오케스트레이터는 `plan`·`assemble`·`handoff_frame` 만 읽는다.
    """

    intent: Intent
    plan: Callable[[TurnContext], tuple[HandlerTask, ...]]
    assemble: Callable[[TurnContext, Mapping[str, TaskResult]], Facts]
    handoff_frame: bool = False  # EDIT_SCHEDULE — outcome FRAME (BE 제안 경로), ANSWER 를 내지 않는다
    # 조건부 필수 인자 — 인자표 required 로 못 적는 "이럴 때만 묻는다"(EXPLORE_PLACES 의 region). (인자 이름, 고정 문안) 또는 None
    ask: Callable[[TurnContext], tuple[str, str] | None] | None = None


def _handler(
    intent: Intent,
    assemble: Callable[[TurnContext, Mapping[str, TaskResult]], Facts],
    plan: Callable[[TurnContext], tuple[HandlerTask, ...]] = _plan_nothing,
    *, handoff_frame: bool = False, ask: Callable[[TurnContext], tuple[str, str] | None] | None = None,
) -> Handler:
    """여행 필수 의도는 여행이 없을 때 플랜 없이 needTrip Facts 로 끝낸다 (BLM §3 4단) — 핸들러마다 따로 적지 않는다."""
    guarded = needs_trip(intent)

    def plan_(ctx: TurnContext) -> tuple[HandlerTask, ...]:
        return () if guarded and ctx.snapshot.trip is None else plan(ctx)

    def assemble_(ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts:
        return need_trip_facts(intent) if guarded and ctx.snapshot.trip is None else assemble(ctx, results)

    return Handler(intent, plan_, assemble_, handoff_frame, ask)


# 넘기기 계열(GENERATE·REGENERATE·REPLAN·회고 3종)은 플랜 없이 한 줄 안내 — 표에 따로 표시하지 않는다(plan 이 비어 있는 것이 그 뜻)
HANDLERS: Mapping[Intent, Handler] = {
    Intent.SHOW_SCHEDULE: _handler(Intent.SHOW_SCHEDULE, _assemble_show_schedule),
    Intent.GET_NEXT_SLOT: _handler(Intent.GET_NEXT_SLOT, _assemble_next_slot),
    Intent.GET_WEATHER: _handler(Intent.GET_WEATHER, _assemble_weather, _plan_weather),
    Intent.GET_DISTANCE: _handler(Intent.GET_DISTANCE, _assemble_distance, _plan_distance),
    Intent.GET_POI_INFO: _handler(Intent.GET_POI_INFO, _assemble_poi_info, _plan_poi_info),
    Intent.SUGGEST_ALTERNATIVE: _handler(Intent.SUGGEST_ALTERNATIVE, _assemble_alternatives, _plan_alternatives),
    Intent.EDIT_SCHEDULE: _handler(Intent.EDIT_SCHEDULE, _handoff_to(Intent.EDIT_SCHEDULE, "OPEN_ITINERARY_EDIT"),
                                   handoff_frame=True),
    Intent.GENERATE_SCHEDULE: _handler(Intent.GENERATE_SCHEDULE, _handoff_to(Intent.GENERATE_SCHEDULE, "OPEN_ITINERARY_METHOD")),
    Intent.REGENERATE: _handler(Intent.REGENERATE, _handoff_to(Intent.REGENERATE, "OPEN_REGENERATE")),
    Intent.REPLAN: _handler(Intent.REPLAN, _assemble_replan),
    Intent.GENERATE_REFLECTION: _handler(Intent.GENERATE_REFLECTION, _handoff_to(Intent.GENERATE_REFLECTION, "OPEN_REFLECTION")),
    Intent.TRIP_SUMMARY: _handler(Intent.TRIP_SUMMARY, _handoff_to(Intent.TRIP_SUMMARY, "OPEN_TRIP_SUMMARY")),
    Intent.STYLE_ANALYSIS: _handler(Intent.STYLE_ANALYSIS, _handoff_to(Intent.STYLE_ANALYSIS, "OPEN_STYLE")),
    Intent.EXPLORE_PLACES: _handler(Intent.EXPLORE_PLACES, _assemble_explore, _plan_explore,
                                    ask=lambda ctx: ("region", EXPLORE_ASK_REGION_TEXT) if explore_needs_region(ctx) else None),
}

if set(HANDLERS) != DIALOGUE_INTENTS:  # 의도가 늘면 기동이 멈춘다 — 조용한 빈칸 금지 (DE §2.4)
    raise ValueError(f"HANDLERS 는 도우미 의도 전수여야 한다: 빠짐 {sorted(i.value for i in DIALOGUE_INTENTS - set(HANDLERS))}")
