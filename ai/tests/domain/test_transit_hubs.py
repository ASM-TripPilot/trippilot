"""교통 거점 표 — 이름·별칭 완전 일치만, 표는 전부 좌표가 있고 별칭이 겹치지 않는다."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from trippilot.domain.poi import transit_hubs
from trippilot.domain.poi.transit_hubs import transit_hub

_TABLE = Path(transit_hubs.__file__).resolve().parents[4] / "data/transit_hubs.json"


@pytest.mark.parametrize("said, name", [
    ("서울역", "서울역"), ("서울 역", "서울역"), ("서울역에서", "서울역"), ("김포공항", "김포국제공항"), ("고속터미널", "서울고속버스터미널"),
    ("인천공항", "인천국제공항 제1여객터미널"), ("인천공항 2터미널", "인천국제공항 제2여객터미널"), ("동서울터미널까지", "동서울종합터미널"),
])
def test_hub_by_name_or_alias(said: str, name: str) -> None:
    hub = transit_hub(said)
    assert hub is not None and hub.name == name


@pytest.mark.parametrize("said", ["서울", "서울역사박물관", "서울역 근처 카페", "역", "", "경복궁"])
def test_no_partial_match(said: str) -> None:
    assert transit_hub(said) is None


def test_seoul_station_is_the_station_not_the_city_center() -> None:
    hub = transit_hub("서울역")
    assert hub is not None and hub.kind == "기차역"
    assert abs(hub.point.lat - 37.554) < 0.003 and abs(hub.point.lng - 126.971) < 0.003  # 시청(37.5665, 126.978)이 아니다


def test_table_rows_all_have_kakao_coordinates_and_distinct_aliases() -> None:
    table = json.loads(_TABLE.read_text(encoding="utf-8"))
    seen: set[str] = set()
    for row in table["hubs"]:
        assert {"name", "kind", "query", "aliases", "lat", "lng", "kakao_name", "address"} <= set(row), row["name"]
        assert row["kind"] in {"기차역", "공항", "버스터미널", "여객터미널"}
        for alias in (row["name"], *row["aliases"]):
            key = "".join(alias.split())
            assert key not in seen, alias  # 한 말이 두 거점을 가리키면 어느 쪽인지 알 수 없다
            seen.add(key)
    assert len(table["hubs"]) >= 150
