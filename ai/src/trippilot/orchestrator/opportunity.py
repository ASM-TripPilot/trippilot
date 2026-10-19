"""기회 카드 판정 — 그 날 남은 동선 근처의 행사·'요즘 인기' 장소 (situation-awareness BR-SA-22 · DEC-SA-6, LLM 0회).

트리거가 아니다(DEC-U4-4 — 문제가 아니라 기회)·알림 경로도 타지 않는다(LEGAL-U6-02). 카드가 가리키는 것은
언제나 **등록 POI** 다(INV-1) — 행사는 후보가 아니고, 행사장(이름)이나 행사장 가까이(카테고리)의 등록 POI 에
사상될 때만 카드가 된다.

- `EVENT_VENUE`  : 기간이 겹치는 행사 좌표 1km 안 + 행사 주소·이름에 POI 이름이 들어 있다
- `EVENT_NEARBY` : (행사장이 없을 때) 행사 좌표 0.3km 안 + 카테고리 적합 — 아래 `_NEARBY_FIT`(설계 D6 원안).
  표에 없는 유형(팝업 등)은 이름 대조만 한다
- `TRENDING`     : POI 태그 '요즘 인기'

행사 원천은 공식(TourAPI `tourapi-`)과 수동 큐레이션(`popup-`)만 보인다 — 네이버 검색 → LLM 추출(`evx-`)은
카드에 올리지 않는다(O-SA-12). 시각은 다루지 않는다 — 행사 원천이 일 단위다(INV-2). 거리는 직선거리 값만
내고 문자열은 경계가 만든다(INV-3 — 소요시간 없음).
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from enum import Enum

# 아래 둘은 기존 판정을 그대로 쓴다 — 사본을 만들지 않는다: '그날 휴무 증명'(배선·자연어 재계획과 같은 판정) ·
# 등록 이름 대조의 정규화
from trippilot.agents.planb.composition import hours_label
from trippilot.agents.planb.request_verification import normalize
from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.event import EventInfo, EventType
from trippilot.domain.poi import NIGHTLIFE_TAG, TRENDING_TAG, HolidayCalendar, Poi, PoiCategory
from trippilot.llm_gateway.gates.base import has_contact_like
from trippilot.orchestrator.event_affinity import ATTACH_RADIUS_KM

NEAR_KM = 1.0             # 남은 슬롯 ↔ 카드 장소 — 경계가 슬롯마다 이 반경으로 등록 POI 를 묻는다
NEARBY_KM = 0.3           # 행사 좌표 ↔ '행사장 가까이' 장소 (이름이 안 맞을 때)
MAX_OPPORTUNITIES = 3
_SHOWN_EVENT_SOURCES = ("tourapi-", "popup-")  # 공식 축제 · 수동 큐레이션 팝업 (O-SA-12)
_VENUE_NAME_MIN = 3       # 행사장 이름 대조 최소 길이 — '공원' 같은 두 글자가 아무 주소에나 붙지 않게
_NAME_MIN, _NAME_MAX = 2, 60  # 표시 게이트 — 실측 행사명 최대 61자
# '행사장 가까이'로 인정하는 장소 종류(설계 D6 원안 — 실측 행사의 40%가 이 판정으로만 짝을 찾는다). 생성 점수의
# 취향표(event_affinity)와 따로 둔다: 그쪽은 '이 여행자가 좋아할까', 여기는 '행사장 곁에 둘 만한 곳인가'다
_NEARBY_FIT: Mapping[EventType, frozenset[PoiCategory]] = {
    EventType.FESTIVAL: frozenset({PoiCategory.SIGHT, PoiCategory.NATURE, PoiCategory.NIGHT_VIEW,
                                   PoiCategory.ACTIVITY, PoiCategory.CULTURE}),
    EventType.PERFORMANCE: frozenset({PoiCategory.CULTURE, PoiCategory.SIGHT}),
    EventType.EXHIBITION: frozenset({PoiCategory.CULTURE, PoiCategory.SIGHT}),
}


class OpportunityKind(Enum):
    EVENT_VENUE = "EVENT_VENUE"
    EVENT_NEARBY = "EVENT_NEARBY"
    TRENDING = "TRENDING"


_KIND_RANK = {OpportunityKind.EVENT_VENUE: 0, OpportunityKind.EVENT_NEARBY: 1, OpportunityKind.TRENDING: 2}


@dataclass(frozen=True, slots=True)
class Opportunity:
    key: str                  # "event:{event_id}" | "trending:{poi_id}" — 순위 꼬리·기기 숨김의 키
    kind: OpportunityKind
    poi: Poi                  # 등록 POI (INV-1)
    near_slot_key: str        # 가장 가까운 남은 슬롯
    distance_km: float        # 그 슬롯 ↔ 장소 직선거리
    event: EventInfo | None = None


def find_opportunities(
    day: date,
    slots: Sequence[tuple[str, GeoPoint]],
    events: Iterable[EventInfo],
    pois: Iterable[Poi],
    planned: Collection[PoiId],
    holidays: HolidayCalendar | None = None,
) -> tuple[Opportunity, ...]:
    """남은 슬롯 `(slot_key, 좌표)` 근처의 기회 ≤ 3. 입력 순서와 무관한 결정론이다."""
    skip = frozenset(planned)
    places: dict[PoiId, tuple[Poi, str, float]] = {}
    for poi in pois:
        if poi.poi_id in skip or poi.poi_id in places or not _eligible(poi, day, holidays):
            continue
        near = min(((haversine_km(c, poi.coord), key) for key, c in slots), default=None)
        if near is not None and near[0] <= NEAR_KM:
            places[poi.poi_id] = (poi, near[1], near[0])

    # 슬롯에서 NEAR_KM + 1km 보다 먼 행사는 카드가 될 장소를 가질 수 없다(삼각부등식) — 장소 대조 전에 거른다
    reach = NEAR_KM + ATTACH_RADIUS_KM
    shown = (e for e in events if _shown(e, day)
             and min((haversine_km(c, e.coord) for _, c in slots), default=reach + 1) <= reach)
    cards = [c for c in (_event_card(e, places.values()) for e in shown) if c is not None]
    cards += [Opportunity(f"trending:{p.poi_id}", OpportunityKind.TRENDING, p, slot, km)
              for p, slot, km in places.values() if TRENDING_TAG in p.tags]
    cards.sort(key=_rank)

    picked: list[Opportunity] = []
    for card in cards:  # 한 POI·한 행사 한 장 — 순위가 높은 쪽이 가져간다
        if any(card.key == c.key or card.poi.poi_id == c.poi.poi_id for c in picked):
            continue
        picked.append(card)
        if len(picked) == MAX_OPPORTUNITIES:
            break
    return tuple(picked)


def _eligible(poi: Poi, day: date, holidays: HolidayCalendar | None) -> bool:
    """나이트라이프·숙소·그날 휴무가 증명된 곳은 권하지 않는다(정보 없음은 막지 않는다 — HC1 과 같은 판정,
    공휴일 휴무도 같은 헬퍼 — 상황 감지 H1)."""
    return (poi.category is not PoiCategory.STAY and NIGHTLIFE_TAG not in poi.tags
            and hours_label(poi, day, holidays) is not None and _displayable(poi.name))


def _shown(event: EventInfo, day: date) -> bool:
    return (event.event_type is not EventType.OTHER and event.coord is not None
            and event.event_id.startswith(_SHOWN_EVENT_SOURCES) and event.overlaps((day,))
            and _displayable(event.name))


def _displayable(name: str) -> bool:
    """웹 원천 문자열이 앱 목소리로 나가는 자리 — 길이·제어문자·링크·연락처 꼴을 막는다."""
    text = name.strip()
    return _NAME_MIN <= len(text) <= _NAME_MAX and text.isprintable() and not has_contact_like(text)


def _event_card(event: EventInfo, places: Iterable[tuple[Poi, str, float]]) -> Opportunity | None:
    """행사 1건 → 카드 1장(행사장 > 행사장 가까이). 사상할 장소가 없으면 카드도 없다."""
    venue_text = normalize(f"{event.address or ''} {event.name}")
    venue, nearby = [], []
    for poi, slot, km in places:
        to_event = haversine_km(event.coord, poi.coord)
        name = normalize(poi.name)
        if to_event <= ATTACH_RADIUS_KM and len(name) >= _VENUE_NAME_MIN and name in venue_text:
            venue.append((-len(name), to_event, str(poi.poi_id), poi, slot, km))
        elif to_event <= NEARBY_KM and poi.category in _NEARBY_FIT.get(event.event_type, ()):
            nearby.append((to_event, str(poi.poi_id), poi, slot, km))
    if venue:
        *_, poi, slot, km = min(venue)
        return Opportunity(f"event:{event.event_id}", OpportunityKind.EVENT_VENUE, poi, slot, km, event)
    if nearby:
        *_, poi, slot, km = min(nearby)
        return Opportunity(f"event:{event.event_id}", OpportunityKind.EVENT_NEARBY, poi, slot, km, event)
    return None


def _rank(card: Opportunity) -> tuple:
    """VENUE > NEARBY > TRENDING → 짧은 기간 → 거리 → key (→ 장소 id — 같은 key 의 중복 행사)."""
    days = (card.event.end - card.event.start).days if card.event is not None else 0
    return (_KIND_RANK[card.kind], days, card.distance_km, card.key, str(card.poi.poi_id))
