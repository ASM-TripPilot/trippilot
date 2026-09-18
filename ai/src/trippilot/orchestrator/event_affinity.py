"""행사 ↔ POI 근접 보너스 조립 — 순수 규칙 함수만 (TRIP-421, LLM 0회).

설계 확정(대화 2026-08-20):
- **점수 분리**: POI 선호 점수는 행사를 모른다(프롬프트 무접촉 — 취향 오염 방지).
  행사는 여기서 계산한 보너스 맵으로 어셈블리 소프트 항에만 들어간다.
- **양수만**: 행사가 취향에 맞으면 근처 POI에 보너스, 안 맞으면 0 — 감점 경로
  없음("행사 싫어도 광안리는 간다").
- **거리 감쇠**: 행사에 가까운 POI일수록 큰 보너스 — 선형 (1 − 거리/부착반경).
- 꺼내기 실효 반경 = 이동수단 기본 × 취향 계수 (조견표 — 판단 아님).

Provider가 못 하는 이유: 풀(PLACE)과 페르소나(PERSONA)를 함께 봐야 하는데
Provider끼리는 서로의 데이터를 못 본다 — 그래서 수집 후 조립 단계(오케스트레이터)
소관이다.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint, PoiId, TransportMode
from trippilot.domain.event import EventInfo, EventType
from trippilot.domain.persona import TasteTag
from trippilot.domain.poi import Poi

# 꺼내기 실효 반경 = 이동수단 기본 × 취향 계수, clamp [3, 40]km
_TRANSPORT_BASE_KM: Mapping[TransportMode, float] = {
    TransportMode.WALK: 5.0,
    TransportMode.PUBLIC: 15.0,
    TransportMode.CAR: 30.0,
}
_ACTIVE_FACTOR = 1.5   # 활동계(ACTIVITY) — 행사 때문에 더 멀리도 간다
_CALM_FACTOR = 0.7     # 차분계(REST, 활동계 없음) — 동선 반경을 좁게
_RADIUS_MIN_KM, _RADIUS_MAX_KM = 3.0, 40.0

ATTACH_RADIUS_KM = 1.0  # 행사 좌표 기준 POI 부착 반경 — 반경 안 전부, 상한 없음

# 행사 유형 ↔ 취향 태그 적합 조견표 — 교집합 있으면 적합(1.0), 없으면 0(보너스 없음).
# OTHER는 유형 불명 — 근거 없는 보너스를 주지 않는다.
_AFFINITY_TAGS: Mapping[EventType, frozenset[TasteTag]] = {
    EventType.FESTIVAL: frozenset({TasteTag.ACTIVITY, TasteTag.CULTURE}),
    EventType.PERFORMANCE: frozenset({TasteTag.CULTURE}),
    EventType.EXHIBITION: frozenset({TasteTag.CULTURE}),
    EventType.OTHER: frozenset(),
}


def event_radius_km(
    transport: TransportMode, taste_tags: tuple[TasteTag, ...]
) -> float:
    base = _TRANSPORT_BASE_KM.get(transport, _TRANSPORT_BASE_KM[TransportMode.PUBLIC])
    if TasteTag.ACTIVITY in taste_tags:
        factor = _ACTIVE_FACTOR
    elif TasteTag.REST in taste_tags:
        factor = _CALM_FACTOR
    else:
        factor = 1.0
    return max(_RADIUS_MIN_KM, min(_RADIUS_MAX_KM, base * factor))


def event_affinity(
    event_type: EventType, taste_tags: tuple[TasteTag, ...]
) -> float:
    return 1.0 if _AFFINITY_TAGS[event_type] & set(taste_tags) else 0.0


def event_bonus_map(
    events: Iterable[EventInfo],
    pool_pois: Iterable[Poi],
    *,
    anchor: GeoPoint,
    transport: TransportMode,
    taste_tags: tuple[TasteTag, ...],
) -> dict[PoiId, float]:
    """행사 → 근접 POI 보너스 맵 [0,1]. 스케일링(한 단 미만 크기)은 어셈블리 config 몫.

    같은 POI에 행사가 여럿 걸리면 최대값 채택 — 합산하면 밀집 지역이 인플레된다.
    좌표 없는 행사는 부착 불가로 건너뛴다 (목록 자체는 패킷에 남아 있다).
    """
    radius = event_radius_km(transport, taste_tags)
    bonus: dict[PoiId, float] = {}
    pois = tuple(pool_pois)
    for event in events:
        if event.coord is None:
            continue
        if haversine_km(anchor, event.coord) > radius:
            continue  # 실효 반경 밖 — 이 여행자에겐 너무 멂
        affinity = event_affinity(event.event_type, taste_tags)
        if affinity <= 0.0:
            continue
        for poi in pois:
            dist = haversine_km(event.coord, poi.coord)
            if dist > ATTACH_RADIUS_KM:
                continue
            value = affinity * (1.0 - dist / ATTACH_RADIUS_KM)  # 선형 감쇠
            if value > bonus.get(poi.poi_id, 0.0):
                bonus[poi.poi_id] = value
    return bonus
