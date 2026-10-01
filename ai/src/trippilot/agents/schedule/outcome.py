"""일정 생성 결과 타입 — `GenerationOutcome` 과 그 부품 (agent-io-contracts §1.2 의 도메인 형태).

에이전트가 만들고, 오케스트레이터가 그대로 돌려주며, 경계(`api/wiring.py`)가 와이어로
사영한다. 와이어로 나가는 것은 solution·explanations·candidates_summary·solved_at·
slot_alternatives — degradations·scoring_mode 는 내부 관측용이다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Mapping

from trippilot.agents.schedule.budget import DeadlineBudget
from trippilot.domain.common import PoiId
from trippilot.domain.itinerary import ItinerarySolution
from trippilot.domain.llm import CandidatePool, PoiExplanation
from trippilot.domain.persona import PersonaSummary, TasteTag
from trippilot.domain.poi import PoiCategory


class ScoringMode(Enum):
    """선호 점수의 출처 — 사용자 고지("기본 모드로 생성")의 근거."""

    LLM = "LLM"
    RULE = "RULE"


class GenerationStatus(Enum):
    SUCCESS = "SUCCESS"    # 폴백 계단을 한 칸도 밟지 않음
    DEGRADED = "DEGRADED"  # 어딘가 강등됐지만 일정은 나왔다 (사유는 degradations)
    FAILED = "FAILED"      # 일정 없음 — 명시적 실패 (침묵 금지)


@dataclass(frozen=True, slots=True)
class Degradation:
    """밟은 폴백 계단 1칸. 결과에 실려 호출자(백엔드)가 고지 문구를 고른다."""

    stage: str  # pool / llm / assembly / explanation / weather / event / agent
    reason: str


# 슬롯당 차선책 상한 — "한두 개"(팀 결정 2026-09-16, TRIP-871). PlanB 온디맨드 경로의
# `max_alternatives`(3)와 일부러 다르다 — 생성 화면의 칸이 작다.
MAX_SLOT_ALTERNATIVES = 2


@dataclass(frozen=True, slots=True)
class SlotAlternative:
    """슬롯 1개의 차선책 1건 (TRIP-871) — **제안만**.

    시각·순서 없음(INV-2 — 교체 확정은 edit → validate 관문), poi_id ∈ pool(INV-1 —
    선정이 풀을 순회해 만든다). `rationale` 은 사실만 담은 템플릿 문장(카테고리) —
    LLM 문장이 아니다.
    """

    poi_id: PoiId
    rationale: str


# 경계 카테고리 8종 (domain/poi.py 정본) — STAY는 내부 전용이라 충분성 판정 대상이 아니다.
_BOUNDARY_CATEGORIES: tuple[PoiCategory, ...] = tuple(
    c for c in PoiCategory if c is not PoiCategory.STAY
)


@dataclass(frozen=True, slots=True)
class CandidatesReport:
    """후보 충분성 보고 (BR-U2-05) — 판정은 AI 소유, 백엔드는 그대로 전달한다.

    `level` 어휘는 io-contracts의 sufficiency(OK | LOW | NO_CANDIDATES).
    필드명은 API `CandidatesSummaryLike`(protocols.py) 구조 계약과 일치한다.
    """

    level: str
    pool_size: int | None  # 모르면 None — 0은 "후보 0건"이라는 판정 (여기서는 항상 안다)
    shortfall_categories: tuple[str, ...]


# 하루 최소 슬롯 수 — U3 NFR 의 "하루 5~10슬롯"(nfr-requirements PERF-U3-01·
# tech-stack-decisions) 하한. 풀이 `일수 × 이 값` 보다 작으면 일정을 채울 후보가
# 모자란다는 판정이다. 솔버는 슬롯 수를 미리 정하지 않으므로 문서상 하한을 쓴다.
MIN_SLOTS_PER_DAY = 5

# 취향 → 경계 카테고리 (BR-U2-05 개정 2026-10-02). 코드베이스에 기존 사상이 없어 신설.
# 대응이 없는 축(REST=휴양)은 싣지 않는다 — 요구 카테고리를 지어내지 않는다.
_TASTE_CATEGORIES: dict[TasteTag, PoiCategory] = {
    TasteTag.NATURE: PoiCategory.NATURE,
    TasteTag.CITY: PoiCategory.SIGHT,  # 관광
    TasteTag.FOOD: PoiCategory.FOOD,
    TasteTag.CULTURE: PoiCategory.CULTURE,
    TasteTag.SHOPPING: PoiCategory.SHOPPING,
    TasteTag.ACTIVITY: PoiCategory.ACTIVITY,
}
# 백엔드 `activities` 8종 (domain/persona.py ACTIVITY_LABELS) — 8종 모두 대응이 있다.
_ACTIVITY_CATEGORIES: dict[str, PoiCategory] = {
    "자연": PoiCategory.NATURE,
    "역사문화": PoiCategory.CULTURE,
    "테마파크": PoiCategory.ACTIVITY,
    "맛집투어": PoiCategory.FOOD,
    "카페": PoiCategory.CAFE,
    "전시": PoiCategory.CULTURE,
    "야경": PoiCategory.NIGHT_VIEW,
    "쇼핑": PoiCategory.SHOPPING,
}


def _wanted_categories(persona: PersonaSummary | None) -> set[PoiCategory]:
    """취향이 요구하는 경계 카테고리. 페르소나 없음·취향 비어 있음 → 빈 집합."""
    if persona is None:
        return set()
    wanted = {_TASTE_CATEGORIES[t] for t in persona.taste_tags if t in _TASTE_CATEGORIES}
    wanted |= {_ACTIVITY_CATEGORIES[a] for a in persona.activities
               if a in _ACTIVITY_CATEGORIES}
    if persona.cuisines:  # 음식 선호(한식·양식…)는 전부 FOOD 안의 구분이다
        wanted.add(PoiCategory.FOOD)
    return wanted


def candidates_report(
    pool: CandidatePool, *, days: int, persona: PersonaSummary | None
) -> CandidatesReport:
    """후보 풀 실측 → 충분성 보고. 지어내지 않는다 — 전부 풀에서 센 사실이다.

    - shortfall = 풀에 후보가 **0건**인 경계 카테고리 (보고용 — 취향과 무관하게 전부)
    - level (BR-U2-05 개정 2026-10-02):
      풀이 비면 NO_CANDIDATES · 취향이 요구하는 카테고리가 0건이거나 풀 크기 <
      `days × MIN_SLOTS_PER_DAY` 면 LOW · 아니면 OK. 취향과 무관한 공백만으로는
      LOW 가 아니다 — 종전 "아무 카테고리 0건 → LOW" 는 실데이터에서 거의 매 생성을
      LOW 로 만들어 FE 가 정상 LLM 결과를 "AI 추천은 잠시 쉬어요"로 오표기했다.
    """
    present = {p.category for p in pool.pois}
    shortfall = tuple(
        c.value for c in _BOUNDARY_CATEGORIES if c not in present
    )
    if not pool.pois:
        level = "NO_CANDIDATES"
    elif (_wanted_categories(persona) - present
          or len(pool.pois) < days * MIN_SLOTS_PER_DAY):
        level = "LOW"
    else:
        level = "OK"
    return CandidatesReport(
        level=level, pool_size=len(pool.pois), shortfall_categories=shortfall
    )


@dataclass(frozen=True, slots=True)
class GenerationOutcome:
    """조립 결과. FAILED ⇔ solution=None ⇔ error 존재 (셋이 서로 거짓말할 수 없다).

    `candidates_summary`·`solved_at`은 **기본값 없음** — 생성 지점이 채움을 잊으면
    TypeError로 드러난다 (anti-patterns "전이 진입점에 기본값 금지").
    - `candidates_summary`: 후보 풀 실측 보고. 풀을 만들기 전에 실패하면 None(모름).
    - `solved_at`: 어셈블리 검증 완료 시각 = 주입된 `now` + 단조시계 경과 (wall-clock
      직접 호출 없음, DL-3). 해가 없으면(FAILED) None.
    - `slot_alternatives`: 슬롯별 차선책(TRIP-871), 키 `"{date}#{poi_id}"`(BR-U2-04).
      해가 없으면 빈 맵. 키가 없는 슬롯 = 차선책 없음(경계는 빈 목록으로 사영).
    """

    status: GenerationStatus
    solution: ItinerarySolution | None
    scoring_mode: ScoringMode
    explanations: tuple[PoiExplanation, ...]
    degradations: tuple[Degradation, ...]
    candidate_count: int
    budget: DeadlineBudget
    candidates_summary: CandidatesReport | None
    solved_at: datetime | None
    slot_alternatives: Mapping[str, tuple[SlotAlternative, ...]]
    error: str | None = None

    def __post_init__(self) -> None:
        failed = self.status is GenerationStatus.FAILED
        if failed != (self.solution is None):
            raise ValueError("FAILED ⇔ solution=None 위반")
        if failed != (self.error is not None):
            raise ValueError("FAILED ⇔ error 필수 위반")
        if self.status is GenerationStatus.SUCCESS and self.degradations:
            raise ValueError("SUCCESS는 폴백 흔적 0 — 있으면 DEGRADED")
        if self.status is GenerationStatus.DEGRADED and not self.degradations:
            raise ValueError("DEGRADED는 사유 필수 (침묵 실패 금지, INV-4)")
        if self.solution is None and self.solved_at is not None:
            raise ValueError("해가 없는데 solved_at 존재 — 검증 시각을 지어낼 수 없다")
        if self.solution is None and self.slot_alternatives:
            raise ValueError("해가 없는데 차선책 존재 — 슬롯 없이 슬롯별 제안을 지어낼 수 없다")

    @property
    def is_fallback(self) -> bool:
        return self.status is not GenerationStatus.SUCCESS


def failed_outcome(
    budget: DeadlineBudget,
    error: str,
    *,
    scoring_mode: ScoringMode = ScoringMode.RULE,
    candidate_count: int = 0,
    candidates_summary: CandidatesReport | None = None,
) -> GenerationOutcome:
    """명시적 실패 결과 — 오케스트레이터·에이전트 양쪽의 `_failed` 가 공유하는 조립.

    관측(FallbackEvent 발행)은 호출측 몫이다 — 어느 component 이름으로 낼지는 실패한
    쪽이 안다. 여기서는 결과만 만든다.
    """
    return GenerationOutcome(
        status=GenerationStatus.FAILED,
        solution=None,
        scoring_mode=scoring_mode,
        explanations=(),
        degradations=(Degradation(stage="agent", reason=error),),
        candidate_count=candidate_count,
        budget=budget,
        candidates_summary=candidates_summary,  # 풀 이전 실패면 None — 모름을 유지
        solved_at=None,  # 해가 없다 — 검증 시각을 지어내지 않는다
        slot_alternatives={},  # 슬롯이 없다 — 슬롯별 제안도 없다
        error=error,
    )
