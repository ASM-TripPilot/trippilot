"""오케스트레이터 경계 — **구조적 타이핑(Protocol)만** 선언한다.

`trippilot.orchestrator`의 실 구현(TRIP-237)은 머지돼 있고, `api/wiring.py`가 그것을
조립해 `WiredItineraryOrchestrator`로 감싸 주입한다. 그래도 여기서 import하지 않는다 —
Protocol은 구조적이라 이름·형태만 맞으면 어댑터 없이 그대로 꽂히고, API 계층은 구현
타입을 몰라도 된다.

API 계층이 오케스트레이터에 기대하는 것은 아래 `ItineraryOrchestrator` Protocol 본문이
정본이다 — 메서드를 여기 다시 나열하지 않는다(나열이 먼저 낡는다).
회고 2종(`reflection_generate`·`reflection_nudge`, TRIP-429)은 **Protocol 밖**이고
`routes.py`가 `getattr`로 찾아 없으면 503으로 명시 실패한다 — 구형 조립 호환을 위해
선택적으로 둔 것이다(INV-4: 없으면 조용히 넘어가지 않고 크게 드러낸다).

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


class UnverifiedSlotLike(Protocol):
    """HC 판정에서 제외된 슬롯 1건 (TRIP-537). `reason_code`는 닫힌 집합
    (NOT_REGISTERED | UNMAPPABLE) — 스키마 Literal이 강제한다."""

    poi_id: str
    reason_code: str
    detail: str


class ValidationOutcome(Protocol):
    """검증 결과 — 위반과 **판정 못 한 슬롯**을 나눠 담는다 (TRIP-537).

    `Sequence[Violation]` 하나로는 "위반 0"이 통과인지 미검증인지 구분되지 않았다.
    POI 정본을 못 찾은 슬롯은 HC1·HC2에서 제외되는데(c2 규칙 — 정보 없음은 막지
    않는다), 그 사실이 응답에 없으면 침묵 실패다(INV-4).
    """

    violations: Sequence[Violation]
    unverified: Sequence[UnverifiedSlotLike]


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
    """최소 변경 수리 결과. `repaired=None` = 수리 불가(정상 결과, IO-7).

    `unverified`는 validate와 같은 의미 — 수리 결과도 그 슬롯들은 판정 밖이다.
    """

    repaired: ItineraryOutcome | None
    changes: Sequence[str]
    unverified: Sequence[UnverifiedSlotLike]


class ItineraryOrchestrator(Protocol):
    """API가 주입받는 유일한 협력자. 미주입이면 라우트는 503으로 명시 실패한다."""

    def generate(self, request: GenerateItineraryRequest) -> ItineraryOutcome: ...

    def validate(self, request: ValidateItineraryRequest) -> ValidationOutcome: ...

    def repair(self, request: RepairItineraryRequest) -> RepairOutcome: ...

    def alternatives(self, request: AlternativesRequest) -> AlternativesResponse: ...

    def explanations(self, request: ExplanationsRequest) -> ExplanationsResponse: ...

    def edit(self, request: EditItineraryRequest) -> EditItineraryResponse: ...
