"""시한 배분 — 단계별 상한 + 어셈블리는 잔여 전부 (services.md §5.1, TRIP-376).

오케스트레이터가 요청 전체 예산을 `allocate()` 로 나누고, 결과 `DeadlineBudget` 을
`ScheduleTask` 에 실어 에이전트에 넘긴다. 에이전트는 상한(게이트웨이 점수)·바닥
(어셈블리)·진입 임계(설명)를 읽기만 한다.

필드 이름의 `c1_`·`c2_`·`m7_` 접두는 패키지 개명(llm_gateway·assembly_engine·
poi_curation) 전 이름이 공개 필드로 남은 것이다 — 테스트·배선이 잡고 있어 이번에는
유지한다. 뜻은 각각 게이트웨이 점수 단계 / 어셈블리 단계 / 후보 풀 단계.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class OrchestratorConfig:
    """시한 배분 파라미터 (services.md §5.1 타임아웃 정책의 주입 컨테이너).

    배분 방식은 **단계별 상한 + 어셈블리는 잔여 전부** (TRIP-376, 고정 분할 폐기):
    상류(후보 풀·게이트웨이 점수)는 상한까지만 쓰고, 어셈블리는 solve 시점 잔여를
    전부 받는다. day1 5초·전체 20초 양쪽에서 성립해야 하므로 **고정 ms가 아니라
    비율+상한**이다.
    """

    c2_min_share: float = 0.5     # 전체 예산 중 어셈블리 바닥이 가져가는 몫 (소예산용)
    c2_floor_ms: int = 1_000      # 어셈블리 바닥 절대 하한 (전체가 더 작으면 전체까지만)
    # 어셈블리 바닥 상한 — 어셈블리는 어차피 solve 시점 잔여를 **전부** 받으므로 바닥을
    # 키울 이유가 없고, 바닥이 크면 점수 상한이 그만큼 줄어든다. OR-Tools 실측
    # 3.0~3.1s(193건, TRIP-373) + 여유 = 5s (TRIP-376).
    c2_cap_ms: int = 5_000
    m7_share: float = 0.3         # 상류(풀+점수) 몫 중 후보 풀 관측 배분
    m7_max_ms: int = 1_000        # 후보 풀은 로컬 조회 — 이 이상 걸리면 관측 대상
    # 게이트웨이 점수 단계 상한 — PREFERENCE_SCORING 실호출 바닥 ~3s(7건 3.2s)·변동
    # 3~4배 (TRIP-373 실측). 종전 2.5s에서는 LLM 점수가 구조적으로 미사용이었다 (TRIP-376).
    c1_max_ms: int = 14_000
    c1_min_ms: int = 800          # 이보다 적게 배분되면 LLM 호출 자체를 스킵 (DL-2)
    explanation_min_ms: int = 1_500  # 설명 부착(선택 단계) 진입 하한

    def __post_init__(self) -> None:
        if not 0.0 < self.c2_min_share < 1.0:
            raise ValueError("c2_min_share ∈ (0, 1)")
        if not 0.0 <= self.m7_share < 1.0:
            raise ValueError("m7_share ∈ [0, 1)")
        if self.c2_cap_ms <= 0:
            raise ValueError("c2_cap_ms 양수 필요 (total>0 ⇒ c2>0 불변식의 전제)")
        for name in ("c2_floor_ms", "m7_max_ms", "c1_max_ms", "c1_min_ms",
                     "explanation_min_ms"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} 음수 불가")


@dataclass(frozen=True, slots=True)
class DeadlineBudget:
    """단계별 시한 배분 결과 — **상류는 상한, 어셈블리는 잔여 전부** (TRIP-376).

    `m7_ms`·`c1_ms`는 각 단계의 **상한**(점수 상한은 게이트웨이 호출 타임아웃으로 관통
    강제)이고, `c2_reserved_ms`는 어셈블리의 **최소 보장 바닥**이다. 어셈블리의 실제
    예산은 solve 시점 잔여 전부(≥ 바닥) — 앞 단계가 일찍 끝나면 그만큼 어셈블리가 더 받는다.

    불변식(구조 강제): 상한 합 + 바닥 ≤ total (상한 합이 바닥을 침범할 수 없다 —
    상한을 다 써도 바닥은 남는다), 전체 예산이 양수인 한 **바닥은 0보다 크다**.
    "배분이 나빠서 항상 최소 일정만 나오는" 상태는 이 타입의 인스턴스로 표현 자체가
    불가능하다.
    """

    total_ms: int
    m7_ms: int
    c1_ms: int
    c2_reserved_ms: int

    def __post_init__(self) -> None:
        if min(self.m7_ms, self.c1_ms, self.c2_reserved_ms) < 0:
            raise ValueError("배분은 음수가 될 수 없음")
        if self.m7_ms + self.c1_ms + self.c2_reserved_ms > max(0, self.total_ms):
            raise ValueError("상한 합이 어셈블리 바닥을 침범함")
        if self.total_ms > 0 and self.c2_reserved_ms <= 0:
            raise ValueError("어셈블리 바닥이 0 이하 — 배분 규칙 위반")


ZERO_BUDGET = DeadlineBudget(total_ms=0, m7_ms=0, c1_ms=0, c2_reserved_ms=0)


def allocate(total_ms: int, config: OrchestratorConfig) -> DeadlineBudget:
    """전체 예산 → 단계별 상한 배분. 어셈블리 바닥을 **먼저 떼고** 남은 것이 상류 상한이다.

    바닥을 나중에 계산하면 상류가 다 써버렸을 때 0 이하가 된다 — 순서가 곧 보장이다.
    어셈블리의 실제 예산은 이 바닥이 아니라 solve 시점 잔여 전부다(에이전트 ④).
    - 5,000ms(day1): 바닥 2,500 / 풀 상한 750 / 점수 상한 1,750 (즉답 목적 —
      실호출 바닥 ~3s > 상한이라 규칙 점수 유지가 의도)
    - 20,000ms(전체): 바닥 5,000 / 풀 상한 1,000 / 점수 상한 14,000 (TRIP-376 —
      점수 실호출 바닥 ~3s·변동 3~4배(TRIP-373 실측)라 종전 2.5s 배분은 미사용)
    """
    total = max(0, total_ms)
    c2_reserved = min(
        total, config.c2_cap_ms,
        max(config.c2_floor_ms, int(total * config.c2_min_share)),
    )
    upstream = max(0, total - c2_reserved)
    m7 = min(config.m7_max_ms, int(upstream * config.m7_share))
    c1 = min(config.c1_max_ms, max(0, upstream - m7))
    return DeadlineBudget(
        total_ms=total, m7_ms=m7, c1_ms=c1, c2_reserved_ms=c2_reserved
    )
