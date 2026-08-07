"""규칙 점수 (정본 §4.3 결정론 모드, U2 FD §2.5).

build_rule_score = 선호 점수 ML(A-1)의 폴백 — 삭제 금지 (AI-D05).
budget_fit = 예산 소프트 가중 (U5-P6 단조성 대상, 하드 제약 아님 — INV-SOLVE3).
전부 순수 함수·결정론 (시드 기반 tie-break만).
"""

from __future__ import annotations

import zlib

from trippilot.c2.travel import haversine_km
from trippilot.domain.common import BudgetLevel, GeoPoint
from trippilot.domain.poi import Poi, PoiCategory

# 축은 "그 카테고리가 일정의 주 목적지가 되는 정도" — 명소 최상, 식음은 중간,
# 쇼핑은 보조, STAY는 앵커라 0(선택 대상 아님). PoiCategory 전 값 커버 필수(직접 조회).
# 신규 3종은 이 축 위에서:
#   NIGHT_VIEW 0.9 — SIGHT 계열이나 야간 시간대에만 유효. 규칙 점수는 시간대 인지가 없어
#                    SIGHT(1.0)와 동률이면 주간 슬롯에서 과선택된다 → 한 단 아래.
#   NATURE     0.9 — 관람형 주 목적지(SIGHT 계열)지만 날씨 의존이 커 기본값은 한 단 아래.
#   CULTURE    0.8 — 박물관·미술관·공연은 관심 의존도가 커 보편 선호가 낮다 → FOOD와 동급.
CATEGORY_WEIGHT: dict[PoiCategory, float] = {
    PoiCategory.SIGHT: 1.0,
    PoiCategory.ACTIVITY: 0.9,
    PoiCategory.NIGHT_VIEW: 0.9,
    PoiCategory.NATURE: 0.9,
    PoiCategory.FOOD: 0.8,
    PoiCategory.CULTURE: 0.8,
    PoiCategory.CAFE: 0.6,
    PoiCategory.SHOPPING: 0.5,
    PoiCategory.STAY: 0.0,
}

_CHEAP_MAX = 15_000   # BudgetLevel.LOW 기준 (domain-entities U1 §0)
_MID_MAX = 40_000


def budget_fit(avg_cost: int | None, budget: BudgetLevel) -> float:
    """예산 소프트 보상 [0, 0.3].

    단조성(U5-P6): 저비용 POI일수록 예산이 낮아질수록 보상 비증가 없음(LOW≥MID≥HIGH),
    고비용 POI는 그 반대(LOW≤MID≤HIGH). 비용 미상은 예산 무관 중립.
    """
    if avg_cost is None:
        return 0.1  # 정보 없음 — 중립 (예산 필터 통과 규칙과 정합)
    if budget is BudgetLevel.LOW:
        return 0.3 if avg_cost <= _CHEAP_MAX else 0.0
    if budget is BudgetLevel.MID:
        return 0.2 if avg_cost <= _MID_MAX else 0.05
    return 0.15  # HIGH — 비용 무관 균등


def build_rule_score(
    poi: Poi,
    budget: BudgetLevel,
    anchor: GeoPoint | None,
    seed: int,
) -> float:
    """LLM 점수 부재 시의 결정론 점수 (동일 입력 → 동일 출력, U5-P3)."""
    rating_norm = (poi.rating / 5.0 * 0.5) if poi.rating is not None else 0.2
    dist_penalty = 0.0
    if anchor is not None:
        dist_penalty = min(haversine_km(anchor, poi.coord) * 0.02, 0.5)
    # 시드 기반 미세 tie-break (crc32 — 파이썬 hash와 달리 실행 간 안정)
    jitter = (zlib.crc32(f"{seed}:{poi.poi_id}".encode()) % 1000) / 1e7
    return (CATEGORY_WEIGHT[poi.category] + rating_norm
            + budget_fit(poi.avg_cost, budget) - dist_penalty + jitter)
