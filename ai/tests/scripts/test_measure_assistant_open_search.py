"""열린 검색 측정 러너의 **쌍대 판정 집계** — 실 LLM·임베딩·HTTP 0. 판정을 실제로 돌리는 쪽(`judge`)은 유료라 여기서 부르지 않는다.

여기서 묶는 것은 판정 결과를 읽고 세는 규칙이다 — 그쪽이 틀리면 "B 가 이겼다"가 조용히 뒤집힌다.
  ① 못 읽은 판정(본문 비었음·잘림·거절·깨진 JSON·목록 밖 승자)은 '같음'이 아니라 판정 실패다(11-04 사고 — 32판이 전부 '같음'으로 셌다)
  ② 집계는 판정 실패·같음·같은 목록을 승패에서 빼고, 부호 검정 p 는 승패만으로 낸다
  ③ 판정 프롬프트는 두 목록 모든 장소에 같은 참고 설명(개요 → 위키 도입부 → '설명 없음')과 사실 카드를 주고,
     '설명 없음'이 부적합이 아니라고 적는다
  ④ 키는 환경 변수로만 — 없으면 아무것도 읽거나 부르기 전에 멈춘다
"""

from __future__ import annotations

import importlib.util
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from trippilot.domain.common import GeoPoint
from trippilot.domain.poi.poi import DataQuality, Poi, PoiCategory, PoiSource

_SCRIPTS = Path(__file__).resolve().parents[2] / "scripts" / "measure"


@pytest.fixture(scope="module")
def mos():
    with pytest.MonkeyPatch.context() as mp:  # 러너는 로드 때 임베딩 주소를 기본값으로 심는다 — 이 모듈 밖으로 새지 않게
        mp.setenv("TRIPPILOT_EMBEDDING_BASE_URL", "http://localhost:8100")
        mp.syspath_prepend(str(_SCRIPTS))
        spec = importlib.util.spec_from_file_location("measure_assistant_open_search", _SCRIPTS / "measure_assistant_open_search.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        yield module
    sys.modules.pop("measure_assistant_open_search", None)


@pytest.mark.parametrize(("text", "stop"), [
    ("", "max_tokens"),  # 사고가 상한을 먹어 본문이 비었다 — 11-04 사고의 꼴
    ('{"winner": "A", "why": "잘림', "max_tokens"),
    ('{"winner": "A", "why": "x"}', "refusal"),
    ("판정할 수 없습니다", "end_turn"),
    ('{"winner": "C", "why": "x"}', "end_turn"),
    ('["A"]', "end_turn"),
])
def test_unreadable_verdicts_are_failures_not_ties(mos, text, stop) -> None:
    winner, why = mos.read_verdict(text, stop)
    assert winner is None and why.startswith("판정 실패")


@pytest.mark.parametrize(("text", "winner"), [
    ('{"winner": "A", "why": "비 오는 날 실내가 앞"}', "A"),
    ('생각해 보면 {"winner": "B", "why": "x"} 입니다', "B"),
    ('{"winner": "같음", "why": "우열 없음"}', "="),
])
def test_readable_verdicts(mos, text, winner) -> None:
    assert mos.read_verdict(text, "end_turn")[0] == winner


def test_sign_test_is_two_sided_over_wins_and_losses_only(mos) -> None:
    assert mos.sign_test_p(0, 0) == 1.0 and mos.sign_test_p(5, 5) == 1.0
    assert mos.sign_test_p(10, 0) == pytest.approx(2 / 1024) == mos.sign_test_p(0, 10)
    assert mos.sign_test_p(8, 2) == pytest.approx(2 * (1 + 10 + 45) / 1024)


def test_tally_keeps_failures_ties_and_identical_lists_out_of_the_win_count(mos) -> None:
    def row(pair, winner, identical=False):
        return {"pair": pair, "winner": winner, "identical": identical}

    rows = [row("A-B", "right"), row("A-B", "right"), row("A-B", "left"), row("A-B", "="), row("A-B", None),
            row("A-B", "=", identical=True), row("A-A", "left"), row("A-A", None), row("B-B3", None)]
    got = mos.tally(rows)
    assert got["A-B"] == {"left": "A", "right": "B", "n": 6, "identical": 1, "left_win": 1, "right_win": 2, "tie": 1,
                          "judge_fail": 1, "sign_p": 1.0}
    assert got["A-A"]["left_win"] == 1 and got["A-A"]["judge_fail"] == 1 and got["A-A"]["tie"] == 0
    assert got["B-B3"]["judge_fail"] == 1 and got["B-B3"]["left_win"] == got["B-B3"]["right_win"] == 0
    assert set(got) == {"A-B", "A-A", "B-B3"}


def _poi(name: str, ref: str | None, category: PoiCategory, tags: tuple[str, ...] = ()) -> Poi:
    return replace(Poi(poi_id=f"p-{name}", name=name, category=category, coord=GeoPoint(37.5, 127.0), open_hours=(), avg_cost=None,
                       rating=None, quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None, tags=tags), source_ref=ref)


class _Kn:
    rows = {"place_corpus_overview.jsonl.gz": {"o1": {"sections": [{"text": "비 오는 날에도  좋은 실내 미술관"}]}},
            "place_corpus_wiki.jsonl.gz": {"o1": {"sections": [{"text": "위키 도입부(개요가 먼저라 안 쓰인다)"}]},
                                           "w1": {"sections": [{"text": "숲길이 이어진 공원"}, {"text": "둘째 단락"}]}}}


def test_judge_prompt_gives_every_place_the_same_reference_and_says_no_doc_is_not_unfit(mos) -> None:
    museum = _poi("시립미술관", "o1", PoiCategory.ART, ("실내",))
    park = _poi("낙산공원", "w1", PoiCategory.NATURE, ("야외",))
    cafe = _poi("골목 카페", None, PoiCategory.CAFE)
    prompt = mos.judge_prompt("서울 비 오는 날 실내 갈 만한 곳", [park, museum], [museum, cafe], _Kn())
    assert '"서울 비 오는 날 실내 갈 만한 곳"' in prompt
    assert "[목록 A]\n1. 낙산공원 (자연)\n2. 시립미술관 (미술)" in prompt and "[목록 B]\n1. 시립미술관 (미술)\n2. 골목 카페 (카페)" in prompt
    refs = prompt.split("[참고")[1]
    assert refs.count("시립미술관") == 1  # 두 목록에 다 나온 곳도 한 번 — 같은 자료
    assert "시립미술관 — 분류: 미술 · 태그: 실내 · 설명: 비 오는 날에도 좋은 실내 미술관" in refs  # 개요 먼저
    assert "낙산공원 — 분류: 자연 · 태그: 야외 · 설명: 숲길이 이어진 공원" in refs and "둘째 단락" not in refs  # 위키는 도입부만
    assert "골목 카페 — 분류: 카페 · 태그: 없음 · 설명: 설명 없음" in refs
    assert "'설명 없음'은 자료가 없다는 뜻일 뿐 그곳이 부적합하다는 뜻이 아닙니다" in prompt


def test_judge_needs_the_key_in_the_environment_and_a_claude_judge(mos, monkeypatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(mos, "_Knowledge", lambda: pytest.fail("키 없이 재료를 읽기 시작했다"))
    with pytest.raises(SystemExit, match="ANTHROPIC_API_KEY"):
        mos.judge(1)
    monkeypatch.setattr(mos, "JUDGE", "gpt-5.6-terra")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    with pytest.raises(SystemExit, match="Claude"):
        mos.judge(1)
    assert mos.JUDGE_PAIRS == (("A", "B"), ("A", "A"), ("B", "B3"))
