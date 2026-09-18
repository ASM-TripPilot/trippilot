"""SRC-P2(중복 처리) 확장 — 교차 출처 동일성 판정 (TRIP-682).

**같은 가게가 출처마다 다른 레코드로 들어온다.** 좌표만으로는 못 잡는다 — 실측
(TourAPI × LOCALDATA 동일 가게 6,886쌍) 중앙값 7.8m 지만 p95 가 52.0m 라 게이트
3단의 50m 반경이 94.7% 에서 끊기고, 한쪽 좌표가 틀린 8.4km 짜리까지 있다. 그래서
좌표와 **무관한** 근거(도로명주소 키 + 상호)를 쓴다.

여기서 증명하는 것은 네 방향이다.
- **붙어야 할 것은 붙는다** — 표기·좌표·출처가 어떻게 흔들려도 한 건 (merged=1).
- **붙으면 안 될 것은 안 붙는다** — 같은 건물의 다른 가게, 1자 상호, 그리고
  주소 키가 유효한 FOOD·CAFE 밖의 카테고리(개심사 ⟷ 그 안의 문화재).
- **모름은 근거가 아니다** — addr_key None 끼리는 주소로 판정하지 않는다.
- **기존 동작 보존** — 출처 미지정이면 잠정 ID 는 여전히 `tourapi-` 다.

입력은 무작위 유니코드가 아니라 실측 표기의 조립이다(tests/generators/poi_curation
§2) — 반례가 실데이터 한 줄이어야 재현·수정이 된다. 실 API 호출 0 (순수 함수만).
"""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.poi import OpenHour, PoiCategory
from trippilot.poi_curation.sourcing.collection_gate import (
    DROP_EXISTENCE_CLOSED,
    CollectionGate,
    GateReport,
    SourcingCandidate,
)
from trippilot.poi_curation.sourcing.mapping import (
    addr_key,
    normalize_business_name,
    same_business_name,
)

from tests.generators.geo import coord_pairs_apart
from tests.generators.poi_curation import (
    distinct_store_name_pairs,
    road_address_pairs,
    road_addresses,
    same_store_name_pairs,
    store_names,
    unresolvable_addresses,
)

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식으로 경로를 붙인다
# (test_match_business_status.py 와 동일 관용구, stdlib 전용 모듈이라 부작용 없음).
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from match_business_status import addr_key as script_addr_key  # noqa: E402

_ADDR_DEDUP = (PoiCategory.FOOD, PoiCategory.CAFE)
_OTHER_CATEGORIES = tuple(c for c in PoiCategory if c not in _ADDR_DEDUP)
_JEJU = (33.4996, 126.5312)


def _cand(
    ref: str,
    *,
    name: str = "고집돌우럭",
    address: str | None = "제주특별자치도 서귀포시 중문관광로 154",
    lat: float | None = _JEJU[0],
    lng: float | None = _JEJU[1],
    category: PoiCategory = PoiCategory.FOOD,
    source: str = "tourapi",
    open_hours: tuple[OpenHour, ...] = (),
    hours_raw: str | None = None,
    image_url: str | None = None,
) -> SourcingCandidate:
    """게이트 입력 1건 (test_poi_sourcing_pipeline._candidate 와 같은 모양 + source)."""
    return SourcingCandidate(
        source_ref=ref, kind="39", name=name, address=address, lat=lat, lng=lng,
        category=category, category_codes=("A05", "A0502", "A05020100"),
        open_hours=open_hours, hours_raw=hours_raw,
        image_url=image_url, modified_at="20260901120000", source=source,
    )


def _two_sources(
    names: tuple[str, str],
    addresses: tuple[str | None, str | None],
    coords: tuple[tuple[float, float], tuple[float, float]],
    category: PoiCategory,
) -> list[SourcingCandidate]:
    """같은(또는 다른) 가게가 서로 다른 출처·source_ref·좌표로 들어온 두 건."""
    return [
        _cand("101", name=names[0], address=addresses[0],
              lat=coords[0][0], lng=coords[0][1], category=category, source="tourapi"),
        _cand("A-77", name=names[1], address=addresses[1],
              lat=coords[1][0], lng=coords[1][1], category=category, source="localdata"),
    ]


def _conserved(report: GateReport, total: int) -> bool:
    """통과 + 병합 + 드롭 = 입력 — 병합은 드롭이 아니다(정보 보존)."""
    return len(report.passed) + report.merged + sum(report.drops.values()) == total


# ── 1. 상호 정규화·동일성 (순수 함수) ──────────────────────────────
@settings(max_examples=50, deadline=None)
@given(pair=same_store_name_pairs())
def test_pbt_상호_정규화는_멱등이다(pair: tuple[str, str]) -> None:
    """두 번 정규화해도 같다 — 정규화는 비교 전에 몇 번 걸려도 안전해야 한다."""
    for name in pair:
        once = normalize_business_name(name)
        assert normalize_business_name(once) == once


@settings(max_examples=60, deadline=None)
@given(pair=same_store_name_pairs())
def test_pbt_같은_가게_상호는_표기가_흔들려도_같다(pair: tuple[str, str]) -> None:
    """지점명 유무·꼬리표·괄호 주기·띄어쓰기가 달라도 같은 가게로 읽힌다.

    생성기 유효성 검증을 겸한다 — 이 전제가 깨지면 아래 게이트 속성들이 공허해진다.
    """
    a, b = pair
    assert same_business_name(a, b)


@settings(max_examples=60, deadline=None)
@given(pair=distinct_store_name_pairs())
def test_pbt_다른_가게_상호는_어떤_표기에서도_안_붙는다(pair: tuple[str, str]) -> None:
    """오병합 방지 — 이름 유사도 단독 판정은 실측에서 전부 오병합이었다."""
    a, b = pair
    assert not same_business_name(a, b)


@settings(max_examples=60, deadline=None)
@given(pair=st.one_of(same_store_name_pairs(), distinct_store_name_pairs()))
def test_pbt_상호_동일성_판정은_대칭이다(pair: tuple[str, str]) -> None:
    """same_business_name(a,b) == same_business_name(b,a) — 인자 순서에 의존하면
    게이트에서 '먼저 온 것' 이 판정을 바꾼다(입력 순서가 결과를 흔든다)."""
    a, b = pair
    assert same_business_name(a, b) == same_business_name(b, a)
    assert same_business_name(a, a) and same_business_name(b, b)


@pytest.mark.parametrize(
    ("short", "other"),
    [("김", "김밥천국"), ("면", "면사무소식당"), ("점", "고집돌우럭 중문점")],
)
def test_한_글자_상호는_아무_이름에나_붙지_않는다(short: str, other: str) -> None:
    """포함 판정의 2자 하한 — 1자면 전국의 아무 가게에나 걸린다."""
    assert not same_business_name(short, other)
    assert not same_business_name(other, short)


# ── 2. 주소 키 (순수 함수) ────────────────────────────────────────
@settings(max_examples=80, deadline=None)
@given(pair=road_address_pairs())
def test_pbt_주소_표기가_달라도_주소키는_같다(pair: tuple[str, str]) -> None:
    """읍·면 삽입 / 꼬리 쉼표 / 괄호 상세 / 중복 공백을 섞어도 같은 건물이다.

    예: '제주특별자치도 제주시 해맞이해안로 1296'
      ≡ '제주특별자치도 제주시 구좌읍 해맞이해안로 1296,'
    이 표기 차를 넘는 것이 매칭률을 35.5% → 83.3% 로 올린 조각이다.
    """
    a, b = pair
    assert addr_key(a) == addr_key(b)
    assert addr_key(a) is not None


@settings(max_examples=40, deadline=None)
@given(address=unresolvable_addresses())
def test_pbt_해석_불가_주소는_키가_없다(address: str | None) -> None:
    """지번·도로명 결손·시군구 계층 부재(세종)는 None — '다르다'가 아니라 '모른다'."""
    assert addr_key(address) is None


@settings(max_examples=80, deadline=None)
@given(address=st.one_of(road_addresses(), unresolvable_addresses()))
def test_pbt_주소키_정의가_두_곳에서_일치한다(address: str | None) -> None:
    """`mapping.addr_key` 와 `scripts/match_business_status.addr_key` 는 같은 규칙이다.

    정의가 두 곳에 있다(스크립트는 stdlib 전용 독립 실행). 갈라지면 '폐업으로 붙인
    가게' 와 '중복으로 병합한 가게' 의 판정이 어긋난다 — 그 드리프트를 여기서 잡는다.
    """
    assert addr_key(address) == script_addr_key(address)


def test_건물_부번은_다른_건물이다() -> None:
    assert addr_key("서울특별시 종로구 사직로 133-10") != addr_key(
        "서울특별시 종로구 사직로 133")


# ── 3. 게이트 3단 — 붙어야 할 것은 붙는다 ─────────────────────────
@settings(max_examples=60, deadline=None)
@given(
    names=same_store_name_pairs(),
    addresses=road_address_pairs(),
    coords=coord_pairs_apart(max_km=10.0),
    category=st.sampled_from(_ADDR_DEDUP),
)
def test_pbt_같은_가게는_출처가_달라도_한_건으로_남는다(
    names, addresses, coords, category
) -> None:
    """**핵심** — 출처·source_ref·좌표가 달라도 통과는 1건, 병합은 1건.

    좌표 차이를 0~10km 로 뽑는다: 주소 키 분기는 좌표와 무관해야 한다(출처마다
    좌표 기준이 다르고 실측 최대 8.4km 까지 벌어졌다).
    """
    c0, c1 = coords
    report = CollectionGate().apply(_two_sources(
        names, addresses, ((c0.lat, c0.lng), (c1.lat, c1.lng)), category))

    assert len(report.passed) == 1
    assert report.merged == 1
    assert report.drops == {}                      # 병합은 드롭이 아니다
    assert _conserved(report, 2)
    # 먼저 온 레코드가 살아남는다 — 잠정 ID 는 그 출처를 따른다
    assert str(report.passed[0].poi.poi_id) == "tourapi-101"


@settings(max_examples=40, deadline=None)
@given(
    names=same_store_name_pairs(),
    addresses=road_address_pairs(),
    coords=coord_pairs_apart(min_km=0.2, max_km=10.0),
    category=st.sampled_from(_ADDR_DEDUP),
)
def test_pbt_주소키_병합은_50m_반경_밖에서도_성립한다(
    names, addresses, coords, category
) -> None:
    """50m 반경(㉠)이 절대 못 잡는 거리에서만 뽑는다 — 순수하게 주소 키(㉡)의 몫."""
    c0, c1 = coords
    report = CollectionGate().apply(_two_sources(
        names, addresses, ((c0.lat, c0.lng), (c1.lat, c1.lng)), category))
    assert len(report.passed) == 1 and report.merged == 1


@settings(max_examples=40, deadline=None)
@given(
    names=same_store_name_pairs(),
    addresses=road_address_pairs(),
    coords=coord_pairs_apart(max_km=10.0),
    category=st.sampled_from(_ADDR_DEDUP),
    hours=st.sampled_from([(OpenHour(0, 540, 1080),), ()]),
)
def test_pbt_교차출처_병합도_결측만_보충한다(
    names, addresses, coords, category, hours
) -> None:
    """조용한 덮어쓰기 금지 — 먼저 온 값은 유지하고 비어 있던 칸만 채운다."""
    c0, c1 = coords
    first, second = _two_sources(
        names, addresses, ((c0.lat, c0.lng), (c1.lat, c1.lng)), category)
    first = replace(first, image_url="http://img/first.jpg")
    second = replace(second, open_hours=hours, hours_raw="10:00~21:00",
                     image_url="http://img/second.jpg")
    report = CollectionGate().apply([first, second])

    kept = report.passed[0]
    assert kept.poi.name == names[0].strip()               # 먼저 온 이름 유지
    assert kept.candidate.image_url == "http://img/first.jpg"   # 덮어쓰지 않는다
    assert kept.poi.open_hours == hours                    # 결측만 보충
    assert kept.candidate.hours_raw == "10:00~21:00"


# ── 4. 게이트 3단 — 붙으면 안 될 것은 안 붙는다 ───────────────────
@settings(max_examples=60, deadline=None)
@given(
    names=same_store_name_pairs(),
    addresses=st.tuples(unresolvable_addresses(), unresolvable_addresses()),
    coords=coord_pairs_apart(min_km=0.2, max_km=10.0),
    category=st.sampled_from(_ADDR_DEDUP),
)
def test_pbt_주소를_모르면_이름이_같아도_안_붙는다(
    names, addresses, coords, category
) -> None:
    """**모름은 근거가 아니다** — addr_key 가 None 인 둘은 주소로 판정하지 않는다.

    이름이 같아도 50m 밖이면 2건으로 남는다(㉠ 도 ㉡ 도 못 쓴다). None 을 '같다'로
    읽으면 주소 없는 후보가 전부 한 덩어리가 된다.
    """
    c0, c1 = coords
    report = CollectionGate().apply(_two_sources(
        names, addresses, ((c0.lat, c0.lng), (c1.lat, c1.lng)), category))

    assert len(report.passed) == 2
    assert report.merged == 0
    assert _conserved(report, 2)


@settings(max_examples=60, deadline=None)
@given(
    names=distinct_store_name_pairs(),
    addresses=road_address_pairs(),
    coords=coord_pairs_apart(max_km=10.0),
    category=st.sampled_from(_ADDR_DEDUP),
)
def test_pbt_같은_주소_다른_상호는_병합되지_않는다(
    names, addresses, coords, category
) -> None:
    """같은 건물의 다른 가게 — 붙이면 엉뚱한 가게로 안내한다(실측 12%대)."""
    c0, c1 = coords
    report = CollectionGate().apply(_two_sources(
        names, addresses, ((c0.lat, c0.lng), (c1.lat, c1.lng)), category))

    assert len(report.passed) == 2 and report.merged == 0


def test_같은_주소_1자_상호는_붙지_않는다() -> None:
    """'김' 이 '김밥천국' 에 걸리면 한 건물의 모든 가게가 한 덩어리가 된다."""
    report = CollectionGate().apply([
        _cand("1", name="김", address="제주특별자치도 제주시 월랑로 36"),
        _cand("2", name="김밥천국", address="제주특별자치도 제주시 월랑로 36,",
              lat=33.51, lng=126.52, source="localdata"),
    ])
    assert len(report.passed) == 2 and report.merged == 0


# ── 5. 주소 키 분기의 적용 범위 (FOOD·CAFE 한정) ───────────────────
@settings(max_examples=60, deadline=None)
@given(
    names=same_store_name_pairs(),
    addresses=road_address_pairs(),
    coords=coord_pairs_apart(min_km=0.2, max_km=10.0),
    other=st.sampled_from(_OTHER_CATEGORIES),
    food=st.sampled_from(_ADDR_DEDUP),
)
def test_pbt_주소키_병합은_FOOD_CAFE_에만_적용된다(
    names, addresses, coords, other, food
) -> None:
    """같은 입력을 **카테고리만 바꿔** 대조한다 — 같은 주소 + 포함관계 상호일 때
    FOOD·CAFE 는 병합, 그 밖(관광지·문화·자연·체험·쇼핑)은 2건으로 남는다.

    상호 부분일치는 식품업소에서만 검증된 규칙이다(폐업 대조 대상이 식품위생업소뿐).
    관광지에 그대로 쓰면 포함 관계인 **다른** POI 를 병합한다 — 공유본 18,607건에서
    전 카테고리 적용 시 57쌍 중 대부분이 오탐이었다.
    """
    c0, c1 = coords
    pts = ((c0.lat, c0.lng), (c1.lat, c1.lng))

    kept_apart = CollectionGate().apply(_two_sources(names, addresses, pts, other))
    assert len(kept_apart.passed) == 2 and kept_apart.merged == 0

    merged = CollectionGate().apply(_two_sources(names, addresses, pts, food))
    assert len(merged.passed) == 1 and merged.merged == 1


def test_절과_그_안의_문화재는_병합되지_않는다() -> None:
    """회귀 고정 — 전 카테고리에 주소 키를 쓰면 걸리던 대표 오탐(SIGHT)."""
    address = "충청남도 서산시 운산면 개심사로 321-86"
    report = CollectionGate().apply([
        _cand("1", name="개심사(괴산)", address=address,
              category=PoiCategory.SIGHT, lat=36.73, lng=126.60),
        _cand("2", name="개심사 목조여래좌상과 목조관음보살좌상", address=address + ", 1층",
              category=PoiCategory.SIGHT, lat=36.7301, lng=126.6001, source="localdata"),
    ])
    assert len(report.passed) == 2 and report.merged == 0
    # 상호 판정 자체는 '같다'고 본다 — 막는 것은 카테고리 범위다
    assert same_business_name("개심사(괴산)", "개심사 목조여래좌상과 목조관음보살좌상")


def test_같은_건물_같은_상호_식당은_병합된다() -> None:
    """회귀 고정 — FOOD 한정으로 남은 6쌍은 전부 진짜 중복이었다('오픈커피' 3m)."""
    report = CollectionGate().apply([
        _cand("1", name="오픈커피", address="경기도 성남시 분당구 판교로 228-3",
              category=PoiCategory.CAFE, lat=37.4020, lng=127.1080),
        _cand("2", name="오픈커피 판교본점",
              address="경기도 성남시 분당구 판교로 228-3, 1층 (삼평동)",
              category=PoiCategory.CAFE, lat=37.4500, lng=127.1500, source="localdata"),
    ])
    assert len(report.passed) == 1 and report.merged == 1
    assert str(report.passed[0].poi.poi_id) == "tourapi-1"


# ── 6. 배치 전체 — 중복 비율 0~100% 스윕 ───────────────────────────
@st.composite
def _cross_source_batches(draw) -> tuple[list[SourcingCandidate], int]:
    """가게 N개를 1~2개 출처로 흩뿌린 배치 + 고유 가게 수.

    중복 비율은 0%(전부 단일 출처) ~ 100%(전부 2출처) 사이를 스윕한다. 가게마다
    상호가 서로 포함되지 않고 건물번호가 다르므로 **고유 가게 수가 곧 정답**이다.
    """
    n = draw(st.integers(min_value=1, max_value=5))
    bases = draw(st.lists(store_names(), min_size=n, max_size=n, unique=True))
    records: list[SourcingCandidate] = []
    for i, base in enumerate(bases):
        names = draw(same_store_name_pairs(base=base))
        addresses = draw(road_address_pairs(bldg=str(100 + i)))
        c0, c1 = draw(coord_pairs_apart(max_km=10.0))
        category = draw(st.sampled_from(_ADDR_DEDUP))
        records.append(_cand(f"t{i}", name=names[0], address=addresses[0],
                             lat=c0.lat, lng=c0.lng, category=category,
                             source="tourapi"))
        if draw(st.booleans()):   # 이 가게가 두 번째 출처에도 있나
            records.append(_cand(f"L{i}", name=names[1], address=addresses[1],
                                 lat=c1.lat, lng=c1.lng, category=category,
                                 source="localdata"))
    return draw(st.permutations(records)), n


@settings(max_examples=60, deadline=None)
@given(batch=_cross_source_batches())
def test_pbt_중복_비율이_얼마든_고유_가게_수만_남는다(
    batch: tuple[list[SourcingCandidate], int]
) -> None:
    """0~100% 스윕 — 통과 수 = 고유 가게 수, 병합 수 = 나머지 전부. 순서 무관."""
    records, unique_stores = batch
    report = CollectionGate().apply(records)

    assert len(report.passed) == unique_stores
    assert report.merged == len(records) - unique_stores
    assert _conserved(report, len(records))
    # 살아남은 잠정 ID 는 서로 다르다 (병합이 id 를 복제하지 않는다)
    ids = [str(p.poi.poi_id) for p in report.passed]
    assert len(set(ids)) == len(ids)


@settings(max_examples=30, deadline=None)
@given(batch=_cross_source_batches())
def test_pbt_교차출처_판정은_결정론적이다(
    batch: tuple[list[SourcingCandidate], int]
) -> None:
    """같은 입력 두 번 → 같은 출력 (시각·난수·외부 조회 없음)."""
    records, _ = batch

    def run() -> tuple:
        r = CollectionGate().apply(records)
        return (tuple(str(p.poi.poi_id) for p in r.passed), r.merged, tuple(sorted(r.drops.items())))

    assert run() == run()


# ── 7. 기존 동작 보존 ─────────────────────────────────────────────
@settings(max_examples=40, deadline=None)
@given(ref=st.integers(min_value=1, max_value=10**7).map(str))
def test_pbt_출처를_안_주면_tourapi_접두를_유지한다(ref: str) -> None:
    """source 기본값 — 기존 수집 산출물의 잠정 ID 규약이 바뀌지 않는다."""
    report = CollectionGate().apply([_cand(ref)])
    assert str(report.passed[0].poi.poi_id) == f"tourapi-{ref}"
    assert report.passed[0].candidate.source == "tourapi"


@settings(max_examples=40, deadline=None)
@given(
    ref=st.integers(min_value=1, max_value=10**7).map(str),
    source=st.sampled_from(("tourapi", "localdata", "kakao")),
)
def test_pbt_잠정_ID_는_출처_접두를_따른다(ref: str, source: str) -> None:
    """출처가 둘 이상이면 여기서 갈린다 — 정본 ID 는 백엔드가 부여한다(INV-1)."""
    report = CollectionGate().apply([_cand(ref, source=source)])
    assert str(report.passed[0].poi.poi_id) == f"{source}-{ref}"


# ── 8. 벤더 번호는 출처 안에서만 유일하다 (회귀 고정) ──────────────────
# 3단 색인과 폐업 대조가 `source_ref` **단독** 문자열을 쓰던 시절의 버그를 막는다.
# 벤더가 부여한 번호라 출처가 둘이 되면 무관한 레코드끼리 번호가 겹친다. 색인이
# 먼저 걸리면 이름·카테고리·거리를 **아예 보지 않고** 병합됐다.
#   재현했던 것: tourapi/"1234" 성산일출봉(NATURE·제주) + localdata/"1234"
#   우진해장국(FOOD·서울) → passed 1건, merged 1 — 450km·다른 카테고리인데도.
# 지금은 `SourcingCandidate.ref = (source, source_ref)` 가 두 조회의 유일한 키다.


@given(ref=st.text(alphabet="0123456789", min_size=1, max_size=7))
@settings(max_examples=50)
def test_pbt_내부_번호가_겹쳐도_다른_가게는_안_붙는다(ref: str) -> None:
    """출처만 다르고 번호가 같은 두 무관한 레코드 — 번호는 병합 근거가 아니다."""
    report = CollectionGate().apply([
        _cand(ref, name="성산일출봉", category=PoiCategory.NATURE,
              address="제주특별자치도 서귀포시 성산읍 일출로 284-12",
              lat=33.4580, lng=126.9423, source="tourapi"),
        _cand(ref, name="우진해장국", category=PoiCategory.FOOD,
              address="서울특별시 종로구 종로 10", lat=37.5700, lng=126.9830,
              source="localdata"),
    ])
    assert len(report.passed) == 2, "번호 충돌이 병합 근거가 됐다"
    assert report.merged == 0
    assert _conserved(report, 2)


@given(ref=st.text(alphabet="0123456789", min_size=1, max_size=7))
@settings(max_examples=50)
def test_pbt_폐업_목록은_자기_출처에만_적용된다(ref: str) -> None:
    """폐업 근거는 TourAPI contentid 집합 — 다른 출처의 같은 번호를 드롭하면 안 된다."""
    closed = frozenset({("tourapi", ref)})
    other = CollectionGate(closed_refs=closed).apply([
        _cand(ref, name="우진해장국", source="localdata"),
    ])
    assert len(other.passed) == 1, "남의 출처 번호를 폐업으로 읽었다"

    own = CollectionGate(closed_refs=closed).apply([_cand(ref, source="tourapi")])
    assert len(own.passed) == 0, "자기 출처의 폐업은 여전히 걸러야 한다"
    assert own.drops.get(DROP_EXISTENCE_CLOSED) == 1


# 부수 발견(미해결, 위험 낮음): ㉠ 은 `_normalize_name`(casefold 포함), ㉡ 은
# `normalize_business_name`(casefold 없음)으로 정규화가 갈린다 — 'STARBUCKS' 와
# 'Starbucks' 는 같은 주소·50m 밖이면 안 붙는다. 보수적(미병합) 방향이라 오병합은
# 아니지만 두 분기의 규칙이 다른 것은 사실이다.
