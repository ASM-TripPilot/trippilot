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

from collections.abc import Callable, Collection, Mapping, Sequence
from datetime import date, datetime

from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.itinerary import VisitSlot
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import NIGHTLIFE_TAG, HolidayCalendar, Poi, PoiCategory, hours_label, open_windows_on  # noqa: F401 — hours_label 은 재export(미결 #16)

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

# 다시 짜기에서 "얼마나 바꿀지" — 요청 종류마다 한 줄(TRIP-1394). 0.2.0 은 "그대로 돌려주지 마라"
# 한 규칙이라 "카페 하나 추가"에도 하루를 다 갈았고(로컬 실측 유지 0/6), 0.1.0 은 반대로 "괜찮으면
# 그대로"라 "실내로"에 아무것도 안 바뀌었다. 종류는 코드가 정하고 프롬프트엔 결론 한 줄만 싣는다.
PLACE_REASONS = frozenset({"closed", "fully_booked", "canceled"})  # 특정 장소가 문제인 사유
CHANGE_ADD = "요청은 한 곳을 더하는 것입니다 — 남은 일정은 그대로 두고 요청한 곳을 더하세요. 시간이 모자라면 가장 덜 중요한 한 곳만 바꾸세요"
CHANGE_PLACE = "문제가 된 곳(제외 요청)만 비슷한 역할의 다른 곳으로 바꾸고, 나머지 남은 일정은 그대로 두세요"
CHANGE_MATCH = "사유·요청에 맞지 않는 곳만 바꾸고, 맞는 곳은 그대로 두세요"
CHANGE_REFRESH = "특별한 사유 없이 새로 짜 보고 싶어 합니다 — 남은 일정의 절반 이상을 새 곳으로 바꿔 다른 하루를 제안하세요"
# 1회 수리(배선 `_repair_day`) — 1차 해는 그대로 두고 빈 시간만 채운다. 후보는 코드가 그 빈 시간에
# 그대로 들어가는 곳으로 이미 좁혔다(`fallback_assembler.explain_unplaced`).
CHANGE_REPAIR = "앞서 고른 하루는 '확정(유지)'로 그대로 들어갑니다(후보에 없음) — [빈 시간]마다 한 곳씩, 그 빈 시간 앞뒤 장소에서 가까운 곳으로 [못 넣은 곳]의 역할을 대신할 곳만 고르세요"
# 못 넣은 까닭(`explain_unplaced` 코드) → 프롬프트 문구. 표에 없는 코드(`fits` — 틈은 있는데 솔버가
# 탐색 한도에서 멈춤)는 다른 곳을 골라도 나아지지 않아 되묻지 않는다.
REPAIR_LABELS = {
    "closed": "이날 휴무",
    "hours": "남은 시간·영업시간 안에 머물 시간이 안 나옴",
    "far": "지금 위치에서 멀어 영업 중에 못 닿음",
    "full": "남은 시간이 모자라 못 들어감",
}


def change_rule(reasons: Collection[str], day_directives: bool, add_one: bool,
                free_text: bool) -> str:
    """요청 종류 → 바꿀 정도. `day_directives` = 하루 방향 지시(실내로 등), `add_one` = 한 곳 추가 지시."""
    place = any(r in PLACE_REASONS for r in reasons)
    other = any(r and r != "none" and r not in PLACE_REASONS for r in reasons)
    if add_one and not (other or day_directives):
        return CHANGE_ADD
    if place and not (other or day_directives or free_text):
        return CHANGE_PLACE
    if other or day_directives or free_text or place:
        return CHANGE_MATCH
    return CHANGE_REFRESH


_WEEKDAYS = "월화수목금토일"

# 변경 이력 출처 — 프롬프트에 영문 enum 을 그대로 싣지 않는다(KB-3 reason 한국어 치환과 같은 이유).
_CHANGE_SOURCE = {"PLAN_B": "다시 짜기", "MANUAL": "직접 편집", "COEDIT": "같이 편집", "ASSISTANT": "도우미"}


def recent_change_lines(change_log, names: "dict[PoiId, str]") -> tuple[str, ...]:
    """변경 이력 → "다시 짜기(비 예보): 성산일출봉 빠짐 / 제주민속촌 들어옴" 줄들 (TRIP-975).

    이름은 풀에서 가져오고, 못 찾은 id 는 그 줄에서 빠진다(이름 없는 id 를 흘리면 모델이 장소로 읽는다).
    양쪽 다 못 찾은 항목은 통째로 뺀다. 순서는 백엔드가 보낸 최신순 그대로, 시각은 싣지 않는다.
    """
    lines: list[str] = []
    for ev in change_log:
        out = [names[PoiId(p)] for p in ev.removed_poi_ids if PoiId(p) in names]
        into = [names[PoiId(p)] for p in ev.added_poi_ids if PoiId(p) in names]
        if not out and not into:
            continue
        head = _CHANGE_SOURCE.get(ev.source, ev.source)
        if ev.reason:
            head += f"({ev.reason})"
        parts = ([f"{', '.join(out)} 빠짐"] if out else []) + ([f"{', '.join(into)} 들어옴"] if into else [])
        lines.append(f"{head}: {' / '.join(parts)}")
    return tuple(lines)


def date_label(when: datetime) -> str:
    return f"{when:%Y-%m-%d} ({_WEEKDAYS[when.weekday()]})"


def max_visits(start: datetime, end: datetime, cap: int | None) -> int:
    """남은 시간 → 고를 수 있는 방문 수(1~MAX_VISITS). `cap` 은 사유 상한에서 고정을 뺀 값."""
    # 반올림 — 내림이면 저녁 2.5시간(식사 + 한 곳)이 1곳으로 줄었다(로컬 실측 18:30).
    minutes = int((end - start).total_seconds() // 60)
    by_time = (minutes + _MINUTES_PER_VISIT // 2) // _MINUTES_PER_VISIT
    n = max(1, min(MAX_VISITS, by_time))
    return max(1, min(n, cap)) if cap is not None else n


def repair_gaps(
    slots: Sequence[VisitSlot],
    start: datetime,
    end: datetime,
    fits: Mapping[PoiId, datetime],
    index: Mapping[PoiId, Poi],
    anchor: GeoPoint,
) -> tuple[dict[PoiId, int], dict[int, str], dict[PoiId, float]]:
    """1회 수리의 빈 시간 — 틈에 드는 후보(`fits` = 그 후보가 들어갈 가장 이른 시작)를 틈 번호로 묶는다.

    반환 (후보 → 틈 번호, 틈 번호 → "14:10~15:40 · 앞: X · 뒤: Y", 후보 → 거리 km). 틈 g 는 슬롯 g−1 끝
    (맨 앞이면 `start` = 창 시작·하한 중 늦은 쪽)부터 슬롯 g 시작(맨 뒤면 `end`)까지다. 거리는 그 틈의 앞
    장소에서(맨 앞 틈이면 뒤 장소, 슬롯이 없으면 기준점) 잰 직선 — 그 자리에 들어갈 곳이라 기준점 거리보다
    이 값이 동선을 말한다. 시각은 틈의 경계(어셈블리 값)뿐이다 — 후보의 시작 시각은 싣지 않는다(INV-2).
    """
    ordered = sorted(slots, key=lambda s: s.start_at)

    def name(s: VisitSlot) -> str:
        p = index.get(s.poi_id)
        return p.name if p is not None else str(s.poi_id)

    gap_of: dict[PoiId, int] = {}
    labels: dict[int, str] = {}
    near: dict[PoiId, float] = {}
    for pid, t in fits.items():
        poi = index.get(pid)
        if poi is None:
            continue
        g = sum(1 for s in ordered if s.end_at <= t)
        prev = ordered[g - 1] if g else None
        nxt = ordered[g] if g < len(ordered) else None
        if g not in labels:
            labels[g] = (f"{(prev.end_at if prev else start):%H:%M}~{(nxt.start_at if nxt else end):%H:%M}"
                         + (f" · 앞: {name(prev)}" if prev else "")
                         + (f" · 뒤: {name(nxt)}" if nxt else ""))
        ref = prev or nxt
        origin = index[ref.poi_id].coord if ref is not None and ref.poi_id in index else anchor
        gap_of[pid] = g
        near[pid] = haversine_km(origin, poi.coord)
    return gap_of, labels, near


def shortlist(
    pool: CandidatePool,
    *,
    keep: Collection[PoiId],
    excluded: Collection[PoiId],
    day: date,
    score: Callable[[Poi], float],
    cap: int = SHORTLIST_MAX,
    holidays: HolidayCalendar | None = None,
) -> CandidatePool:
    """닫힌 집합 — `keep`(원 일정의 남은 곳·상황 추천)은 먼저, 나머지는 카테고리마다 점수 상위.

    빼는 것: 제외(다녀온 곳·거절·휴무 사유 대상·피할 카테고리의 곳), 숙소, 그날 휴무가 증명된 곳(정기·공휴일 —
    조립과 같은 `open_windows_on`, 상황 감지 H1). `pool` 밖 id 는 `keep` 에 있어도 넣지 않는다 — 후보 자격은
    풀이 정한다(INV-1).
    """
    def eligible(p: Poi) -> bool:
        return (p.poi_id not in excluded
                and p.category is not PoiCategory.STAY
                and hours_label(p, day, holidays) is not None)

    by_id = {p.poi_id: p for p in pool.pois if eligible(p)}
    chosen: dict[PoiId, Poi] = {pid: by_id[pid] for pid in keep if pid in by_id}
    ranked = sorted(by_id.values(), key=lambda p: (-score(p), str(p.poi_id)))
    per: dict[PoiCategory, int] = {}
    for p in ranked:
        if len(chosen) >= cap:
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
