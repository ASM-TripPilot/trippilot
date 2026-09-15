"""SRC-P1 확장 — Overture 채택 목록 + NIGHT_VIEW 이름 규칙 (TRIP-684).

Overture 한국 POI 691,968건을 후보 풀에 붓기 전에 거르는 **순수 함수 두 개**를
고정한다(`sourcing/overture.py`). 실 호출 0 — S3·DuckDB·네트워크 없이 돌아간다.

증명하는 것은 네 방향이다.

- **채택 목록이지 배제 목록이 아니다.** 목록 밖은 **무엇이든** None 이다 —
  실측 상위의 비여행 카테고리(편의점 9,298·미용실 9,972·치과 3,844·ATM 4,487),
  대소문자·공백·복수형 근접 오타, 임의 유니코드, 빈 문자열, None 전부. 새 카테고리가
  생겨도 조용히 새어들면 안 된다("모르는 것은 넣지 않는다").
- **천문대는 절대 야경이 아니다.** `observatory` 가 전망대와 천문대를 한 바구니에
  담고 있어 코드만으로는 못 가른다. 실측 표본의 천문 시설을 회귀로 고정한다.
- **이름 규칙은 NIGHT_VIEW 에만 적용된다.** 비-야경 카테고리는 이름을 **보지
  않는다** — 같은 카테고리에 어떤 이름이 와도 결과가 같다는 대조로 증명한다.
- **한글 음절이 있어야 이름이다.** 로마자 상호는 사용자에게 보여줄 수 없다.

입력은 무작위 유니코드가 아니라 실측 표기의 조립이다(tests/generators/poi_curation
§5) — 반례가 Overture 한 줄이어야 재현·수정이 된다. 카테고리 쪽만 임의 텍스트를
섞는다: 거기서는 "모르는 문자열은 전부 드롭" 이 주장 자체이기 때문이다.
"""

from __future__ import annotations

import re
import unicodedata

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from trippilot.domain.poi import PoiCategory
from trippilot.poi_curation.sourcing.overture import (
    _CATEGORY_MAP,
    SOURCE_NAME,
    has_korean_name,
    map_category,
)

from tests.generators.poi_curation import (
    astronomy_names,
    korean_place_names,
    lookout_names,
    mixed_script_names,
    non_korean_names,
    non_travel_categories,
    plain_place_names,
    road_addresses,
    unknown_overture_categories,
)

# 표에서 **유도한다** — 야경 키 3종을 손으로 적으면 네 번째가 추가될 때 무방비다.
_NIGHT_KEYS = tuple(k for k, v in _CATEGORY_MAP.items() if v is PoiCategory.NIGHT_VIEW)
_OTHER_KEYS = tuple(k for k, v in _CATEGORY_MAP.items() if v is not PoiCategory.NIGHT_VIEW)
_ALL_KEYS = tuple(_CATEGORY_MAP)
# 경계 8종 (STAY 는 내부 전용 — 수집이 만들어내면 안 된다)
_BOUNDARY = tuple(c for c in PoiCategory if c is not PoiCategory.STAY)

# 이름 자리에 올 수 있는 것 전부. None 은 뺀다 — `map_category` 의 이름 인자는
# `str` 이고, 호출자가 `(name or "").strip()` 으로 보장한다(아래 §6 주석).
_ANY_NAME = st.one_of(korean_place_names(),
                      non_korean_names().filter(lambda n: n is not None),
                      st.text(max_size=20))


# ── 0. 전제 고정 — 이 파일의 주장이 공허해지지 않도록 ──────────────────
def test_표_전제_야경키와_비야경키가_모두_존재한다() -> None:
    """유도한 키 집합이 비면 아래 속성들이 전부 무동작(vacuous)이 된다."""
    assert _NIGHT_KEYS, "NIGHT_VIEW 로 가는 카테고리가 없다 — 야경 축이 다시 0건이다"
    assert _OTHER_KEYS, "비-야경 카테고리가 없다 — 대조군이 사라졌다"
    assert set(_NIGHT_KEYS) | set(_OTHER_KEYS) == set(_ALL_KEYS)


def test_표_값은_전부_경계_8종이다() -> None:
    """내부 전용 STAY 가 섞이면 `/internal/pois` 경계 밖 값이 후보로 나간다."""
    assert set(_CATEGORY_MAP.values()) <= set(_BOUNDARY)


@settings(max_examples=50, deadline=None)
@given(cat=non_travel_categories())
def test_pbt_생성기_전제_비여행_어휘는_채택_목록_밖이다(cat: str) -> None:
    """생성기 유효성 — 이 어휘가 목록에 들어오면 '드롭된다' 주장이 거짓이 된다."""
    assert cat not in _CATEGORY_MAP


@settings(max_examples=60, deadline=None)
@given(key=st.sampled_from(_ALL_KEYS))
def test_pbt_표_키는_소문자_식별자다(key: str) -> None:
    """`collect_overture._rows` 가 키를 DuckDB SQL 문자열 목록에 **그대로 보간**한다
    (`'...','...'`). 따옴표·공백이 섞인 키가 들어오면 쿼리가 깨지거나 주입이 된다.
    """
    assert re.fullmatch(r"[a-z0-9_]+", key), f"SQL 리터럴로 못 쓰는 키: {key!r}"


def test_출처_이름은_TOURAPI_와_같은_표기_규약이다() -> None:
    """수집 산출물의 `source` 는 대문자 벤더명 (pipeline.SOURCE_NAME='TOURAPI')."""
    assert SOURCE_NAME == "OVERTURE"


# ── 1. 채택 목록이지 배제 목록이 아니다 ────────────────────────────────
@settings(max_examples=300, deadline=None)
@given(cat=unknown_overture_categories(), name=_ANY_NAME)
def test_pbt_채택_목록_밖_카테고리는_항상_None(cat: str | None, name: str) -> None:
    """**핵심** — 목록에 없으면 이름이 무엇이든 드롭이다.

    비여행 실측 · 근접 오타(대소문자·공백·복수형) · 임의 유니코드 · 빈 문자열 ·
    None 을 한 전략으로 쓸어 넣는다. 여기가 뚫리면 69만 건 중 편의점·치과·ATM 이
    후보 풀로 들어온다.
    """
    assume(cat not in _CATEGORY_MAP)
    assert map_category(cat, name) is None


@settings(max_examples=120, deadline=None)
@given(cat=non_travel_categories(), name=korean_place_names())
def test_pbt_실측_비여행_카테고리는_한글_이름이어도_드롭된다(
    cat: str, name: str
) -> None:
    """한글 이름은 통과 근거가 아니다 — 편의점도 상호는 한글이다."""
    assert map_category(cat, name) is None


@pytest.mark.parametrize(
    "near_miss",
    ["Korean_Restaurant", "KOREAN_RESTAURANT", " korean_restaurant",
     "korean_restaurant ", "korean_restaurants", "korean restaurant",
     "church", "Observatory", "night_markets", "Park", "cafe "],
)
def test_근접_오타_카테고리는_새지_않는다(near_miss: str) -> None:
    """조회는 **정확 일치**다. 대소문자·공백·복수형·상위어를 관대하게 받으면
    화이트리스트가 화이트리스트가 아니다 (`church` ⊅ `church_cathedral`)."""
    assert near_miss not in _CATEGORY_MAP
    assert map_category(near_miss, "솔오름 전망대") is None


@settings(max_examples=200, deadline=None)
@given(cat=st.one_of(st.sampled_from(_ALL_KEYS), unknown_overture_categories()),
       name=_ANY_NAME)
def test_pbt_결과는_None_이거나_경계_8종이다(cat: str | None, name: str) -> None:
    """치역 고정 — 문자열·임의 값이 새어 나가면 백엔드 등록 제안이 깨진다."""
    out = map_category(cat, name)
    assert out is None or (isinstance(out, PoiCategory) and out in _BOUNDARY)


# ── 2. 천문대는 절대 야경이 아니다 ─────────────────────────────────────
@settings(max_examples=200, deadline=None)
@given(cat=st.sampled_from(_NIGHT_KEYS), name=astronomy_names())
def test_pbt_천문_이름은_어떤_야경_카테고리로_와도_None(cat: str, name: str) -> None:
    """**핵심** — `observatory`·`lookout`·`night_market` 어느 쪽으로 들어와도 드롭.

    카테고리를 표에서 유도하므로 야경 키가 늘어나도 자동으로 덮인다.
    """
    assert map_category(cat, name) is None


@pytest.mark.parametrize(
    "name",
    ["용인어린이천문대", "대전시민천문대", "별아띠천문대",
     "서산류방택천문기상과학관", "만행산천문체험관", "사량도천문대"],
)
def test_실측_천문시설_회귀_고정(name: str) -> None:
    """실측 표본(2026-08-19.0)에서 `observatory` 로 들어온 천문 시설 6건.

    별을 보는 곳이지 야경을 보는 곳이 아니다 — 야경 41건에 섞이면 비율로 4할이다.
    """
    for cat in _NIGHT_KEYS:
        assert map_category(cat, name) is None, f"{cat}×{name} 가 야경으로 샜다"


@settings(max_examples=200, deadline=None)
@given(cat=st.sampled_from(_NIGHT_KEYS), name=lookout_names())
def test_pbt_진짜_전망대는_통과한다(cat: str, name: str) -> None:
    """배제가 과하면 야경 축이 다시 0건이 된다 — 반대 방향도 같이 건다."""
    assert map_category(cat, name) is PoiCategory.NIGHT_VIEW


@pytest.mark.parametrize(
    "name",
    ["솔오름 전망대", "거린사슴전망대", "국사봉전망대", "넓은드르 전망대",
     "북악산 하늘전망대", "오두산통일전망타워"],
)
def test_실측_전망대_회귀_고정(name: str) -> None:
    """실측 표본의 진짜 야경 6건 — `observatory` 로 들어와 NIGHT_VIEW 가 된다."""
    assert map_category("observatory", name) is PoiCategory.NIGHT_VIEW


@settings(max_examples=200, deadline=None)
@given(cat=st.sampled_from(_NIGHT_KEYS), name=plain_place_names())
def test_pbt_야경_이름_규칙을_못_넘는_이름은_None(cat: str, name: str) -> None:
    """카테고리만으로는 통과 못 한다 — `night_market`(44) 에 섞인 `전라도여행맛집`
    같은 오분류가 여기서 걸린다. 야경은 **이름이 근거를 대야** 들어온다."""
    assert map_category(cat, name) is None


@settings(max_examples=200, deadline=None)
@given(cat=st.sampled_from(_NIGHT_KEYS),
       astro=astronomy_names(), look=lookout_names(),
       astro_first=st.booleans())
def test_pbt_두_규칙이_동시에_걸리면_배제가_이긴다(
    cat: str, astro: str, look: str, astro_first: bool
) -> None:
    """`대전시민천문대 전망대` 처럼 둘 다 걸리는 이름 — 보수적으로 드롭한다.

    순서를 뒤집어도 같다(정규식 평가 순서가 판정을 바꾸면 안 된다). 야경을 한 건
    놓치는 쪽이, 별 보는 곳을 야경이라고 안내하는 쪽보다 싸다.
    """
    name = f"{astro} {look}" if astro_first else f"{look} {astro}"
    assert map_category(cat, name) is None


@settings(max_examples=120, deadline=None)
@given(cat=st.sampled_from(_NIGHT_KEYS), name=astronomy_names())
def test_pbt_유니코드_분해형_이름도_야경으로_새지_않는다(
    cat: str, name: str
) -> None:
    """NFD(자모 분해) 로 적힌 천문대 이름이 야경 규칙을 **우회하지 못한다**.

    Overture 는 여러 원출처(Meta·Microsoft·Foursquare·AllThePlaces)가 섞여 있어
    정규화 형태가 한 가지라고 가정할 수 없다. 이름 규칙은 어느 형태에서도
    fail-closed 여야 한다 — '모르는 표기는 야경이 아니다'.
    """
    assert map_category(cat, unicodedata.normalize("NFD", name)) is not PoiCategory.NIGHT_VIEW


# ── 3. 이름 규칙은 NIGHT_VIEW 에만 적용된다 ────────────────────────────
@settings(max_examples=300, deadline=None)
@given(cat=st.sampled_from(_OTHER_KEYS), name=_ANY_NAME)
def test_pbt_비야경_카테고리는_이름을_보지_않는다(cat: str, name: str) -> None:
    """**핵심 대조** — 야경이 아닌 카테고리는 표 값이 그대로 나온다.

    이름 전 분포(천문·전망·평범·로마자·임의 텍스트)를 통과시켜도 결과가 표와 같다.
    이름 규칙이 야경 밖으로 번지면 `천문과학관식당` 같은 이름이 FOOD 에서 사라진다.
    """
    assert map_category(cat, name) is _CATEGORY_MAP[cat]


@settings(max_examples=200, deadline=None)
@given(cat=st.sampled_from(_OTHER_KEYS), a=_ANY_NAME, b=_ANY_NAME)
def test_pbt_비야경_카테고리는_이름이_달라도_결과가_같다(
    cat: str, a: str, b: str
) -> None:
    """같은 카테고리·다른 이름 두 건을 대조한다 — 이름이 결과를 흔들면 실패."""
    assert map_category(cat, a) == map_category(cat, b)


def test_한식당에_천문대_이름이_와도_FOOD_다() -> None:
    """회귀 고정 — 이름 규칙의 적용 범위를 한 줄로 못박는다."""
    assert map_category("korean_restaurant", "대전시민천문대") is PoiCategory.FOOD
    assert map_category("cafe", "용인어린이천문대") is PoiCategory.CAFE
    assert map_category("park", "솔오름 전망대") is PoiCategory.NATURE


# ── 4. 한글 판정 ──────────────────────────────────────────────────────
@settings(max_examples=120, deadline=None)
@given(name=korean_place_names())
def test_pbt_한글_음절이_있으면_True(name: str) -> None:
    """천문·전망·평범·로마자 병기 전 분포 — 음절이 하나라도 있으면 통과."""
    assert has_korean_name(name) is True


@settings(max_examples=120, deadline=None)
@given(name=non_korean_names())
def test_pbt_한글_음절이_없으면_False(name: str | None) -> None:
    """로마자·숫자·기호·빈 문자열·None, 그리고 **타 문자권**(가나·한자)과
    **자모 단독**(`ㅋㅋ`) — 판정 기준은 한글 '음절'(`[가-힣]`)이다."""
    assert has_korean_name(name) is False


@settings(max_examples=120, deadline=None)
@given(name=mixed_script_names())
def test_pbt_한글_로마자_병기는_True(name: str) -> None:
    """`사라오름 전망대 Sara Observatory` — 실측에 흔한 형태다."""
    assert has_korean_name(name) is True


@settings(max_examples=150, deadline=None)
@given(korean=korean_place_names(), head=st.text(max_size=8), tail=st.text(max_size=8))
def test_pbt_어떤_잡음에_싸여도_한글은_감지된다(
    korean: str, head: str, tail: str
) -> None:
    """포함 판정이지 '전부 한글' 판정이 아니다 — 앞뒤 잡음이 결과를 못 바꾼다."""
    assert has_korean_name(f"{head}{korean}{tail}") is True


# ── 5. 결정론 ─────────────────────────────────────────────────────────
@settings(max_examples=150, deadline=None)
@given(cat=st.one_of(st.sampled_from(_ALL_KEYS), unknown_overture_categories()),
       name=_ANY_NAME)
def test_pbt_매핑은_결정론적이고_표를_바꾸지_않는다(
    cat: str | None, name: str
) -> None:
    """같은 입력 두 번 → 같은 출력. 시각·난수·외부 조회 없음.

    호출이 채택 목록을 건드리지 않는 것도 같이 본다 — 표가 호출로 자라면
    '채택 목록' 이라는 성질 자체가 무너진다.
    """
    before = dict(_CATEGORY_MAP)
    assert map_category(cat, name) == map_category(cat, name)
    assert has_korean_name(name) == has_korean_name(name)
    assert dict(_CATEGORY_MAP) == before
