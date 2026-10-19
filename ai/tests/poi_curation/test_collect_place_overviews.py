"""KB-5 2단계 — 관광공사 개요 수집기(`scripts/collect/collect_place_overviews.py`)와 어댑터 `fetch_overview` (실 호출 0).

증명하는 것:
  ① `fetch_overview` 는 detailCommon2 를 contentId 로 **한 번** 부르고 개요 원문을 준다(없으면 None)
  ② 정리: `<br>`·태그·엔티티를 걷고 연락처꼴 문장을 뺀다 — 출력 게이트가 이유를 통째로 비우지 않게
  ③ 이어받기: 이미 받은 곳(개요가 비었던 곳 포함)은 다시 부르지 않고, 호출 상한·연속 실패(한도 소진)에서 멈춘다.
     실패한 곳은 남기지 않는다 — 다음 실행이 다시 부른다
  ④ 대상은 관광공사 장소만, content_id 중복 없이, 실행마다 같은 순서(해시 순 — 앞 N건이 고르게 섞인 표본)
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from tests.fakes.fake_tourapi_http import FakeTourApiHttp, common_item, envelope
from trippilot.poi_curation.chunking import chunk_document
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "collect" / "collect_place_overviews.py"


def _mod():
    spec = importlib.util.spec_from_file_location("collect_place_overviews_under_test", _SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_fetch_overview_calls_detail_common_once_and_returns_the_raw_text() -> None:
    http = FakeTourApiHttp(commons={"126508": envelope([common_item("126508", "경복궁은<br>조선의 법궁이다.")], 1)})
    adapter = TourApiAdapter(http, "k")
    assert adapter.fetch_overview("126508") == "경복궁은<br>조선의 법궁이다."
    assert adapter.fetch_overview("999") is None  # 없는 곳 — 빈 봉투
    assert [url.rsplit("/", 1)[1] for url, _ in http.calls] == ["detailCommon2", "detailCommon2"]
    assert http.calls[0][1]["contentId"] == "126508"


def test_clean_overview_strips_markup_and_contact_sentences() -> None:
    m = _mod()
    raw = "경복궁은 조선의 법궁이다.<br />\n근정전이 &lt;국보&gt;로 지정돼 있다. 문의는 02-3700-3900 으로 한다.<BR>"
    assert m.clean_overview(raw) == "경복궁은 조선의 법궁이다. 근정전이 <국보>로 지정돼 있다."


class _Adapter:
    def __init__(self, table: dict[str, str | None], fail: set[str] = frozenset()) -> None:
        self.table, self.fail, self.calls = table, set(fail), []

    def fetch_overview(self, cid: str) -> str | None:
        self.calls.append(cid)
        if cid in self.fail:
            raise RuntimeError("HTTP 429")
        return self.table.get(cid)


def test_collect_resumes_skips_known_places_and_stops_at_the_budget() -> None:
    m = _mod()
    have = {"overview:a": m.row_of("a", "가", "이미 받은 개요다."), "overview:b": m.row_of("b", "나", None)}
    adapter = _Adapter({"c": "다 개요다.", "d": "", "e": "마 개요다."})
    calls, failed = m.collect(adapter, [("a", "가"), ("b", "나"), ("c", "다"), ("d", "라"), ("e", "마")], have, 2)
    assert adapter.calls == ["c", "d"] and (calls, failed) == (2, 0)  # 받은 곳(개요 없던 b 포함)은 안 부른다
    assert have["overview:c"]["sections"] == [{"heading": "개요", "text": "다 개요다."}]
    assert have["overview:d"]["sections"] == [] and chunk_document(have["overview:d"]) == ()
    assert "overview:e" not in have


def test_collect_stops_after_consecutive_failures_and_keeps_failed_places_for_next_run() -> None:
    m = _mod()
    todo = [(str(i), f"곳{i}") for i in range(20)]
    adapter = _Adapter({}, fail={str(i) for i in range(20)})
    have: dict[str, dict] = {}
    calls, failed = m.collect(adapter, todo, have, 100)
    assert calls == failed == m._STOP_AFTER_FAILS  # 한도가 끝난 날 호출을 낭비하지 않는다
    assert have == {}


def test_targets_are_tourapi_places_deduped_in_a_stable_hash_order() -> None:
    m = _mod()
    def p(cid, source="TOURAPI", name="곳"):
        return {"source": source, "poi": {"name": name}, "provenance": {"content_id": cid}}
    proposals = [p("1"), p("2"), p("1"), p("9", source="LOCALDATA"), {"source": "TOURAPI", "poi": {}, "provenance": {}}]
    got = m.targets(proposals)
    assert sorted(cid for cid, _ in got) == ["1", "2"]
    assert got == m.targets(list(reversed(proposals)))


def test_stats_projects_chunk_count_and_vector_size() -> None:
    m = _mod()
    rows = [m.row_of("a", "가", "짧은 개요다."), m.row_of("b", "나", None)]
    line = m.stats(rows, 20_940)
    assert "개요 있음 1 (50.0%)" in line and "전량 20940곳 환산" in line
