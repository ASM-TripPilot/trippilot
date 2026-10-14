"""LOCALDATA 일반음식점 — 공백 선별·게이트 경유·제안 문서 (TRIP-1224).

TourAPI 식당이 비는 지역에만 인허가 식당을 넣는다. 여기서 고정하는 것:

- **공백 선별은 전수 비교와 같은 답을 낸다.** 격자 색인은 속도를 위한 것이지 판정이 아니다 —
  앵커 반경 안 TourAPI FOOD 가 기준 미만인 앵커만 공백이고, 그 앵커 반경 안 후보를 가까운 순
  (동률은 관리번호 순)으로 최대 K 개 고른 합집합이다. 무작위 점 배치로 전수 계산과 대조한다.
- **게이트는 기존 것을 그대로 탄다.** TourAPI 와 같은 가게(같은 이름 50m 안 · 같은 주소 키 +
  같은 상호 · 분류가 달라도 같은 주소 키 + 같은 상호 완전 일치 — TRIP-1231)는 TourAPI 쪽이 남고
  LOCALDATA 는 병합으로 빠진다. 산출에는 LOCALDATA 만 나가고,
  통계(병합·드롭)도 LOCALDATA 몫만 센다.
- **제안 문서는 수신 계약 그대로다.** TourAPI 산출(`pipeline.to_output_document`)과 칸 구성이
  같고, `source` 는 백엔드가 받는 값이다(백엔드 `PoiSource` 를 직접 읽어 대조).

실 호출 0 — 순수 함수만. 반례가 실데이터 한 줄이 되도록 상호·주소는 실측 표기 생성기를 쓴다.
"""

from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import GeoPoint
from trippilot.domain.poi import DataQuality, PoiCategory
from trippilot.poi_curation.sourcing.collection_gate import (
    DROP_POLICY_NON_TRAVEL,
    CollectionGate,
    SourcingCandidate,
    _haversine_m,
)
from trippilot.poi_curation.sourcing.localdata import (
    GAP_RADIUS_KM,
    GAP_RADIUS_KM_URBAN,
    PER_ANCHOR,
    PICK_RADIUS_KM,
    SOURCE,
    SOURCE_NAME,
    URBAN_SIDO,
    fill_near,
    gap_anchors,
    gap_anchors_split,
    gate_against_tourapi,
    pick_near,
    shared_tourapi_candidates,
    split_urban,
    to_output_document,
)
from trippilot.poi_curation.sourcing.mapping import extract_region
from trippilot.poi_curation.sourcing.pipeline import (
    SCHEMA_VERSION,
    CollectResult,
    CollectStats,
    to_output_document as tourapi_output_document,
)

from tests.generators.geo import coord_pairs_apart
from tests.generators.poi_curation import (
    distinct_store_name_pairs,
    road_address_pairs,
    same_store_name_pairs,
)

_BASE = (36.50, 127.50)   # 내륙 — 무작위 점을 이 둘레 ±0.15° 에 뿌린다
_JEJU = (33.4996, 126.5312)


def _km(a: GeoPoint, b: GeoPoint) -> float:
    return _haversine_m(a, b) / 1000.0


def _points(max_size: int) -> st.SearchStrategy[list[GeoPoint]]:
    near = st.floats(-0.15, 0.15, allow_nan=False, allow_infinity=False)
    return st.lists(st.tuples(near, near).map(lambda d: GeoPoint(_BASE[0] + d[0], _BASE[1] + d[1])),
                    max_size=max_size)


def _ld(ref: str, *, name: str = "고집돌우럭", lat: float = _JEJU[0], lng: float = _JEJU[1],
        address: str | None = "제주특별자치도 서귀포시 중문관광로 154",
        kind: str = "한식") -> SourcingCandidate:
    """LOCALDATA 게이트 입력 1건 (`localdata.to_candidate` 산출과 같은 모양)."""
    return SourcingCandidate(
        source_ref=ref, kind="일반음식점", name=name, address=address, lat=lat, lng=lng,
        category=PoiCategory.FOOD, category_codes=(kind,), open_hours=(), hours_raw=None,
        image_url=None, modified_at=None, source=SOURCE,
    )


def _tour(ref: str, *, name: str = "고집돌우럭", lat: float = _JEJU[0], lng: float = _JEJU[1],
          address: str | None = "제주특별자치도 서귀포시 중문관광로 154",
          category: PoiCategory = PoiCategory.FOOD) -> SourcingCandidate:
    return SourcingCandidate(
        source_ref=ref, kind="39", name=name, address=address, lat=lat, lng=lng,
        category=category, category_codes=("A05", "A0502", "A05020100"), open_hours=(),
        hours_raw=None, image_url="https://tong.visitkorea.or.kr/x.jpg", modified_at=None,
    )


# ── 공백 선별 = 전수 비교 ─────────────────────────────────────────────


@settings(max_examples=150, deadline=None)
@given(_points(25), _points(60), st.floats(0.5, 12.0), st.integers(0, 8))
def test_gap_anchors_match_brute_force(anchors: list[GeoPoint], foods: list[GeoPoint],
                                       radius_km: float, min_food: int) -> None:
    expected = [a for a in anchors
                if sum(1 for f in foods if _km(a, f) <= radius_km) < min_food]
    assert gap_anchors(anchors, foods, radius_km=radius_km, min_food=min_food) == expected


@settings(max_examples=150, deadline=None)
@given(_points(15), _points(80), st.floats(0.3, 6.0), st.integers(1, 12))
def test_pick_near_matches_brute_force(anchors: list[GeoPoint], spots: list[GeoPoint],
                                       radius_km: float, per_anchor: int) -> None:
    cands = [_ld(f"R-{i:03d}", lat=p.lat, lng=p.lng) for i, p in enumerate(spots)]
    expected: dict[str, SourcingCandidate] = {}
    for a in anchors:
        near = sorted(((_km(a, GeoPoint(c.lat, c.lng)), c.source_ref, c) for c in cands
                       if _km(a, GeoPoint(c.lat, c.lng)) <= radius_km), key=lambda t: t[:2])
        for _, ref, c in near[:per_anchor]:
            expected.setdefault(ref, c)
    got = pick_near(anchors, cands, radius_km=radius_km, per_anchor=per_anchor)
    # 관리번호 순으로 낸다 — 재생성 diff 가 앵커 순서에 흔들리지 않게
    assert [c.source_ref for c in got] == sorted(expected)


def test_pick_near_caps_each_anchor_and_breaks_ties_by_ref() -> None:
    a = GeoPoint(*_BASE)
    same_spot = [_ld(f"R-{i}", lat=a.lat, lng=a.lng) for i in (5, 3, 9, 1)]   # 거리 동률 0
    assert [c.source_ref for c in pick_near([a], same_spot, radius_km=2.0, per_anchor=2)] == ["R-1", "R-3"]


def test_pick_near_skips_candidates_outside_radius() -> None:
    a = GeoPoint(*_BASE)
    far = _ld("FAR", lat=a.lat + 0.03, lng=a.lng)   # 약 3.3km
    assert pick_near([a], [far], radius_km=2.0, per_anchor=12) == []


# ── 게이트 경유 ───────────────────────────────────────────────────────


def test_same_name_within_50m_of_tourapi_is_merged_away() -> None:
    out = gate_against_tourapi([_tour("100")], [_ld("L-1", lat=_JEJU[0] + 0.0002)])   # 약 22m
    assert out.passed == ()
    assert out.merged == 1
    assert out.drops == {}


@settings(max_examples=100, deadline=None)
@given(same_store_name_pairs(), road_address_pairs(), coord_pairs_apart(min_km=0.2, max_km=8.0))
def test_same_store_by_address_key_is_merged_however_far(
    names: tuple[str, str], addrs: tuple[str, str], coords: tuple[GeoPoint, GeoPoint],
) -> None:
    """좌표가 50m 넘게 벌어져도(실측 최대 8.4km) 주소 키 + 상호가 같으면 같은 가게다(TRIP-682)."""
    (t_name, l_name), (t_addr, l_addr), (t_pt, l_pt) = names, addrs, coords
    out = gate_against_tourapi(
        [_tour("100", name=t_name, address=t_addr, lat=t_pt.lat, lng=t_pt.lng)],
        [_ld("L-1", name=l_name, address=l_addr, lat=l_pt.lat, lng=l_pt.lng)],
    )
    assert (out.passed, out.merged) == ((), 1)


@settings(max_examples=100, deadline=None)
@given(distinct_store_name_pairs(), road_address_pairs(), coord_pairs_apart(min_km=0.0, max_km=0.04))
def test_different_store_in_same_building_passes(
    names: tuple[str, str], addrs: tuple[str, str], coords: tuple[GeoPoint, GeoPoint],
) -> None:
    """같은 건물(같은 주소 키)·코앞이어도 상호가 다르면 다른 가게다 — 공백을 메우는 진짜 식당이다."""
    (t_name, l_name), (t_addr, l_addr), (t_pt, l_pt) = names, addrs, coords
    out = gate_against_tourapi(
        [_tour("100", name=t_name, address=t_addr, lat=t_pt.lat, lng=t_pt.lng)],
        [_ld("L-1", name=l_name, address=l_addr, lat=l_pt.lat, lng=l_pt.lng)],
    )
    assert [p.candidate.ref for p in out.passed] == [(SOURCE, "L-1")]
    assert out.merged == 0


def test_same_place_filed_as_cafe_on_tourapi_is_merged_away() -> None:
    """실측 회귀(TRIP-1231) — TourAPI 카페 '엘파라이소365' 와 같은 주소·같은 상호의 인허가 식당.
    분류가 달라도 같은 곳이다 — TourAPI 쪽(카페)이 남고 LOCALDATA 는 병합으로 빠진다."""
    addr = "경상북도 청도군 화양읍 소라2길 36-13"
    out = gate_against_tourapi(
        [_tour("100", name="엘파라이소365", address=addr, category=PoiCategory.CAFE)],
        [_ld("L-1", name="엘파라이소365", address=addr, lat=_JEJU[0] + 0.00001)],
    )
    assert (out.passed, out.merged) == ((), 1)


def test_restaurant_named_after_facility_with_more_words_passes() -> None:
    """분류가 다르면 상호 **완전 일치**만 붙인다 — 시설 이름을 품은 다른 가게는 남는다."""
    addr = "충청남도 태안군 남면 연꽃길 70"
    out = gate_against_tourapi(
        [_tour("100", name="청산수목원", address=addr, category=PoiCategory.NATURE)],
        [_ld("L-1", name="청산수목원 매점", address=addr, lat=_JEJU[0] + 0.00001)],
    )
    assert [p.candidate.ref for p in out.passed] == [(SOURCE, "L-1")]
    assert out.merged == 0


def test_only_localdata_comes_out_and_only_its_drops_are_counted() -> None:
    tours = [
        _tour("100"),
        _tour("101", name="이마트24 강릉여고점", lat=_JEJU[0] + 0.01),      # TourAPI 의 드롭은 세지 않는다
        _tour("102", name="고집돌우럭", lat=_JEJU[0] + 0.00001),             # TourAPI 끼리 병합도 세지 않는다
    ]
    locals_ = [
        _ld("L-1", name="올레국수", lat=_JEJU[0] + 0.02),
        _ld("L-2", name="세븐일레븐 중문점", lat=_JEJU[0] + 0.03),          # 비여행지 — 게이트 5단
        _ld("L-3", name="올레국수", lat=_JEJU[0] + 0.02 + 0.0001),          # 먼저 온 L-1 에 병합
    ]
    out = gate_against_tourapi(tours, locals_)
    assert [p.candidate.source_ref for p in out.passed] == ["L-1"]
    assert out.merged == 1
    assert out.drops == {f"{DROP_POLICY_NON_TRAVEL}:convenience_store": 1}
    p = out.passed[0].poi
    assert str(p.poi_id) == "localdata-L-1"                     # 잠정 ID — 정본 ID 는 백엔드가 준다
    assert p.quality is DataQuality.PARTIAL                       # 영업시간·사진이 없다
    assert p.category is PoiCategory.FOOD


# ── 공유본 → TourAPI 비교 대상 ────────────────────────────────────────


def _shared_item(cid: str, category: str, name: str = "고집돌우럭") -> dict:
    return {
        "provisional_id": f"tourapi-{cid}", "source": "TOURAPI",
        "poi": {"poi_id": f"tourapi-{cid}", "name": name, "category": category,
                "coord": {"lat": _JEJU[0], "lng": _JEJU[1]}, "open_hours": [], "avg_cost": None,
                "rating": None, "quality": "PARTIAL", "source": "PLACES_API", "confidence": None},
        "tags": ["음식점", "한식"], "region": "서귀포시", "opening_hours_raw": None,
        "provenance": {"content_id": cid, "content_type_id": "39",
                       "address": "제주특별자치도 서귀포시 중문관광로 154", "image_url": None},
    }


def test_shared_tourapi_candidates_keep_every_category() -> None:
    """전 카테고리를 넘긴다 — 게이트 ㉢ 이 카페·캠핑장으로 등록된 같은 곳을 봐야 한다(TRIP-1231).
    공백 판정용 FOOD 거르기는 호출측(`collect_localdata`) 몫이다."""
    doc = {"proposals": [_shared_item("1", "FOOD"), _shared_item("2", "CAFE"), _shared_item("3", "SIGHT")]}
    got = shared_tourapi_candidates(doc)
    assert [(c.ref, c.category) for c in got] == [
        (("tourapi", "1"), PoiCategory.FOOD),
        (("tourapi", "2"), PoiCategory.CAFE),
        (("tourapi", "3"), PoiCategory.SIGHT),
    ]
    assert got[0].address == "제주특별자치도 서귀포시 중문관광로 154"
    assert (got[0].lat, got[0].lng) == _JEJU


# ── 제안 문서 = 수신 계약 ─────────────────────────────────────────────


def _backend_poi_source_values() -> set[str]:
    rel = "backend/modules/place-data/src/main/kotlin/com/trippilot/placedata/domain/Poi.kt"
    for parent in Path(__file__).resolve().parents:
        if (parent / rel).is_file():
            m = re.search(r"enum class PoiSource \{([^}]*)\}", (parent / rel).read_text(encoding="utf-8"))
            assert m is not None
            return {v.strip() for v in m.group(1).split(",") if v.strip()}
    raise AssertionError(f"백엔드 정본을 찾지 못했습니다: {rel}")   # skip 이 아니라 실패 — 게이트가 사라진 채 초록이면 안 된다


def _tourapi_doc() -> dict:
    report = CollectionGate().apply([_tour("100")])
    stats = CollectStats(http_calls=0, listed=1, page_failures=0, detail_failures=0,
                         category_unmapped=0, gate_drops={}, merged=0, passed=1, budget_exhausted=False)
    return tourapi_output_document(CollectResult(report=report, stats=stats), area_code="39",
                                   content_types=("39",), collected_at=datetime(2026, 10, 4, tzinfo=UTC))


def _localdata_doc() -> dict:
    out = gate_against_tourapi([], [_ld("3000000-101-1970-00526", name="경원집",
                                        address="서울특별시 종로구 사직로 133-6 (적선동)",
                                        lat=37.5759, lng=126.9707)])
    return to_output_document(out.passed, collected_at=datetime(2026, 10, 4, tzinfo=UTC), stats={"passed": 1})


def test_document_has_the_same_shape_as_tourapi_output() -> None:
    ours, theirs = _localdata_doc(), _tourapi_doc()
    (p,), (q,) = ours["proposals"], theirs["proposals"]
    assert ours["schema_version"] == theirs["schema_version"] == SCHEMA_VERSION
    assert set(p) == set(q)
    assert set(p["poi"]) == set(q["poi"])
    # 백엔드 `ProposalProvenance` 가 읽는 세 칸 — 나머지는 ignoreUnknown 으로 흘린다
    assert {"content_id", "address", "image_url"} <= set(p["provenance"])


def test_document_values_follow_the_contract() -> None:
    doc = _localdata_doc()
    assert doc["source"] == SOURCE_NAME == "LOCALDATA"
    (p,) = doc["proposals"]
    assert p["source"] == SOURCE_NAME
    assert p["provisional_id"] == p["poi"]["poi_id"] == "localdata-3000000-101-1970-00526"
    assert p["poi"]["category"] == "FOOD"
    assert p["poi"]["open_hours"] == [] and p["opening_hours_raw"] is None
    assert p["tags"] == ["한식"]                                   # 업태 원문
    assert p["region"] == extract_region(p["provenance"]["address"]) == "종로구"
    assert p["provenance"] == {"content_id": "3000000-101-1970-00526",
                               "address": "서울특별시 종로구 사직로 133-6 (적선동)", "image_url": None}
    assert math.isclose(p["poi"]["coord"]["lat"], 37.5759)


def test_document_source_is_accepted_by_backend() -> None:
    """모르는 `source` 는 백엔드가 문서째 400 으로 막는다 — 값 집합을 백엔드 enum 에서 직접 읽어 대조."""
    assert SOURCE_NAME in _backend_poi_source_values()


# ── '기타' 빈자리 보충 (TRIP-1282) ────────────────────────────────────
#
# 업태 '기타' 10.3만은 상호로 72.9% 를 못 가려 통째로 뺀 칸이다. 그중 LLM 이 "확실한 식당"으로
# 판정한 것만 **남은 자리에** 넣는다. 여기서 못 박는 것은 하나다: **밀어내지 않는다.**


def test_보충은_기존_선정을_한_곳도_바꾸지_않는다() -> None:
    """자리가 꽉 찬 앵커에는 '기타'가 못 들어간다 — 확실한 한식집이 밀리면 보충이 아니라 교체다."""
    anchor = GeoPoint(*_JEJU)
    # 상한만큼 채택 업태가 이미 반경 안에 있다 → 빈 자리 0
    taken = [_ld(f"A{i:02d}", lat=_JEJU[0] + 0.0001 * i) for i in range(PER_ANCHOR)]
    extra = [_ld("E01", name="수로밥상", lat=_JEJU[0])]

    assert fill_near([anchor], taken, extra) == []

    before = pick_near([anchor], taken)
    after = pick_near([anchor], taken) + fill_near([anchor], taken, extra)
    assert [c.source_ref for c in after] == [c.source_ref for c in before]


def test_남은_자리만큼만_가까운_순으로_채운다() -> None:
    anchor = GeoPoint(*_JEJU)
    taken = [_ld(f"A{i:02d}", lat=_JEJU[0] + 0.0001 * i) for i in range(PER_ANCHOR - 2)]
    # 가까운 순: E01 < E02 < E03 — 자리는 둘뿐이다
    extra = [_ld(f"E{i:02d}", lat=_JEJU[0] + 0.001 * i) for i in (1, 2, 3)]

    got = [c.source_ref for c in fill_near([anchor], taken, extra)]
    assert got == ["E01", "E02"], "남은 자리 수를 넘겨 채웠거나 가까운 순이 아니다"


def test_자리가_비어도_반경_밖은_안_가져온다() -> None:
    """보충이 반경을 넓히는 장치가 되면 안 된다 — 공백 지역 설계가 무너진다."""
    anchor = GeoPoint(*_JEJU)
    far = GeoPoint(_JEJU[0] + PICK_RADIUS_KM / 110.574 * 2, _JEJU[1])
    assert fill_near([anchor], [], [_ld("E01", lat=far.lat, lng=far.lng)]) == []


def test_판정_파일이_없으면_보충이_0_이다() -> None:
    """`collect_localdata` 는 accept 목록이 빈 집합이면 '기타'를 한 곳도 만들지 않는다."""
    assert fill_near([GeoPoint(*_JEJU)], [], []) == []


@settings(max_examples=100, deadline=None)
@given(_points(12), _points(40), _points(40))
def test_보충분은_언제나_기존_선정과_겹치지_않는다(
    anchors: list[GeoPoint], a: list[GeoPoint], b: list[GeoPoint],
) -> None:
    """합쳐서 게이트에 넘기므로 겹치면 같은 가게가 두 번 샌다."""
    taken = [_ld(f"A{i:03d}", lat=p.lat, lng=p.lng) for i, p in enumerate(a)]
    extra = [_ld(f"E{i:03d}", lat=p.lat, lng=p.lng) for i, p in enumerate(b)]
    picked = {c.source_ref for c in pick_near(anchors, taken)}
    filled = {c.source_ref for c in fill_near(anchors, taken, extra)}
    assert not (picked & filled)


@settings(max_examples=100, deadline=None)
@given(_points(40), _points(40))
def test_앵커_하나가_가져가는_수는_상한을_넘지_않는다(
    a: list[GeoPoint], b: list[GeoPoint],
) -> None:
    """선정 + 보충이 **한 앵커**에서 K 를 넘으면 '보충'이 아니라 상한 완화다.

    앵커를 하나만 둔다 — 합집합에 대고 주장하면 거짓이다. 앵커 둘의 반경이 겹치면
    각자 K 곳씩 고른 결과가 한쪽 반경 안에서 K 를 넘는 것이 **정상**이고, 실제로
    hypothesis 가 겹치는 배치로 반례를 냈다(13 > 12).
    """
    anchor = GeoPoint(*_JEJU)
    taken = [_ld(f"A{i:03d}", lat=p.lat, lng=p.lng) for i, p in enumerate(a)]
    extra = [_ld(f"E{i:03d}", lat=p.lat, lng=p.lng) for i, p in enumerate(b)]
    got = pick_near([anchor], taken) + fill_near([anchor], taken, extra)
    near = [c for c in got if _km(anchor, GeoPoint(c.lat, c.lng)) <= PICK_RADIUS_KM]
    assert len(near) <= PER_ANCHOR


@settings(max_examples=60, deadline=None)
@given(_points(12), _points(40), _points(40))
def test_보충_총량은_앵커수_곱하기_상한을_넘지_않는다(
    anchors: list[GeoPoint], a: list[GeoPoint], b: list[GeoPoint],
) -> None:
    """합집합에 대해 참인 경계 — 앵커마다 최대 K 곳을 가져오므로 총량은 그 곱 이하다."""
    taken = [_ld(f"A{i:03d}", lat=p.lat, lng=p.lng) for i, p in enumerate(a)]
    extra = [_ld(f"E{i:03d}", lat=p.lat, lng=p.lng) for i, p in enumerate(b)]
    assert len(fill_near(anchors, taken, extra)) <= PER_ANCHOR * len(anchors)


# ── 도시 공백은 걸어갈 거리로 잰다 (TRIP-1283) ────────────────────────
#
# 7km 는 시골 기준이다. 그 자로 재면 **서울·부산·제주 숙소 3,481곳 중 공백이 0곳**이라
# LOCALDATA 가 도시에 한 곳도 들어가지 않았다(실측 2026-10-14). 여행자는 걸어간다.


def _backend_sido_codes() -> dict[str, str]:
    """`R__seed_region_catalog` 의 SIDO 행 → {코드: 이름}. 카탈로그가 정본이다."""
    rel = "backend/app/src/main/resources/db/migration/R__seed_region_catalog.sql"
    for parent in Path(__file__).resolve().parents:
        if (parent / rel).is_file():
            rows = re.findall(r"\('(\d+)', '([^']+)', '\d+', '[^']+', 'SIDO'",
                              (parent / rel).read_text(encoding="utf-8"))
            assert rows, "카탈로그에서 SIDO 행을 찾지 못했습니다"
            return dict(rows)
    raise AssertionError(f"백엔드 정본을 찾지 못했습니다: {rel}")


def test_도시_반경이_시골보다_좁다() -> None:
    """이게 뒤집히면 '도시 보강'이 오히려 시골보다 헐거워진다."""
    assert GAP_RADIUS_KM_URBAN < GAP_RADIUS_KM


def test_도시_목록은_특별_광역시와_제주다() -> None:
    """시도 코드는 `R__seed_region_catalog` 정본을 따른다 — 코드가 바뀌면 조용히 빗나간다."""
    catalog = _backend_sido_codes()
    assert URBAN_SIDO <= set(catalog), f"카탈로그에 없는 시도 코드: {URBAN_SIDO - set(catalog)}"
    assert {catalog[c] for c in URBAN_SIDO} == {
        "서울특별시", "부산광역시", "대구광역시", "인천광역시",
        "대전광역시", "울산광역시", "제주특별자치도",
    }


@pytest.mark.parametrize("code,urban", [
    ("11", True), ("11680", True),      # 서울 · 강남구
    ("26", True), ("26350", True),      # 부산 · 해운대구
    ("50", True), ("50110", True),      # 제주 · 제주시
    ("41", False), ("41135", False),    # 경기 · 성남시
    ("51", False), ("12", False),       # 강원 · 전남광주통합(농촌 섞임)
    ("36", False),                      # 세종 (농촌 섞임)
])
def test_시도_코드_앞두자리로_도시를_가른다(code: str, urban: bool) -> None:
    got_urban, got_rural = split_urban([(GeoPoint(*_JEJU), code)])
    assert (len(got_urban), len(got_rural)) == ((1, 0) if urban else (0, 1))


def test_도시_시골이_섞여도_한_곳도_잃지_않는다() -> None:
    """앵커가 한 곳이라도 새면 그 숙소 둘레가 통째로 안 채워진다."""
    stays = [(GeoPoint(*_JEJU), c) for c in ("11", "41", "26", "51", "50", "41135")]
    urban, rural = split_urban(stays)
    assert len(urban) + len(rural) == len(stays)


def test_도시_반경에서는_더_많은_앵커가_공백이_된다() -> None:
    """같은 식당 배치라도 자를 좁히면 공백이 늘어난다 — 이 단계의 존재 이유다."""
    anchor = GeoPoint(*_JEJU)
    # 1km 밖 · 7km 안에 식당 여섯 곳 → 시골 기준은 통과, 도시 기준은 공백
    far = [GeoPoint(_JEJU[0] + 0.03 * (i + 1) / 6, _JEJU[1]) for i in range(6)]
    assert gap_anchors([anchor], far) == []
    assert gap_anchors([anchor], far, radius_km=GAP_RADIUS_KM_URBAN) == [anchor]


def test_공백_정의는_한_곳에만_있다() -> None:
    """수집기와 분류기가 **같은 함수**로 공백을 구해야 한다.

    둘이 각자 `gap_anchors` 를 부르다 도시 규칙이 수집기에만 들어가 어긋났다
    (2026-10-14 실측: 수집기 5,125 대 분류기 2,983). 분류기가 덜 본 만큼 '기타'
    보충 대상이 조용히 빠진다 — 에러 없이 데이터만 줄어드는 종류의 실패다.
    """
    root = Path(__file__).resolve().parents[2] / "scripts"
    for rel in ("collect/collect_localdata.py", "classify/classify_localdata_etc.py"):
        src = (root / rel).read_text(encoding="utf-8")
        assert "gap_anchors_split(" in src, f"{rel} 가 공용 함수를 쓰지 않는다"
        # 숙소 앵커에 직접 gap_anchors 를 부르면 도시 규칙을 건너뛴다
        assert "gap_anchors([p for p, _ in stays]" not in src, (
            f"{rel} 가 숙소 앵커에 gap_anchors 를 직접 부른다 — 도시 반경이 빠진다")


def test_공백_셋은_서로_겹치지_않는다() -> None:
    """시골·도시·지역중심은 같은 앵커를 두 번 세면 안 된다 — 보충 수가 부풀려진다."""
    stays = [(GeoPoint(*_JEJU), "50110"), (GeoPoint(_JEJU[0] + 0.5, _JEJU[1]), "51110")]
    centers = [GeoPoint(_JEJU[0] + 1.0, _JEJU[1])]
    rural, urban, center = gap_anchors_split(stays, centers, [])
    assert len(rural) + len(urban) + len(center) == len(stays) + len(centers)
    assert len(urban) == 1 and len(rural) == 1 and len(center) == 1


def test_도시_앵커는_좁은_자로_걸러진다() -> None:
    """같은 식당 배치에서 도시 앵커만 공백이 된다 — 이 함수의 존재 이유다."""
    urban_pt = GeoPoint(*_JEJU)                       # 제주(50) = 도시
    rural_pt = GeoPoint(_JEJU[0] + 2.0, _JEJU[1])     # 강원(51) = 시골
    # 각 앵커에서 1km 밖·7km 안에 식당 여섯 곳
    food = [GeoPoint(p.lat + 0.03 * (i + 1) / 6, p.lng)
            for p in (urban_pt, rural_pt) for i in range(6)]
    rural, urban, _ = gap_anchors_split(
        [(urban_pt, "50110"), (rural_pt, "51110")], [], food)
    assert urban == [urban_pt], "도시 앵커가 좁은 자로 안 걸러졌다"
    assert rural == [], "시골 앵커까지 좁은 자로 걸렀다"
