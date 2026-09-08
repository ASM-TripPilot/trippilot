"""LOCALDATA 영업상태 매칭의 순수 로직 검증 (TRIP-280).

스크립트 본체는 pytest 대상이 아니지만(원본 CSV 862MB 가 로컬에만 있다) **판정**은
여기서 못 박는다. 실측에서 주소 문자열 비교는 35.5%, 키 비교는 83.5% 였고 그 차이를
만든 세 경우(쉼표 뒤 상세주소·읍면 유무·동 표기)를 그대로 케이스로 쓴다.

가장 중요한 건 마지막 묶음이다 — 주소만 맞고 이름이 다르면 **붙이지 않는다**.
붙이면 같은 건물 다른 가게의 폐업 여부를 사용자에게 보여주게 된다(실측 12.1%).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from match_business_status import (  # noqa: E402
    Biz,
    addr_key,
    norm_name,
    pick,
    to_status,
)


def _open(name: str) -> Biz:
    return Biz(name, "영업/정상", "", "2011-03-02")


def _closed(name: str) -> Biz:
    return Biz(name, "폐업", "2025-10-30", "2015-09-15")


@pytest.mark.parametrize(
    ("a", "b"),
    [
        # 쉼표 뒤 상세주소
        ("제주특별자치도 제주시 월랑로 36", "제주특별자치도 제주시 월랑로 36,"),
        # 읍면 유무 — CSV 는 읍면을 쓰고 TourAPI 는 안 쓰는 경우가 흔하다
        ("제주특별자치도 제주시 해맞이해안로 1296",
         "제주특별자치도 제주시 구좌읍 해맞이해안로 1296,"),
        # 동 표기
        ("제주특별자치도 제주시 애월읍 애월로 6",
         "제주특별자치도 제주시 애월읍 애월로 6, A동"),
        # 괄호 법정동 + 층 표기 (LOCALDATA 도로명주소 실제 형태)
        ("서울특별시 종로구 사직로 133-10",
         "서울특별시 종로구 사직로 133-10, 1층 (적선동)"),
    ],
)
def test_같은_장소는_같은_주소키(a: str, b: str) -> None:
    assert addr_key(a) == addr_key(b) is not None


def test_주소키_구성() -> None:
    assert addr_key("제주특별자치도 제주시 구좌읍 세화14길 3") == (
        "제주", "제주시", "세화14길", "3")


def test_건물번호_부번_유지() -> None:
    # 133 과 133-10 은 다른 건물이다 — 부번을 버리면 안 된다
    assert addr_key("서울특별시 종로구 사직로 133-10") != addr_key(
        "서울특별시 종로구 사직로 133")


@pytest.mark.parametrize("a", [None, "", "제주특별자치도 제주시 한경면 청수리", "서울"])
def test_도로명이_없으면_키가_없다(a: str | None) -> None:
    assert addr_key(a) is None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("고집돌우럭 중문점", "고집돌우럭중문점"),
        ("스타벅스(제주점)", "스타벅스"),
        ("김밥천국 본점", "김밥천국"),
        ("교촌치킨 1호점", "교촌치킨"),
        (None, ""),
    ],
)
def test_이름_정규화(raw: str | None, expected: str) -> None:
    assert norm_name(raw) == expected


def test_정확_일치를_먼저_고른다() -> None:
    cands = [_closed("가는곶"), _open("가는곶 세화")]
    assert pick("가는곶 세화", cands).name == "가는곶 세화"


def test_부분_포함이면_채택() -> None:
    assert pick("고집돌우럭", [_open("고집돌우럭 중문점")]) is not None


def test_이름이_다르면_주소가_맞아도_버린다() -> None:
    # 같은 건물의 다른 가게 — 붙이면 엉뚱한 가게의 폐업 여부를 가져온다
    assert pick("고집돌우럭 중문점", [_open("고등어와 친구들")]) is None


def test_한_글자는_부분일치로_안_붙는다() -> None:
    assert pick("김", [_open("김밥천국")]) is None


def test_동명이점은_영업중을_고른다() -> None:
    # 폐업 이력 위에 재개업한 자리 — 최신 상태가 영업이면 영업이다
    assert pick("한라산", [_closed("한라산"), _open("한라산")]).status == "영업/정상"


def test_후보가_없으면_None() -> None:
    assert pick("한라산", []) is None


def test_상태_변환() -> None:
    assert to_status(_closed("x")) == {
        "state": "CLOSED", "closed_at": "2025-10-30", "licensed_at": "2015-09-15"}
    # 영업 중이면 폐업일자 칸 자체가 없다
    assert to_status(_open("x")) == {"state": "OPEN", "licensed_at": "2011-03-02"}
