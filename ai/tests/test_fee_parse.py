"""입장료 파서 — 실물에서 걸린 함정만 고정한다. 실 호출 0.

이 파서가 조용히 틀리면 **예산 기반 POI 선택이 틀린 값으로 돌아간다.** 아래 네 건은
전부 2026-09-22 실측에서 실제로 잘못 읽혔던 것이고, 셋은 **진짜 입장료를 무료·제외로
밀어** 무료율을 부풀렸다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from collect_place_fees import parse_fee  # noqa: E402


# ── 함정 ①: `일반` 의 "반" 을 강좌명으로 읽는다 ──────────────────────

def test_일반_요금을_강좌명으로_읽지_않는다() -> None:
    """수강료 제외 규칙(`반\\s*\\d`)이 **`일반 9,000원`** 을 잡아먹던 것 — 실측 21건."""
    assert parse_fee("[개인]<br>- 일반 9,000원<br>- 어린이 5,000원") == 9000


def test_진짜_강좌료는_여전히_제외한다() -> None:
    assert parse_fee("- 한글서예반 90,000원<br>- 동양화반 60,000원") is None


# ── 함정 ②: 라벨과 금액 사이 괄호가 성인 요금을 끊는다 ────────────────

@pytest.mark.parametrize("raw,want", [
    ("- 성인 (20~65세) 12,000원<br>- 어린이 8,000원", 12000),
    ("- 대인 (만 19세 이상) 8,000원<br>- 소인 6,000원", 8000),
    ("[국민여권]<br>- 일반(1년) 20,000원<br>- 초등학생 10,000원", 20000),
])
def test_괄호_나이가_끼어도_성인_요금을_잡는다(raw: str, want: int) -> None:
    assert parse_fee(raw) == want


def test_괄호_속_나이를_금액으로_읽지_않는다() -> None:
    """`어른 (25~64세) 1,000원` — 25·64 가 아니라 1,000 이다."""
    assert parse_fee("- 어른 (25~64세) 1,000원 <br>- 어린이 (7~12세) 300원") == 1000


# ── 함정 ③: 나이 구분이 없는 단일 요금제 ─────────────────────────

@pytest.mark.parametrize("raw,want", [
    ("5,000원 (녹차 1잔 제공)", 5000),
    ("12,000원\n※ 자세한 사항은 전화 문의 요망", 12000),
])
def test_라벨_없는_단일_요금제도_읽는다(raw: str, want: int) -> None:
    assert parse_fee(raw) == want


# ── 함정 ④: 금액이 있어도 입장료가 아닐 수 있다 ───────────────────

@pytest.mark.parametrize("raw", [
    "[전시]<br />무료<br />[대관료]<br />- 세미나실 4시간 55,000원",   # 전시는 무료·대관료만 유료
    "- 프리미엄 초콜릿 만들기 99,000원",                              # 체험비
    "1박 70,000원",                                                # 숙박
    "문화학교 1년 회비 30,000원",                                    # 회비
])
def test_입장료가_아닌_금액은_None(raw: str) -> None:
    """**0 이 아니라 None 이다** — "무료"가 아니라 "입장료를 못 찾았다"는 뜻이다."""
    assert parse_fee(raw) is None


# ── 명시적 입장료 표지가 비입장료 표지를 이긴다 ─────────────────────

def test_관람료가_같은_기록의_체험비에_지지_않는다() -> None:
    """한 기록에 입장료와 체험비가 같이 온다 — 비입장료만 보면 멀쩡한 입장료도 버린다."""
    raw = ("- 관람료 5,000원\n- 나무곤충만들기/나무곤충목걸이 6,000원\n"
           "- 교육농장 교육프로그램 10,000원")
    assert parse_fee(raw) == 5000


def test_개인가를_집는다_단체가가_아니라() -> None:
    """`[단체]` 대괄호가 없어 구간을 못 자르는 모양 — `개인` 라벨이 가른다."""
    assert parse_fee("- 개인 3,000원<br>- 단체(10인 이상) 2,400원") == 3000


# ── 무료 / 불명 ────────────────────────────────────────────────

@pytest.mark.parametrize("raw", ["무료", "무료입장", "  무료  ", "무료 (체험 활동 비용 별도)"])
def test_무료는_0(raw: str) -> None:
    assert parse_fee(raw) == 0


def test_유료_기록_안의_무료_문구에_지지_않는다() -> None:
    """`※ 무료 - 유아/경로` 는 면제 대상 안내지 이 장소가 무료라는 뜻이 아니다."""
    raw = ("[개인]<br>- 어른 1,000원<br>- 어린이 300원<br>"
           "※ 무료 <br>- 유아 / 65세 이상 경로")
    assert parse_fee(raw) == 1000


@pytest.mark.parametrize("raw", ["공연 별로 상이함", "※ 강좌에 따라 상이하므로 전화문의 요망", ""])
def test_못_읽으면_None_이지_0_이_아니다(raw: str) -> None:
    assert parse_fee(raw) is None


def test_단체가가_아니라_개인가를_쓴다() -> None:
    raw = ("[개인]<br>- 성인 8,800원<br>[단체 (30인 이상)]<br>- 성인 7,700원")
    assert parse_fee(raw) == 8800


def test_원천_오타를_성인_라벨이_막는다() -> None:
    """`청소년 181,000원`(=18,000 오타)이 실재한다 — 최댓값을 쓰면 이걸 집는다."""
    raw = ("[개인]\n- 일반(20세 이상) 21,000원\n- 청소년 181,000원\n"
           "- 어린이(36개월 이상) 15,000원")
    assert parse_fee(raw) == 21000


@settings(max_examples=200, deadline=None)
@given(st.text(max_size=120))
def test_pbt_절대_음수나_예외를_내지_않는다(raw: str) -> None:
    """임의 문자열에도 죽지 않는다 — 수집은 8천 건을 돌고 한 건 때문에 멈추면 안 된다."""
    got = parse_fee(raw)
    assert got is None or got >= 0
