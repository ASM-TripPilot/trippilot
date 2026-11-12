"""교통 거점(역·공항·터미널) → 좌표 — 도우미 거리의 **끝**으로만 쓰는 표(`data/transit_hubs.json`).

역은 가 볼 곳이 아니라 오가는 곳이라 장소 DB(`poi_public`) 에 넣지 않는다 — 넣으면 "서울 가볼 만한 곳"에 서울역 1호선이 섞이고,
지하철역은 "서울역 1호선"처럼 와서 이름 완전 일치로는 찾히지도 않는다. 지역 표(`region_centers`)와 같은 꼴의 닫힌 집합이고(INV-1),
좌표는 카카오 키워드 검색 값(`scripts/collect/refresh_transit_hubs.py`) — 지역 중심 같은 어림이 아니라 그 시설의 한 점이다.
이름·별칭(사용자가 부르는 말 — "김포공항"·"고속터미널")은 사람이 적는다. 표에 없는 역은 None 이고 호출측이 등록 장소 찾기로 넘긴다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from trippilot.domain.common import GeoPoint

_TABLE = Path(__file__).resolve().parents[4] / "data/transit_hubs.json"


@dataclass(frozen=True, slots=True)
class TransitHub:
    name: str  # 표의 이름(카카오 상호와 같거나 그 머리) — 발화 원문이 아니다
    kind: str  # 기차역·공항·버스터미널·여객터미널
    point: GeoPoint


def _squash(text: str) -> str:
    return "".join(text.split())


@lru_cache(maxsize=1)
def _index() -> dict[str, TransitHub]:
    table = json.loads(_TABLE.read_text(encoding="utf-8"))
    out: dict[str, TransitHub] = {}
    for row in table["hubs"]:
        if "lat" not in row:  # 카카오가 못 맞춘 항목 — 좌표 없이 거점을 만들지 않는다
            continue
        hub = TransitHub(row["name"], row["kind"], GeoPoint(row["lat"], row["lng"]))
        for alias in (row["name"], *row.get("aliases", ())):
            out.setdefault(_squash(alias), hub)
    return out


def transit_hub(said: str) -> TransitHub | None:
    """말한 이름(공백 무시, 끝의 조사 하나까지)이 표의 이름·별칭과 **같을 때**만 — 부분 일치는 하지 않는다("서울역사박물관"은 역이 아니다)."""
    key = _squash(said)
    table = _index()
    if key in table:
        return table[key]
    for josa in ("에서", "까지", "부터", "으로", "로", "에", "은", "는", "이", "가", "을", "를", "의"):
        if key.endswith(josa) and key[: -len(josa)] in table:
            return table[key[: -len(josa)]]
    return None
