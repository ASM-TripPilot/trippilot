"""의도 라우팅 도메인 타입 (intent-matching-design.md §2·§7, orchestrator-delegation-design.md §5).

`Intent`는 라우팅 테이블의 **closed-set 라벨** — 이 enum 밖의 의도는 존재할 수 없다
(INV-1과 동형: intent-matching-design §7 "뱅크·parse_intent 모두 라우팅 테이블 라벨만 반환 가능").

라벨 13종의 근거: `orchestrator-delegation-design.md` §5 라우팅 테이블에서
CONFIRM/CANCEL/UNDO(버튼형 상태 전이 — 자연어 발화 대상 아님)를 제외한 집합.
제외 근거 정본은 `ai/data/README.md` + `intent_question_bank.yaml` 헤더("closed-set 13종").

`OUT_OF_SCOPE`는 라우팅 위임 대상이 아니라 **폴백 전용 라벨**이다 —
3단 매칭이 전부 실패했을 때 Orchestrator Fallback 모드(기본 응답 + 수동 편집 안내, INV-4)로 가는 표식.
`IntentMatch`의 post-init이 "FALLBACK 경로 ⇔ OUT_OF_SCOPE 라벨"을 구조로 강제한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Intent(Enum):
    """라우팅 closed-set 13종 + 폴백 라벨 1종."""

    GENERATE_SCHEDULE = "GENERATE_SCHEDULE"
    REGENERATE = "REGENERATE"
    REPLAN = "REPLAN"
    SUGGEST_ALTERNATIVE = "SUGGEST_ALTERNATIVE"
    GENERATE_REFLECTION = "GENERATE_REFLECTION"
    TRIP_SUMMARY = "TRIP_SUMMARY"
    STYLE_ANALYSIS = "STYLE_ANALYSIS"
    EDIT_SCHEDULE = "EDIT_SCHEDULE"
    GET_NEXT_SLOT = "GET_NEXT_SLOT"
    SHOW_SCHEDULE = "SHOW_SCHEDULE"
    GET_WEATHER = "GET_WEATHER"
    GET_DISTANCE = "GET_DISTANCE"
    GET_POI_INFO = "GET_POI_INFO"
    OUT_OF_SCOPE = "OUT_OF_SCOPE"  # 폴백 전용 — 위임 대상 아님


class RoutingMode(Enum):
    """처리 모드 (README "Orchestrator" 표 + delegation-design §5)."""

    DELEGATE = "DELEGATE"  # 업무 에이전트에 AgentTask 위임
    FAST_PATH = "FAST_PATH"  # Orchestrator 직접 처리 (DB 조회 / 정보 Provider 1개)
    FALLBACK = "FALLBACK"  # 기본 응답 + 수동 편집 경로 안내 (INV-4)


class MatchRoute(Enum):
    """의도가 확정된 경로 (intent-matching-design §2 "경로별 특성").

    AMBIGUOUS·UNKNOWN은 단계 전이 상태일 뿐 최종 경로가 아니므로 값에 넣지 않는다.
    """

    CONFIDENT = "CONFIDENT"  # 1차 질문뱅크 임베딩 매칭 (LLM 0회)
    VOTED = "VOTED"  # 2차 유사질문 생성 + 재매칭 가중 투표
    LLM_DIRECT = "LLM_DIRECT"  # 3차 LLM 직접 분류
    FALLBACK = "FALLBACK"  # 전 단계 실패 → 결정론 폴백


@dataclass(frozen=True, slots=True)
class RoutingEntry:
    """intent → 처리자·모드 (delegation-design §5). handler=None은 Orchestrator 직접 처리."""

    handler: str | None
    mode: RoutingMode


# delegation-design §5 라우팅 테이블 그대로. handler 문자열은 질문뱅크 yaml의
# `handler` 필드와 대조되는 정본이다 (question_bank 로더가 드리프트를 잡는다).
ROUTING_TABLE: dict[Intent, RoutingEntry] = {
    Intent.GENERATE_SCHEDULE: RoutingEntry("ScheduleAgent", RoutingMode.DELEGATE),
    Intent.REGENERATE: RoutingEntry("ScheduleAgent", RoutingMode.DELEGATE),
    Intent.REPLAN: RoutingEntry("PlanBAgent", RoutingMode.DELEGATE),
    Intent.SUGGEST_ALTERNATIVE: RoutingEntry("PlanBAgent", RoutingMode.DELEGATE),
    Intent.GENERATE_REFLECTION: RoutingEntry("ReflectAgent", RoutingMode.DELEGATE),
    Intent.TRIP_SUMMARY: RoutingEntry("ReflectAgent", RoutingMode.DELEGATE),
    Intent.STYLE_ANALYSIS: RoutingEntry("ReflectAgent", RoutingMode.DELEGATE),
    Intent.EDIT_SCHEDULE: RoutingEntry("EditAgent", RoutingMode.DELEGATE),
    Intent.GET_NEXT_SLOT: RoutingEntry(None, RoutingMode.FAST_PATH),  # DB 조회
    Intent.SHOW_SCHEDULE: RoutingEntry(None, RoutingMode.FAST_PATH),  # DB 조회
    Intent.GET_WEATHER: RoutingEntry("WeatherAgent", RoutingMode.FAST_PATH),
    Intent.GET_DISTANCE: RoutingEntry("TransitAgent", RoutingMode.FAST_PATH),  # 거리만 (INV-3)
    Intent.GET_POI_INFO: RoutingEntry("PlaceScoutAgent", RoutingMode.FAST_PATH),
    Intent.OUT_OF_SCOPE: RoutingEntry(None, RoutingMode.FALLBACK),
}

# 위임·Fast Path 대상 13종 (폴백 라벨 제외) — 질문뱅크가 커버해야 하는 집합.
ROUTABLE_INTENTS: frozenset[Intent] = frozenset(ROUTING_TABLE) - {Intent.OUT_OF_SCOPE}


def route_for(intent: Intent) -> RoutingEntry:
    """intent → 처리자·모드. 표에 없는 값은 존재할 수 없다 (enum이 closed-set)."""
    return ROUTING_TABLE[intent]


@dataclass(frozen=True, slots=True)
class IntentDraft:
    """3차 LLM 직접 분류의 산출물 (intent-matching-design §2 [3차], `llm.parse_intent`).

    C1 INTENT 출구 게이트가 조립해 `TypedResult.value`로 내보내는 타입 —
    라벨이 enum이라 게이트 통과 시점에 closed-set이 이미 보장된다.
    confidence는 모델이 주지 않을 수 있어 None 허용 (라우터가 설정 기본값으로 대체).
    """

    intent: Intent
    slots: dict  # JSON-safe (키는 str)
    confidence: float | None = None

    def __post_init__(self) -> None:
        if not all(isinstance(k, str) for k in self.slots):
            raise ValueError("slots의 키는 전부 str이어야 함 (JSON-safe)")
        if self.confidence is not None and not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"confidence는 [0,1]: {self.confidence}")


@dataclass(frozen=True, slots=True)
class IntentMatch:
    """의도 매칭 결과 (intent-matching-design §2 마지막 단 — AgentTask 발행 재료).

    불변식:
    - `match_route=FALLBACK` ⇔ `intent=OUT_OF_SCOPE` (폴백 라벨은 폴백 경로에서만 나온다)
    - 폴백이면 `reason` 필수 — **침묵 실패 금지(INV-4)**. 왜 폴백했는지가 결과에 남는다.
    - 폴백이 아니면 라벨은 항상 위임 가능한 closed-set 13종 안 (INV-1과 동형)
    """

    intent: Intent
    slots: dict  # JSON-safe — AgentTask.slots로 그대로 실린다
    confidence: float  # [0,1]
    match_route: MatchRoute
    reason: str | None = None  # 폴백 사유 / 단계 승격 사유

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"confidence는 [0,1]: {self.confidence}")
        if not all(isinstance(k, str) for k in self.slots):
            raise ValueError("slots의 키는 전부 str이어야 함 (JSON-safe)")
        is_fallback = self.match_route is MatchRoute.FALLBACK
        if is_fallback != (self.intent is Intent.OUT_OF_SCOPE):
            raise ValueError(
                "FALLBACK 경로 ⇔ OUT_OF_SCOPE 라벨이어야 함 "
                f"(route={self.match_route.value}, intent={self.intent.value})"
            )
        if is_fallback:
            if not self.reason:
                raise ValueError("폴백은 사유 필수 — 침묵 실패 금지 (INV-4)")
            if self.confidence != 0.0:
                raise ValueError("폴백의 confidence는 0.0")
        elif self.intent not in ROUTABLE_INTENTS:  # 방어 — enum 확장 시 자동 검출
            raise ValueError(f"위임 불가 라벨: {self.intent.value}")

    @property
    def routing(self) -> RoutingEntry:
        """이 의도의 처리자·모드 (Fast Path / Delegate / Fallback 구분)."""
        return route_for(self.intent)

    def to_dict(self) -> dict:
        return {
            "intent": self.intent.value,
            "slots": dict(self.slots),
            "confidence": self.confidence,
            "match_route": self.match_route.value,
            "reason": self.reason,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "IntentMatch":
        return cls(
            intent=Intent(d["intent"]),
            slots=dict(d["slots"]),
            confidence=d["confidence"],
            match_route=MatchRoute(d["match_route"]),
            reason=d.get("reason"),
        )
