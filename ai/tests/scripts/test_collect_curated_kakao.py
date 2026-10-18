"""웹 큐레이션 → 카카오 속성 채우기 — 매칭·중복 판정의 실측 사례 고정 (2026-10-18)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "collect"))

from collect_curated_kakao import already, pick  # noqa: E402


def _doc(name: str, addr: str) -> dict:
    return {"place_name": name, "road_address_name": addr}


def test_이름이_들어_있고_시도가_맞는_첫_건만_고른다() -> None:
    docs = [_doc("옥타곤", "충북 제천시 금성면"), _doc("옥타곤", "서울 강남구 논현로")]
    assert pick(docs, "옥타곤", "서울")["road_address_name"].startswith("서울")
    assert pick(docs, "옥타곤", "부산") is None   # 비슷한 것을 고르지 않는다


def test_이미_있음은_목록_이름이_공유본_상호_안에_있을_때만() -> None:
    shared = [("스몹하남", 37.5600, 127.1900), ("명동", 37.5630, 126.9850)]
    assert already(shared, "스몹", 37.5612, 127.1905)          # 지점명 붙은 같은 곳, ~140m
    assert not already(shared, "사격", 37.5631, 126.9851)       # `명동` 이 `명동실탄사격장` 을 삼키지 않는다
    assert not already(shared, "스몹", 37.5700, 127.1900)       # 1km 넘으면 다른 곳
