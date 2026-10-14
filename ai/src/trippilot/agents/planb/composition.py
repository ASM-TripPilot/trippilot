"""다시 짜기 — LLM 이 남은 하루를 고르기 위한 재료 (REPLAN_COMPOSITION).

후보 목록(닫힌 집합)과 방문 수 상한을 만든다. 고른 곳은 배선(`api/wiring.replan`)이 시각 없는
필수 방문으로 어셈블리에 넣고 하루 상한을 `고정 + 고른 수`로 묶는다 — 그날 들어가는 곳은 LLM 이
고른 것뿐이고, 시각·순서는 어셈블리가 동선·영업시간으로 정하고 검증한다(INV-2).

사유 규칙(BR-U4-47)은 여기서 코드로 지킨다 — 프롬프트에만 맡기지 않는다:
- 피해야 할 카테고리(우천 실내 등 `avoid`)는 후보에서 **뺀다**(원 일정의 남은 곳도).
- 선호·가까운 데로는 후보 순위(규칙 점수 — 지시 가산·거리 감점)로 위에 온다.
- 피로·지연 상한은 `max_visits` 에 들어간다(배선이 LLM 결과를 그 수로 자른다).
"""

from __future__ import annotations

from collections.abc import Callable, Collection
from datetime import datetime

from trippilot.domain.common import PoiId
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import Poi, PoiCategory

# 카테고리마다 점수 상위 몇 곳을 후보로 줄까 — 맛집·카페·명소가 고루 보여야 식사창을 채운다.
PER_CATEGORY = 6
# 후보 총량 상한 — 프롬프트 길이가 곧 지연이다(PlanB 63k 토큰 사고, #935).
SHORTLIST_MAX = 40
# 하루 방문 상한 — 원 일정 생성의 하루 최대치와 같은 급
MAX_VISITS = 8
# 한 곳에 드는 평균 시간(분) — 남은 시간 → 방문 수 환산. 이동 포함 1.5시간.
_MINUTES_PER_VISIT = 90

REASON_LABELS = {
    "none": "특별한 사유 없음 — 지금 일정이 마음에 안 들어 새로 짜 보고 싶음",
    "weather": "비·날씨가 나쁨",
    "closed": "가려던 곳이 휴무",
    "fully_booked": "가려던 곳이 만석·예약 마감",
    "canceled": "예약이 취소됨",
    "delay": "일정이 늦어짐",
    "fatigue": "체력이 떨어짐 — 덜 걷고 덜 움직이고 싶음",
}

_WEEKDAYS = "월화수목금토일"


def date_label(when: datetime) -> str:
    return f"{when:%Y-%m-%d} ({_WEEKDAYS[when.weekday()]})"


def hours_label(poi: Poi, weekday: int) -> str | None:
    """그날 영업시간 문구. 휴무가 **증명**되면 None(HC1 과 같은 판정 — 정보 없음은 막지 않는다)."""
    if not poi.open_hours:
        return "영업시간 정보 없음"
    ranges = [h for h in poi.open_hours if h.day_of_week == weekday]
    if not ranges:
        return None
    return ", ".join(f"{_hm(h.open_min)}~{_hm(h.close_min)}" for h in ranges)


def _hm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def max_visits(start: datetime, end: datetime, cap: int | None) -> int:
    """남은 시간 → 고를 수 있는 방문 수(1~MAX_VISITS). `cap` 은 사유 상한에서 고정을 뺀 값."""
    # 반올림 — 내림이면 저녁 2.5시간(식사 + 한 곳)이 1곳으로 줄었다(로컬 실측 18:30).
    minutes = int((end - start).total_seconds() // 60)
    by_time = (minutes + _MINUTES_PER_VISIT // 2) // _MINUTES_PER_VISIT
    n = max(1, min(MAX_VISITS, by_time))
    return max(1, min(n, cap)) if cap is not None else n


def shortlist(
    pool: CandidatePool,
    *,
    keep: Collection[PoiId],
    excluded: Collection[PoiId],
    weekday: int,
    score: Callable[[Poi], float],
) -> CandidatePool:
    """닫힌 집합 — `keep`(원 일정의 남은 곳·상황 추천)은 먼저, 나머지는 카테고리마다 점수 상위.

    빼는 것: 제외(다녀온 곳·거절·휴무 사유 대상·피할 카테고리의 곳), 숙소, 그날 휴무가 증명된 곳.
    `pool` 밖 id 는 `keep` 에 있어도 넣지 않는다 — 후보 자격은 풀이 정한다(INV-1).
    """
    def eligible(p: Poi) -> bool:
        return (p.poi_id not in excluded
                and p.category is not PoiCategory.STAY
                and hours_label(p, weekday) is not None)

    by_id = {p.poi_id: p for p in pool.pois if eligible(p)}
    chosen: dict[PoiId, Poi] = {pid: by_id[pid] for pid in keep if pid in by_id}
    ranked = sorted(by_id.values(), key=lambda p: (-score(p), str(p.poi_id)))
    per: dict[PoiCategory, int] = {}
    for p in ranked:
        if len(chosen) >= SHORTLIST_MAX:
            break
        if p.poi_id in chosen or per.get(p.category, 0) >= PER_CATEGORY:
            continue
        per[p.category] = per.get(p.category, 0) + 1
        chosen[p.poi_id] = p
    pois = tuple(chosen.values())
    return CandidatePool(
        poi_ids=frozenset(chosen), pois=pois, generated_at=pool.generated_at,
        anchor=pool.anchor, radius_km=pool.radius_km,
    )
