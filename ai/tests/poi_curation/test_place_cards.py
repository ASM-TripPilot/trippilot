"""장소 카드 — 관광공사 상세 칸만으로 만든 한 줄(2026-10-23 · 10-30 개정). 후보 줄에 이미 있는 칸·칸 밖의 말·시각·가격·전화가 없다."""

from __future__ import annotations

import re

import pytest

from trippilot.poi_curation.place_cards import CARD_MAX_CHARS, area, card_text, intro_facts


def _p(name="술술국밥 석촌고분역점", category="FOOD", tags=("한식", "국밥", "혼밥", "인기1", "평점높음"), source="TOURAPI",
       cid="2795233", address="서울특별시 송파구 백제고분로 265, 1층 (삼전동)", region="송파구", detail=None):
    return {"source": source, "tags": list(tags), "region": region, "poi": {"name": name, "category": category},
            "provenance": {"content_id": cid, "address": address, **({"detail": detail} if detail else {})}}


def test_card_is_area_plus_detail_facts_and_never_repeats_the_candidate_line() -> None:
    text = card_text(_p(detail={"firstmenu": "소고기국밥", "parkingfood": "가능"}))
    assert text == "서울 송파구 삼전동. 대표메뉴 소고기국밥. 주차 가능."
    assert "술술국밥" not in text and "한식" not in text and "혼밥" not in text  # 이름·종류·태그는 후보 줄에 있다
    assert not re.search(r"인기\d|평점높음", text)


def test_no_detail_facts_means_no_card() -> None:
    assert card_text(_p(source="LOCALDATA", cid="3230000-101-1995-00001")) == ""  # 동네만으로는 문서라 할 것이 없다


def test_intro_drops_unknown_flags_phones_prices_and_markup() -> None:
    detail = {"firstmenu": "고기국수<br>", "treatmenu": "돔베고기 / 멸치국수 / 물만두 / 비빔국수", "kidsfacility": "0",
              "reservationfood": "전화 예약 (064-123-4567)", "parkingfood": "가능", "packing": "가능", "saleitem": "8,000원",
              "chkpet": "불가"}
    assert intro_facts(detail) == ["대표메뉴 고기국수", "메뉴 돔베고기·멸치국수·물만두 등", "주차 가능", "포장 가능"]


@pytest.mark.parametrize("detail", [{"packing": "포장 불가능"}, {"packing": "불가"}, {"firstmenu": "3시까지 판매"},
                                    {"firstmenu": "아메리카노 4500"}, {"treatmenu": "11:00~21:00"}, {"kidsfacility": "0"}])
def test_negative_flags_clock_times_and_bare_prices_never_become_facts(detail) -> None:
    assert intro_facts(detail) == []


def test_repeated_menu_items_are_listed_once() -> None:
    assert intro_facts({"treatmenu": "냉면, 냉면, 수육"}) == ["메뉴 냉면·수육"]


@pytest.mark.parametrize(("address", "region", "want"), [
    ("서울특별시 송파구 백제고분로 265, 1층 (삼전동)", "송파구", "서울 송파구 삼전동"),
    ("제주특별자치도 제주시 한경면 청수리", "제주시", "제주 제주시 한경면"),
    ("경기도 수원시 팔달구 정조로 825 (남창동)", "수원시", "경기 수원시 팔달구 남창동"),
    ("세종특별자치시 만남로 151 (고운동)", "", "세종 고운동"),  # 둘째 낱말은 길 이름이다
    ("전남광주통합특별시 광산구 하남대로54번안길 133 (하남동)", "광산구", "전남광주 광산구 하남동"),
    ("서울특별시 강남구 테헤란로 1 (101동)", "강남구", "서울 강남구"),  # 건물 동 번호는 동네가 아니다
    ("서울특별시 중구 명동길 1 (지하상가)", "중구", "서울 중구"),
    ("서울특별시 종로구 종로 1 (종로1가)", "종로구", "서울 종로구 종로1가"),
])
def test_area_reads_gu_from_the_address_and_rejects_building_units(address, region, want) -> None:
    assert area(address, region) == want


def test_card_never_carries_clock_times_prices_or_phones_and_respects_the_cap() -> None:
    detail = {"firstmenu": "A·" * 200, "treatmenu": "11:00~21:00", "saleitem": "010-1234-5678", "parkingfood": "가능"}
    text = card_text(_p(detail=detail))
    assert len(text) <= CARD_MAX_CHARS
    assert not re.search(r"\d{1,2}:\d{2}|\d{2,4}-\d{3,4}-\d{4}|\d[\d,]*원", text)


@pytest.mark.parametrize(("address", "region", "want"), [
    ("제주특별자치도 서귀포시 산방로 141 원앤온리", "서귀포시", "제주 서귀포시"),  # 도로명 뒤 상호는 동네가 아니다
    ("인천광역시 연수구 인권로 26 하늘다리 한정식", "연수구", "인천 연수구"),
    ("전북특별자치도 남원시 향단로 18 이조숯불냉면", "남원시", "전북 남원시"),
    ("서울특별시 성동구 성수동2가 289-1", "성동구", "서울 성동구 성수동2가"),
])
def test_area_reads_only_the_unit_right_after_the_district(address, region, want) -> None:
    assert area(address, region) == want


def test_menu_items_split_outside_parentheses_and_say_when_cut() -> None:
    assert intro_facts({"treatmenu": "잔치국수(온/냉) / 비빔국수 / 수육 / 전"}) == ["메뉴 잔치국수(온/냉)·비빔국수·수육 등"]


@pytest.mark.parametrize("detail", [{"saleitem": "복합쇼핑몰(백화점, 마트, 편의점, 아울렛 등)"}, {"treatmenu": "물회 1만5천원 / 회덮밥 9천원"},
                                    {"firstmenu": "성인 이용 가격"}, {"treatmenu": "만원대 정식"}])
def test_placeholders_store_formats_and_prices_with_units_are_not_items(detail) -> None:
    assert intro_facts(detail) == []
