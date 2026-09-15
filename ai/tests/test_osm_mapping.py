"""SRC-P1 확장 — OSM 채택 목록 + 야경 이름 규칙 + shop 채택 목록 (TRIP-685).

세 번째 출처(OSM)를 후보 풀에 붓기 전에 거르는 **순수 함수 두 개**를 고정한다
(`sourcing/osm.py`). Overpass·네트워크 호출 0 — 태그 dict 만 넣고 돌린다.

증명하는 것은 다섯 방향이다.

- **채택 목록이지 배제 목록이 아니다.** `_TAG_MAP` 에도 없고 `shop` 값도
  `_SHOP_TRAVEL` 밖이면 **무엇이 와도** None 이다 — 실측 비채택 태그(amenity·
  highway·building·`man_made=observatory`), 근접 오타·대소문자·복수형, **라이프
  사이클 접두**(`disused:`·`was:`·`abandoned:`), 임의 유니코드 키/값, 빈 dict 전부.
- **Overture 가 이기는 축은 일부러 안 받는다.** `amenity=restaurant`·
  `amenity=cafe`·`tourism=attraction`·`tourism=museum` 은 실측에서 Overture 가
  더 많이 준다(82,123 vs 130,760 등). 겹치는 축까지 OSM 으로 받으면 얻는 것
  없이 **ODbL share-alike 노출만 커진다** — 이건 설계 결정이므로 회귀로 못박는다.
- **`tourism=viewpoint` 는 태그만으로 야경이 아니다.** 제주 실호출 42건에서 진짜
  전망대는 **15건(36%)** 뿐이었고 나머지는 동굴·갤러리·기념비·촬영지였다
  (`구린굴`·`김영갑갤러리`·`우도해녀항일기념비`). OSM 의 viewpoint 는 "전망이
  좋은 지점" 전반이라 **우리 NIGHT_VIEW(야경)와 개념이 다르다** — 그래서
  Overture 와 **같은 2단 구조**(배제 `_NIGHT_NO` + 허용 `_NIGHT_OK`)를 쓴다.
  야경 탈락은 **다음 태그로 넘어가고**(공동 태깅된 봉우리·해변은 NATURE 로 산다)
  `shop` 으로는 **흘리지 않는다**(약한 신호 쪽은 fail-closed).
- **shop 도 채택 목록이다.** 배제 목록으로는 끝이 없었다 — 편의점·차량·미용을
  빼도 다이소·안경점·휴대폰·문구·철물이 남고 새 값이 생기면 조용히 새어든다
  (`vacant`·`no` 가 실제로 새어들었다). 사용자 결정: "관광 관련이 아니라면 없애는
  게 맞아." `_SHOP_TRAVEL` 정확 일치만 SHOPPING, 나머지는 **미채택**으로 None.
- **라이선스 고지는 조용히 사라지면 위반이다.** ODbL §4.3 은 출처 표시가 의무다.

입력은 무작위 유니코드가 아니라 **실측 OSM 태그·이름의 조립**이다
(tests/generators/poi_curation §6) — 반례가 Overpass 한 줄이어야 재현·수정이
된다. 천문 배제 표본은 §5(Overture)를 그대로 재사용한다: `_NIGHT_NO` 가 두
모듈에서 같은 정규식이므로 같은 표본으로 걸어야 둘이 어긋나는 순간이 보인다.
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from trippilot.domain.poi import PoiCategory
from trippilot.poi_curation.sourcing.osm import (
    _NIGHT_NO,
    _NIGHT_OK,
    _SHOP_KEY,
    _SHOP_TRAVEL,
    _TAG_MAP,
    ATTRIBUTION,
    LICENSE,
    SOURCE_NAME,
    has_korean_name,
    map_tags,
)
from trippilot.poi_curation.sourcing.overture import map_category as overture_map

from tests.generators.poi_curation import (
    astronomy_names,
    korean_place_names,
    mixed_script_names,
    non_korean_names,
    osm_noise_tags,
    osm_non_travel_shop_values,
    osm_non_viewpoint_names,
    osm_shop_near_miss_keys,
    osm_shop_near_miss_values,
    osm_travel_shop_values,
    osm_unadopted_pairs,
    osm_unadopted_tags,
    osm_viewpoint_names,
    overture_owned_tags,
    plain_place_names,
)

# 표에서 **유도한다** — 야경 쌍을 손으로 적으면 네 번째가 추가될 때 무방비다.
_NIGHT_PAIRS = tuple(kv for kv, c in _TAG_MAP.items() if c is PoiCategory.NIGHT_VIEW)
_OTHER_PAIRS = tuple(kv for kv, c in _TAG_MAP.items() if c is not PoiCategory.NIGHT_VIEW)
_ALL_PAIRS = tuple(_TAG_MAP)
# 경계 8종 (STAY 는 내부 전용 — 수집이 만들어내면 안 된다)
_BOUNDARY = tuple(c for c in PoiCategory if c is not PoiCategory.STAY)
# shop 채택 목록도 표에서 유도해 샘플링한다 — 값이 추가되면 자동으로 덮인다.
_TRAVEL_SHOPS = tuple(sorted(_SHOP_TRAVEL))

# 이름 자리에 올 수 있는 것 전부. `map_tags` 의 이름은 태그 dict 안의 `name`
# 값이므로 `str` 만 온다(이름 없음은 **키 부재**로 표현한다).
_ANY_NAME = st.one_of(
    osm_viewpoint_names(), osm_non_viewpoint_names(), astronomy_names(),
    korean_place_names(), non_korean_names().filter(lambda n: n is not None),
    st.text(max_size=20),
)
# 야경 이름 규칙에 **떨어지는** 이름 — 천문(배제) 또는 전망 어휘 없음(허용 불충족).
_NIGHT_REJECTED_NAME = st.one_of(astronomy_names(), osm_non_viewpoint_names())
# `_SHOP_TRAVEL` 밖의 shop 값 전 분포 — 실측 비여행 · 근접 변형 · 임의 텍스트.
_NON_TRAVEL_SHOP = st.one_of(osm_non_travel_shop_values(),
                             osm_shop_near_miss_values(), st.text(max_size=12))


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def _tags(pair: tuple[str, str], **extra: str) -> dict[str, str]:
    """채택 쌍 1건 + 부가 태그로 조립한 Overpass 태그 dict."""
    k, v = pair
    return {k: v, **extra}


# ── 0. 전제 고정 — 이 파일의 주장이 공허해지지 않도록 ──────────────────
def test_표_전제_야경쌍과_비야경쌍이_모두_존재한다() -> None:
    """유도한 쌍 집합이 비면 아래 속성들이 전부 무동작(vacuous)이 된다."""
    assert _NIGHT_PAIRS, "NIGHT_VIEW 로 가는 태그가 없다 — 야경 축이 다시 0건이다"
    assert _OTHER_PAIRS, "비-야경 태그가 없다 — 대조군이 사라졌다"
    assert set(_NIGHT_PAIRS) | set(_OTHER_PAIRS) == set(_ALL_PAIRS)
    assert _SHOP_TRAVEL, "shop 채택 목록이 비었다 — 쇼핑 축이 0건이다"


def test_표_값은_전부_경계_8종이다() -> None:
    """내부 전용 STAY 가 섞이면 `/internal/pois` 경계 밖 값이 후보로 나간다."""
    assert set(_TAG_MAP.values()) <= set(_BOUNDARY)


def test_shop_키는_문자_그대로_shop_이다() -> None:
    """Overpass 필터 `["shop"]` 와 같은 키여야 한다 — 어긋나면 5.9만 건이 전부 드롭."""
    assert _SHOP_KEY == "shop"


@settings(max_examples=60, deadline=None)
@given(pair=st.sampled_from(_ALL_PAIRS))
def test_pbt_표_키와_값은_OSM_태그_식별자다(pair: tuple[str, str]) -> None:
    """`collect_osm._TAG_FILTERS` 가 `["키"="값"]` 로 **손으로 옮겨 적은** 것이다.
    따옴표·공백이 섞인 키/값은 Overpass QL 을 깨뜨리거나 조용히 0건을 만든다.
    """
    for token in pair:
        assert re.fullmatch(r"[a-z0-9_]+", token), f"태그로 못 쓰는 토큰: {token!r}"


@settings(max_examples=60, deadline=None)
@given(value=st.sampled_from(_TRAVEL_SHOPS))
def test_pbt_shop_채택목록은_OSM_값_식별자다(value: str) -> None:
    """채택 목록은 Overpass 가 돌려주는 `shop` **값과 정확 비교**된다 —
    대문자·공백이 섞인 항목은 영원히 매칭되지 않는 죽은 줄이다."""
    assert re.fullmatch(r"[a-z0-9_]+", value), f"OSM 값이 아닌 항목: {value!r}"


def test_수집_스크립트의_필터가_채택_표와_정확히_대응한다() -> None:
    """`_TAG_MAP` 에 줄을 늘리고 `collect_osm._TAG_FILTERS` 를 안 고치면
    **그 축은 조용히 0건**이다 — 매핑은 되는데 애초에 받아오질 않는다.
    반대로 필터만 늘리면 받아온 뒤 전부 드롭돼 Overpass 호출만 낭비한다.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import collect_osm  # noqa: PLC0415 — scripts/ 는 패키지가 아니다

    parsed: set[tuple[str, str]] = set()
    shop_regex_values: frozenset[str] | None = None
    for filt in collect_osm._TAG_FILTERS.values():
        eq = re.fullmatch(r'\["([a-z0-9_]+)"="([a-z0-9_]+)"\]', filt)
        if eq:
            parsed.add((eq.group(1), eq.group(2)))
            continue
        # `shop` 은 채택 목록에서 유도한 `["shop"~"^(a|b|…)$"]` 형태다 — 전체
        # 5.9만을 받아와 버리지 않고 서버에서 거른다. 안의 값 집합이 표와 같아야 한다.
        rx = re.fullmatch(r'\["shop"~"\^\(([a-z0-9_|]+)\)\$"\]', filt)
        assert rx, f"해독 못 하는 Overpass 필터: {filt!r}"
        shop_regex_values = frozenset(rx.group(1).split("|"))

    assert parsed == set(_TAG_MAP), (
        "수집 필터와 채택 표가 어긋났다 — 한쪽만 고치면 축이 조용히 빈다"
    )
    assert shop_regex_values == _SHOP_TRAVEL, (
        "shop 필터 정규식이 채택 목록과 다르다 — 손으로 옮겨 적으면 갈라진다"
    )


@settings(max_examples=80, deadline=None)
@given(value=osm_non_travel_shop_values())
def test_pbt_생성기_전제_비여행_shop_값은_채택목록_밖이다(value: str) -> None:
    """**전제 고정** — 편의점·차량·미용·다이소·안경·휴대폰·`vacant`·`no` 가
    채택 목록에 하나라도 들어오면 '관광 관련이 아니라면 없앤다' 결정이 깨진 것이다.
    """
    assert value not in _SHOP_TRAVEL


@settings(max_examples=80, deadline=None)
@given(value=osm_shop_near_miss_values())
def test_pbt_생성기_전제_근접_변형_shop_값은_채택목록_밖이다(value: str) -> None:
    """생성기 유효성 — `Gift`·`gifts`·`gift_shop` 이 표에 들어오면 '정확 일치'
    주장이 거짓이 된다."""
    assert value not in _SHOP_TRAVEL


@settings(max_examples=120, deadline=None)
@given(pair=osm_unadopted_pairs())
def test_pbt_생성기_전제_비채택_쌍은_표_밖이다(pair: tuple[str, str]) -> None:
    """생성기 유효성 — 근접 오타·라이프사이클 접두가 표에 들어오면 주장이 무너진다."""
    assert pair not in _TAG_MAP


@settings(max_examples=80, deadline=None)
@given(name=osm_non_viewpoint_names())
def test_pbt_생성기_전제_비전망_이름에는_전망_어휘가_없다(name: str) -> None:
    """생성기 유효성 — 여기 전망 어휘가 섞이면 '드롭된다' 주장이 거짓이 된다."""
    assert not _NIGHT_OK.search(_nfc(name))


@settings(max_examples=80, deadline=None)
@given(name=osm_viewpoint_names())
def test_pbt_생성기_전제_전망_이름은_천문_어휘가_없다(name: str) -> None:
    """생성기 유효성 — 배제 어휘가 섞이면 '통과한다' 주장이 거짓이 된다."""
    assert _NIGHT_OK.search(_nfc(name)) and not _NIGHT_NO.search(_nfc(name))


def test_출처_이름은_OVERTURE_와_같은_표기_규약이다() -> None:
    """수집 산출물의 `source` 는 대문자 벤더명 (TOURAPI·OVERTURE 와 같은 줄)."""
    assert SOURCE_NAME == "OSM"


# ── 1. 채택 목록이지 배제 목록이 아니다 ────────────────────────────────
@settings(max_examples=400, deadline=None)
@given(tags=osm_unadopted_tags())
def test_pbt_채택_목록_밖_태그는_항상_None(tags: dict[str, str]) -> None:
    """**핵심** — 표에 없고 `shop` 값도 채택 밖이면 드롭이다.

    실측 비채택 태그 · 근접 오타 · 라이프사이클 접두 · `shop` 닮은 키 · 채택 밖
    `shop` 값 · 임의 유니코드 키/값 · 빈 dict 를 한 전략으로 쓸어 넣는다. 여기가
    뚫리면 OSM 한국 전체(수백만 객체)에서 버스정류장·전봇대·편의점이 후보 풀로
    들어온다.
    """
    assume(not any(tags.get(k) == v for k, v in _TAG_MAP))
    assume(tags.get(_SHOP_KEY) not in _SHOP_TRAVEL)
    assert map_tags(tags) is None


def test_빈_태그는_None() -> None:
    """태그 없는 Overpass 요소 — 근거가 0 이면 채택도 0 이다."""
    assert map_tags({}) is None


@settings(max_examples=200, deadline=None)
@given(pair=osm_unadopted_pairs(), name=korean_place_names())
def test_pbt_비채택_태그는_한글_이름이어도_드롭된다(
    pair: tuple[str, str], name: str
) -> None:
    """한글 이름은 통과 근거가 아니다 — 버스정류장도 이름은 한글이다."""
    assume(pair not in _TAG_MAP)
    assert map_tags(_tags(pair, name=name)) is None


@pytest.mark.parametrize(
    "tags",
    [
        {"tourism": "Viewpoint"}, {"tourism": "viewpoints"},
        {"tourism": "view_point"}, {"tourism": "viewpoint "},
        {"Tourism": "viewpoint"}, {"natural": "Peak"}, {"natural": "peaks"},
        {"natural": "beach_resort"}, {"natural": "beaches"},
        {"disused:tourism": "viewpoint"}, {"was:tourism": "viewpoint"},
        {"abandoned:natural": "peak"}, {"proposed:natural": "beach"},
    ],
)
def test_근접_오타와_라이프사이클_접두는_새지_않는다(tags: dict[str, str]) -> None:
    """조회는 **정확 일치**다. 대소문자·공백·복수형을 관대하게 받으면 채택 목록이
    채택 목록이 아니다. 특히 `disused:`·`was:` 는 **지금 거기 없는 것**이라
    받아들이면 유령 POI 를 스스로 만들어 넣는 셈이다.
    """
    assert map_tags({**tags, "name": "솔오름 전망대"}) is None


@settings(max_examples=200, deadline=None)
@given(key=osm_shop_near_miss_keys(), value=osm_travel_shop_values())
def test_pbt_shop_을_닮은_키는_채택이_아니다(key: str, value: str) -> None:
    """`Shop`·`SHOP`·`shop:type`·`disused:shop` 은 `shop` 이 아니다.

    값이 채택 목록 안(`gift`)이어도 그렇다 — `disused:shop=gift` 는 닫힌
    기념품점이지 쇼핑 명소가 아니다.
    """
    assume(key != _SHOP_KEY)
    assert map_tags({key: value, "name": "제주올레시장"}) is None


# ── 2. Overture 가 이기는 축은 일부러 안 받는다 (회귀 고정) ────────────
@settings(max_examples=150, deadline=None)
@given(tags=overture_owned_tags(), name=korean_place_names())
def test_pbt_Overture_우세축은_받지_않는다(
    tags: dict[str, str], name: str
) -> None:
    """**설계 결정의 회귀 고정** — 실수로 표에 추가되면 여기서 깨진다.

    실측(2026-09-16, 한국 bbox): restaurant 82,123 vs Overture 130,760 ·
    cafe 13,126 vs 45,309 · attraction 2,488 vs 15,879 · museum 2,021 vs 4,060.
    겹치는 축은 OSM 에서 더 적게 주면서 **ODbL share-alike 노출만** 늘린다.
    """
    assert map_tags({**tags, "name": name}) is None


@pytest.mark.parametrize(
    "tags",
    [{"amenity": "restaurant"}, {"amenity": "cafe"},
     {"tourism": "attraction"}, {"tourism": "museum"}],
)
def test_Overture_우세축_네_줄_고정(tags: dict[str, str]) -> None:
    """이 네 줄이 `_TAG_MAP` 에 들어오는 순간 실패한다 — 라이선스 판단이 바뀐
    것이라면 이 테스트와 osm.py 모듈 주석의 비교표를 같이 고쳐야 한다."""
    (k, v), = tags.items()
    assert (k, v) not in _TAG_MAP
    assert map_tags(tags) is None


# ── 3. 야경 — `viewpoint` 태그만으로는 부족하다 (배제 + 허용 2단) ──────
@settings(max_examples=250, deadline=None)
@given(pair=st.sampled_from(_NIGHT_PAIRS), name=astronomy_names())
def test_pbt_천문_이름은_야경_태그로_와도_None(
    pair: tuple[str, str], name: str
) -> None:
    """**배제 방향** — `tourism=viewpoint` 에 천문대가 섞인다. 별을 보는 곳은
    야경 명소가 아니다. 야경 쌍을 표에서 유도하므로 쌍이 늘어나도 자동으로 덮인다.
    """
    assert map_tags(_tags(pair, name=name)) is None


@pytest.mark.parametrize(
    "name",
    ["용인어린이천문대", "대전시민천문대", "별아띠천문대", "사량도천문대",
     "조경철천문대", "국립과천과학관 천체투영관"],
)
def test_실측_천문시설_회귀_고정(name: str) -> None:
    """Overture 표본에서 야경으로 샜던 실측 6건. OSM `viewpoint` 에도 같은
    시설들이 들어오므로 같은 표본으로 다시 건다."""
    for pair in _NIGHT_PAIRS:
        assert map_tags(_tags(pair, name=name)) is None, f"{pair}×{name} 가 샜다"


@settings(max_examples=300, deadline=None)
@given(pair=st.sampled_from(_NIGHT_PAIRS), name=osm_non_viewpoint_names())
def test_pbt_전망_어휘가_없으면_viewpoint_도_None(
    pair: tuple[str, str], name: str
) -> None:
    """**핵심** — 제주 실호출 42건 중 진짜 전망대는 15건(36%)뿐이었다.

    OSM 의 `tourism=viewpoint` 는 "전망이 좋은 지점" 전반이라 동굴·갤러리·
    기념비·촬영지가 함께 들어온다. 태그를 근거로 통과시키면 **야경 보러 갔다가
    동굴을 만난다** — 그래서 이름이 근거를 대야 채택한다(Overture 와 같은 구조).
    """
    assert map_tags(_tags(pair, name=name)) is None


@pytest.mark.parametrize(
    "name",
    ["구린굴", "중동굴", "검멀레동굴", "김영갑갤러리",
     "우도해녀항일기념비", "산신각", "용두암", "쇠소깍",
     "유채꽃촬영지", "인어공주 촬영장소"],
)
def test_실측_제주_비전망_회귀_고정(name: str) -> None:
    """제주 실호출(2026-09-16) `tourism=viewpoint` 42건 중 야경이 **아닌** 것들.

    이 줄들이 통과하기 시작하면 야경 축이 동굴·기념비로 희석된다 — 실측 재판정은
    42건 → 통과 13건이었고 전부 진짜 전망대였다.
    """
    assert map_tags({"tourism": "viewpoint", "name": name}) is None


@settings(max_examples=300, deadline=None)
@given(pair=st.sampled_from(_NIGHT_PAIRS), name=osm_viewpoint_names())
def test_pbt_진짜_전망대는_통과한다(
    pair: tuple[str, str], name: str
) -> None:
    """**허용 방향** — 배제가 과하면 야경 축이 다시 0건이 된다.

    OSM 쪽 허용 어휘에는 `일출`·`일몰`·`낙조`·로마자 `viewpoint`/`lookout` 이
    들어간다: `viewpoint` 태그가 야경뿐 아니라 해돋이·낙조 명소도 담기 때문이다.
    """
    assert map_tags(_tags(pair, name=name)) is PoiCategory.NIGHT_VIEW


@pytest.mark.parametrize(
    "name",
    ["성산일출봉 정상전망대", "거린사슴전망대", "산지천 전망대", "사라오름전망대"],
)
def test_실측_제주_전망대_회귀_고정(name: str) -> None:
    """같은 42건의 **통과분** — 이 줄들이 드롭되기 시작하면 축이 야윈다."""
    assert map_tags({"tourism": "viewpoint", "name": name}) is PoiCategory.NIGHT_VIEW


def test_이름_없는_viewpoint_는_채택되지_않는다() -> None:
    """`name` 키 부재 = 이름 근거 0 → 드롭. fail-closed 가 기본값이다
    (수집 스크립트는 한글 이름 없는 요소를 앞단에서 이미 뺀다)."""
    assert map_tags({"tourism": "viewpoint"}) is None
    assert map_tags({"tourism": "viewpoint", "name": ""}) is None


@settings(max_examples=250, deadline=None)
@given(pair=st.sampled_from(_NIGHT_PAIRS), name=st.text(max_size=24))
def test_pbt_모르는_이름은_야경이_아니다(
    pair: tuple[str, str], name: str
) -> None:
    """임의 문자열은 근거가 아니다 — 허용 어휘에 걸리지 않으면 드롭이다.

    '모르는 것은 넣지 않는다'가 이름 축에도 적용된다는 뜻이다.
    """
    assume(not _NIGHT_OK.search(_nfc(name)))
    assert map_tags(_tags(pair, name=name)) is None


@settings(max_examples=250, deadline=None)
@given(pair=st.sampled_from(_NIGHT_PAIRS),
       astro=astronomy_names(), look=osm_viewpoint_names(),
       astro_first=st.booleans())
def test_pbt_배제가_허용을_이긴다(
    pair: tuple[str, str], astro: str, look: str, astro_first: bool
) -> None:
    """`보현산천문대 전망대` 처럼 둘 다 걸리는 이름 — 보수적으로 드롭한다.

    순서를 뒤집어도 같다(정규식 평가 순서가 판정을 바꾸면 안 된다). 야경을 한 건
    놓치는 쪽이, 별 보는 곳을 야경이라고 안내하는 쪽보다 싸다. Overture 쪽
    같은 이름 속성과 **동형**이다 — 두 출처가 어긋나면 한쪽에서 먼저 걸린다.
    """
    name = f"{astro} {look}" if astro_first else f"{look} {astro}"
    assert map_tags(_tags(pair, name=name)) is None


@settings(max_examples=250, deadline=None)
@given(name=_NIGHT_REJECTED_NAME)
def test_pbt_천문_배제는_두_출처가_같은_방향이다(name: str) -> None:
    """`_NIGHT_NO` 는 두 모듈이 같은 정규식이고, 허용 규칙도 이제 둘 다 있다.

    천문 시설·근거 없는 이름은 OSM `tourism=viewpoint` 로 오든 Overture
    `observatory` 로 오든 야경이 아니다. 한쪽만 느슨해지면 여기서 걸린다.
    (허용 **어휘**는 일부러 다르다 — OSM 은 일출·낙조를, Overture 는 야시장을
    담는다. 축이 다르므로 통과 집합까지 같을 이유는 없다.)
    """
    assert map_tags({"tourism": "viewpoint", "name": name}) is None
    assert overture_map("observatory", name) is None


@settings(max_examples=250, deadline=None)
@given(pair=st.sampled_from(_OTHER_PAIRS), name=_ANY_NAME)
def test_pbt_비야경_태그는_이름을_보지_않는다(
    pair: tuple[str, str], name: str
) -> None:
    """**핵심 대조** — 이름 규칙은 NIGHT_VIEW 전용이다.

    `조경철천문대`가 있는 광덕산도 `natural=peak` 이면 NATURE 고, `구린굴` 도
    `natural=beach` 면 NATURE 다. 이름 규칙이 야경 밖으로 번지면 산·해변이
    이름 때문에 통째로 사라진다 — 실패하지 않으니 조용한 사고다.
    """
    assert map_tags(_tags(pair, name=name)) is _TAG_MAP[pair]


@settings(max_examples=200, deadline=None)
@given(pair=st.sampled_from(_OTHER_PAIRS), a=_ANY_NAME, b=astronomy_names())
def test_pbt_비야경_태그는_이름이_달라도_결과가_같다(
    pair: tuple[str, str], a: str, b: str
) -> None:
    """같은 태그·다른 이름 두 건 대조 — 이름이 결과를 흔들면 실패."""
    assert map_tags(_tags(pair, name=a)) == map_tags(_tags(pair, name=b))


@settings(max_examples=250, deadline=None)
@given(night=st.sampled_from(_NIGHT_PAIRS), other=st.sampled_from(_OTHER_PAIRS),
       name=_NIGHT_REJECTED_NAME, night_first=st.booleans())
def test_pbt_야경_탈락은_다음_태그로_넘어간다(
    night: tuple[str, str], other: tuple[str, str], name: str, night_first: bool
) -> None:
    """**공동 태깅된 봉우리·해변은 산다** — 야경 이름 규칙 탈락이 드롭이 아니다.

    `tourism=viewpoint` 를 함께 단 `natural=peak` 가 이름에 전망 어휘가 없다고
    통째로 사라지면, Overture 대비 7.6배라는 OSM 채택 근거(NATURE 축)가 조용히
    깎인다 — `collect_osm` 의 seen 은 채택분만 담아 peak 쿼리에서 다시 와도 또
    드롭된다. 입력 dict 의 키 순서를 뒤집어도 같아야 한다(Overpass 는 순서를
    보장하지 않는다).
    """
    a, b = (night, other) if night_first else (other, night)
    tags = {a[0]: a[1], b[0]: b[1], "name": name}
    assert map_tags(tags) is _TAG_MAP[other]


def test_공동_태깅_회귀_고정() -> None:
    """실측 두 줄 — 천문대가 있는 봉우리, 전망 어휘 없는 해변."""
    assert map_tags({"tourism": "viewpoint", "natural": "peak",
                     "name": "조경철천문대"}) is PoiCategory.NATURE
    assert map_tags({"tourism": "viewpoint", "natural": "beach",
                     "name": "협재해수욕장"}) is PoiCategory.NATURE


@settings(max_examples=250, deadline=None)
@given(pair=st.sampled_from(_ALL_PAIRS), noise=osm_noise_tags(),
       name=osm_viewpoint_names())
def test_pbt_이름_규칙은_name_키만_읽는다(
    pair: tuple[str, str], noise: dict[str, str], name: str
) -> None:
    """부가 태그는 판정을 바꾸지 않는다 — 특히 `description`·`note`·`old_name`·
    `name:en` 에 천문 어휘가 있어도 그렇다(생성기 §6 이 일부러 심어 뒀다).

    OSM 은 한 요소에 수십 개 태그가 붙는다. 이름 규칙이 `name` 밖을 읽기 시작하면
    `천문대 바로 옆` 이라고 적힌 진짜 전망대가 조용히 사라진다.
    """
    assert map_tags({**noise, **_tags(pair, name=name)}) is _TAG_MAP[pair]


# ── 4. shop — 채택 목록 정확 일치만 SHOPPING, 나머지는 미채택 ──────────
@settings(max_examples=250, deadline=None)
@given(value=osm_travel_shop_values(), name=korean_place_names())
def test_pbt_채택_목록_shop_값은_SHOPPING(value: str, name: str) -> None:
    """여행자가 **일부러 찾아가는** 가게만 — 기념품·공예·찻집·백화점·면세점.

    우리가 640건뿐이던 축이다. 목록을 표에서 유도하므로 값이 추가돼도 자동으로
    덮인다. 이름은 보지 않는다(한글 이름 전 분포를 통과시킨다).
    """
    assert map_tags({_SHOP_KEY: value, "name": name}) is PoiCategory.SHOPPING


@settings(max_examples=250, deadline=None)
@given(value=osm_non_travel_shop_values(), name=korean_place_names())
def test_pbt_비여행_shop_값은_미채택으로_None(value: str, name: str) -> None:
    """편의점·차량·미용·다이소·안경·휴대폰·문구·철물 — 그리고 `vacant`(공실)·
    `no`(가게 아님)·`yes`(정보 없음).

    배제 목록 시절엔 이것들을 **쫓아가며** 빼야 했고, `vacant`·`no` 는 실제로
    새어들었다(유령 POI). 이제는 배제가 아니라 **미채택**이다 — 목록에 없으니
    None 이고, 새 값이 생겨도 사람이 손대기 전까지 조용히 새어들 길이 없다.
    """
    assert map_tags({_SHOP_KEY: value, "name": name}) is None


@pytest.mark.parametrize(
    "value",
    ["vacant", "no", "yes", "convenience", "supermarket", "car",
     "hairdresser", "pharmacy", "variety_store", "mobile_phone", "optician"],
)
def test_실측_비여행_shop_회귀_고정(value: str) -> None:
    """채택 목록으로 뒤집게 만든 실측 값들. `vacant`·`no` 는 배제 목록 시절
    SHOPPING 으로 새던 유령 값 — 여기가 다시 SHOPPING 이 되면 뒤집은 이유가 없다."""
    assert value not in _SHOP_TRAVEL
    assert map_tags({_SHOP_KEY: value, "name": "제주올레시장"}) is None


@settings(max_examples=250, deadline=None)
@given(value=st.text(max_size=12), name=korean_place_names())
def test_pbt_모르는_shop_값은_None(value: str, name: str) -> None:
    """**방향이 뒤집힌 속성** — 이전엔 '목록 밖 임의 값은 SHOPPING' 이었다.

    OSM `shop` 값은 계속 늘어난다. 모르는 값을 받으면 새 값이 생길 때마다 조용히
    새어든다 — '모르는 것은 넣지 않는다' 가 `shop` 축에도 똑같이 적용된다.
    """
    assume(value not in _SHOP_TRAVEL)
    assert map_tags({_SHOP_KEY: value, "name": name}) is None


@settings(max_examples=200, deadline=None)
@given(value=osm_shop_near_miss_values(), name=korean_place_names())
def test_pbt_근접_변형_shop_값은_None(value: str, name: str) -> None:
    """`Gift`·`GIFT`·`gifts`·`gift `·`gift_shop` 은 `gift` 가 아니다 —
    조회는 **정확 일치**다. 대소문자·공백·복수형·합성어를 관대하게 받으면
    채택 목록이 채택 목록이 아니다."""
    assert map_tags({_SHOP_KEY: value, "name": name}) is None


@pytest.mark.parametrize(
    "value", ["Gift", "GIFT", "gifts", "gift ", " gift", "gift_shop",
              "souvenirs", "Mall", "duty_free_shop", "department_stores"],
)
def test_근접_변형_shop_회귀_고정(value: str) -> None:
    """정확 일치를 한 줄씩 못박는다."""
    assert map_tags({_SHOP_KEY: value, "name": "제주올레시장"}) is None


def test_빈_shop_값은_근거가_아니다() -> None:
    """`shop=""` 는 '가게다' 라는 정보가 아니다 — 키만 있고 값이 비면 드롭."""
    assert map_tags({_SHOP_KEY: "", "name": "제주올레시장"}) is None


@settings(max_examples=150, deadline=None)
@given(value=osm_travel_shop_values(), name=_NIGHT_REJECTED_NAME)
def test_pbt_shop_은_이름_규칙을_보지_않는다(value: str, name: str) -> None:
    """이름 규칙은 야경 전용이다 — 쇼핑은 전망 어휘가 없어도, 천문 어휘가 있어도
    채택된다(`천문대 기념품점` 은 기념품점이다)."""
    assert map_tags({_SHOP_KEY: value, "name": name}) is PoiCategory.SHOPPING


# ── 5. 태그 우선순위 — `_TAG_MAP` 이 `shop` 보다 먼저다 ────────────────
@settings(max_examples=250, deadline=None)
@given(pair=st.sampled_from(_ALL_PAIRS), shop=osm_travel_shop_values(),
       name=osm_viewpoint_names())
def test_pbt_표_항목이_shop_보다_이긴다(
    pair: tuple[str, str], shop: str, name: str
) -> None:
    """`natural=beach` + `shop=gift` 는 해변이다 — 해변 매점이 기념품점으로
    둔갑하면 자연 축이 쇼핑으로 새어 나간다."""
    assert map_tags(_tags(pair, shop=shop, name=name)) is _TAG_MAP[pair]


@settings(max_examples=200, deadline=None)
@given(pair=st.sampled_from(_ALL_PAIRS), shop=_NON_TRAVEL_SHOP,
       name=osm_viewpoint_names())
def test_pbt_비여행_shop_이_붙어도_표_항목이_이긴다(
    pair: tuple[str, str], shop: str, name: str
) -> None:
    """반대 방향 — `natural=peak` + `shop=convenience`(정상 매점)는 여전히 NATURE.
    미채택 shop 값이 태그 채택을 **취소하지는 않는다**."""
    assert map_tags(_tags(pair, shop=shop, name=name)) is _TAG_MAP[pair]


def test_해변_기념품점은_NATURE_다() -> None:
    """회귀 고정 — 우선순위를 한 줄로 못박는다."""
    assert map_tags({"natural": "beach", "shop": "gift"}) is PoiCategory.NATURE
    assert map_tags({"natural": "peak", "shop": "mall"}) is PoiCategory.NATURE


@settings(max_examples=250, deadline=None)
@given(pair=st.sampled_from(_NIGHT_PAIRS), shop=osm_travel_shop_values(),
       name=_NIGHT_REJECTED_NAME)
def test_pbt_야경_이름_탈락은_shop_으로_떨어지지_않는다(
    pair: tuple[str, str], shop: str, name: str
) -> None:
    """천문대 기념품점·동굴 매점 — 야경 이름 규칙이 드롭하면 `shop` 으로는
    **안 흘린다**(`night_rejected`).

    `natural=peak` 같은 강한 단일 태그로는 넘어가지만(§3), `shop` 은 catch-all
    키라 `shop=gift` 하나로 쇼핑에 다시 들이면 배제해 놓고 뒷문으로 넣는 꼴이다 —
    이름이 가게가 아니라 동굴을 가리키는 것도 문제다(`구린굴` 이 쇼핑 후보가 된다).
    """
    assert map_tags(_tags(pair, shop=shop, name=name)) is None


# ── 6. NFC 정규화 — 자모 분해 표기가 규칙을 흔들지 못한다 ──────────────
@settings(max_examples=200, deadline=None)
@given(pair=st.sampled_from(_NIGHT_PAIRS), name=astronomy_names())
def test_pbt_NFD_천문_이름도_야경으로_새지_않는다(
    pair: tuple[str, str], name: str
) -> None:
    """**새는 방향** — OSM 은 기여자가 직접 입력하므로 정규화 형태가 섞인다.
    `천문` 은 완성형만 매칭하므로, 합치지 않으면 자모로 적힌 천문대가 배제 규칙을
    통째로 우회한다. 이름 규칙은 어느 형태에서도 fail-closed 여야 한다.
    """
    assert map_tags(_tags(pair, name=unicodedata.normalize("NFD", name))) is None


@settings(max_examples=200, deadline=None)
@given(pair=st.sampled_from(_NIGHT_PAIRS), name=osm_viewpoint_names())
def test_pbt_NFD_전망대_이름도_드롭되지_않는다(
    pair: tuple[str, str], name: str
) -> None:
    """**사라지는 방향** — 허용 규칙(`전망대`)도 완성형만 매칭한다.

    NFC 로 합치지 않으면 자모로 적힌 전망대가 '근거 없음'으로 읽혀 통째로
    드롭된다. 실패하지 않으니 조용하다 — 그래서 속성으로 건다.
    """
    nfd = unicodedata.normalize("NFD", name)
    assert map_tags(_tags(pair, name=nfd)) is PoiCategory.NIGHT_VIEW


@settings(max_examples=300, deadline=None)
@given(pair=st.sampled_from(_ALL_PAIRS),
       name=st.one_of(astronomy_names(), osm_viewpoint_names(),
                      osm_non_viewpoint_names(), plain_place_names()))
def test_pbt_정규화_형태가_결과를_바꾸지_않는다(
    pair: tuple[str, str], name: str
) -> None:
    """NFC 로 적힌 것과 NFD 로 적힌 것이 **같은 판정**을 받는다 — 위 두 방향을
    한 속성으로 묶은 것이고, 새 이름 어휘가 늘어도 자동으로 덮인다."""
    assert map_tags(_tags(pair, name=_nfc(name))) is map_tags(
        _tags(pair, name=unicodedata.normalize("NFD", name)))


@settings(max_examples=150, deadline=None)
@given(name=korean_place_names())
def test_pbt_NFD_한글_이름도_한글로_인정된다(name: str) -> None:
    """자모 분해로 적힌 이름을 '한글 없음' 으로 읽으면 수집 앞단에서 통째로
    드롭된다(collect_osm 의 `한글이름없음`). 새는 게 아니라 **사라지는** 사고다.
    """
    assert has_korean_name(unicodedata.normalize("NFD", name)) is True


# ── 7. 한글 판정 ──────────────────────────────────────────────────────
@settings(max_examples=150, deadline=None)
@given(name=korean_place_names())
def test_pbt_한글_음절이_있으면_True(name: str) -> None:
    """천문·전망·평범·로마자 병기 전 분포 — 음절이 하나라도 있으면 통과."""
    assert has_korean_name(name) is True


@settings(max_examples=150, deadline=None)
@given(name=non_korean_names())
def test_pbt_한글_음절이_없으면_False(name: str | None) -> None:
    """로마자·숫자·기호·빈 문자열·None, 타 문자권(가나·한자), 자모 단독(`ㅋㅋ`).
    판정 기준은 한글 '음절'(`[가-힣]`)이다 — 로마자 상호는 보여줄 수 없다."""
    assert has_korean_name(name) is False


@settings(max_examples=150, deadline=None)
@given(name=mixed_script_names())
def test_pbt_한글_로마자_병기는_True(name: str) -> None:
    """`사라오름 전망대 Sara Observatory` — OSM 실측에 흔한 형태다
    (강남 표본 1,956건 중 한글 보유 90%)."""
    assert has_korean_name(name) is True


@settings(max_examples=150, deadline=None)
@given(korean=korean_place_names(), head=st.text(max_size=8), tail=st.text(max_size=8))
def test_pbt_어떤_잡음에_싸여도_한글은_감지된다(
    korean: str, head: str, tail: str
) -> None:
    """포함 판정이지 '전부 한글' 판정이 아니다 — 앞뒤 잡음이 결과를 못 바꾼다."""
    assert has_korean_name(f"{head}{korean}{tail}") is True


# ── 8. 치역·결정론 ────────────────────────────────────────────────────
_ANY_TAGS = st.one_of(
    osm_unadopted_tags(),
    overture_owned_tags(),
    st.builds(lambda kv, n: {kv[0]: kv[1], "name": n},
              st.sampled_from(_ALL_PAIRS), _ANY_NAME),
    st.builds(lambda v, n: {_SHOP_KEY: v, "name": n},
              st.one_of(osm_travel_shop_values(), _NON_TRAVEL_SHOP),
              korean_place_names()),
    st.builds(lambda night, other, v, n: {night[0]: night[1], other[0]: other[1],
                                          _SHOP_KEY: v, "name": n},
              st.sampled_from(_NIGHT_PAIRS), st.sampled_from(_OTHER_PAIRS),
              osm_travel_shop_values(), _ANY_NAME),
)


@settings(max_examples=300, deadline=None)
@given(tags=_ANY_TAGS)
def test_pbt_결과는_None_이거나_경계_8종이다(tags: dict[str, str]) -> None:
    """치역 고정 — 문자열·임의 값이 새어 나가면 백엔드 등록 제안이 깨진다."""
    out = map_tags(tags)
    assert out is None or (isinstance(out, PoiCategory) and out in _BOUNDARY)


@settings(max_examples=300, deadline=None)
@given(tags=_ANY_TAGS)
def test_pbt_매핑은_결정론적이고_표를_바꾸지_않는다(tags: dict[str, str]) -> None:
    """같은 입력 두 번 → 같은 출력. 시각·난수·외부 조회(Overpass) 없음.

    호출이 채택 표·shop 채택 목록을 건드리지 않는 것도 같이 본다 — 표가 호출로
    자라면 '채택 목록' 이라는 성질 자체가 무너진다. 입력 dict 도 불변이어야 한다:
    수집 스크립트가 같은 dict 를 `tags`·`provenance` 로 다시 쓴다.
    """
    tag_before, shop_before = dict(_TAG_MAP), frozenset(_SHOP_TRAVEL)
    arg_before = dict(tags)
    assert map_tags(tags) is map_tags(tags)
    assert dict(_TAG_MAP) == tag_before
    assert frozenset(_SHOP_TRAVEL) == shop_before
    assert dict(tags) == arg_before


@settings(max_examples=200, deadline=None)
@given(name=st.one_of(korean_place_names(), non_korean_names()))
def test_pbt_한글_판정도_결정론적이다(name: str | None) -> None:
    """같은 이름 두 번 → 같은 판정."""
    assert has_korean_name(name) == has_korean_name(name)


# ── 9. 라이선스 고지 (ODbL §4.3) ──────────────────────────────────────
def test_라이선스_상수가_조용히_사라지지_않는다() -> None:
    """ODbL-1.0 은 **출처 표시가 의무**다(§4.3). 수집 산출물이 이 두 줄을 싣기
    때문에 받는 쪽이 의무를 모를 수 없다 — 상수가 비거나 바뀌면 그 고리가 끊긴다.

    앱 화면 고지(`© OpenStreetMap contributors`)는 프론트엔드 작업이고 이 패키지
    밖이다. 빠지면 라이선스 위반이므로 여기서 문구를 고정해 둔다.
    """
    assert LICENSE == "ODbL-1.0"
    assert "OpenStreetMap" in ATTRIBUTION
    assert ATTRIBUTION.strip() == ATTRIBUTION and ATTRIBUTION


def test_수집_스크립트가_라이선스_상수를_그대로_싣는다() -> None:
    """`collect_osm` 이 자기 문자열을 따로 적으면 두 곳이 어긋난다 — 상수를
    import 해서 쓰는지 확인한다(산출 JSON 의 `license`·`attribution`)."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import collect_osm  # noqa: PLC0415 — scripts/ 는 패키지가 아니다

    assert collect_osm.LICENSE is LICENSE
    assert collect_osm.ATTRIBUTION is ATTRIBUTION
    assert collect_osm.SOURCE_NAME is SOURCE_NAME
