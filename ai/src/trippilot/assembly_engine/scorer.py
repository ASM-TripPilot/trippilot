"""규칙 점수 (정본 §4.3 결정론 모드, U2 FD §2.5).

build_rule_score = 선호 점수 ML(A-1)의 폴백 — 삭제 금지 (AI-D05).
admission_fit = 예산 소프트 가중 (U5-P6 단조성 대상, 하드 제약 아님 — INV-SOLVE3).
  종전 `budget_fit(avg_cost, …)` 을 대체한다 — 가격 정본이 AI 쪽 파생 지식으로
  결정되면서(2026-09-24) `Poi.avg_cost` 는 영구히 `None` 이다(백엔드 read 경계에
  가격 필드 없음 + `to_cacheable_dict` 가 제거). 상수를 더하던 항을 실제 값으로 바꾼다.
전부 순수 함수·결정론 (시드 기반 tie-break만).
"""

from __future__ import annotations

import math
import zlib

from trippilot.assembly_engine.travel import haversine_km
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

# ── 입장료 임계 — 카테고리별 (TourAPI 실측 2026-09-24, n=494) ─────────
#
# **전역 임계 한 벌로는 못 덮는다.** 유료일 때 중앙값이 카테고리마다 세 배 범위다:
#
#     카테고리   유료n   중앙     q75      최대
#     NATURE      19    5,000   8,000   13,000
#     CULTURE     42    7,000  13,250   30,000
#     SIGHT       34    9,500  15,000   45,000
#     ACTIVITY     6   16,500  18,500   20,000   ← 표본 부족, 임계 없음
#
# 절대 임계 하나로 자르면 카테고리가 통째로 날아간다(ACTIVITY 중앙 16,500). 그래서
# **그 카테고리 안에서 비싼 쪽**을 본다 — 예산이 낮은 사용자도 박물관은 가되 3만원짜리
# 대신 싼 쪽으로 간다.
#
# LOW 는 그 카테고리 유료 중앙, MID 는 q75. HIGH 는 임계 없음(비용 무관).
# ACTIVITY 는 유료 n=6 이라 **뺀다** — 얇은 표본으로 경계를 정하면 그 숫자가 근거로
# 굳는다(anti-patterns 「얇은 표본은 단정형 결론의 면죄부가 아니다」).
_FEE_CEILING: dict[BudgetLevel, dict[PoiCategory, int]] = {
    BudgetLevel.LOW: {
        PoiCategory.NATURE: 5_000,
        PoiCategory.CULTURE: 7_000,
        PoiCategory.SIGHT: 9_500,
    },
    BudgetLevel.MID: {
        PoiCategory.NATURE: 8_000,
        PoiCategory.CULTURE: 13_250,
        PoiCategory.SIGHT: 15_000,
    },
    BudgetLevel.HIGH: {},
}

# 예산 항의 기준값과 초과 감점. 기준값은 종전 "미상 중립" 값(0.1)을 그대로 쓴다 —
# 켜지기 전과 후의 기본 동작이 같아야 한다.
_BUDGET_NEUTRAL = 0.1
_OVER_BUDGET_PENALTY = 0.1   # 중립의 절반 크기 — 취향 점수(카테고리 0.5~1.0)를 못 뒤집는다


def admission_fit(fee_won: int | None, category: PoiCategory, budget: BudgetLevel) -> float:
    """입장료 예산 적합 — **비대칭**. 아는 것은 "비싸다"뿐이다.

    종전 `budget_fit` 은 싼 것에 **가점**을 줬다(`0원 → 0.3`, 미상 → 0.1). 요금
    커버리지가 30.6% 이고 카테고리에 정렬돼 있어서(FOOD·CAFE 는 구조적으로 0%),
    그러면 **"싸서 받는 가점"이 아니라 "기록이 있어서 받는 가점"** 이 된다 — 같은
    무료 공원 둘이 요금 레코드 유무로 0.3 vs 0.1 로 갈린다.

    그래서 **기록이 있으면 손해만 볼 수 있고 이득은 못 보게** 한다:

        모름 · 예산 안  → 중립 (같다)
        예산 초과       → 중립 − 감점

    이러면 수집을 아무리 해도 특정 카테고리가 유리해지지 않는다 — 커버리지 편향이
    구조적으로 사라진다. 정보량 근거도 같다: 판정분의 79.6% 가 0원이라 "싸다"는
    사실상 정보가 없고, 정보는 나머지 20% 에 있다.

    **하드 배제가 아니다.** 예산 초과 POI 도 배치될 수 있다 — 감점이 취향 점수
    격차(카테고리 가중 0.5~1.0)를 못 뒤집는 크기다. 부분 데이터로 후보를 없애면
    원천 오타 하나가 장소를 조용히 지운다(실측: `청소년 181,000원` = 18,000 오타).
    """
    ceiling = _FEE_CEILING[budget].get(category)
    if fee_won is None or ceiling is None:
        return _BUDGET_NEUTRAL      # 모름 · 임계 없는 카테고리 · HIGH
    return _BUDGET_NEUTRAL if fee_won <= ceiling else _BUDGET_NEUTRAL - _OVER_BUDGET_PENALTY


# ── 재계획 지시 — 사용자가 명시적으로 고른 방향 (KB-4) ─────────────────
#
# `DirectiveSpec.prefer_categories` / `avoid_categories` 를 **실제로 읽는 첫 자리**다.
# 2026-09-24 실측: 사전 20종(PROMPT 11·RANKING 3·SOLVER 6)이 전부 적재돼 있는데
# `enforced_by`·`prefer_categories`·`avoid_categories` 를 읽는 코드가 `src/` 전체에
# **0건**이었다 — 사전이 인식은 하고 아무 효과가 없었다.
#
# **크기를 "한 단"(0.3)으로 잡는다.** 이 리포가 쓰는 말이고(`AssemblyConfig` 주석:
# "취향 점수 갭이 한 단(≥0.3) 이상이면 점수 서열이 그대로 이긴다"), 그 값이어야
# 지시가 카테고리 가중치를 실제로 넘는다 — ACTIVITY 0.9 를 CULTURE 0.8 아래로
# 내리려면 0.1 로는 부족하고, "힘든 건 피해줘"를 눌렀는데 액티비티가 그대로 오면
# 그 버튼은 거짓이다.
#
# **요금(`admission_fit`)과 달리 대칭이다.** 그쪽은 커버리지가 30%라 "기록이 있어서
# 받는 가점"이 생겨 비대칭으로 막았는데, 지시는 사용자가 방금 누른 것이고 후보의
# 카테고리는 **전원 알려져 있다** — 부분 관측이 아니라서 편향이 생길 자리가 없다.
DIRECTIVE_STEP = 0.3


def directive_fit(
    category: PoiCategory,
    prefer: frozenset[PoiCategory] = frozenset(),
    avoid: frozenset[PoiCategory] = frozenset(),
) -> float:
    """지시 적합 — 선호 +, 회피 −, 해당 없으면 0.

    **둘 다 걸리면 0 이다**(상쇄). 사용자가 서로 반대인 칩을 같이 눌렀다는 뜻이고,
    그때 한쪽을 임의로 이기게 하면 화면에 설명할 수 없는 결과가 나온다 —
    아무것도 안 하는 것이 정직하다. 그 상쇄는 호출측이 노트로 남긴다.
    """
    in_prefer, in_avoid = category in prefer, category in avoid
    if in_prefer and in_avoid:
        return 0.0
    if in_prefer:
        return DIRECTIVE_STEP
    if in_avoid:
        return -DIRECTIVE_STEP
    return 0.0


# 인기 포화점 — 저장 수가 이만큼이면 인기 항이 만점. 별점(0~5)이 차지하던 0~0.5 폭을
# 그대로 쓰므로 다른 항(카테고리·예산·거리)과의 상대 비중은 변하지 않는다.
_POPULARITY_FULL = 1000


def _popularity_norm(saved_count: int) -> float:
    """인앱 저장 수 → 0~0.5. 상한 없는 카운트라 log 로 눌러 상위 소수가 독식하지 않게."""
    return min(math.log1p(saved_count) / math.log1p(_POPULARITY_FULL), 1.0) * 0.5


def build_rule_score(
    poi: Poi,
    budget: BudgetLevel,
    anchor: GeoPoint | None,
    seed: int,
    fee_won: int | None = None,
    prefer: frozenset[PoiCategory] = frozenset(),
    avoid: frozenset[PoiCategory] = frozenset(),
) -> float:
    """LLM 점수 부재 시의 결정론 점수 (동일 입력 → 동일 출력, U5-P3).

    `fee_won` 은 **파생 지식**이라 `Poi` 에 안 싣는다 — `Poi` 는 백엔드가 말한
    것만 담는다(정본 단일 소유, PR #76). 호출측이 `place_fees.FeeTable.of()` 로
    뽑아 넘긴다. 기본 `None` 이라 기존 호출은 전부 무영향(전 POI 중립).
    """
    popularity_norm = _popularity_norm(poi.saved_count)
    dist_penalty = 0.0
    if anchor is not None:
        dist_penalty = min(haversine_km(anchor, poi.coord) * 0.02, 0.5)
    # 시드 기반 미세 tie-break (crc32 — 파이썬 hash와 달리 실행 간 안정)
    jitter = (zlib.crc32(f"{seed}:{poi.poi_id}".encode()) % 1000) / 1e7
    return (CATEGORY_WEIGHT[poi.category] + popularity_norm
            + admission_fit(fee_won, poi.category, budget)
            + directive_fit(poi.category, prefer, avoid)
            - dist_penalty + jitter)
