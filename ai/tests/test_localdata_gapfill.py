"""LOCALDATA 일반음식점 — 공백 선별·게이트 경유·제안 문서 (TRIP-1224).

TourAPI 식당이 비는 지역에만 인허가 식당을 넣는다. 여기서 고정하는 것:

- **공백 선별은 전수 비교와 같은 답을 낸다.** 격자 색인은 속도를 위한 것이지 판정이 아니다 —
  앵커 반경 안 TourAPI FOOD 가 기준 미만인 앵커만 공백이고, 그 앵커 반경 안 후보를 가까운 순
  (동률은 관리번호 순)으로 최대 K 개 고른 합집합이다. 무작위 점 배치로 전수 계산과 대조한다.
- **게이트는 기존 것을 그대로 탄다.** TourAPI 와 같은 가게(같은 이름 50m 안 · 같은 주소 키 +
  같은 상호)는 TourAPI 쪽이 남고 LOCALDATA 는 병합으로 빠진다. 산출에는 LOCALDATA 만 나가고,
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
    SOURCE,
    SOURCE_NAME,
    gap_anchors,
    gate_against_tourapi,
    pick_near,
    shared_food_candidates,
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


def test_tourapi_cafe_never_absorbs_localdata_food() -> None:
    """게이트 3단은 같은 카테고리끼리만 본다 — 같은 이름의 카페가 식당을 지우지 않는다."""
    out = gate_against_tourapi([_tour("100", category=PoiCategory.CAFE)], [_ld("L-1")])
    assert [p.candidate.source_ref for p in out.passed] == ["L-1"]


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


def test_shared_food_candidates_take_food_only_as_tourapi() -> None:
    doc = {"proposals": [_shared_item("1", "FOOD"), _shared_item("2", "CAFE"), _shared_item("3", "SIGHT")]}
    (c,) = shared_food_candidates(doc)
    assert c.ref == ("tourapi", "1")
    assert c.category is PoiCategory.FOOD
    assert c.address == "제주특별자치도 서귀포시 중문관광로 154"
    assert (c.lat, c.lng) == _JEJU


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
