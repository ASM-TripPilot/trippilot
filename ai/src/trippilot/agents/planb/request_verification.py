"""자연어 재계획 — LLM 이 뽑은 정보를 **외부 소스로 검증한 뒤에만** 일정에 쓴다.

사용자가 다시 짜기에 "성심당은 꼭 가고 싶어, 6시까지 숙소로 돌아갈래" 처럼 쓰면
`REPLAN_REQUEST_EXTRACTION` 워커가 장소명·시간 제약·날씨 주장을 뽑는다. 뽑은 것은
**주장**일 뿐이다 — 모델이 이름을 잘못 옮겼거나, 그 가게가 문을 닫았거나, 이미 지난
시각이거나, 비가 안 오는 날일 수 있다. 그래서 항목마다 독립 출처로 대조하고, 통과한
것만 일정 조립에 넘긴다. 탈락은 사유와 함께 `notes` 로 나간다(INV-4 — 침묵 금지).

| 뽑은 것 | 대조하는 출처 | 통과해야 할 것 |
|---|---|---|
| 장소명 | 등록 POI(place-data, 반경 조회) | 이름이 맞는 등록 장소가 있다 — **후보 자격은 여기서만 생긴다**(INV-1) |
| 〃 | 지도 실재 포트(Kakao·Google) | NOT_FOUND 가 아니다(UNVERIFIED 는 통과 — 장애를 폐업으로 읽지 않는다) |
| 〃 | 그날 영업시간 | 휴무가 증명되지 않았다(정보 없음은 막지 않는다 — HC1 과 같은 판정) |
| 시각 제약 | 그날 남은 시간창 | 창 안이고 지금 이후다 — 창을 **좁히기만** 한다(넓히면 백엔드 창을 어긴다) |
| 날씨 주장 | 기상청 강수확률(수집 패킷) | 비 주장이면 임계 이상일 때만 실내 쪽으로 기운다 |

웹 검색 결과를 후보로 쓰지 않는다 — 지도 포트는 **확인용**이고, 후보는 등록 POI 에서만 온다.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, tzinfo

from trippilot.agents.planb.composition import hours_label
from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import Poi, PoiCategory
from trippilot.llm_gateway.gates.replan_request_extraction import (
    ExtractedPlace,
    ExtractedRequest,
)
from trippilot.ports.place_existence_port import (
    ExistenceQuery,
    ExistenceStatus,
    PlaceExistencePort,
)

# 이름 대조 반경(km). 재계획 후보 풀 반경(도보 2·대중교통 10·자차 20)보다 넓게 본다 —
# 사용자가 이름을 콕 집은 곳은 풀 밖이어도 갈 의사가 분명하다. 다만 같은 상호의 다른 지점
# (전국 체인)을 잡지 않도록 지역 안에 묶는다.
NAME_SEARCH_RADIUS_KM = 30.0
# 지정 시각이 남은 창에서 이만큼은 남겨야 의미가 있다 — 10분 남기고 "6시까지"는 무효.
MIN_WINDOW_MINUTES = 60
# 이름 대조 최소 길이 — "카페" 한 단어가 모든 카페에 붙지 않게.
_MIN_NAME_CHARS = 2
_NORMALIZE = re.compile(r"[\s\-·.,'\"()\[\]]+")


@dataclass(frozen=True, slots=True)
class VerifiedRequest:
    """검증을 통과한 것만. 배선이 이것을 필수 방문·제외·하루 창·회피 카테고리로 옮긴다."""

    visit: tuple[Poi, ...] = ()
    avoid: frozenset[PoiId] = frozenset()
    window_start: datetime | None = None
    window_end: datetime | None = None
    rain_confirmed: bool = False
    notes: tuple[str, ...] = field(default=())


def normalize(name: str) -> str:
    return _NORMALIZE.sub("", name).lower()


def match_place(name: str, registered: Sequence[Poi], anchor: GeoPoint) -> tuple[Poi | None, str]:
    """이름 → 등록 POI 하나. 정확 일치 > 포함 관계, 같은 급이면 가까운 곳. (POI, 노트)."""
    key = normalize(name)
    if len(key) < _MIN_NAME_CHARS:
        return None, "too_short"
    exact = [p for p in registered if normalize(p.name) == key]
    partial = [p for p in registered
               if p not in exact and len(normalize(p.name)) >= _MIN_NAME_CHARS
               and (key in normalize(p.name) or normalize(p.name) in key)]
    pick = exact or partial
    if not pick:
        return None, "not_registered"
    best = min(pick, key=lambda p: (haversine_km(anchor, p.coord), str(p.poi_id)))
    return best, ("exact" if exact else f"partial/{len(pick)}")


def verify_places(
    places: Sequence[ExtractedPlace],
    registered: Sequence[Poi],
    anchor: GeoPoint,
    weekday: int,
    existence: PlaceExistencePort | None,
    deadline_ms: int,
) -> tuple[tuple[Poi, ...], frozenset[PoiId], list[str]]:
    """장소 주장 → (갈 곳, 피할 곳, 노트). 세 출처를 모두 통과한 것만 남는다."""
    notes: list[str] = []
    matched: list[tuple[ExtractedPlace, Poi]] = []
    for ep in places:
        poi, how = match_place(ep.name, registered, anchor)
        if poi is None:
            notes.append(f"nl_place_rejected: {how}")  # 이름은 사용자 문자열이라 싣지 않는다
            continue
        matched.append((ep, poi))

    # 지도 실재 — 갈 곳만 확인한다(피할 곳은 없어도 피하는 데 문제가 없다).
    visits = [poi for ep, poi in matched if ep.want == "visit"]
    gone: set[PoiId] = set()
    if visits and existence is not None:
        try:
            verdicts = existence.verify(
                tuple(ExistenceQuery(poi_id=p.poi_id, name=p.name, coord=p.coord) for p in visits),
                deadline_ms=max(1, deadline_ms),
            )
            gone = {v.poi_id for v in verdicts if v.status is ExistenceStatus.NOT_FOUND}
            unverified = sum(1 for v in verdicts if v.status is ExistenceStatus.UNVERIFIED)
            if unverified:
                notes.append(f"nl_place_existence_unverified: {unverified}")
        except Exception as e:  # 포트 장애가 재계획을 죽이지 않는다 — 확인 못 함으로 둔다
            notes.append(f"nl_place_existence_error: {type(e).__name__}")
    elif visits:
        notes.append("nl_place_existence_unavailable")

    keep: list[Poi] = []
    avoid: set[PoiId] = set()
    for ep, poi in matched:
        if ep.want == "avoid":
            avoid.add(poi.poi_id)
            continue
        if poi.poi_id in gone:
            notes.append(f"nl_place_rejected: map_not_found {poi.poi_id}")
        elif hours_label(poi, weekday) is None:
            notes.append(f"nl_place_rejected: closed_that_day {poi.poi_id}")
        elif poi.category is PoiCategory.STAY:
            notes.append(f"nl_place_rejected: stay {poi.poi_id}")
        elif poi.poi_id not in {k.poi_id for k in keep}:
            keep.append(poi)
            notes.append(f"nl_place_accepted: visit {poi.poi_id}")
    if avoid:
        notes.append(f"nl_place_accepted: avoid {len(avoid)}")
    return tuple(keep), frozenset(avoid), notes


def verify_window(
    on: date,
    start_after: time | None,
    end_by: time | None,
    window_start: datetime,
    window_end: datetime,
    not_before: datetime | None,
    tz: tzinfo,
) -> tuple[datetime | None, datetime | None, list[str]]:
    """시각 주장 → 좁힌 창. 창 밖·지난 시각·너무 좁아지는 것은 버린다."""
    notes: list[str] = []
    floor = max(window_start, not_before) if not_before else window_start
    start = end = None
    if start_after is not None:
        at = datetime.combine(on, start_after, tzinfo=tz)
        if floor <= at < window_end:
            start = at
        else:
            notes.append("nl_time_rejected: start_after_outside_window")
    if end_by is not None:
        at = datetime.combine(on, end_by, tzinfo=tz)
        lo = start or floor
        if lo < at <= window_end:
            end = at
        else:
            notes.append("nl_time_rejected: end_by_outside_window")
    lo, hi = start or floor, end or window_end
    if (start or end) and hi - lo < timedelta(minutes=MIN_WINDOW_MINUTES):
        notes.append("nl_time_rejected: window_too_narrow")
        return None, None, notes
    if start:
        notes.append(f"nl_time_accepted: start_after {start:%H:%M}")
    if end:
        notes.append(f"nl_time_accepted: end_by {end:%H:%M}")
    return start, end, notes


def verify_weather(claim: str | None, rain_prob: int | None, threshold: int) -> tuple[bool, list[str]]:
    """비 주장 → 기상청 강수확률로 확인. 확인이 안 되면 따르지 않는다(관측이 말보다 세다)."""
    if claim != "rain":
        return False, []
    if rain_prob is None:
        return False, ["nl_weather_unverified: no_forecast"]
    if rain_prob >= threshold:
        return True, [f"nl_weather_confirmed: rain {rain_prob}%"]
    return False, [f"nl_weather_rejected: rain {rain_prob}% < {threshold}%"]


def verify(
    extracted: ExtractedRequest,
    *,
    on: date,
    anchor: GeoPoint,
    window_start: datetime,
    window_end: datetime,
    not_before: datetime | None,
    tz: tzinfo,
    registered: Callable[[], Sequence[Poi]],
    existence: PlaceExistencePort | None,
    existence_deadline_ms: int,
    rain_by_date: Mapping[date, int],
    rain_threshold: int,
) -> VerifiedRequest:
    """뽑은 주장 전부를 각자의 출처로 대조한다. 예외를 던지지 않는다(INV-4)."""
    notes: list[str] = []
    visit: tuple[Poi, ...] = ()
    avoid: frozenset[PoiId] = frozenset()
    if extracted.places:
        try:
            pool = registered()
        except Exception as e:  # 등록 POI 조회 장애 — 장소 주장은 하나도 쓸 수 없다
            notes.append(f"nl_place_lookup_error: {type(e).__name__}")
        else:
            visit, avoid, n = verify_places(
                extracted.places, pool, anchor, on.weekday(), existence, existence_deadline_ms)
            notes += n
    start, end, n = verify_window(
        on, extracted.start_after, extracted.end_by, window_start, window_end, not_before, tz)
    notes += n
    rain, n = verify_weather(extracted.weather, rain_by_date.get(on), rain_threshold)
    notes += n
    return VerifiedRequest(visit=visit, avoid=avoid, window_start=start, window_end=end,
                           rain_confirmed=rain, notes=tuple(notes))
