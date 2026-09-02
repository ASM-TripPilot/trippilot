"""U2 어셈블리용 generator — (problem, poi_index) 정합 세트 (U2 FD §3).

가해성(solvable) 보장 방침:
- POI 영업정보 없음(open_hours=()) → HC1 미적용, 좌표는 앵커 ±0.03도
- 고정 블록 0~1개: day[0]의 window 초반, 후보 풀 안 POI, 60분
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from hypothesis import strategies as st

from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, ScheduleId, TransportMode
from trippilot.domain.itinerary import FixedBlock, ItineraryProblem, TimeWindow
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource

_KST = timezone(timedelta(hours=9))
_ANCHOR = GeoPoint(37.751, 128.876)


def _poi(i: int, lat_off: float, lng_off: float, category: PoiCategory) -> Poi:
    return Poi(
        poi_id=PoiId(f"sp{i}"),
        name=f"poi{i}",
        category=category,
        coord=GeoPoint(_ANCHOR.lat + lat_off, _ANCHOR.lng + lng_off),
        open_hours=(),  # 정보 없음 → HC1 미적용 (가해성 보장)
        avg_cost=None,
        rating=None,
        quality=DataQuality.FULL,
        source=PoiSource.SEED,
        confidence=None,
    )


@st.composite
def assembly_setups(draw) -> tuple[ItineraryProblem, dict[PoiId, Poi]]:
    n = draw(st.integers(min_value=1, max_value=8))
    pois = [
        _poi(
            i,
            draw(st.floats(-0.03, 0.03, allow_nan=False, allow_infinity=False)),
            draw(st.floats(-0.03, 0.03, allow_nan=False, allow_infinity=False)),
            draw(st.sampled_from(list(PoiCategory))),
        )
        for i in range(n)
    ]
    index = {p.poi_id: p for p in pois}
    candidates = tuple(
        ScoredPoi(
            poi_id=p.poi_id,
            score=draw(st.floats(0, 1, allow_nan=False, allow_infinity=False)),
            is_llm_score=draw(st.booleans()),
        )
        for p in pois
    )
    d0 = draw(st.dates(min_value=date(2026, 8, 1), max_value=date(2026, 8, 20)))
    n_days = draw(st.integers(min_value=1, max_value=2))
    days = tuple(d0 + timedelta(days=k) for k in range(n_days))
    window = TimeWindow(
        start=datetime(d0.year, d0.month, d0.day, 9, 0, tzinfo=_KST),
        end=datetime(d0.year, d0.month, d0.day, 21, 0, tzinfo=_KST),
    )
    fixed: tuple[FixedBlock, ...] = ()
    if draw(st.booleans()) and pois:
        fb_poi = pois[0]
        fb_start = datetime(d0.year, d0.month, d0.day, 9, 30, tzinfo=_KST)
        fixed = (FixedBlock(
            poi_id=fb_poi.poi_id,
            window=TimeWindow(start=fb_start, end=fb_start + timedelta(minutes=60)),
            reason="user_fixed",
        ),)
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-bench"),
        days=days,
        candidates=candidates,
        fixed_blocks=fixed,
        budget=draw(st.sampled_from(list(BudgetLevel))),
        transport=draw(st.sampled_from(list(TransportMode))),
        day_window=window,
        seed=draw(st.integers(min_value=0, max_value=2**31)),
        anchor=draw(st.one_of(st.none(), st.just(_ANCHOR))),
    )
    return problem, index


# ── TRIP-531 카테고리 다양성 항 전용 ──────────────────────────────
# 체류 ≤75분 카테고리만 (config.STAY_DEFAULT_MIN) — 전량 배치 가능성 산정의 상한.
_SHORT_STAY_CATS = (PoiCategory.FOOD, PoiCategory.CAFE, PoiCategory.SIGHT,
                    PoiCategory.NIGHT_VIEW, PoiCategory.SHOPPING)


@st.composite
def skewed_category_setups(
    draw, mono: bool = False
) -> tuple[ItineraryProblem, dict[PoiId, Poi]]:
    """TRIP-531 다양성 항 전용 — 지배 카테고리 편중 + 순서 무관 전량 배치 풀.

    assembly_setups와 달리 다음을 보장한다:
    - 지배 카테고리 후보 4~6개(mono=True면 4~8개 전원) + 여행 2일 고정 →
      일별 허용치 max(category_free_count=2, ⌈후보÷2⌉)를 실제로 초과시켜
      새 코드 경로(폴백 재정렬·OR-Tools 페널티 항)를 반드시 태운다
    - 체류 ≤75분 카테고리 + 좌표 ±0.001도(호핑 ≤23분, WALK 최악) + 창 09~21시
      + anchor·고정 블록 없음 → **어떤 시도 순서로도 2일 안에 전 후보가 들어간다**
      (일1은 말단 622분 전까지 실패 불가능 → 이월 ≤1개 → 일2가 흡수).
      "후순위 ≠ 손실" 단언은 이 순서 무관 가해성 위에서만 정리(theorem)가 된다
    - 점수 하한 0.05 — 0점 후보는 목적함수상 배치 무차별이라 비배제 단언의 교란

    mono=True: 전원 지배 카테고리(단일 카테고리 풀 — "감점일 뿐 배제 아님" 증명용).
    """
    dom = draw(st.sampled_from(_SHORT_STAY_CATS))
    cats = [dom] * draw(st.integers(min_value=4, max_value=8 if mono else 6))
    if not mono:
        others = [c for c in _SHORT_STAY_CATS if c is not dom]
        cats += [draw(st.sampled_from(others))
                 for _ in range(draw(st.integers(min_value=1, max_value=2)))]
    pois = [
        _poi(
            i,
            draw(st.floats(-0.001, 0.001, allow_nan=False, allow_infinity=False)),
            draw(st.floats(-0.001, 0.001, allow_nan=False, allow_infinity=False)),
            cats[i],
        )
        for i in range(len(cats))
    ]
    index = {p.poi_id: p for p in pois}
    candidates = tuple(
        ScoredPoi(
            poi_id=p.poi_id,
            score=draw(st.floats(0.05, 1, allow_nan=False, allow_infinity=False)),
            is_llm_score=draw(st.booleans()),
        )
        for p in pois
    )
    d0 = draw(st.dates(min_value=date(2026, 8, 1), max_value=date(2026, 8, 20)))
    problem = ItineraryProblem(
        schedule_id=ScheduleId("s-531"),
        days=(d0, d0 + timedelta(days=1)),
        candidates=candidates,
        fixed_blocks=(),
        budget=draw(st.sampled_from(list(BudgetLevel))),
        transport=draw(st.sampled_from(list(TransportMode))),
        day_window=TimeWindow(
            start=datetime(d0.year, d0.month, d0.day, 9, 0, tzinfo=_KST),
            end=datetime(d0.year, d0.month, d0.day, 21, 0, tzinfo=_KST),
        ),
        seed=draw(st.integers(min_value=0, max_value=2**31)),
        anchor=None,
    )
    return problem, index
