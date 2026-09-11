"""M7 설정 (U3 FD §4 — ai-data-design 확정 초기값의 주입 컨테이너).

실체는 remote config — 하드코딩 사용 금지(항상 주입).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from trippilot.domain.common import BudgetLevel, TransportMode


def _default_radius() -> dict[TransportMode, float]:
    return {TransportMode.WALK: 2.0, TransportMode.PUBLIC: 10.0, TransportMode.CAR: 20.0}


def _default_budget_limit() -> dict[BudgetLevel, int | None]:
    return {BudgetLevel.LOW: 15_000, BudgetLevel.MID: 40_000, BudgetLevel.HIGH: None}


@dataclass(frozen=True, slots=True)
class M7Config:
    radius_km: dict[TransportMode, float] = field(default_factory=_default_radius)
    multi_day_factor: float = 0.7            # 다일 여행 반경 축소
    budget_limit: dict[BudgetLevel, int | None] = field(
        default_factory=_default_budget_limit)
    max_candidates: int = 5_000              # G142
    # 지도 실재 검증에 줄 시간 (TRIP-683). 생성 마감이 25s 이고 검증은
    # 곁가지라 넉넉히 못 준다 — 넘긴 몫은 UNVERIFIED 로 떨어지고 강등은
    # 일어나지 않는다(모르면 그대로 둔다).
    existence_deadline_ms: int = 1_500
    # 정렬 상위 몇 건까지 지도 검증을 할 것인가. 마감(1.5s)이 실질 제한이라
    # 이 값은 상한일 뿐이다 — 3일 여행이 슬롯 15개 안팎이라 50 이면 화면에
    # 오를 후보를 넉넉히 덮는다. 후보 전체(최대 5,000)를 조회하지 않는다.
    existence_verify_top_n: int = 50
    poi_ttl_sec: int = 24 * 3600             # D13
    hours_ttl_sec: int = 6 * 3600            # D13
    match_auto: float = 0.85                 # AI-D04 임계 (캘리브레이션 대상)
    match_confirm: float = 0.60

    def __post_init__(self) -> None:
        if not 0 < self.multi_day_factor <= 1:
            raise ValueError("multi_day_factor는 (0,1]")
        if not 0 <= self.match_confirm <= self.match_auto <= 1:
            raise ValueError("임계 정합 위반: 0 ≤ confirm ≤ auto ≤ 1")
        if self.max_candidates <= 0:
            raise ValueError("max_candidates 양수 필요")
        if self.existence_deadline_ms <= 0:
            raise ValueError("existence_deadline_ms 양수 필요")
        if self.existence_verify_top_n <= 0:
            raise ValueError("existence_verify_top_n 양수 필요")
