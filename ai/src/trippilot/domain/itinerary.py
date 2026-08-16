"""일정 도메인 타입 (domain-entities.md §2).

INV-2(솔버 검증값만)의 U1 책임 (business-rules.md §1):
- 강제: ItinerarySolution이 solve_mode·solver_run으로 "어떻게 나온 해인지" 출처를 기록
- 준비: Violation 타입 + SolverPort 계약 (None=해 없음 → 체인 진행)
- 실제 HC1~HC4 검증은 U2 솔버 소유

순환 import 방지: ScoredPoi(llm)·SolverRunRecord(observability)는 타입 힌트 전용
(from __future__ import annotations로 문자열 처리) + from_dict 내부 지역 import.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum
from typing import TYPE_CHECKING, Mapping

from trippilot.domain.common import (
    BudgetLevel,
    GeoPoint,
    PoiId,
    ScheduleId,
    TransportMode,
)
from trippilot.domain.serialization import from_iso, to_iso

if TYPE_CHECKING:
    from trippilot.domain.llm import ScoredPoi
    from trippilot.domain.observability import SolverRunRecord


class SolveMode(Enum):
    """솔버가 어느 계층으로 해를 냈는지. LLM이라도 HC 검증 후에만 반환 (벤더 중립 — AI-D06)."""

    OR_TOOLS = "OR_TOOLS"
    LLM = "LLM"
    RULE_FALLBACK = "RULE_FALLBACK"
    MINIMAL = "MINIMAL"


_FALLBACK_MODES = frozenset({SolveMode.RULE_FALLBACK, SolveMode.MINIMAL})


@dataclass(frozen=True, slots=True)
class Violation:
    """하드 제약 위반 1건. 빈 리스트 = 유효 (INV-2 준비)."""

    code: str  # HC1 ~ HC4
    slot_ref: PoiId | None
    detail: str

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "slot_ref": str(self.slot_ref) if self.slot_ref is not None else None,
            "detail": self.detail,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Violation":
        return cls(
            code=d["code"],
            slot_ref=PoiId(d["slot_ref"]) if d["slot_ref"] is not None else None,
            detail=d["detail"],
        )


@dataclass(frozen=True, slots=True)
class TimeWindow:
    """시간 구간. tz-aware, start < end (기본 day window 09:00~21:00)."""

    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        if self.start.tzinfo is None or self.end.tzinfo is None:
            raise ValueError("TimeWindow는 tz-aware datetime만")
        if not self.start < self.end:
            raise ValueError(f"start < end 위반: {self.start} !< {self.end}")

    def to_dict(self) -> dict:
        return {"start": to_iso(self.start), "end": to_iso(self.end)}

    @classmethod
    def from_dict(cls, d: dict) -> "TimeWindow":
        return cls(start=from_iso(d["start"]), end=from_iso(d["end"]))


@dataclass(frozen=True, slots=True)
class FixedBlock:
    """시각 고정 방문지 (HC3: 솔버가 시각 변경 불가)."""

    poi_id: PoiId
    window: TimeWindow
    reason: str

    def to_dict(self) -> dict:
        return {
            "poi_id": str(self.poi_id),
            "window": self.window.to_dict(),
            "reason": self.reason,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "FixedBlock":
        return cls(
            poi_id=PoiId(d["poi_id"]),
            window=TimeWindow.from_dict(d["window"]),
            reason=d["reason"],
        )


@dataclass(frozen=True, slots=True)
class VisitSlot:
    """방문 슬롯 (HC1/HC4 대상). tz-aware, start_at < end_at."""

    poi_id: PoiId
    start_at: datetime
    end_at: datetime
    stay_min: int
    score: float
    is_llm_score: bool

    def __post_init__(self) -> None:
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("VisitSlot 시각은 tz-aware만")
        if not self.start_at < self.end_at:
            raise ValueError("start_at < end_at 위반")
        if self.stay_min < 0:
            raise ValueError(f"stay_min 음수: {self.stay_min}")

    def to_dict(self) -> dict:
        return {
            "poi_id": str(self.poi_id),
            "start_at": to_iso(self.start_at),
            "end_at": to_iso(self.end_at),
            "stay_min": self.stay_min,
            "score": self.score,
            "is_llm_score": self.is_llm_score,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "VisitSlot":
        return cls(
            poi_id=PoiId(d["poi_id"]),
            start_at=from_iso(d["start_at"]),
            end_at=from_iso(d["end_at"]),
            stay_min=d["stay_min"],
            score=d["score"],
            is_llm_score=d["is_llm_score"],
        )


@dataclass(frozen=True, slots=True)
class DaySolution:
    """하루치 해. slots는 시작 시각 오름차순 정렬 필수."""

    date: date
    slots: tuple[VisitSlot, ...]
    fixed_blocks: tuple[FixedBlock, ...]

    def __post_init__(self) -> None:
        starts = [s.start_at for s in self.slots]
        if starts != sorted(starts):
            raise ValueError("DaySolution.slots 시간순 정렬 위반")

    def to_dict(self) -> dict:
        return {
            "date": self.date.isoformat(),
            "slots": [s.to_dict() for s in self.slots],
            "fixed_blocks": [f.to_dict() for f in self.fixed_blocks],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "DaySolution":
        return cls(
            date=date.fromisoformat(d["date"]),
            slots=tuple(VisitSlot.from_dict(x) for x in d["slots"]),
            fixed_blocks=tuple(FixedBlock.from_dict(x) for x in d["fixed_blocks"]),
        )


@dataclass(frozen=True, slots=True)
class ItineraryProblem:
    """솔버 입력. candidates ⊆ CandidatePool (INV-1). seed 고정 → 결정론(INV-4).

    excluded_poi_ids: 이미 다른 호출에서 배정된 POI (day1 2단계 생성 — TRIP-293).
    1차 `days=[day1]`로 solve → 배정된 poi_id를 2차 `days=[나머지]`의 제외 목록으로
    넘기면 두 호출이 합쳐져도 POI 중복이 없다. 기본 빈 집합 = 기존 동작 그대로.

    제외의 의미는 **후보 풀 축소**뿐이다 — closed-set 검증(INV-1)을 우회하지 않고,
    고정 블록(HC3)은 제외보다 우선한다(모순 입력에서 하드 제약을 깨지 않기 위해).

    daily_rain_prob: 날짜별 강수확률%(POP, 0~100) — 날씨 소프트 보정 입력(TRIP-383).
    기본 None = 무보정(기존 생성자 호출 전부 무영향). 부분 매핑이다 — 예보 지평 밖
    날짜는 키 없음(정보 없음을 0%로 지어내지 않는다). 하드 제약이 아니라 솔버
    목적함수의 소프트 항에만 쓰인다 — 비가 와도 실외 배치는 가능하다.
    """

    schedule_id: ScheduleId
    days: tuple[date, ...]
    candidates: tuple["ScoredPoi", ...]
    fixed_blocks: tuple[FixedBlock, ...]
    budget: BudgetLevel
    transport: TransportMode
    day_window: TimeWindow
    seed: int
    anchor: GeoPoint | None = None  # 숙소 기점 (정본 §4.1 — U1 누락분 보강)
    excluded_poi_ids: frozenset[PoiId] = frozenset()  # 기배정 POI (TRIP-293)
    daily_rain_prob: Mapping[date, int] | None = None  # 날짜별 POP% (TRIP-383)

    def __post_init__(self) -> None:
        if not self.days:
            raise ValueError("days는 최소 1일")
        if self.daily_rain_prob is not None:
            for d, pop in self.daily_rain_prob.items():
                if not 0 <= pop <= 100:
                    raise ValueError(f"daily_rain_prob[{d}] 범위 밖 [0,100]: {pop}")

    def to_dict(self) -> dict:
        return {
            "schedule_id": str(self.schedule_id),
            "days": [d.isoformat() for d in self.days],
            "candidates": [c.to_dict() for c in self.candidates],
            "fixed_blocks": [f.to_dict() for f in self.fixed_blocks],
            "budget": self.budget.value,
            "transport": self.transport.value,
            "day_window": self.day_window.to_dict(),
            "seed": self.seed,
            "anchor": self.anchor.to_dict() if self.anchor else None,
            # frozenset은 JSON 원시 타입이 아니다 → 정렬된 list (결정론적 직렬화)
            "excluded_poi_ids": sorted(str(p) for p in self.excluded_poi_ids),
            # date 키는 JSON 원시 타입이 아니다 → 정렬된 ISO 키 (결정론적 직렬화)
            "daily_rain_prob": (
                {d.isoformat(): self.daily_rain_prob[d]
                 for d in sorted(self.daily_rain_prob)}
                if self.daily_rain_prob is not None
                else None
            ),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ItineraryProblem":
        from trippilot.domain.llm import ScoredPoi  # 지역 import (순환 방지)

        return cls(
            schedule_id=ScheduleId(d["schedule_id"]),
            days=tuple(date.fromisoformat(x) for x in d["days"]),
            candidates=tuple(ScoredPoi.from_dict(x) for x in d["candidates"]),
            fixed_blocks=tuple(FixedBlock.from_dict(x) for x in d["fixed_blocks"]),
            budget=BudgetLevel(d["budget"]),
            transport=TransportMode(d["transport"]),
            day_window=TimeWindow.from_dict(d["day_window"]),
            seed=d["seed"],
            anchor=GeoPoint.from_dict(d["anchor"]) if d.get("anchor") else None,
            # d.get: 키가 없는 기존 직렬화본도 그대로 읽힌다 (하위호환)
            excluded_poi_ids=frozenset(
                PoiId(x) for x in d.get("excluded_poi_ids", ())
            ),
            daily_rain_prob=(
                {date.fromisoformat(k): v
                 for k, v in d["daily_rain_prob"].items()}
                if d.get("daily_rain_prob") is not None
                else None
            ),
        )


@dataclass(frozen=True, slots=True)
class QualityScore:
    """솔버 산출물 품질 점수 (정본 components.md §3.7 · FR-SOLVER-02).

    성분 4개 전부 [0, 1] 무차원 비율 — duration/minutes 필드 없음(INV-3).
    composite는 2차 솔버(LLM) 엔진 교체 판정의 관측 지표(프로젝트 수준 결정, AI-D06).
    산식·가중치·임계값은 CONSTRUCTION·운영 결정(O-SOLVER) — 계산은 c2/quality.py.
    """

    preference_fit: float
    constraint_satisfaction: float
    route_efficiency: float
    composite: float

    def __post_init__(self) -> None:
        for name in ("preference_fit", "constraint_satisfaction",
                     "route_efficiency", "composite"):
            v = getattr(self, name)
            if not 0.0 <= v <= 1.0:
                raise ValueError(f"QualityScore.{name} 범위 밖 [0,1]: {v}")

    def to_dict(self) -> dict:
        return {
            "preference_fit": self.preference_fit,
            "constraint_satisfaction": self.constraint_satisfaction,
            "route_efficiency": self.route_efficiency,
            "composite": self.composite,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "QualityScore":
        return cls(
            preference_fit=d["preference_fit"],
            constraint_satisfaction=d["constraint_satisfaction"],
            route_efficiency=d["route_efficiency"],
            composite=d["composite"],
        )


@dataclass(frozen=True, slots=True)
class ItinerarySolution:
    """솔버 출력. 반환 전 HC1~HC4 통과 필수 (INV-2, 검증은 U2).

    U1 강제: 출처 정합 — 폴백 해(is_fallback)는 폴백 모드여야 한다
    (solve_mode·is_fallback이 서로 거짓말하지 못하게. INV-2/INV-4 정합).
    """

    schedule_id: ScheduleId
    days: tuple[DaySolution, ...]
    is_fallback: bool
    solve_mode: SolveMode
    solver_run: "SolverRunRecord | None"
    score: QualityScore | None = None  # 품질 점수 부착 지점 (§3.7) — 하위호환 기본 None

    def __post_init__(self) -> None:
        if self.is_fallback and self.solve_mode not in _FALLBACK_MODES:
            raise ValueError(
                f"is_fallback=True인데 폴백 모드가 아님: {self.solve_mode}"
            )

    def to_dict(self) -> dict:
        return {
            "schedule_id": str(self.schedule_id),
            "days": [d.to_dict() for d in self.days],
            "is_fallback": self.is_fallback,
            "solve_mode": self.solve_mode.value,
            "solver_run": self.solver_run.to_dict() if self.solver_run else None,
            "score": self.score.to_dict() if self.score else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ItinerarySolution":
        from trippilot.domain.observability import SolverRunRecord  # 지역 import

        return cls(
            schedule_id=ScheduleId(d["schedule_id"]),
            days=tuple(DaySolution.from_dict(x) for x in d["days"]),
            is_fallback=d["is_fallback"],
            solve_mode=SolveMode(d["solve_mode"]),
            solver_run=(
                SolverRunRecord.from_dict(d["solver_run"])
                if d["solver_run"] is not None
                else None
            ),
            # d.get: score 키가 없는 기존 직렬화본도 그대로 읽힌다 (하위호환)
            score=(
                QualityScore.from_dict(d["score"])
                if d.get("score") is not None
                else None
            ),
        )
