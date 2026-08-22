"""오케스트레이터 경계 — **구조적 타이핑(Protocol)만** 선언한다.

`trippilot.orchestrator`의 실 구현(TRIP-237)은 별도 브랜치에서 만들어지는 중이라
여기서 import하지 않는다. Protocol은 구조적이므로, 실 구현이 아래 이름·형태를
만족하면 배선 시 어댑터 없이 그대로 주입된다(배선은 두 브랜치 머지 후 별도 작업).

API 계층이 오케스트레이터에 기대하는 것은 딱 셋:
- `generate(request) -> ItineraryOutcome`
- `validate(request) -> Sequence[Violation]`   (도메인 Violation 그대로)
- `repair(request) -> RepairOutcome`

시각·순서·후보 판단은 전부 오케스트레이터(→ M7·C1·C2) 소유다. API는 사영만 한다(INV-2).
`request`는 검증을 마친 경계 스키마 객체 — 도메인 타입 조립(ItineraryProblem 등)은
후보 풀·시드·이동추정을 아는 오케스트레이터의 책임이라 API가 대신하지 않는다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Mapping, Protocol, Sequence

from trippilot.api.schemas import (
    AlternativesRequest,
    AlternativesResponse,
    EditItineraryRequest,
    EditItineraryResponse,
    ExplanationsRequest,
    ExplanationsResponse,
    GenerateItineraryRequest,
    RepairItineraryRequest,
    ValidateItineraryRequest,
)
from trippilot.domain.freshness import FreshnessMeta
from trippilot.domain.itinerary import ItinerarySolution, Violation


class CandidatesSummaryLike(Protocol):
    """후보 충분성 판정(BR-U2-05). `pool_size`는 모르면 None — 0으로 채우지 않는다."""

    level: str
    pool_size: int | None
    shortfall_categories: Sequence[str]


class UnplacedMustVisitLike(Protocol):
    """미배치 필수방문 보고 1건 (TRIP-350). `reason_code`는 닫힌 집합
    (OUT_OF_RANGE | NO_FEASIBLE_SLOT | WINDOW_CONFLICT) — 스키마 Literal이 강제한다."""

    poi_id: str
    reason_code: str


class ItineraryOutcome(Protocol):
    """일정 산출물 + 표시에 필요한 부가 정보.

    `ItinerarySolution` 하나로는 경계 계약을 채울 수 없다(설명·거리·신선도·충분성은
    솔버 소관이 아니다) — 그 차이를 이 봉투가 메운다.

    - `explanations` / `distance_ranges` 키 규약 = `"{date}#{poi_id}"` (BR-U2-04)
    - `distance_ranges` 값은 표시 문자열("약 1.2km · 도보 추정")이며 **시간을 담지 않는다**(INV-3)
    - `unplaced_must_visits`: 요청 fixed_blocks 대비 해에 없는 필수방문의 사유 보고
      (TRIP-350 — 빈 시퀀스 = 전부 배치됨)
    """

    solution: ItinerarySolution
    explanations: Mapping[str, str]
    distance_ranges: Mapping[str, str]
    freshness: FreshnessMeta | None
    candidates_summary: CandidatesSummaryLike | None
    day1_ready_at: datetime | None
    unplaced_must_visits: Sequence[UnplacedMustVisitLike]


class RepairOutcome(Protocol):
    """최소 변경 수리 결과. `repaired=None` = 수리 불가(정상 결과, IO-7)."""

    repaired: ItineraryOutcome | None
    changes: Sequence[str]


class ItineraryOrchestrator(Protocol):
    """API가 주입받는 유일한 협력자. 미주입이면 라우트는 503으로 명시 실패한다."""

    def generate(self, request: GenerateItineraryRequest) -> ItineraryOutcome: ...

    def validate(self, request: ValidateItineraryRequest) -> Sequence[Violation]: ...

    def repair(self, request: RepairItineraryRequest) -> RepairOutcome: ...

    def alternatives(self, request: AlternativesRequest) -> AlternativesResponse: ...

    def explanations(self, request: ExplanationsRequest) -> ExplanationsResponse: ...

    def edit(self, request: EditItineraryRequest) -> EditItineraryResponse: ...
