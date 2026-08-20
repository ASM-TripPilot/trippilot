"""C2 솔버 설정 (U2 FD domain-entities §1 — AI-D07·G106·G51 확정 초기값).

실체는 remote config — 이 타입은 주입 컨테이너. 하드코딩 사용 금지(항상 주입).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from trippilot.domain.common import TransportMode
from trippilot.domain.poi import PoiCategory


def _default_speeds() -> dict[TransportMode, float]:
    # AI-D07 ③
    return {TransportMode.WALK: 4.0, TransportMode.PUBLIC: 20.0, TransportMode.CAR: 30.0}


def _default_safety() -> dict[TransportMode, float]:
    # G106
    return {TransportMode.WALK: 1.4, TransportMode.PUBLIC: 1.5, TransportMode.CAR: 1.5}


# G51 — 카테고리 기본 체류시간(분). B-1(체류시간 ML)의 폴백 테이블.
# PoiCategory 전 값을 덮어야 한다(직접 dict 조회 — 누락 시 KeyError).
# 신규 3종은 G51 원표(ai-data-design.md §2.2, 세분 택소노미)를 현 8종으로 접어서 도출:
#   NIGHT_VIEW 60 — 원표에 대응 행 없음. 전망대·야경 포인트는 조망 중심 단일 지점이라
#                   관람 동선이 있는 SIGHT(75)보다 짧고 CAFE(45)보다는 길다.
#   NATURE     90 — 원표 PARK 60(도심 공원)이 하한이나 '자연'은 산·해변·산책로를 함께 담아
#                   이동 반경이 넓다 → SIGHT(75) 위, 시간 고정형 ACTIVITY(120) 아래.
#   CULTURE    90 — 원표 MUSEUM 120 + HISTORIC 60을 함께 담는 상위 묶음이라 그 중간값.
STAY_DEFAULT_MIN: dict[PoiCategory, int] = {
    PoiCategory.FOOD: 60,
    PoiCategory.CAFE: 45,
    PoiCategory.SIGHT: 75,
    PoiCategory.NIGHT_VIEW: 60,
    PoiCategory.NATURE: 90,
    PoiCategory.CULTURE: 90,
    PoiCategory.ACTIVITY: 120,
    PoiCategory.SHOPPING: 60,
    PoiCategory.STAY: 30,
}


# TRIP-383 — 날씨 보정의 실외/실내 판정표 (경계 카테고리 8종 기준).
# 실외: 자연·야경·액티비티 — 강수에 체험이 직접 훼손되는 축.
# 실내: 문화(박물관류)·카페·쇼핑 — 강수 대피처로 기능하는 축.
# FOOD·SIGHT·STAY는 중립 — 실내외 혼재(식당/명소)라 어느 쪽으로도 밀지 않는다.
RAIN_OUTDOOR: frozenset[PoiCategory] = frozenset(
    {PoiCategory.NATURE, PoiCategory.NIGHT_VIEW, PoiCategory.ACTIVITY}
)
RAIN_INDOOR: frozenset[PoiCategory] = frozenset(
    {PoiCategory.CULTURE, PoiCategory.CAFE, PoiCategory.SHOPPING}
)


@dataclass(frozen=True, slots=True)
class SolverConfig:
    or_tools_limit_ms: int = 3000
    or_tools_min_ms: int = 500          # 이보다 잔여가 적으면 OR-Tools 단계 스킵 (DL-2)
    llm_stage_timeout_ms: int = 2500    # LLM 2차 요구 시간 (DL-2)
    local_search_min_remaining_ms: int = 3000
    buffer_min: int = 15                # G106 솔버 내부 버퍼
    detour_factor: float = 1.3          # 직선거리 우회계수
    speeds_kmph: dict[TransportMode, float] = field(default_factory=_default_speeds)
    safety: dict[TransportMode, float] = field(default_factory=_default_safety)
    # ── 식사 시간대 소프트 보정 (TRIP-379 신설 — 정본에 기존 규칙 없음:
    # ai-data-design.md §2.2는 RESTAURANT 기본 체류 60분만 정의하고, 카테고리-시간대
    # 적합성 규칙은 이 티켓이 처음 도입한다. 하드 제약(HC) 아님 — 식당 0개 풀에서도
    # 일정은 나온다("정보 없음 ≠ 배제").)
    # 창은 분-of-day [시작, 끝]: 점심 11:00~14:00, 저녁 17:00~20:00.
    lunch_window_min: tuple[int, int] = (11 * 60, 14 * 60)
    dinner_window_min: tuple[int, int] = (17 * 60, 20 * 60)
    # 가중 단위 = 선호 점수와 동일 축(score ∈ [0,1]). 보조적 크기 원칙:
    # 취향 점수 갭이 한 단(≥0.3) 이상이면 점수 서열이 그대로 이기고, 동률·근소 갭에서만
    # 식사 리듬이 개입한다 — 보정이 취향 점수를 압도하지 않도록.
    meal_bonus: float = 0.3             # 식사 창에 FOOD 1개 배치 시 창당 보상
    meal_penalty: float = 0.2           # 창 밖 FOOD·FOOD 연속 배치 억제 (건당)
    # ── 날씨 소프트 보정 (TRIP-383 — TRIP-379 식사 보정과 동형의 결정론 규칙).
    # 하드 배제 금지: 비가 와도 실외 배치는 가능하고, 실외만 남은 풀에서도 일정은
    # 나온다. problem.daily_rain_prob이 None이면 항 자체가 생기지 않아 종전과 동일.
    rain_threshold_pct: int = 60        # 이 강수확률(%) 이상인 날짜만 보정 대상
    # 가중 단위 = 선호 점수와 동일 축(score ∈ [0,1]) — 식사 보정 스케일 근거 그대로:
    # 실외 억제 0.2는 meal_penalty와 같은 "한 단 미만" 크기라 취향 점수 갭이 한 단
    # (≥0.3) 이상이면 점수 서열이 그대로 이기고, 동률·근소 갭에서만 실내로 재배치된다.
    # 실내 보상 0.1은 억제의 절반(소폭) — 보상까지 크면 우천일 실내가 취향을 압도한다.
    rain_outdoor_penalty: float = 0.2   # 우천일 실외(NATURE·NIGHT_VIEW·ACTIVITY) 억제
    rain_indoor_bonus: float = 0.1      # 우천일 실내(CULTURE·CAFE·SHOPPING) 소폭 보상
    # ── 행사 근접 보너스 (TRIP-421 — 양수만, 감점 경로 없음).
    # problem.event_bonus 값 [0,1](적합도×거리감쇠)에 이 스케일을 곱한다 —
    # 최대치(1.0×0.15)가 rain_indoor_bonus급 "한 단 미만" 크기: 근소 갭에서만
    # 행사 근접 POI가 유리해지고, 취향 점수 갭이 크면 서열 그대로.
    event_bonus_scale: float = 0.15

    def __post_init__(self) -> None:
        for name in ("or_tools_limit_ms", "or_tools_min_ms", "llm_stage_timeout_ms",
                     "local_search_min_remaining_ms", "buffer_min"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} 음수 불가")
        if self.detour_factor <= 0:
            raise ValueError("detour_factor 양수 필요")
        for name in ("lunch_window_min", "dinner_window_min"):
            lo, hi = getattr(self, name)
            if not (0 <= lo < hi <= 1440):
                raise ValueError(f"{name} 은 0 ≤ 시작 < 끝 ≤ 1440 분이어야 함")
        for name in ("meal_bonus", "meal_penalty",
                     "rain_outdoor_penalty", "rain_indoor_bonus",
                     "event_bonus_scale"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} 음수 불가")
        if not 0 <= self.rain_threshold_pct <= 100:
            raise ValueError(
                f"rain_threshold_pct 범위 밖 [0,100]: {self.rain_threshold_pct}")
