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
    # 다일 여행 반경 배율 — 0.7(축소)이던 것을 1.0 으로(2026-10-20). 서울 2박3일(앵커 = 시청)에서 7km 는 강남역 8.8km·
    # 성수 7.3km 를 풀에서 뺐다. 날마다 다른 동네로 가려면(`day_focus`) 풀이 도시를 덮어야 한다.
    multi_day_factor: float = 1.0
    budget_limit: dict[BudgetLevel, int | None] = field(
        default_factory=_default_budget_limit)
    max_candidates: int = 5_000              # G142
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
