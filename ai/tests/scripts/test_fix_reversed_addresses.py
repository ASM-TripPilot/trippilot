"""뒤집힌 주소 보정 — 순수 로직만. 공유본 전체를 읽는 `main` 은 테스트 대상이 아니다.

이 보정의 **유일한 위험은 POI 를 다른 지역으로 옮기는 것**이다. 그래서 "고쳐진다"보다
"엉뚱한 데로 안 간다"를 더 많이 건다.
"""

from __future__ import annotations

import importlib.util
import sys
from collections import defaultdict
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

_AI = Path(__file__).resolve().parents[2]

# 스크립트는 패키지가 아니라 파일이다 — 경로로 불러온다(`collect_localdata` 를 import 하므로
# `scripts/collect` 를 경로에 먼저 넣는다).
sys.path.insert(0, str(_AI / "scripts" / "collect"))
_spec = importlib.util.spec_from_file_location(
    "fix_reversed_addresses", _AI / "scripts" / "collect" / "fix_reversed_addresses.py")
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

from trippilot.poi_curation.sourcing.overture_address import (  # noqa: E402
    resolve_address, sido_abbreviations)

# 카탈로그 축소판 — **두 토큰 시군구**(`고양시 일산서구`)가 핵심이다. 조각(`고양시`·`일산서구`)이
# 접두·꼬리 양쪽에 따로 나타나는 것이 이 버그의 모양이다.
REGIONS = [
    ("11", "서울특별시", "11", "SIDO", False),
    ("11440", "마포구", "11", "SIGUNGU", True),
    ("11530", "구로구", "11", "SIGUNGU", True),
    ("11680", "강남구", "11", "SIGUNGU", True),
    ("11380", "은평구", "11", "SIGUNGU", True),
    ("41", "경기도", "41", "SIDO", False),
    ("41281", "고양시 일산서구", "41", "SIGUNGU", True),
    ("41285", "고양시 일산동구", "41", "SIGUNGU", True),
    ("41290", "과천시", "41", "SIGUNGU", True),
]


def region_check(address: str, regions) -> str:
    tokens = address.split()
    if not tokens:
        return "unresolved"
    sido = next((c for c, n, _, lvl, _ in regions if lvl == "SIDO" and n == tokens[0]), None)
    if sido is None:
        return "unresolved"
    under = {n for _, n, sc, lvl, _ in regions if lvl == "SIGUNGU" and sc == sido}
    two = " ".join(tokens[1:3]) if len(tokens) >= 3 else None
    return "sigungu" if (two in under or (len(tokens) >= 2 and tokens[1] in under)) else "sido_only"


ABBREV = sido_abbreviations(REGIONS)
SIDO_NAMES = {n for _, n, _, lvl, _ in REGIONS if lvl == "SIDO"}
_sido_of = {c: n for c, n, _, lvl, _ in REGIONS if lvl == "SIDO"}
BY_SIDO: dict[str, set[str]] = defaultdict(set)
for _c, _n, _sc, _lvl, _ in REGIONS:
    if _lvl == "SIGUNGU":
        BY_SIDO[_sido_of.get(_sc, "")].add(_n)
PARTS = {t for gus in BY_SIDO.values() for g in gus for t in g.split()}
TAIL_DROP = _mod._COUNTRY | SIDO_NAMES | PARTS | set(ABBREV)


def split_prefix(address: str) -> tuple[str, str]:
    """스크립트 `main` 안의 같은 이름 클로저와 **같은 규칙**을 테스트용으로 재현한다."""
    t = _mod._INVISIBLE.sub("", address).split()
    if not t or t[0] not in SIDO_NAMES:
        return "", " ".join(t)
    gus = BY_SIDO[t[0]]
    if len(t) >= 3 and " ".join(t[1:3]) in gus:
        return " ".join(t[:3]), " ".join(t[3:])
    if len(t) >= 2 and t[1] in gus:
        return " ".join(t[:2]), " ".join(t[2:])
    return t[0], " ".join(t[1:])


def trim(address: str) -> str:
    t = [x for x in address.split() if x]
    while t and t[-1].strip(",") in TAIL_DROP:
        t.pop()
    while t and t[0].strip(",") in TAIL_DROP:
        t.pop(0)
    return " ".join(t)


def fix(address: str, dongs: dict | None = None) -> str | None:
    """보정 한 번 — 스크립트의 세 단계와 같은 순서."""
    prefix, rest = split_prefix(address)
    got = resolve_address(trim(rest), REGIONS, abbrev=ABBREV, dongs=dongs or {},
                          region_check=region_check)
    if got and prefix and split_prefix(got)[0] != prefix:
        return None                                   # 지역이 달라진다 — 건드리지 않는다
    if got and all(got.count(s) <= 1 for s in SIDO_NAMES):
        return got
    if prefix and region_check(prefix, REGIONS) == "sigungu":
        return prefix                                 # 접두만 남긴다
    return None


DONGS = {
    "대화동": ("경기도", "고양시 일산서구"),
    "주엽동": ("경기도", "고양시 일산서구"),
    "장항동": ("경기도", "고양시 일산동구"),
    "과천동": ("경기도", "과천시"),
    "신사동": ("서울특별시", "강남구"),
    "서교동": ("서울특별시", "마포구"),
    "신도림동": ("서울특별시", "구로구"),
}


# ── 1. 접두 식별 — 두 토큰 시군구를 통째로 본다 ──────────────────────────
@pytest.mark.parametrize(
    "address,prefix,rest",
    [
        # 두 토큰 시군구 — 세 토큰이 접두다. 두 토큰만 떼면 `일산서구` 가 남아 또 붙는다
        ("경기도 고양시 일산서구 대화동 2324", "경기도 고양시 일산서구", "대화동 2324"),
        # 한 토큰 시군구
        ("경기도 과천시 과천동 489-6", "경기도 과천시", "과천동 489-6"),
        # 시도만 — 시군구가 아니면 한 토큰만 접두다
        ("경기도 어딘가 1", "경기도", "어딘가 1"),
        # 시도로 시작하지 않으면 접두가 없다
        ("과천동 489-6", "", "과천동 489-6"),
        ("", "", ""),
    ],
)
def test_접두를_카탈로그로_식별한다(address: str, prefix: str, rest: str) -> None:
    assert split_prefix(address) == (prefix, rest)


def test_보이지_않는_문자를_떼고_본다() -> None:
    """`경기도‎` 처럼 방향 제어 문자가 붙어 와서 토큰 비교를 깬 실측 사례."""
    assert split_prefix("경기도‎ 과천시 과천동 1") == ("경기도 과천시", "과천동 1")


# ── 2. 양끝을 떼야 한다 — 뒤집힌 꼴은 지역 조각이 양쪽에 남는다 ──────────
@pytest.mark.parametrize(
    "before,after",
    [
        ("과천동 489-6번지 과천시 경기도 KR", "과천동 489-6번지"),
        ("일산서구 주엽동 22번지 7층 고양시 경기도", "주엽동 22번지 7층"),
        ("KR 서울특별시 구로구 신도림동 692번지", "신도림동 692번지"),
        ("대한민국 경기도 고양시 대화동 2324", "대화동 2324"),
        ("서교동 448-14번지 1층", "서교동 448-14번지 1층"),   # 뗄 것이 없다
    ],
)
def test_양끝의_지역_나라_조각을_뗀다(before: str, after: str) -> None:
    assert trim(before) == after


def test_지역_조각만_있으면_빈_문자열이_된다() -> None:
    assert trim("서울특별시 마포구 KR") == ""


# ── 3. 실측 54곳의 모양 — 깨끗하게 복구되는 것 ────────────────────────────
@pytest.mark.parametrize(
    "before,after",
    [
        # 꼬리가 뒤집혀 있다
        ("경기도 과천시 과천동 489-6번지 과천시 경기도 KR",
         "경기도 과천시 과천동 489-6번지"),
        ("서울특별시 마포구 서교동 448-14번지 1층 마포구 서울특별시 KR",
         "서울특별시 마포구 서교동 448-14번지 1층"),
        # 머리에 나라가 붙어 있다
        ("경기도 고양시 일산서구 대한민국 경기도 고양시 대화동 2324",
         "경기도 고양시 일산서구 대화동 2324"),
        # 원문이 시군구 조각으로 시작한다(두 토큰 시군구의 뒷조각)
        ("경기도 고양시 일산서구 일산서구 주엽동 22번지 7층 고양시 경기도",
         "경기도 고양시 일산서구 주엽동 22번지 7층"),
        # 나라 표기가 중간에 있다
        ("서울특별시 구로구 KR 서울특별시 구로구 신도림동 692번지",
         "서울특별시 구로구 신도림동 692번지"),
    ],
)
def test_실측_모양이_깨끗하게_복구된다(before: str, after: str) -> None:
    assert fix(before, DONGS) == after


# ── 4. 못 풀면 접두만 남긴다 — 번지는 잃어도 지역은 사실이다 ─────────────
@pytest.mark.parametrize(
    "before",
    [
        # 남은 원문이 로마자라 못 푼다
        "서울특별시 마포구 World Cup-ro 25-gil, 91) 지하 KR 서울특별시 마포구",
        # 남은 원문이 쓸 수 없는 값이다
        "서울특별시 마포구 전체 번지 지층 148-9 KR 서울특별시 마포구",
    ],
)
def test_못_풀면_접두만_남긴다(before: str) -> None:
    got = fix(before, DONGS)
    assert got == "서울특별시 마포구"
    # 접두만 남겨도 **지역은 풀린다** — 그래야 다음 재수집에서 퇴출되지 않는다
    assert region_check(got, REGIONS) == "sigungu"


# ── 5. **지역을 옮기지 않는다** — 이 보정의 유일한 위험 ──────────────────
def test_복원이_다른_시군구를_가리키면_건드리지_않는다() -> None:
    """실측 — `탑베이비` 는 꼬리가 은평구인데 접두가 강남구다(`신사동` 은 강남구).

    동 표가 꼬리 쪽을 가리키게 돼 있으면 보정이 POI 를 옮긴다. 그건 안 한다 —
    지금 적재된 지역이 틀렸다는 증거가 없다.
    """
    moved = {"신사동": ("서울특별시", "은평구")}      # 일부러 어긋나게
    assert fix("서울특별시 강남구 신사동 2-20번지 3층 은평구 서울특별시 KR", moved) is None
    # 같은 입력에 맞는 표를 주면 고쳐진다
    assert fix("서울특별시 강남구 신사동 2-20번지 3층 은평구 서울특별시 KR", DONGS) == \
        "서울특별시 강남구 신사동 2-20번지 3층"


@settings(max_examples=300, deadline=None)
@given(address=st.text(max_size=60))
def test_pbt_보정_결과는_None_이거나_접두를_보존한다(address: str) -> None:
    """치역 불변식 — 결과가 있으면 **원래 접두와 같은 시군구**이고 지역이 한 번만 나온다."""
    prefix, _ = split_prefix(address)
    got = fix(address, DONGS)
    if got is None:
        return
    assert region_check(got, REGIONS) == "sigungu"
    assert all(got.count(s) <= 1 for s in SIDO_NAMES)
    if prefix:
        assert split_prefix(got)[0] == prefix


@settings(max_examples=100, deadline=None)
@given(address=st.text(max_size=60))
def test_pbt_보정은_멱등이다(address: str) -> None:
    """한 번 고친 주소를 다시 넣으면 그대로다 — 재실행이 주소를 깎아 먹으면 안 된다."""
    once = fix(address, DONGS)
    if once is not None:
        assert fix(once, DONGS) == once
