"""KB-5 본문 전문 수집기(`scripts/collect/collect_place_docs.py wikifull`)의 선택·판정 규칙 — 네트워크 없이."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "collect" / "collect_place_docs.py"


def _mod():
    spec = importlib.util.spec_from_file_location("collect_place_docs_under_test", _SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _p(name, source="TOURAPI", ref=None, region="강동구", address="서울특별시 강동구 천호동"):
    ref = ref or f"{source}-{name}"
    return {"source": source, "provisional_id": ref, "region": region, "poi": {"name": name},
            "provenance": {"content_id": ref, "address": address}}


def test_localdata_is_not_judged_and_does_not_count_toward_chains() -> None:
    m = _mod()
    # '죽변항' — 진짜 항구(TOURAPI) + 동명 식당 둘(LOCALDATA). 식당 때문에 체인으로 빠지면 안 된다.
    props = [_p("죽변항"), _p("죽변항", "LOCALDATA", "l1"), _p("죽변항", "LOCALDATA", "l2"),
             _p("골목식당", ref="a"), _p("골목식당", "OVERTURE", "b"), _p("골목식당", "KAKAO_LOCAL", "c"),
             _p("동네식당", "LOCALDATA", "x")]
    got = m.select_wiki_titles(props)
    assert set(got) == {"죽변항"} and got["죽변항"]["source"] == "TOURAPI"


def test_redirect_and_normalization_map_back_to_the_requested_name() -> None:
    m = _mod()
    q = {"normalized": [{"from": "더현대_서울", "to": "더현대 서울"}],
         "redirects": [{"from": "더현대 서울", "to": "현대백화점"}],
         "pages": {"1": {"title": "현대백화점", "extract": "…"}, "2": {"title": "현대백화점 천호점", "extract": "x"}}}
    assert m.map_requested(["더현대_서울", "현대백화점", "없는 이름"], q) == {
        "더현대_서울": ("현대백화점", "…"), "현대백화점": ("현대백화점", "…")}


def test_accept_judges_with_the_requested_poi_and_rejects_company_and_region_misses() -> None:
    m = _mod()
    by_title = {"더현대 서울": _p("더현대 서울", ref="r1", region="영등포구", address="서울특별시 영등포구 여의도동"),
                "천호시장": _p("천호시장", ref="r2"),
                "다른곳": _p("다른곳", ref="r3", region="해운대구", address="부산광역시 해운대구 우동")}
    pages = {"더현대 서울": ("현대백화점", "주식회사 현대백화점은 1968년에 설립된 회사이다. 영등포구 여의도에 점포가 있다."),
             "천호시장": ("천호시장", "천호시장은 서울 강동구 천호동에 있는 전통 시장이다."),
             "다른곳": ("다른곳", "다른곳은 서울 종로구에 있는 건물이다.")}
    assert m.accept(pages, by_title) == [("천호시장", "r2")]


def test_contact_like_sentences_are_dropped_from_sections() -> None:
    m = _mod()
    got = m._without_contacts([{"heading": "이용", "text": "입장은 무료다. 문의는 02-123-4567 로 한다."},
                               {"heading": "링크", "text": "누리집 www.example.com 참조."}])
    assert got == [{"heading": "이용", "text": "입장은 무료다."}]


def test_redirected_page_is_judged_against_the_poi_that_asked_not_the_target_title() -> None:
    """'더현대 서울'(영등포) 요청이 '현대백화점' 문서로 리다이렉트됐다 — 그 문서를 강동구 POI '현대백화점'으로
    판정하면 엉뚱한 장소가 채택되고, 같은 문서가 두 번 들어가 배포 적재가 doc_id 중복으로 죽었다(리뷰 재현)."""
    m = _mod()
    by_title = {"더현대 서울": _p("더현대 서울", ref="r1", region="영등포구", address="서울특별시 영등포구 여의도동"),
                "현대백화점": _p("현대백화점", ref="r4")}
    pages = {"더현대 서울": ("현대백화점", "현대백화점 천호점은 서울 강동구 천호동에 있는 백화점이다.")}
    assert m.accept(pages, by_title) == []
