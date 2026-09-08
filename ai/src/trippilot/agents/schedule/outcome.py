"""일정 생성 결과 타입 — `GenerationOutcome` 과 그 부품 (agent-io-contracts §1.2 의 도메인 형태).

에이전트가 만들고, 오케스트레이터가 그대로 돌려주며, 경계(`api/wiring.py`)가 와이어로
사영한다. 와이어로 나가는 것은 solution·explanations·candidates_summary·solved_at —
degradations·scoring_mode 는 내부 관측용이다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from trippilot.agents.schedule.budget import DeadlineBudget
from trippilot.domain.itinerary import ItinerarySolution
from trippilot.domain.llm import CandidatePool, PoiExplanation
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


def candidates_report(pool: CandidatePool) -> CandidatesReport:
    """후보 풀 실측 → 충분성 보고. 지어내지 않는다 — 전부 풀에서 센 사실이다.

    - shortfall = 풀에 후보가 **0건**인 경계 카테고리 (카테고리별 최소 개수 임계는 1 —
      임계 발명을 최소화한 1차 규칙. 정교한 판정은 PlaceScoutProvider(S7.1) 승격 시 이관)
    - level: 풀 자체가 비면 NO_CANDIDATES, 빠진 카테고리가 있으면 LOW, 아니면 OK
    """
    present = {p.category for p in pool.pois}
    shortfall = tuple(
        c.value for c in _BOUNDARY_CATEGORIES if c not in present
    )
    if not pool.pois:
        level = "NO_CANDIDATES"
    elif shortfall:
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
        error=error,
    )
