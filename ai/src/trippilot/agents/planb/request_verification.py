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
| 방문 시각("3시에 카페") | 〃 | 창 안이고 지금 이후다 — 하루 시작이 아니라 그 곳·종류의 방문 시각이다 |
| 날씨 주장 | 기상청 강수확률(수집 패킷) | 비 주장이면 임계 이상일 때만 실내 쪽으로 기운다 |
| 지역("강남에서") | 등록 POI 이름 | 그 이름이 든 곳이 `AREA_MIN_MATCHES` 이상 — 중심은 그 좌표들의 중앙값(후보가 아니라 기준점) |

웹 검색 결과를 후보로 쓰지 않는다 — 지도 포트는 **확인용**이고, 후보는 등록 POI 에서만 온다.
"""

from __future__ import annotations

import re
import statistics
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, field, replace
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

# 이름 대조 반경(km) = 백엔드 반경 조회 상한(`PoiReadService.MAX_RADIUS_KM`). 사용자가 이름으로
# 콕 집은 곳은 풀 반경(도보 2·대중교통 10·자차 20) 밖이어도 갈 의사가 분명하다.
# 30 이던 것을 올렸다 — DEV 실호출(2026-10-14)에서 제주시 기준점 → 성산일출봉이 38.4km 라
# `not_registered` 로 탈락했다. 제주 동서 폭이 73km 라 30 으로는 섬 반대편 명소를 못 잡는다.
# 같은 상호의 다른 지점(전국 체인)은 "가까운 곳이 이긴다"(`match_place`)가 막는다.
# ponytail: 50 을 넘는 곳(제주 서쪽 끝 → 동쪽 끝 등)은 여전히 못 잡는다 — 넘어야 하면 백엔드에
# 이름 검색 경계를 열어 반경 대신 지역으로 묻는다.
NAME_SEARCH_RADIUS_KM = 50.0
# 지정 시각이 남은 창에서 이만큼은 남겨야 의미가 있다 — 10분 남기고 "6시까지"는 무효.
MIN_WINDOW_MINUTES = 60
# 이름 대조 최소 길이 — 한 글자 키("산"·"역")가 그 글자를 품은 모든 이름에 붙지 않게. "카페" 같은 종류 단어를
# 막는 것은 이 문턱이 아니라 추출 프롬프트다(places 는 "이름으로 콕 집은 장소만", 종류는 categories). 3 으로 올리면
# 두 글자 지역·상호(강남·홍대·명동·성수, 카페 '해림')가 빠진다.
_MIN_NAME_CHARS = 2
_NORMALIZE = re.compile(r"[\s\-·.,'\"()\[\]]+")
# 후보 반경 밖에서 집은 곳 둘레 — 거기까지 가서 그곳 하나만 보고 오면 이동 앞뒤로 몇 시간이 빈다
# (DEV 2026-10-14: 제주시 → 성산 38km, 12:00~16:00 공백). 둘레의 등록 POI 를 후보에 넣어 구성 LLM 이
# 그 근처로 하루를 이어 짤 수 있게 한다. 카테고리당 상한은 둘레 463곳 중 393곳이 맛집이라서다.
NEARBY_RADIUS_KM = 5.0
NEARBY_MAX = 8
NEARBY_PER_CATEGORY = 2
# 지역 중심 — 이름에 그 지역 말("강남"·"성수")이 든 등록 POI 가 이만큼은 있어야 한다. 중앙값이라 다른 동네의 같은 말
# ("강남면옥")이 몇 곳 섞여도 중심이 끌려가지 않는다. 행정동 경계 데이터가 생기면 그걸로 바꾼다.
AREA_MIN_MATCHES = 3
# 잘 알려진 여행 동네의 중심 — 상호에 동네 이름을 잘 안 쓰는 곳이 있다(연희동: 로컬 이름 대조 3곳 미만 → 하루가 명동으로
# 갔다, 2026-10-20). 표가 먼저고, 없으면 이름 중앙값. 키는 `_area_key` 모양("동" 뗀 것), 대조는 "가장 긴 키가 말 안에 든다".
# ponytail: 손으로 고른 표다 — 행정동 경계·상권 데이터가 들어오면 그걸로 바꾼다.
KNOWN_AREAS: dict[str, GeoPoint] = {
    # 서울
    "강남": GeoPoint(37.4979, 127.0276), "역삼": GeoPoint(37.5006, 127.0364), "신사": GeoPoint(37.5205, 127.0228),
    "가로수길": GeoPoint(37.5205, 127.0228), "압구정": GeoPoint(37.5271, 127.0285), "청담": GeoPoint(37.5247, 127.0473),
    "코엑스": GeoPoint(37.5117, 127.0592), "잠실": GeoPoint(37.5133, 127.1001), "성수": GeoPoint(37.5446, 127.0557),
    "서울숲": GeoPoint(37.5444, 127.0374), "건대": GeoPoint(37.5404, 127.0692), "왕십리": GeoPoint(37.5612, 127.0371),
    "홍대": GeoPoint(37.5563, 126.9236), "연남": GeoPoint(37.5617, 126.9230), "연희": GeoPoint(37.5689, 126.9305),
    "합정": GeoPoint(37.5495, 126.9139), "망원": GeoPoint(37.5560, 126.9100), "상수": GeoPoint(37.5477, 126.9227),
    "신촌": GeoPoint(37.5552, 126.9369), "이태원": GeoPoint(37.5345, 126.9946), "한남": GeoPoint(37.5364, 127.0040),
    "해방촌": GeoPoint(37.5430, 126.9860), "용산": GeoPoint(37.5298, 126.9648), "여의도": GeoPoint(37.5219, 126.9245),
    "을지로": GeoPoint(37.5660, 126.9910), "명동": GeoPoint(37.5636, 126.9826), "종로": GeoPoint(37.5703, 126.9910),
    "익선": GeoPoint(37.5743, 126.9898), "인사": GeoPoint(37.5743, 126.9853), "북촌": GeoPoint(37.5826, 126.9830),
    "삼청": GeoPoint(37.5850, 126.9810), "서촌": GeoPoint(37.5790, 126.9700), "광화문": GeoPoint(37.5759, 126.9768),
    "대학로": GeoPoint(37.5822, 127.0019), "혜화": GeoPoint(37.5822, 127.0019), "동대문": GeoPoint(37.5710, 127.0095),
    "성북": GeoPoint(37.5930, 126.9990), "문래": GeoPoint(37.5175, 126.8950),
    # 부산
    "해운대": GeoPoint(35.1587, 129.1604), "광안리": GeoPoint(35.1532, 129.1187), "서면": GeoPoint(35.1578, 129.0600),
    "전포": GeoPoint(35.1570, 129.0640), "남포": GeoPoint(35.0979, 129.0306), "송정": GeoPoint(35.1789, 129.1999),
    "영도": GeoPoint(35.0911, 129.0681), "감천": GeoPoint(35.0975, 129.0106), "기장": GeoPoint(35.2444, 129.2222),
    # 제주
    "애월": GeoPoint(33.4636, 126.3317), "협재": GeoPoint(33.3940, 126.2397), "함덕": GeoPoint(33.5431, 126.6692),
    "월정리": GeoPoint(33.5560, 126.7960), "성산": GeoPoint(33.4586, 126.9426), "중문": GeoPoint(33.2490, 126.4120),
    "서귀포": GeoPoint(33.2490, 126.5600), "표선": GeoPoint(33.3260, 126.8340),
    # 강릉·경주
    "경포": GeoPoint(37.7957, 128.9087), "안목": GeoPoint(37.7720, 128.9470), "주문진": GeoPoint(37.8960, 128.8290),
    "황리단길": GeoPoint(35.8381, 129.2096),
}


@dataclass(frozen=True, slots=True)
class VerifiedRequest:
    """검증을 통과한 것만. 배선이 이것을 필수 방문·제외·하루 창·회피 카테고리로 옮긴다."""

    visit: tuple[Poi, ...] = ()
    avoid: frozenset[PoiId] = frozenset()
    window_start: datetime | None = None
    window_end: datetime | None = None
    rain_confirmed: bool = False
    # 종류 조건 — 후보 풀에 그 종류가 있는 것만. `only` 가 비면 제한 없음, `counts` 는 그 종류를 정확히 몇 곳.
    only: frozenset[PoiCategory] = frozenset()
    counts: tuple[tuple[PoiCategory, int], ...] = ()
    # 방문 시각 — "성심당은 5시에"(visit 의 곳)·"3시에 카페"(종류). 배선이 그 시각에 잠근다.
    visit_at: tuple[tuple[PoiId, datetime], ...] = ()
    category_at: tuple[tuple[PoiCategory, datetime], ...] = ()
    area_center: GeoPoint | None = None  # "강남에서 놀고 싶어" — 그 지역 중심(기준점일 뿐, 후보 자격 없음)
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


def _area_key(area: str) -> str:
    key = normalize(area)
    return key[:-1] if len(key) > 2 and key.endswith("동") else key


def known_area_key(area: str) -> str | None:
    """말 안에 든 가장 긴 표 이름(`KNOWN_AREAS` 키) — 없으면 None. "강남구쪽" → "강남"."""
    key = _area_key(area)
    return max((k for k in KNOWN_AREAS if k in key), key=len, default=None)


def area_center(area: str, registered: Sequence[Poi], anchor: GeoPoint) -> tuple[GeoPoint | None, str]:
    """지역 이름 → (중심, 노트 꼬리). 표(`KNOWN_AREAS`)가 먼저 — 여행지에서 `NAME_SEARCH_RADIUS_KM` 안일 때만
    (서울 마포 "성산동" ↔ 제주 "성산"). 없거나 멀면 이름에 그 말이 든 등록 POI 좌표의 중앙값(`AREA_MIN_MATCHES` 이상)."""
    key = _area_key(area)
    known = known_area_key(area)
    if known is not None and haversine_km(anchor, KNOWN_AREAS[known]) <= NAME_SEARCH_RADIUS_KM:
        return KNOWN_AREAS[known], "table"
    if len(key) >= _MIN_NAME_CHARS:
        hits = [p.coord for p in registered if key in normalize(p.name)]
        if len(hits) >= AREA_MIN_MATCHES:
            return GeoPoint(statistics.median(c.lat for c in hits),
                            statistics.median(c.lng for c in hits)), f"n={len(hits)}"
    return None, "far" if known is not None else "unknown"


def nearby(place: Poi, registered: Sequence[Poi], weekday: int) -> tuple[Poi, ...]:
    """집은 곳 둘레의 등록 POI — 가까운 순, 카테고리당 `NEARBY_PER_CATEGORY`, 최대 `NEARBY_MAX`.
    숙소·그날 휴무가 증명된 곳·자기 자신은 뺀다(숏리스트와 같은 자격)."""
    ranked = sorted(
        (p for p in registered
         if p.poi_id != place.poi_id and p.category is not PoiCategory.STAY
         and hours_label(p, weekday) is not None),
        key=lambda p: (haversine_km(place.coord, p.coord), str(p.poi_id)))
    out: list[Poi] = []
    per: dict[PoiCategory, int] = {}
    for p in ranked:
        if per.get(p.category, 0) < NEARBY_PER_CATEGORY:
            per[p.category] = per.get(p.category, 0) + 1
            out.append(p)
            if len(out) == NEARBY_MAX:
                break
    return tuple(out)


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


def verify_categories(
    extracted: ExtractedRequest, available: frozenset[PoiCategory],
) -> tuple[frozenset[PoiCategory], tuple[tuple[PoiCategory, int], ...], list[str]]:
    """종류 조건 → (only, counts, 노트). 대조 출처 = **이번 후보 풀에 그 종류가 있는가**.

    없는 종류는 버린다 — "카페로만"인데 카페가 0곳이면 따를 수 없는 조건이라, 제한을 걸면 빈 하루가 된다.
    `only` 의 종류가 전부 버려지면 제한도 풀린다(노트로 밝힌다).
    """
    notes: list[str] = []
    kept: list[tuple[PoiCategory, int | None]] = []
    for c in extracted.categories:
        cat = PoiCategory(c.category)
        if cat not in available:
            notes.append(f"nl_category_rejected: {cat.value} no_candidates")
            continue
        kept.append((cat, c.count))
        notes.append(f"nl_category_accepted: {cat.value}"
                     + (f" count={c.count}" if c.count is not None else "")
                     + (" only" if extracted.only else ""))
    only = frozenset(cat for cat, _ in kept) if extracted.only else frozenset()
    counts = tuple((cat, n) for cat, n in kept if n is not None)
    return only, counts, notes


def apply_counts(
    picks: Sequence[PoiId],
    *,
    only: frozenset[PoiCategory],
    counts: Sequence[tuple[PoiCategory, int]],
    category_of: Mapping[PoiId, PoiCategory],
    fill: Sequence[PoiId],
    keep: Collection[PoiId] = (),
) -> tuple[tuple[PoiId, ...], list[str]]:
    """구성 결과를 종류 조건에 맞춘다 — LLM 이 따르든 말든 결과가 조건을 지킨다.

    `only` 밖 종류는 뺀다(`keep` = 사용자가 이름으로 집은 곳은 예외 — 말이 서로 어긋나면 이름이 이긴다).
    `counts` 는 그 종류를 정확히 n 곳으로: 넘치면 뒤에서 덜고, 모자라면 `fill` 순서(우선순위)로 채운다.
    채울 후보가 없으면 모자란 채로 두고 노트로 밝힌다(INV-4).
    """
    want = dict(counts)
    out: list[PoiId] = []
    seen: dict[PoiCategory, int] = {}
    for p in dict.fromkeys(picks):
        cat = category_of.get(p)
        if p not in keep and only and cat not in only:
            continue
        if cat in want and seen.get(cat, 0) >= want[cat] and p not in keep:
            continue
        seen[cat] = seen.get(cat, 0) + 1
        out.append(p)
    notes: list[str] = []
    for cat, n in want.items():
        for p in fill:
            if seen.get(cat, 0) >= n:
                break
            if category_of.get(p) is cat and p not in out:
                out.append(p)
                seen[cat] = seen.get(cat, 0) + 1
        if seen.get(cat, 0) < n:
            notes.append(f"nl_category_short: {cat.value} {seen.get(cat, 0)}/{n}")
    return tuple(out), notes


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
    available: frozenset[PoiCategory] = frozenset(),
) -> VerifiedRequest:
    """뽑은 주장 전부를 각자의 출처로 대조한다. 예외를 던지지 않는다(INV-4).
    `available` = 이번 후보 풀에 있는 종류(종류 조건의 대조 출처)."""
    notes: list[str] = []
    visit: tuple[Poi, ...] = ()
    avoid: frozenset[PoiId] = frozenset()
    pool: Sequence[Poi] = ()
    # 가까운 표 이름이면 등록 POI 를 안 불러도 된다(반경 50km 조회는 서울에서 수만 건이다)
    table_near = extracted.area is not None and any(
        k in _area_key(extracted.area) and haversine_km(anchor, c) <= NAME_SEARCH_RADIUS_KM
        for k, c in KNOWN_AREAS.items())
    if extracted.places or (extracted.area and not table_near):
        try:
            pool = registered()
        except Exception as e:  # 등록 POI 조회 장애 — 장소·지역 주장은 하나도 쓸 수 없다
            notes.append(f"nl_place_lookup_error: {type(e).__name__}")
    if extracted.places and pool:
        visit, avoid, n = verify_places(
            extracted.places, pool, anchor, on.weekday(), existence, existence_deadline_ms)
        notes += n
    center = None
    if extracted.area:
        center, how = area_center(extracted.area, pool, anchor)
        # 지역 이름은 사용자 문자열이라 노트에 싣지 않는다(장소 노트와 같은 규칙)
        notes.append(f"nl_area_accepted: {how}" if center else f"nl_area_rejected: {how}")
    # "3시에 카페"를 모델이 start_after 로도 옮기면 하루가 15시에 시작해 오전이 통째로 빠졌다(로컬 실측
    # 2026-10-19). 방문 시각과 같은 시작 시각은 그 오독으로 보고 버린다.
    times = {p.at for p in extracted.places if p.at} | {c.at for c in extracted.categories if c.at}
    if extracted.start_after in times:
        extracted = replace(extracted, start_after=None)
        notes.append("nl_time_dropped: start_after_is_visit_time")
    floor = max(window_start, not_before) if not_before else window_start

    def at_in_window(t: time, label: str) -> datetime | None:
        at = datetime.combine(on, t, tzinfo=tz)
        if floor <= at < window_end:
            return at
        notes.append(f"nl_at_rejected: {label} outside_window")
        return None

    kept = {p.poi_id for p in visit}
    visit_at = []
    for ep in extracted.places:
        poi = match_place(ep.name, pool, anchor)[0] if ep.at else None
        if poi is not None and poi.poi_id in kept and (at := at_in_window(ep.at, str(poi.poi_id))):
            visit_at.append((poi.poi_id, at))
    start, end, n = verify_window(
        on, extracted.start_after, extracted.end_by, window_start, window_end, not_before, tz)
    notes += n
    rain, n = verify_weather(extracted.weather, rain_by_date.get(on), rain_threshold)
    notes += n
    only, counts, n = verify_categories(extracted, available)
    notes += n
    category_at = []
    for c in extracted.categories:
        if c.at and PoiCategory(c.category) in available and (at := at_in_window(c.at, c.category)):
            category_at.append((PoiCategory(c.category), at))
    return VerifiedRequest(visit=visit, avoid=avoid, window_start=start, window_end=end,
                           rain_confirmed=rain, only=only, counts=counts,
                           visit_at=tuple(visit_at), category_at=tuple(category_at), area_center=center,
                           notes=tuple(notes))
