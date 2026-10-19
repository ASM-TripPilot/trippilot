"""기회 판정 `find_opportunities` — 근처 행사·요즘 인기 (situation-awareness BR-SA-22 · PBT-SA-19, LLM 0회).

증명하는 것:
  [예시 — 손으로 거리를 잡은 고정 입력]
  ① EVENT_VENUE: 기간이 겹치는 행사 좌표 1km 안 + 행사 주소·이름에 POI 이름
  ② EVENT_NEARBY: 이름이 안 맞을 때 행사 좌표 0.3km 안 + 카테고리 적합(event_affinity 취향 사상)
  ③ 행사 원천: 공식(`tourapi-`)·수동 큐레이션(`popup-`)만 — 네이버 추출(`evx-`)은 카드가 되지 않는다(O-SA-12)
  ④ OTHER·기간 밖·좌표 없는 행사는 카드가 되지 않는다
  ⑤ TRENDING: 태그 '요즘 인기' — 한 POI 는 한 장(행사가 이긴다)
  ⑥ 결정론 순위: VENUE > NEARBY > TRENDING → 짧은 기간 → 거리 → key, 최대 3
  ⑦ 제외: 나이트라이프·숙소·그 요일 휴무 증명·이미 일정에 있음 (영업시간 정보 없음은 막지 않는다)
  ⑧ 표시 게이트: 이름 2~60자·연락처 꼴 금지
  [PBT — 임의 입력]
  INV-1 닫힌 집합 · 근접·기간 겹침·OTHER·출처 · 입력 순서 불변 · ≤3·유일·순위 정렬 · 제외 · 표시 게이트 ·
  빠뜨림 없음(3장이 안 찼으면 자격 있는 '요즘 인기'와 행사는 카드에 있다)
"""

from __future__ import annotations

import math
import re
from datetime import date, timedelta

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.event import EventInfo, EventType
from trippilot.domain.poi import (
    NIGHTLIFE_TAG,
    TRENDING_TAG,
    DataQuality,
    OpenHour,
    Poi,
    PoiCategory,
    PoiSource,
)
from trippilot.orchestrator.opportunity import OpportunityKind, find_opportunities

_DAY = date(2026, 10, 20)  # 화요일
_BASE = GeoPoint(37.5665, 126.9780)  # 서울시청 근방 (값 자체는 임의)
_M_PER_DEG_LAT = 111_195.08  # 하버사인 지구 반지름(6371.0088km) 기준 위도 1도


def _at(north_m: float, east_m: float = 0.0, *, base: GeoPoint = _BASE) -> GeoPoint:
    lat = base.lat + north_m / _M_PER_DEG_LAT
    lng = base.lng + east_m / (_M_PER_DEG_LAT * math.cos(math.radians(base.lat)))
    return GeoPoint(lat, lng)


def _poi(pid: str, name: str, north_m: float, *, category: PoiCategory = PoiCategory.SIGHT,
         tags: tuple[str, ...] = (), hours: tuple[OpenHour, ...] = ()) -> Poi:
    return Poi(PoiId(pid), name, category, _at(north_m), hours, None, None,
               DataQuality.FULL, PoiSource.SEED, None, tags=tags)


def _event(eid: str, name: str, north_m: float | None, *, etype: EventType = EventType.FESTIVAL,
           start: date = _DAY, end: date = _DAY, address: str | None = None) -> EventInfo:
    coord = None if north_m is None else _at(north_m)
    return EventInfo(eid, name, etype, start, end, coord, address)


# 남은 슬롯 둘 — 시청(0m)과 북쪽 3km. 예시는 전부 자오선 위라 거리 = 북쪽 미터 차이다.
_SLOTS = (("s1", _at(0)), ("s2", _at(3000)))


def _find(events=(), pois=(), planned=(), slots=_SLOTS):
    return find_opportunities(_DAY, slots, tuple(events), tuple(pois), frozenset(PoiId(p) for p in planned))


# ── ① EVENT_VENUE ─────────────────────────────────────────────────────


def test_행사_주소에_POI_이름이_있고_1km_안이면_행사장_카드다() -> None:
    lake = _poi("p-lake", "세종호수공원", 300, category=PoiCategory.NATURE)
    fest = _event("tourapi-100", "세종한글축제", 500, address="세종특별자치시 다솜로 216 세종호수공원 일원",
                  start=_DAY - timedelta(days=1), end=_DAY + timedelta(days=1))

    (card,) = _find([fest], [lake])

    assert card.kind is OpportunityKind.EVENT_VENUE
    assert card.key == "event:tourapi-100"
    assert card.poi == lake and card.event == fest
    assert card.near_slot_key == "s1"
    assert math.isclose(card.distance_km, 0.300, abs_tol=0.001)


def test_행사장_이름이_맞아도_행사_좌표에서_1km_밖이면_행사장이_아니다() -> None:
    lake = _poi("p-lake", "세종호수공원", 300, category=PoiCategory.NATURE)
    fest = _event("tourapi-100", "세종한글축제", 1500, address="세종호수공원 일원")  # 1.2km 떨어짐

    assert _find([fest], [lake]) == ()


def test_행사장_후보가_여럿이면_이름이_긴_곳이_가까운_곳보다_먼저다() -> None:
    """'남산공원'도 맞지만 행사가 가리키는 곳은 더 구체적인 '남산공원 야외식물원'이다."""
    park = _poi("p-park", "남산공원", 100, category=PoiCategory.NATURE)                # 행사에서 20m
    garden = _poi("p-garden", "남산공원 야외식물원", 400, category=PoiCategory.NATURE)  # 행사에서 280m
    fest = _event("tourapi-110", "남산공원 야외식물원 국화 축제", 120)

    (card,) = _find([fest], [park, garden])

    assert card.kind is OpportunityKind.EVENT_VENUE and card.poi == garden


def test_두_글자_이름은_주소에_있어도_행사장으로_보지_않는다() -> None:
    namsan = _poi("p-namsan", "남산", 100, category=PoiCategory.NATURE)
    fest = _event("tourapi-120", "가을 숲길 축제", 150, address="서울 중구 남산 일원")

    assert _find([fest], [namsan]) == ()


# ── ② EVENT_NEARBY ────────────────────────────────────────────────────


def test_이름이_안_맞으면_0_3km_안의_카테고리_적합_장소가_행사장_가까이_카드다() -> None:
    museum = _poi("p-museum", "시립미술관", 800, category=PoiCategory.CULTURE)       # 행사에서 200m
    gallery = _poi("p-gallery", "정동 갤러리", 700, category=PoiCategory.CULTURE)    # 100m — 가장 가깝게 맞는 곳
    noodle = _poi("p-noodle", "명동칼국수", 650, category=PoiCategory.FOOD)          # 50m — 축제와 안 맞는 종류
    fest = _event("tourapi-200", "가을 음악 축제", 600, address="서울 중구 세종대로 110")

    (card,) = _find([fest], [museum, noodle, gallery])

    assert card.kind is OpportunityKind.EVENT_NEARBY
    assert card.poi == gallery
    assert card.near_slot_key == "s1" and math.isclose(card.distance_km, 0.700, abs_tol=0.001)


def test_행사_좌표에서_0_3km_밖이면_행사장_가까이가_아니다() -> None:
    far_museum = _poi("p-far", "근대미술관", 950, category=PoiCategory.CULTURE)      # 350m
    fest = _event("tourapi-200", "가을 음악 축제", 600, address="서울 중구 세종대로 110")

    assert _find([fest], [far_museum]) == ()


def test_팝업은_조견표대로_쇼핑_장소와_맞는다() -> None:
    """event_affinity 가 POPUP 을 쇼핑·도시·문화로 안다 — '모르는 유형'이 아니다."""
    shop = _poi("p-shop", "뚝섬 편집숍", 500, category=PoiCategory.SHOPPING)       # 100m
    park = _poi("p-park", "뚝섬한강공원", 450, category=PoiCategory.NATURE)         # 50m — 팝업과 안 맞는 종류
    popup = _event("popup-abc", "클리오 풍년다방 팝업", 400, etype=EventType.POPUP, address="서울 성동구 뚝섬로 273")

    (card,) = _find([popup], [shop, park])

    assert card.kind is OpportunityKind.EVENT_NEARBY and card.poi == shop


def test_조견표에_없는_유형은_이름_대조만_한다() -> None:
    """EventType 에 값이 조견표보다 먼저 들어온 경우 — 죽지 않고 행사장 이름 대조만 한다."""
    museum = _poi("p-museum", "시립미술관", 800, category=PoiCategory.CULTURE)
    unknown = _event("tourapi-210", "도시 탐험 주간", 700, etype="CONCERT")  # type: ignore[arg-type]
    named = _event("tourapi-211", "시립미술관 야간 개장", 700, etype="CONCERT")  # type: ignore[arg-type]

    assert _find([unknown], [museum]) == ()
    (card,) = _find([named], [museum])
    assert card.kind is OpportunityKind.EVENT_VENUE


# ── ③④ 행사 원천·유형·기간·좌표 ───────────────────────────────────────


def test_네이버_추출_행사는_행사장이_맞아도_카드가_되지_않는다() -> None:
    lake = _poi("p-lake", "세종호수공원", 300, category=PoiCategory.NATURE)
    naver = _event("evx-50167b41c3706e21", "세종한글축제", 500, address="세종호수공원 일원")

    assert _find([naver], [lake]) == ()


def test_유형_불명_OTHER_행사는_카드가_되지_않는다() -> None:
    lake = _poi("p-lake", "세종호수공원", 300, category=PoiCategory.NATURE)
    fair = _event("tourapi-300", "세종호수공원 일자리 박람회", 500, etype=EventType.OTHER)

    assert _find([fair], [lake]) == ()


def test_그_날과_기간이_안_겹치는_행사와_좌표_없는_행사는_카드가_되지_않는다() -> None:
    lake = _poi("p-lake", "세종호수공원", 300, category=PoiCategory.NATURE)
    ended = _event("tourapi-401", "세종호수공원 축제", 500,
                   start=_DAY - timedelta(days=3), end=_DAY - timedelta(days=1))
    upcoming = _event("tourapi-402", "세종호수공원 축제", 500,
                      start=_DAY + timedelta(days=1), end=_DAY + timedelta(days=2))
    no_coord = _event("tourapi-403", "세종호수공원 축제", None)

    assert _find([ended, upcoming, no_coord], [lake]) == ()


# ── ⑤ TRENDING ───────────────────────────────────────────────────────


def test_요즘_인기_태그는_TRENDING_카드다() -> None:
    bakery = _poi("p-bakery", "성수 베이커리", 2500, category=PoiCategory.CAFE, tags=(TRENDING_TAG,))

    (card,) = _find(pois=[bakery])

    assert card.kind is OpportunityKind.TRENDING
    assert card.key == "trending:p-bakery" and card.event is None
    assert card.near_slot_key == "s2" and math.isclose(card.distance_km, 0.500, abs_tol=0.001)


def test_한_POI_는_한_장이고_행사가_이긴다() -> None:
    lake = _poi("p-lake", "세종호수공원", 300, category=PoiCategory.NATURE, tags=(TRENDING_TAG,))
    fest = _event("tourapi-100", "세종한글축제", 500, address="세종호수공원 일원")
    rerun = _event("tourapi-101", "세종호수공원 빛 축제", 600)  # 같은 POI 로 사상되는 두 번째 행사

    cards = _find([fest, rerun], [lake])

    assert [c.key for c in cards] == ["event:tourapi-100"]


def test_슬롯에서_1km_밖의_장소는_카드가_되지_않는다() -> None:
    far = _poi("p-far", "북악 전망대", 1100, tags=(TRENDING_TAG,))  # s1 1.1km · s2 1.9km

    assert _find(pois=[far]) == ()


# ── ⑥ 순위 ───────────────────────────────────────────────────────────


def test_행사장_가까이보다_행사장이_먼저고_같은_종류는_짧은_기간이_거리보다_먼저다() -> None:
    market = _poi("p-market", "광장시장", 100, category=PoiCategory.FOOD)
    plaza = _poi("p-plaza", "청계광장", 50, category=PoiCategory.SIGHT)
    stage = _poi("p-stage", "거리 예술 무대", 2800, category=PoiCategory.CULTURE)
    hot = _poi("p-hot", "성수 베이커리", 200, category=PoiCategory.CAFE, tags=(TRENDING_TAG,))
    short = _event("tourapi-1", "광장시장 먹거리 축제", 150, start=_DAY - timedelta(days=1),
                   end=_DAY + timedelta(days=1))                                   # 3일
    long = _event("tourapi-2", "청계천 등불 축제", 60, address="서울 중구 청계광장 일대",
                  start=_DAY - timedelta(days=5), end=_DAY + timedelta(days=4))    # 10일 — 장소는 더 가깝다
    nearby = _event("tourapi-3", "가을 버스킹 축제", 2900, address="서울 어딘가")  # 1일, 무대에서 100m

    cards = _find([nearby, long, short], [hot, stage, plaza, market])

    assert [c.key for c in cards] == ["event:tourapi-1", "event:tourapi-2", "event:tourapi-3"]


def test_같은_종류_같은_기간이면_가까운_곳이_먼저고_같은_거리면_key_순이다() -> None:
    near = _poi("p-b-near", "남산 케이블카", 100, tags=(TRENDING_TAG,))
    far = _poi("p-a-far", "남산 도서관", 300, tags=(TRENDING_TAG,))
    twin_b = _poi("p-twin-b", "을지로 노가리골목", 600, tags=(TRENDING_TAG,))
    twin_a = _poi("p-twin-a", "을지로 맥주거리", 600, tags=(TRENDING_TAG,))

    cards = _find(pois=[twin_b, far, twin_a, near])

    assert [c.key for c in cards] == ["trending:p-b-near", "trending:p-a-far", "trending:p-twin-a"]


# ── ⑦ 제외 ───────────────────────────────────────────────────────────


def test_나이트라이프_숙소_그_요일_휴무_일정에_있는_곳은_빠지고_영업시간_정보_없음은_남는다() -> None:
    tuesday, wednesday = _DAY.weekday(), (_DAY.weekday() + 1) % 7
    club = _poi("p-club", "홍대 클럽", 100, category=PoiCategory.ACTIVITY, tags=(TRENDING_TAG, NIGHTLIFE_TAG))
    hotel = _poi("p-hotel", "시청 호텔", 150, category=PoiCategory.STAY, tags=(TRENDING_TAG,))
    closed = _poi("p-closed", "수요일만 여는 빵집", 200, category=PoiCategory.CAFE, tags=(TRENDING_TAG,),
                  hours=(OpenHour(wednesday, 600, 1200),))
    planned = _poi("p-planned", "덕수궁", 250, tags=(TRENDING_TAG,))
    unknown_hours = _poi("p-unknown", "정동길 카페", 300, category=PoiCategory.CAFE, tags=(TRENDING_TAG,))
    open_today = _poi("p-open", "서울도서관", 350, category=PoiCategory.CULTURE, tags=(TRENDING_TAG,),
                      hours=(OpenHour(tuesday, 540, 1080),))

    cards = _find(pois=[club, hotel, closed, planned, unknown_hours, open_today], planned=["p-planned"])

    assert [c.poi.poi_id for c in cards] == ["p-unknown", "p-open"]


# ── ⑧ 표시 게이트 ────────────────────────────────────────────────────


def test_표시_게이트를_못_넘는_이름은_장소도_행사도_카드가_되지_않는다() -> None:
    names = ("가", "가" * 61, "문의 010-1234-5678", "www.cafe.com 카페")
    bad = [_poi(f"p-bad-{i}", n, 100 + i, tags=(TRENDING_TAG,)) for i, n in enumerate(names)]
    edge = [_poi("p-two", "남산", 200, tags=(TRENDING_TAG,)), _poi("p-sixty", "나" * 60, 210, tags=(TRENDING_TAG,))]
    lake = _poi("p-lake", "세종호수공원", 2700, category=PoiCategory.NATURE)
    spam = _event("tourapi-500", "세종호수공원 축제 예매 www.fest.kr", 2800)

    cards = _find([spam], bad + edge + [lake])

    assert [c.poi.poi_id for c in cards] == ["p-two", "p-sixty"]


# ── PBT — 임의 입력 ──────────────────────────────────────────────────

_GOOD_NAMES = ("서울숲", "남산공원", "시립미술관", "광장시장", "하늘공원", "북촌한옥마을", "성수 베이커리", "남산")
_BAD_NAMES = ("가", "가" * 61, "문의 010-1234-5678", "www.cafe.com 카페")
_HOURS = ((), (OpenHour(_DAY.weekday(), 540, 1260),), (OpenHour((_DAY.weekday() + 1) % 7, 540, 1260),))
# 행사 유형 ↔ 맞는 장소 종류 — event_affinity 조견표(유형 → 취향)와 취향 → 경계 카테고리를 손으로 이은 것
_FIT = {
    EventType.FESTIVAL: {PoiCategory.ACTIVITY, PoiCategory.CULTURE},
    EventType.PERFORMANCE: {PoiCategory.CULTURE},
    EventType.EXHIBITION: {PoiCategory.CULTURE},
    EventType.POPUP: {PoiCategory.SHOPPING, PoiCategory.SIGHT, PoiCategory.CULTURE},
}
_KIND_RANK = {OpportunityKind.EVENT_VENUE: 0, OpportunityKind.EVENT_NEARBY: 1, OpportunityKind.TRENDING: 2}


def _offset(limit_m: int):
    return st.tuples(st.integers(-limit_m, limit_m), st.integers(-limit_m, limit_m))


@st.composite
def _scenes(draw):
    slots = tuple((f"s{i}", _at(*draw(_offset(1500)))) for i in range(draw(st.integers(1, 3))))
    pois = tuple(
        Poi(PoiId(f"p{i}"), draw(st.sampled_from(_GOOD_NAMES + _BAD_NAMES)), draw(st.sampled_from(list(PoiCategory))),
            _at(*draw(_offset(2500))), draw(st.sampled_from(_HOURS)), None, None, DataQuality.FULL,
            PoiSource.SEED, None,
            tags=tuple(sorted(draw(st.sets(st.sampled_from((NIGHTLIFE_TAG, TRENDING_TAG)))))))
        for i in range(draw(st.integers(0, 10)))
    )
    events = []
    for j in range(draw(st.integers(0, 5))):
        host = draw(st.sampled_from(pois)) if pois and draw(st.booleans()) else None
        venue = host.name if host is not None else draw(st.sampled_from(_GOOD_NAMES))
        base = host.coord if host is not None else _at(*draw(_offset(2500)))
        coord = None if draw(st.integers(0, 9)) == 0 else _at(*draw(_offset(900)), base=base)
        start = _DAY + timedelta(days=draw(st.integers(-5, 2)))
        events.append(EventInfo(
            f"{draw(st.sampled_from(('tourapi-', 'popup-', 'evx-')))}{j}",
            draw(st.sampled_from((f"{venue} 축제", "가을 음악 축제", "예매 www.fest.kr"))),
            draw(st.sampled_from(list(EventType))),
            start, start + timedelta(days=draw(st.integers(0, 40))), coord,
            draw(st.sampled_from((None, f"서울 {venue} 일원", "서울 중구 세종대로 110"))),
        ))
    planned = frozenset(p.poi_id for p in pois if draw(st.booleans()))
    return slots, tuple(events), pois, planned


def _squash(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def _nearest_km(coord: GeoPoint, slots) -> float:
    return min(haversine_km(c, coord) for _, c in slots)


def _eligible(p: Poi, slots, planned) -> bool:
    """오라클 — 규칙을 구현과 따로 다시 적은 것(이름 고정 집합·요일 표를 직접 본다)."""
    return (p.poi_id not in planned and p.category is not PoiCategory.STAY and NIGHTLIFE_TAG not in p.tags
            and (not p.open_hours or any(h.day_of_week == _DAY.weekday() for h in p.open_hours))
            and p.name not in _BAD_NAMES and _nearest_km(p.coord, slots) <= 1.0)


def _shown_event(e: EventInfo) -> bool:
    return (e.event_type is not EventType.OTHER and e.coord is not None
            and e.event_id.startswith(("tourapi-", "popup-")) and e.start <= _DAY <= e.end
            and "www." not in e.name)


def _venue_ok(e: EventInfo, p: Poi) -> bool:
    return (haversine_km(e.coord, p.coord) <= 1.0 and len(_squash(p.name)) >= 3
            and _squash(p.name) in _squash(f"{e.address or ''} {e.name}"))


def _nearby_ok(e: EventInfo, p: Poi) -> bool:
    return haversine_km(e.coord, p.coord) <= 0.3 and p.category in _FIT.get(e.event_type, set())


@settings(max_examples=300, deadline=None)
@given(_scenes())
def test_PBT_결과는_입력_등록_POI_에서만_나오고_일정에_있는_곳은_없다(scene) -> None:
    """INV-1 — 행사는 후보가 아니다. 카드의 장소는 입력 POI 중 일정 밖의 것, 행사는 입력 행사다."""
    slots, events, pois, planned = scene
    for card in find_opportunities(_DAY, slots, events, pois, planned):
        assert card.poi in pois and card.poi.poi_id not in planned
        if card.kind is OpportunityKind.TRENDING:
            assert card.event is None and TRENDING_TAG in card.poi.tags
        else:
            assert card.event in events


@settings(max_examples=300, deadline=None)
@given(_scenes())
def test_PBT_근접_기간_유형_출처_규칙을_지킨다(scene) -> None:
    slots, events, pois, planned = scene
    keys = {k for k, _ in slots}
    for card in find_opportunities(_DAY, slots, events, pois, planned):
        nearest = _nearest_km(card.poi.coord, slots)
        assert nearest <= 1.0 and math.isclose(card.distance_km, nearest, abs_tol=1e-9)
        assert card.near_slot_key in keys
        assert math.isclose(haversine_km(dict(slots)[card.near_slot_key], card.poi.coord), nearest, abs_tol=1e-9)
        if card.kind is OpportunityKind.TRENDING:
            continue
        assert _shown_event(card.event)
        assert card.key == f"event:{card.event.event_id}"
        if card.kind is OpportunityKind.EVENT_VENUE:
            assert _venue_ok(card.event, card.poi)
        else:
            assert _nearby_ok(card.event, card.poi)
            assert not any(_venue_ok(card.event, p) for p in pois if _eligible(p, slots, planned))


@settings(max_examples=200, deadline=None)
@given(_scenes(), st.randoms(use_true_random=False))
def test_PBT_입력_순서를_섞어도_결과가_같다(scene, rnd) -> None:
    slots, events, pois, planned = scene
    shuffled = [list(slots), list(events), list(pois)]
    for part in shuffled:
        rnd.shuffle(part)

    assert (find_opportunities(_DAY, tuple(shuffled[0]), tuple(shuffled[1]), tuple(shuffled[2]), planned)
            == find_opportunities(_DAY, slots, events, pois, planned))


@settings(max_examples=300, deadline=None)
@given(_scenes())
def test_PBT_최대_3장이고_key_장소가_유일하며_순위대로_놓인다(scene) -> None:
    cards = find_opportunities(_DAY, *scene)

    assert len(cards) <= 3
    assert len({c.key for c in cards}) == len(cards)
    assert len({c.poi.poi_id for c in cards}) == len(cards)
    ranks = [(_KIND_RANK[c.kind], (c.event.end - c.event.start).days if c.event else 0, c.distance_km, c.key)
             for c in cards]
    assert ranks == sorted(ranks)


@settings(max_examples=300, deadline=None)
@given(_scenes())
def test_PBT_제외_규칙과_표시_게이트(scene) -> None:
    slots, events, pois, planned = scene
    for card in find_opportunities(_DAY, slots, events, pois, planned):
        assert _eligible(card.poi, slots, planned)
        assert 2 <= len(card.poi.name.strip()) <= 60
        if card.event is not None:
            assert "www." not in card.event.name and 2 <= len(card.event.name.strip()) <= 60


@settings(max_examples=300, deadline=None)
@given(_scenes())
def test_PBT_3장이_안_찼으면_자격_있는_요즘_인기와_행사를_빠뜨리지_않는다(scene) -> None:
    """빈 결과는 위 성질을 전부 만족한다 — 그래서 '있어야 할 카드가 있다'를 따로 본다."""
    slots, events, pois, planned = scene
    cards = find_opportunities(_DAY, slots, events, pois, planned)
    if len(cards) == 3:
        return
    used = {c.poi.poi_id for c in cards}
    keys = {c.key for c in cards}
    eligible = [p for p in pois if _eligible(p, slots, planned)]
    for p in eligible:
        if TRENDING_TAG in p.tags:
            assert p.poi_id in used
    for e in events:
        if not _shown_event(e):
            continue
        hosts = {p.poi_id for p in eligible if _venue_ok(e, p) or _nearby_ok(e, p)}
        if hosts:  # 카드가 있거나, 그 행사의 장소를 더 높은 카드가 이미 가져갔다(한 POI 한 장)
            assert f"event:{e.event_id}" in keys or hosts & used
