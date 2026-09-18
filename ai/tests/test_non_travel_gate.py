"""SRC-P1 확장 — 게이트 5단 정책: 이름으로 확실한 비여행지만 드롭 (TRIP-686).

출처가 셋(TourAPI·Overture·OSM)이 되면서 카테고리가 거친 것이 편의점·대형마트·
통신·대리점·아파트를 실어 왔다(제주 실측: SHOPPING 241건 중 편의점 11·대형마트 4·
통신 3, SIGHT 317건 중 아파트 29). 카테고리 화이트리스트를 통과한 뒤에도 남는 것을
**이름**으로 잡는다 — `mapping.non_travel_reason` + `CollectionGate` 5단.

여기서 증명하는 것은 네 방향이다.
- **오탐 0 — 실측 생존자는 전부 통과한다** (가장 중요). 한국 상호는 말장난이 많고
  (오랑우탄면사무소·조은미의원·꿀단지 — 식당) 역사 건물은 기관명을 단다(구 인천우체국·
  고려대학교 본관 — 등록문화재). 넓은 규칙(`학원|대학교|사무소|의원|단지|주공`)이
  **일부러 없다** — 이 파일이 그 좁음을 지킨다. 생존자 하나라도 걸리면 규칙이 넓어진
  것이다. None 은 "여행지다"가 아니라 "이름으로는 모른다"이므로 미탐은 허용된다.
- **실측 진양성은 표의 사유로 걸린다** — 사유 집합은 `_NON_TRAVEL` 표에서 유도한다
  (손으로 적지 않는다 — 표가 늘면 치역도 같이 는다).
- **순수 함수 계약** — 치역·결정론·앞뒤 공백 불변·None/빈 문자열 → None·표 순서대로
  첫 매칭.
- **게이트 결선** — 3단 중복 병합 **뒤**에 판정하므로 같은 편의점이 두 출처로 들어오면
  병합 1 + 드롭 1 이지 드롭 2 가 아니다. 앞단(스키마·실재)에서 떨어진 것은 5단까지
  오지 않아 한 레코드는 한 사유로만 계상된다. 통과 + 병합 + 드롭 = 입력.

입력은 무작위 유니코드가 아니라 실측 표기의 조립이다(tests/generators/poi_curation
§7) — 반례가 실데이터 한 줄이어야 규칙을 좁힐지 넓힐지 판단이 선다. 실 API 호출 0
(순수 함수·게이트만).
"""

from __future__ import annotations

from collections import Counter

import pytest
from hypothesis import example, given, settings
from hypothesis import strategies as st

from trippilot.domain.poi import OpenHour, PoiCategory
from trippilot.poi_curation.sourcing.collection_gate import (
    DROP_EXISTENCE,
    DROP_EXISTENCE_CLOSED,
    DROP_POLICY_NON_TRAVEL,
    DROP_SCHEMA_COORD,
    CollectionGate,
    GateReport,
    SourcingCandidate,
)
from trippilot.poi_curation.sourcing.mapping import _NON_TRAVEL, non_travel_reason

from tests.generators.geo import coord_pairs_apart, geo_points
from tests.generators.poi_curation import (
    name_padding,
    non_travel_hits,
    non_travel_survivors,
    road_address_pairs,
    store_names,
    travel_names,
)

# 사유 집합은 표에서 **유도**한다 — 표에 사유가 늘면 치역 검사도 같이 는다.
_REASONS: tuple[str, ...] = tuple(reason for reason, _ in _NON_TRAVEL)
_REASON_SET = frozenset(_REASONS)
_SOURCES = ("tourapi", "overture", "osm")
_ALL_CATEGORIES = tuple(PoiCategory)
_JEJU = (33.4996, 126.5312)

# 두 규칙 이상에 동시에 걸리는 이름 — "표 순서대로 첫 매칭" 이 실제로 판정을 가른다.
_MULTI_RULE_NAMES = (
    "KT 아파트",              # telecom(3) vs apartment(5)
    "편의점 대리점",          # convenience_store(1) vs dealership(4)
    "CU 편의점 오피스텔",     # convenience_store(1) vs apartment(5)
    "GS25 AS센터",            # convenience_store(1) vs telecom(3)
    "이마트 대리점",          # hypermarket(2, '점'으로 끝) vs dealership(4)
)


def _hit_names() -> st.SearchStrategy[str]:
    return non_travel_hits().map(lambda h: h[0])


def _any_names() -> st.SearchStrategy[str]:
    """치역·결정론·순서 검사용 전 분포 — 생존자·진양성·다중 규칙·임의 텍스트."""
    return st.one_of(travel_names(), _hit_names(),
                     st.sampled_from(_MULTI_RULE_NAMES), st.text(max_size=20))


def _cand(
    ref: str,
    *,
    name: str,
    address: str | None = "제주특별자치도 서귀포시 중문관광로 154",
    lat: float | None = _JEJU[0],
    lng: float | None = _JEJU[1],
    category: PoiCategory = PoiCategory.SHOPPING,
    source: str = "tourapi",
    open_hours: tuple[OpenHour, ...] = (),
) -> SourcingCandidate:
    """게이트 입력 1건 (test_poi_cross_source_dedup._cand 와 같은 모양)."""
    return SourcingCandidate(
        source_ref=ref, kind="38", name=name, address=address, lat=lat, lng=lng,
        category=category, category_codes=("A04", "A0401", "A04010200"),
        open_hours=open_hours, hours_raw=None,
        image_url=None, modified_at="20260901120000", source=source,
    )


def _conserved(report: GateReport, total: int) -> bool:
    """통과 + 병합 + 드롭 = 입력 — 병합은 드롭이 아니다(정보 보존)."""
    return len(report.passed) + report.merged + sum(report.drops.values()) == total


def _non_travel_keys(report: GateReport) -> dict[str, int]:
    return {k: v for k, v in report.drops.items()
            if k.startswith(DROP_POLICY_NON_TRAVEL)}


# ── 1. 보수성 — 실측 오탐 생존자는 전부 None (가장 중요) ────────────────
@pytest.mark.parametrize("name", [
    "아파트 카페", "오랑우탄면사무소", "돈사무소 노형점", "조은미의원", "꿀단지",
    "곰나루국민관광단지", "구 인천우체국", "서울 고려대학교 본관", "인하대학교 박물관",
    "봉채국수 탑동이마트점", "애슐리 제주롯데마트점", "이마트 제주점 문화센터",
    "귤품은흑돼지 제주공항점", "가야산국립공원 치인자동차야영장", "거장산오토캠핑장",
    "하이원리조트 알파인코스터",
])
def test_실측_오탐_생존자는_걸리지_않는다(name: str) -> None:
    """한 건이라도 걸리면 규칙이 넓어진 것이다 — 규칙 추가 전에 이 목록부터 통과해야 한다.

    사례별로 실패가 보이도록 펼쳐 둔다(같은 목록이 §7 생성기에도 있다 — 아래 PBT 가
    공백 변형까지 스윕한다).
    """
    assert non_travel_reason(name) is None, f"규칙이 넓어졌다: {name!r} → {non_travel_reason(name)}"


@settings(max_examples=80, deadline=None)
@given(name=non_travel_survivors(), left=name_padding(), right=name_padding())
def test_pbt_오탐_생존자는_공백을_붙여도_None_이다(name: str, left: str, right: str) -> None:
    """strip 뒤 판정 — 여백 표기가 생존자를 걸리게 만들면 안 된다."""
    assert non_travel_reason(left + name + right) is None


@settings(max_examples=80, deadline=None)
@given(name=travel_names(), left=name_padding(), right=name_padding())
def test_pbt_여행지_이름_전_분포는_None_이다(name: str, left: str, right: str) -> None:
    """대조군 확장 — §2 상호·§5 한글 장소명(천문·전망·병기)도 어느 규칙에도 안 걸린다."""
    assert non_travel_reason(left + name + right) is None


@pytest.mark.parametrize("token", ["학원", "대학교", "사무소", "의원", "단지", "주공"])
def test_넓은_기관명_토큰은_일부러_규칙에_없다(token: str) -> None:
    """설계 의도 고정 — 이 토큰들은 실측에서 오탐을 냈다(대학 박물관·관광단지·
    제주**공**항점·말장난 상호). 이 테스트가 깨지면 규칙을 넓힌 것이고, 그러려면
    위 생존자 목록이 먼저 전부 통과해야 한다.
    """
    assert non_travel_reason(f"제주 {token}") is None
    assert non_travel_reason(f"{token}") is None


@pytest.mark.parametrize(("name", "expected"), [
    ("KT&G 상상마당", None),          # 홍대 복합문화공간 — `&` 뒤라 낱말 경계가 없다
    ("KT 동원텔레콤한림점", "telecom"),
    ("CU카페", None),                 # 체인명이 낱말로 끊기지 않으면 모른다
    ("CU 제주서광로점", "convenience_store"),
])
def test_접두_규칙은_낱말_경계가_있어야_걸린다(name: str, expected: str | None) -> None:
    """`^(KT|CU|…)(\\s|$)` — 접두 뒤에 공백/끝이 없으면 다른 낱말이다. 경계를 풀면
    'KT&G 상상마당' 같은 진짜 문화공간이 통신사로 떨어진다."""
    assert non_travel_reason(name) == expected


# ── 2. 실측 진양성 — 표의 사유로 걸린다 ────────────────────────────────
@settings(max_examples=80, deadline=None)
@given(hit=non_travel_hits(), left=name_padding(), right=name_padding())
def test_pbt_실측_진양성은_표의_사유로_걸린다(hit: tuple[str, str], left: str, right: str) -> None:
    name, reason = hit
    assert reason in _REASON_SET, "생성기 사유가 표에 없다 — 표 또는 생성기가 갈렸다"
    assert non_travel_reason(left + name + right) == reason


# ── 3. 순수 함수 계약 — 치역·결정론·공백 불변·None ───────────────────────
@settings(max_examples=120, deadline=None)
@given(name=_any_names())
def test_pbt_치역은_None_또는_표의_사유다(name: str) -> None:
    """반환값은 표에서 유도한 집합 밖으로 나가지 않는다 — 드롭 키 접미가 이 값이다."""
    result = non_travel_reason(name)
    assert result is None or result in _REASON_SET


@settings(max_examples=80, deadline=None)
@given(name=_any_names())
def test_pbt_판정은_결정론적이다(name: str) -> None:
    """같은 입력 두 번 → 같은 출력 (시각·난수·외부 조회 없음)."""
    assert non_travel_reason(name) == non_travel_reason(name)


@settings(max_examples=120, deadline=None)
@given(name=_any_names(), left=name_padding(), right=name_padding())
def test_pbt_앞뒤_공백은_판정을_바꾸지_않는다(name: str, left: str, right: str) -> None:
    """공백·탭·개행·전각 공백을 앞뒤에 붙여도 결과가 같다 — `$` 앵커가 개행에 속지 않는다."""
    assert non_travel_reason(left + name + right) == non_travel_reason(name)


@settings(max_examples=40, deadline=None)
@given(name=st.one_of(st.none(), st.just(""), name_padding()))
def test_pbt_None_빈문자열_공백만은_None_이다(name: str | None) -> None:
    """이름이 없으면 판정할 근거가 없다 — 사유를 지어내지 않는다."""
    assert non_travel_reason(name) is None


@settings(max_examples=120, deadline=None)
@given(name=_any_names())
@example("KT 아파트")
@example("편의점 대리점")
@example("이마트 대리점")
def test_pbt_표_순서대로_첫_매칭이_사유다(name: str) -> None:
    """oracle 을 표에서 유도한다 — 걸린 규칙보다 **앞선** 규칙은 매칭되지 않았고,
    걸린 규칙 자체는 매칭된다. None 이면 어느 규칙도 매칭되지 않았다.

    두 규칙에 동시에 걸리는 이름(`KT 아파트`)에서 순서가 실제로 판정을 가른다 —
    표를 재정렬하면 드롭 키가 바뀌므로 통계 계약이 바뀐다.
    """
    result = non_travel_reason(name)
    stripped = name.strip()
    matched = [reason for reason, rx in _NON_TRAVEL if rx.search(stripped)]
    assert result == (matched[0] if matched else None)


# ── 4. 게이트 결선 — 한 건 ─────────────────────────────────────────────
@settings(max_examples=80, deadline=None)
@given(
    hit=non_travel_hits(),
    category=st.sampled_from(_ALL_CATEGORIES),
    source=st.sampled_from(_SOURCES),
    left=name_padding(),
    right=name_padding(),
)
def test_pbt_진양성_이름은_게이트를_통과하지_못한다(
    hit: tuple[str, str], category: PoiCategory, source: str, left: str, right: str
) -> None:
    """카테고리·출처·여백과 무관하게 `policy_non_travel:<사유>` 1건으로 계상된다.

    카테고리를 전 종 돌리는 이유: 이 규칙은 카테고리 화이트리스트 **뒤**의 그물이다 —
    출처가 SIGHT 라고 우겨도(Overture 가 아파트를 landmark 로 보냈다) 이름이 이긴다.
    """
    name, reason = hit
    report = CollectionGate().apply([
        _cand("1", name=left + name + right, category=category, source=source),
    ])
    assert report.passed == ()
    assert report.drops == {f"{DROP_POLICY_NON_TRAVEL}:{reason}": 1}
    assert report.merged == 0
    assert _conserved(report, 1)


@settings(max_examples=80, deadline=None)
@given(
    name=travel_names(),
    category=st.sampled_from(_ALL_CATEGORIES),
    source=st.sampled_from(_SOURCES),
    left=name_padding(),
    right=name_padding(),
)
def test_pbt_생존자_이름은_게이트를_통과한다(
    name: str, category: PoiCategory, source: str, left: str, right: str
) -> None:
    """오탐 0 의 게이트판 — 생존자·상호·장소명은 어느 카테고리로 와도 드롭 0."""
    report = CollectionGate().apply([
        _cand("1", name=left + name + right, category=category, source=source),
    ])
    assert len(report.passed) == 1
    assert report.drops == {}
    assert report.passed[0].poi.name == name.strip()
    assert _conserved(report, 1)


@st.composite
def _earlier_stage_faults(draw) -> tuple[SourcingCandidate, frozenset[tuple[str, str]], str]:
    """비여행 이름에 앞단(1·2단) 결손을 하나 얹는다 → (후보, closed_refs, 기대 드롭 키).

    5단은 앞단을 통과한 것만 본다 — 결손 레코드가 정책 사유로도 계상되면 한 레코드가
    두 번 세어져 보존식이 깨진다.
    """
    name, _ = draw(non_travel_hits())
    fault = draw(st.sampled_from(("no_coord", "bad_coord", "out_of_region", "closed")))
    closed: frozenset[tuple[str, str]] = frozenset()
    if fault == "no_coord":
        cand, key = _cand("1", name=name, lat=None), DROP_SCHEMA_COORD
    elif fault == "bad_coord":
        cand, key = _cand("1", name=name, lat=95.0), DROP_SCHEMA_COORD
    elif fault == "out_of_region":
        cand, key = _cand("1", name=name, lat=35.68, lng=139.77), DROP_EXISTENCE  # 도쿄
    else:
        cand, key = _cand("1", name=name), DROP_EXISTENCE_CLOSED
        closed = frozenset({cand.ref})
    return cand, closed, key


@settings(max_examples=60, deadline=None)
@given(case=_earlier_stage_faults())
def test_pbt_앞단_결손은_정책_사유로_이중_계상되지_않는다(
    case: tuple[SourcingCandidate, frozenset[tuple[str, str]], str]
) -> None:
    """한 레코드 = 한 드롭 사유. 좌표 결손·권역 밖·폐업이면 거기서 끝난다."""
    cand, closed, expected_key = case
    report = CollectionGate(closed_refs=closed).apply([cand])
    assert report.drops == {expected_key: 1}
    assert _non_travel_keys(report) == {}
    assert report.passed == ()
    assert _conserved(report, 1)


# ── 5. 게이트 순서 — 3단 병합 뒤에 판정한다 ─────────────────────────────
@settings(max_examples=60, deadline=None)
@given(
    hit=non_travel_hits(),
    coords=coord_pairs_apart(max_km=0.04),
    category=st.sampled_from(_ALL_CATEGORIES),
)
def test_pbt_같은_비여행지가_두_출처로_오면_병합_1_드롭_1_이다(
    hit: tuple[str, str], coords, category: PoiCategory
) -> None:
    """㉠ 같은 이름 + 50m 이내 — 먼저 병합(1), 남은 한 건이 드롭(1). 드롭 2 가 아니다.

    순서가 뒤집히면(5단이 3단 앞) 같은 편의점이 출처 수만큼 드롭으로 잡혀 통계가
    부풀고, 보존식은 그대로 성립해 눈에 안 띈다 — 그래서 병합 수를 직접 본다.
    """
    name, reason = hit
    c0, c1 = coords
    report = CollectionGate().apply([
        _cand("101", name=name, lat=c0.lat, lng=c0.lng, category=category, source="tourapi"),
        _cand("A-77", name=name, lat=c1.lat, lng=c1.lng, category=category, source="overture"),
    ])
    assert report.passed == ()
    assert report.merged == 1
    assert report.drops == {f"{DROP_POLICY_NON_TRAVEL}:{reason}": 1}
    assert _conserved(report, 2)


@settings(max_examples=60, deadline=None)
@given(
    hit=non_travel_hits(),
    addresses=road_address_pairs(),
    coords=coord_pairs_apart(min_km=0.2, max_km=10.0),
    category=st.sampled_from((PoiCategory.FOOD, PoiCategory.CAFE)),
)
def test_pbt_주소키_병합_경로에서도_병합_뒤_드롭이다(
    hit: tuple[str, str], addresses: tuple[str, str], coords, category: PoiCategory
) -> None:
    """㉡ FOOD·CAFE 주소 키 + 같은 상호 — 50m 밖이라 ㉠ 은 못 쓰고 ㉡ 으로 병합된 뒤
    한 건이 드롭된다(`꽃사슴복권마트(슈퍼맨편의점)` 처럼 FOOD 로 매핑된 편의점)."""
    name, reason = hit
    c0, c1 = coords
    report = CollectionGate().apply([
        _cand("101", name=name, address=addresses[0], lat=c0.lat, lng=c0.lng,
              category=category, source="tourapi"),
        _cand("A-77", name=name, address=addresses[1], lat=c1.lat, lng=c1.lng,
              category=category, source="osm"),
    ])
    assert report.passed == ()
    assert report.merged == 1
    assert report.drops == {f"{DROP_POLICY_NON_TRAVEL}:{reason}": 1}
    assert _conserved(report, 2)


# ── 6. 배치 — 오염 비율 0~100% 스윕 ──────────────────────────────────────
@st.composite
def _labelled_batches(draw) -> list[tuple[SourcingCandidate, str | None]]:
    """이름이 전부 다른 레코드 1~8건 + 각 건의 기대 사유(None = 통과).

    기대값은 **생성기의 실측 표**에서 오고 함수 호출로 만들지 않는다 — 함수를 oracle 로
    쓰면 순환이다. 이름·건물번호가 전부 달라 3단 병합이 없으므로 정답은 라벨 합산이다.
    비여행 비율은 0%(전부 여행지) ~ 100%(전부 비여행) 사이를 스윕한다.
    """
    labelled = draw(st.lists(
        st.one_of(non_travel_hits(),
                  non_travel_survivors().map(lambda n: (n, None)),
                  store_names().map(lambda n: (n, None))),
        min_size=1, max_size=8, unique_by=lambda t: t[0],
    ))
    out: list[tuple[SourcingCandidate, str | None]] = []
    for i, (name, reason) in enumerate(labelled):
        pt = draw(geo_points())
        out.append((
            _cand(f"r{i}", name=name, address=f"제주특별자치도 제주시 월랑로 {100 + i}",
                  lat=pt.lat, lng=pt.lng,
                  category=draw(st.sampled_from(_ALL_CATEGORIES)),
                  source=draw(st.sampled_from(_SOURCES))),
            reason,
        ))
    return out


@settings(max_examples=80, deadline=None)
@given(batch=_labelled_batches())
def test_pbt_오염_비율이_얼마든_통과는_여행지만_드롭은_사유별로_정확하다(
    batch: list[tuple[SourcingCandidate, str | None]]
) -> None:
    """통과 이름 = 라벨 None 인 것들(입력 순서 그대로), 드롭 = 사유별 Counter, 병합 0."""
    records = [c for c, _ in batch]
    report = CollectionGate().apply(records)

    expected_pass = [c.name for c, reason in batch if reason is None]
    expected_drops = Counter(f"{DROP_POLICY_NON_TRAVEL}:{reason}"
                             for _, reason in batch if reason is not None)
    assert [p.poi.name for p in report.passed] == expected_pass
    assert dict(report.drops) == dict(expected_drops)
    assert report.merged == 0
    assert _conserved(report, len(records))


@st.composite
def _polluted_batches(draw) -> list[SourcingCandidate]:
    """적대적 배치 1~10건 — 같은 이름·같은 번호·같은 주소·코앞 좌표가 섞여 3단 병합이
    무작위로 일어난다. 정답을 세지 않고 **불변식**만 본다: 통과분에 비여행 이름 0건."""
    n = draw(st.integers(min_value=1, max_value=10))
    names = draw(st.lists(st.one_of(_hit_names(), travel_names()), min_size=n, max_size=n))
    anchors = ((33.4996, 126.5312), (33.4998, 126.5314), (37.5700, 126.9830))
    addrs = ("제주특별자치도 제주시 월랑로 36", "제주특별자치도 제주시 월랑로 36, 1층",
             "서울특별시 종로구 종로 10", None)
    out: list[SourcingCandidate] = []
    for name in names:
        lat, lng = draw(st.sampled_from(anchors))
        out.append(_cand(
            f"r{draw(st.integers(min_value=0, max_value=n))}",   # 번호 충돌 허용
            name=name, address=draw(st.sampled_from(addrs)), lat=lat, lng=lng,
            category=draw(st.sampled_from(_ALL_CATEGORIES)),
            source=draw(st.sampled_from(_SOURCES)),
        ))
    return out


@settings(max_examples=80, deadline=None)
@given(records=_polluted_batches())
def test_pbt_병합이_어떻게_일어나도_통과분에_비여행_이름은_0건이다(
    records: list[SourcingCandidate]
) -> None:
    """INV-1 의 입구 불변식 — 무엇이 어떻게 병합되든 살아남은 이름은 규칙에 안 걸린다.
    드롭 키는 전부 `policy_non_travel:<표의 사유>` 꼴이고 보존식이 성립한다."""
    report = CollectionGate().apply(records)

    for p in report.passed:
        assert non_travel_reason(p.poi.name) is None, f"비여행 이름이 통과했다: {p.poi.name!r}"
    for key in _non_travel_keys(report):
        prefix, _, reason = key.partition(":")
        assert prefix == DROP_POLICY_NON_TRAVEL and reason in _REASON_SET
    assert _conserved(report, len(records))


@settings(max_examples=40, deadline=None)
@given(records=_polluted_batches())
def test_pbt_게이트_판정은_결정론적이다(records: list[SourcingCandidate]) -> None:
    """같은 입력 두 번 → 같은 (통과 ID, 병합 수, 드롭 계수)."""

    def run() -> tuple:
        r = CollectionGate().apply(records)
        return (tuple(str(p.poi.poi_id) for p in r.passed), r.merged,
                tuple(sorted(r.drops.items())))

    assert run() == run()


# ── 7. 드롭 키 계약 (산출 JSON 에 그대로 실린다) ─────────────────────────
def test_드롭_키는_policy_non_travel_접두에_표의_사유가_붙는다() -> None:
    """`collect_pois.py` 가 stats.gate_drops 를 키 그대로 찍는다 — 접두는 문자열 계약,
    접미 집합은 표에서 유도한다."""
    assert DROP_POLICY_NON_TRAVEL == "policy_non_travel"
    one_per_reason = ("GS25 연동바다점", "이마트 서귀포점", "KT 동원텔레콤한림점",
                      "산삼배양근대리점", "노형 e편한세상 아파트")
    seen: set[str] = set()
    for i, name in enumerate(one_per_reason):
        seen |= set(CollectionGate().apply([_cand(str(i), name=name)]).drops)
    assert seen == {f"{DROP_POLICY_NON_TRAVEL}:{r}" for r in _REASONS}


# ── 리뷰 후 조인 규칙 회귀 고정 ─────────────────────────────────────────
# 리뷰가 잠재 오탐 벡터 하나(`KT 위즈파크`)와 라벨 드리프트 하나(`이마트24강릉여고점`)
# 를 짚었다. 둘 다 고쳤고 여기 못박는다.


@pytest.mark.parametrize(
    "name,expected",
    [
        # KT 는 경기장·공연장 스폰서다 — 접두만으로 통신이라 하면 야구장이 사라진다
        ("KT 위즈파크", None),
        ("수원KT위즈파크", None),
        ("KT&G 상상마당", None),
        # 대신 '텔레콤' 문자열이 근거다
        ("KT 동원텔레콤한림점", "telecom"),
        ("T world 제주지점", "telecom"),
        ("Sk텔레콤 제주As센터", "telecom"),
        # 체인명이 유일하면 뒤에 공백이 없어도 편의점이다 — 안 그러면 대형마트
        # 규칙으로 흘러 드롭은 되지만 통계 사유가 틀린다
        ("이마트24강릉여고점", "convenience_store"),
        ("이마트24 강릉여고점", "convenience_store"),
        ("GS25연동바다점", "convenience_store"),
        # `CU` 만은 공백을 요구한다 — 로마자 상호와 겹친다
        ("CUBE 카페", None),
        ("CU 제주서광로점", "convenience_store"),
    ],
)
def test_리뷰_후_조인_규칙_회귀(name: str, expected: str | None) -> None:
    assert non_travel_reason(name) == expected
