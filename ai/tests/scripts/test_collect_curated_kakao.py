"""웹 큐레이션 → 카카오 속성 채우기 — 매칭·중복 판정·인기 표지의 실측 사례 고정 (2026-10-18)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "collect"))

from collect_curated_kakao import already, pick, tags_for  # noqa: E402
from merge_pois_docs import mark_trending  # noqa: E402

from trippilot.assembly_engine.scorer import _popularity_norm  # noqa: E402
from trippilot.domain.poi import NIGHTLIFE_TAG, TRENDING_TAG  # noqa: E402


def _doc(name: str, addr: str, category: str = "") -> dict:
    return {"place_name": name, "road_address_name": addr, "category_name": category}


def test_이름이_들어_있고_시도가_맞는_첫_건만_고른다() -> None:
    docs = [_doc("옥타곤", "충북 제천시 금성면"), _doc("옥타곤", "서울 강남구 논현로")]
    assert pick(docs, "옥타곤", "서울")["road_address_name"].startswith("서울")
    assert pick(docs, "옥타곤", "부산") is None   # 비슷한 것을 고르지 않는다


def test_이미_있음은_목록_이름이_공유본_상호_안에_있을_때만_그_행을_돌려준다() -> None:
    shared = [("스몹하남", 37.5600, 127.1900, ("TOURAPI", "1")),
              ("명동", 37.5630, 126.9850, ("TOURAPI", "2"))]
    assert already(shared, "스몹", 37.5612, 127.1905) == ("TOURAPI", "1")  # 지점명 붙은 같은 곳, ~140m
    assert already(shared, "사격", 37.5631, 126.9851) is None   # `명동` 이 `명동실탄사격장` 을 삼키지 않는다
    assert already(shared, "스몹", 37.5700, 127.1900) is None   # 이름이 달라 300m 넘으면 다른 곳
    big = [("이월드", 35.8530, 128.5640, ("TOURAPI", "3"))]
    assert already(big, "이월드", 35.8559, 128.5640) == ("TOURAPI", "3")   # 이름이 같으면 ~320m 도 같은 곳
    assert already(big, "이월드", 35.8650, 128.5640) is None            # 같아도 1km 넘으면 다른 곳


def test_밤_장소는_나이트라이프_계약에_요즘_인기가_뒤에_붙는다() -> None:
    assert tags_for("혼술바", _doc("헌집", ""), "헌집 제주혼술바") == (NIGHTLIFE_TAG, "혼술바", TRENDING_TAG)
    assert tags_for("칵테일바", _doc("표류", ""), "표류") == (NIGHTLIFE_TAG, "칵테일바", TRENDING_TAG)
    assert tags_for("혼술바", _doc("x", ""), "OO 노래주점") is None     # 기존 제외 규칙이 그대로 걸린다
    assert tags_for("SIGHT", _doc("x", "", "여행 > 관광,명소 > 전망대"), "x") == ("전망대", TRENDING_TAG)


def test_이미_있는_행에_요즘_인기를_한_번만_붙인다(tmp_path) -> None:
    path = tmp_path / "t.json"
    path.write_text(json.dumps({"refs": [{"source": "TOURAPI", "content_id": "1"}]}), encoding="utf-8")
    props = [{"source": "TOURAPI", "provenance": {"content_id": "1"}, "tags": ["자연관광지"]},
             {"source": "LOCALDATA", "provenance": {"content_id": "1"}, "tags": []}]   # 같은 번호, 다른 출처
    assert mark_trending(props, path) == 1
    assert props[0]["tags"] == ["자연관광지", TRENDING_TAG] and props[1]["tags"] == []
    assert mark_trending(props, path) == 0                         # 멱등 — 매 병합 소급
    assert mark_trending(props, tmp_path / "없음.json") == 0


def test_요즘_인기는_인기_항의_바닥이고_저장_수가_넘으면_저장_수가_이긴다() -> None:
    assert _popularity_norm(0) == 0.0
    assert _popularity_norm(0, (TRENDING_TAG,)) == 0.25
    assert _popularity_norm(1000, (TRENDING_TAG,)) == _popularity_norm(1000) == 0.5


def test_출처_주소가_있으면_카카오_주소에도_있어야_고른다() -> None:
    docs = [_doc("문구센터", "서울 용산구 이태원로27길 60"), _doc("문", "서울 용산구 이태원로27길 6")]
    assert pick(docs, "문", "서울", "이태원로27길 6")["road_address_name"].endswith("27길 6")
    assert pick([docs[0]], "문", "서울", "이태원로27길 6") is None   # 6 ≠ 60
