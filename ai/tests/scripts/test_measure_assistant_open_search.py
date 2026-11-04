"""열린 검색 측정 러너의 **쌍대 판정 집계·실 NL2SQL 고정본** — 실 LLM·임베딩·HTTP·DB 0. 판정(`judge`)·고정본(`capture-sql`)을 실제로
돌리는 쪽은 유료라 여기서 부르지 않는다(가짜 LLM·가짜 실행기로만).

여기서 묶는 것은 판정 결과를 읽고 세는 규칙이다 — 그쪽이 틀리면 "B 가 이겼다"가 조용히 뒤집힌다.
  ① 못 읽은 판정(본문 비었음·잘림·거절·깨진 JSON·목록 밖 승자)은 '같음'이 아니라 판정 실패다(11-04 사고 — 32판이 전부 '같음'으로 셌다)
  ② 짝마다 두 자리를 다 묻고, 두 자리 판정이 같을 때만 승패·같음으로 센다 — 자리를 바꾸자 바뀐 판정(흔들림)·판정 실패·같은 목록은
     승패에서 빼고, 부호 검정 p 는 승패만으로 낸다. 자리 편향은 낱판에서 첫 자리가 이긴 수로 따로 낸다
  ③ 판정 프롬프트는 두 목록 모든 장소에 같은 참고 설명(개요 → 위키 도입부 → '설명 없음')과 사실 카드를 주고,
     '설명 없음'이 부적합이 아니라고 적는다
  ④ 키는 환경 변수로만 — 없으면 아무것도 읽거나 부르기 전에 멈춘다
  ⑤ 판정자는 사용자가 말한 지역과 장소마다 위치를 본다(반경이 도심으로 좁아진 것이 보이게 — 조건 2a)
  ⑥ SQL 팔(조건 4): 고정본은 운영 NL2SQL 경로(미리 받기 → 핸들러 조회 · 프롬프트·출구 게이트·조회)를 오케스트레이터 순서 그대로 타고,
     게이트가 열린 탐색만 담는다. 모델은 정한 값만(EVAL_SQL_MODEL — 추정하지 않는다), 벤더는 그 모델 그대로. 판정은 그 행을 운영
     핸들러로 되돌려 SQL 팔을 짓고, SQL 이 실패·0건·거르기 뒤 빈 행이면 SQL 팔이 없다 — 그 사례는 (A, B) 로만 센다
  ⑦ 문턱을 고르는 칸(`SQL-B@doc_backed`)은 문턱만이 답을 가르는 사례(검색 OK ∧ 두 가드 통과)만 센다
"""

from __future__ import annotations

import importlib.util
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from trippilot.domain.common import GeoPoint
from trippilot.domain.llm.llm import LlmFeature
from trippilot.domain.poi.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.poi_curation.adapters.pg_place_sql import PlaceRow
from trippilot.ports.llm_port import LlmResponse

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


def test_tally_counts_a_win_only_when_both_positions_agree(mos) -> None:
    def row(name, flip, winner, pair="A-B", identical=False):
        return {"name": name, "rep": 0, "pair": pair, "flip": flip, "winner": winner, "identical": identical}

    rows = [row("c1", False, "left"), row("c1", True, "left"),  # 두 자리 모두 A — A 승
            row("c2", False, "right"), row("c2", True, "right"),  # 두 자리 모두 B — B 승
            row("c3", False, "left"), row("c3", True, "right"),  # 늘 첫 자리가 이겼다 — 흔들림, 승패 아님
            row("c4", False, "="), row("c4", True, "="),  # 같음
            row("c5", False, None), row("c5", True, "left"),  # 한쪽을 못 읽었다 — 판정 실패
            row("c6", False, "=", identical=True), row("c6", True, "=", identical=True),  # 같은 목록 — 판정 안 함
            row("d1", False, None, pair="B-B3")]  # 한 자리뿐(다른 자리 없음) — 판정 실패
    got = mos.tally(rows)
    assert got["A-B"] == {"left": "A", "right": "B", "n": 6, "identical": 1, "left_win": 1, "right_win": 1, "tie": 1,
                          "position_flip": 1, "judge_fail": 1, "sign_p": 1.0,
                          # 낱판 자리 — 첫 자리 승: c1 False·c2 True·c3 둘 = 4, 둘째 자리 승: c1 True·c2 False·c5 True = 3
                          "first_wins": 4, "second_wins": 3, "position_p": round(mos.sign_test_p(4, 3), 4)}
    assert got["B-B3"]["judge_fail"] == 1 and got["B-B3"]["left_win"] == got["B-B3"]["right_win"] == 0
    assert set(got) == {"A-B", "B-B3", "SQL-B"} and got["SQL-B"]["n"] == 0


def test_judge_asks_every_pair_in_both_positions_and_has_no_same_list_control(mos) -> None:
    # A-A(바이트까지 같은 두 목록)는 흔들림을 못 잰다 — 자리 일관성 대조로 바꿨다. SQL-B 는 운영 분기(SQL 행)의 본 비교
    assert mos.JUDGE_PAIRS == (("A", "B"), ("B", "B3"), ("SQL", "B"))
    arms = {"A": [], "B": [], "B3": []}
    jobs = mos.judge_jobs([(("c1",), arms), (("c2",), {**arms, "SQL": []})], 2)
    keys = [(case[0], left, right, rep, flip) for case, _, left, right, rep, flip in jobs]
    assert len(keys) == len(set(keys)) == 2 * 2 * (2 + 3)  # 반복 2 × 두 자리 × (c1 짝 둘 + c2 짝 셋)
    assert {flip for *_, flip in keys} == {False, True}
    assert all((c, l, r, rep, not flip) in keys for c, l, r, rep, flip in keys)
    assert {(c, f"{l}-{r}") for c, l, r, *_ in keys if l == "SQL"} == {("c2", "SQL-B")}  # SQL 팔이 없는 c1 은 (A, B) 로만


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


def test_judge_prompt_shows_the_said_region_and_where_each_place_is(mos) -> None:
    downtown = _poi("시립미술관", "o1", PoiCategory.ART, ("실내",))
    far = replace(_poi("노원 실내놀이터", None, PoiCategory.ACTIVITY), poi_id="uuid-1")
    same = replace(_poi("시립미술관", "o1", PoiCategory.ART, ("실내",)), poi_id="uuid-2")  # SQL 팔의 같은 곳(다른 id·같은 원천 키)
    where = {"p-시립미술관": "서울특별시 중구", "uuid-1": "서울특별시 노원구"}
    prompt = mos.judge_prompt("서울 비 오는 날 실내", [downtown], [same, far], _Kn(), "서울", where)
    assert '사용자가 말한 지역: "서울"' in prompt and "③ 사용자가 말한 지역에 맞는가" in prompt
    refs = prompt.split("[참고")[1]
    assert refs.count("시립미술관") == 1  # 원천 키가 같으면 한 곳 — 같은 자료
    assert "시립미술관 — 분류: 미술 · 태그: 실내 · 위치: 서울특별시 중구 · 설명:" in refs
    assert "노원 실내놀이터 — 분류: 액티비티 · 태그: 없음 · 위치: 서울특별시 노원구 · 설명: 설명 없음" in refs
    assert "③" not in mos.judge_prompt("서울 비 오는 날 실내", [downtown], [far], _Kn())  # 지역을 안 넘기면 종전 그대로


class _FakeLlm:
    """DIALOGUE_SQL 대역 — 차례로 정해 둔 본문을 돌려주고 받은 요청을 남긴다."""

    def __init__(self, *texts: str) -> None:
        self.texts, self.requests = list(texts), []

    def invoke(self, request):
        self.requests.append(request)
        return LlmResponse(raw_text=self.texts.pop(0), input_tokens=1, output_tokens=1, latency_ms=1, model_id=request.model_id)


class _FakeExecutor:
    def __init__(self, by_region: dict[str, list[PlaceRow]]) -> None:
        self.by_region, self.sqls = by_region, []

    def run(self, sql: str) -> list[PlaceRow]:
        self.sqls.append(sql)
        return next((rows for region, rows in self.by_region.items() if region in sql), [])


_BUSAN = [PlaceRow(poi_id="u1", name="부산시립미술관", category="미술", sido="부산광역시", sigungu="해운대구", trending=False,
                   nightlife=False, rich=True),
          PlaceRow(poi_id="u2", name="실내 서핑", category="액티비티", sido="부산광역시", sigungu="수영구", trending=False,
                   nightlife=False),
          PlaceRow(poi_id="u3", name="서울 실내 동물원", category="액티비티", sido="서울특별시", sigungu="마포구", trending=False,
                   nightlife=False)]


def _sql(region: str) -> str:
    return '{"sql": "SELECT poi_id, name FROM poi_public WHERE sido LIKE \'%s%%\' LIMIT 20"}' % region


def test_capture_runs_the_production_nl2sql_path_only_for_open_gate_explores(mos, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("EVAL_SQL_MODEL", "claude-haiku-5-5")
    cases = {c[0]: c for c in mos.CASES}
    picked = [cases[n] for n in ("부산/비", "부산/국밥2", "대조/부산", "제주/비실내", "서울/비")]
    llm = _FakeLlm(_sql("부산"), _sql("제주"), '{"sql": null}')  # 부르는 차례: 부산/비 · 제주/비실내 · 서울/비
    extra = {"u1": ("TOURAPI", "12345", ["실내"]), "u2": ("KAKAO_LOCAL", "777", []), "u3": ("TOURAPI", "555", [])}
    saved = mos.dh._FANOUT_SQL_CAP_S
    doc = mos.capture_sql(tmp_path / "sql.json", llm=llm, executor=_FakeExecutor({"부산": _BUSAN}),
                          enrich=lambda rows: extra, cases=picked)
    assert mos.dh._FANOUT_SQL_CAP_S == saved  # 시한 풀기는 고정본 안에서만
    assert doc == __import__("json").loads((tmp_path / "sql.json").read_text(encoding="utf-8"))
    got = doc["cases"]
    assert {n: e["status"] for n, e in got.items()} == {
        "부산/비": "OK", "부산/국밥2": "SKIPPED", "대조/부산": "SKIPPED", "제주/비실내": "ZERO", "서울/비": "NONE"}
    assert len(llm.requests) == 3 and {r.model_id for r in llm.requests} == {"claude-haiku-5-5"}  # 추천·닫힌 게이트는 안 부른다
    assert '부산에 비 오는 날 실내로 갈 데' in llm.requests[0].prompt  # 운영 프롬프트에 발화가 실린다
    # 오케스트레이터 순서 — 지역 이름 + 장소 찾기 말("갈 데")은 분류와 나란히 발화만으로 미리 받고 핸들러가 그것을 쓴다(인자 없음).
    # 장소 찾기 말이 없는 "체험할 곳"은 핸들러가 분류 인자를 실어 쓴다. 한 사례에 한 번만 쓴다(미리 받은 것을 다시 쓰지 않는다)
    assert "[분류 인자]\n(없음)" in llm.requests[0].prompt and "[분류 인자]\n(없음)" in llm.requests[2].prompt
    assert '[분류 인자]\n{"region": "제주", "theme": "비 오는 날 실내 체험"}' in llm.requests[1].prompt
    assert {n: e["path"] for n, e in got.items() if "path" in e} == {"부산/비": "prefetch", "제주/비실내": "direct", "서울/비": "prefetch"}
    assert mos.psql.PREFETCH_TIMEOUT_S == 6.0  # 미리 받기 시한 풀기도 고정본 안에서만
    assert {r.prompt_ref.feature for r in llm.requests} == {LlmFeature.DIALOGUE_SQL.value}
    assert llm.requests[0].prompt_ref.version == doc["prompt_version"]  # 운영 프롬프트 판 그대로
    busan = got["부산/비"]
    assert busan["sql"].startswith("SELECT poi_id, name FROM poi_public") and busan["error"] is None
    assert [r["poi_id"] for r in busan["rows"]] == ["u1", "u2", "u3"]  # 거르기 전 행 그대로(지역 거르기는 판정이 핸들러로 한다)
    assert {k: busan["rows"][0][k] for k in ("name", "category", "sido", "source_ref", "tags")} == {
        "name": "부산시립미술관", "category": "미술", "sido": "부산광역시", "source_ref": "12345", "tags": ["실내"]}
    assert busan["rows"][1]["source_ref"] is None  # 카카오 숫자 id 는 원천 키로 쓰지 않는다
    assert got["서울/비"]["rows"] is None and got["제주/비실내"]["rows"] == []
    assert doc["model"] == "claude-haiku-5-5" and doc["prompt_version"]
    assert doc["budget_ms"] == {"direct": 2800, "prefetch": 6000} and doc["budget_note"]  # 경로마다 운영 기준이 다르다
    assert doc["paths"] == {"prefetch": 2, "direct": 1} and doc["over_budget"] == []


def test_capture_needs_the_model_and_its_vendor_key_in_the_environment(mos, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(mos, "PgPlaceSql", lambda *_: pytest.fail("키 없이 DB 실행기를 만들었다"))
    monkeypatch.setattr(mos, "_Capturing", lambda *_: pytest.fail("모델·키 없이 조회를 만들었다"))
    monkeypatch.delenv("EVAL_SQL_MODEL", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    with pytest.raises(SystemExit, match="EVAL_SQL_MODEL"):  # 운영 배정은 정본에 없다 — 추정하지 않는다
        mos.capture_sql(tmp_path / "x.json")
    monkeypatch.setenv("EVAL_SQL_MODEL", "claude-haiku-5-5")
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    with pytest.raises(SystemExit, match="ANTHROPIC_API_KEY"):
        mos.capture_sql(tmp_path / "x.json")
    monkeypatch.setenv("EVAL_SQL_MODEL", "gpt-5.6-luna")  # 운영이 GPT 면 그 벤더 그대로 — 키는 OpenAI 것
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(SystemExit, match="OPENAI_API_KEY"):
        mos.capture_sql(tmp_path / "x.json")
    assert not (tmp_path / "x.json").exists()


def test_sql_model_is_the_given_one_only(mos, monkeypatch) -> None:
    monkeypatch.delenv("EVAL_SQL_MODEL", raising=False)
    with pytest.raises(SystemExit, match="EVAL_SQL_MODEL"):
        mos._sql_model()
    monkeypatch.setenv("EVAL_SQL_MODEL", "gpt-5.6-luna")
    assert mos._sql_model() == "gpt-5.6-luna"


def test_capture_writes_with_a_gpt_model_through_the_same_path(mos, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("EVAL_SQL_MODEL", "gpt-5.6-luna")
    cases = {c[0]: c for c in mos.CASES}
    llm = _FakeLlm(_sql("부산"))
    doc = mos.capture_sql(tmp_path / "sql.json", llm=llm, executor=_FakeExecutor({"부산": _BUSAN}), enrich=lambda rows: {},
                          cases=[cases["부산/비"]])
    assert doc["model"] == "gpt-5.6-luna" and [r.model_id for r in llm.requests] == ["gpt-5.6-luna"]
    assert doc["cases"]["부산/비"]["status"] == "OK" and doc["cases"]["부산/비"]["path"] == "prefetch"


def test_threshold_buckets_count_only_cases_the_threshold_alone_decides(mos) -> None:
    def row(name, backed, status, guards, flip, winner):
        return {"name": name, "rep": 0, "pair": "SQL-B", "flip": flip, "winner": winner, "identical": False,
                "doc_backed": backed, "prod_status": status, "guards_ok": guards}

    rows = [row("rain", 3, "OK", True, False, "right"), row("rain", 3, "OK", True, True, "right"),
            row("named", 3, "OK", False, False, "left"), row("named", 3, "OK", False, True, "left"),  # 이름 가드 — 문턱 무관
            row("none", 0, "NO_EVIDENCE", True, False, "left"), row("none", 0, "NO_EVIDENCE", True, True, "left")]
    buckets, skipped = mos.sql_b_by_doc_backed(rows)
    assert set(buckets) == {3} and buckets[3]["right_win"] == 1 and buckets[3]["left_win"] == 0 and buckets[3]["n"] == 1
    assert skipped == ["named", "none"]


@pytest.mark.parametrize(("region", "sql_name", "ok"), [
    ("전주", "전주 하숙영가마솥비빔밥", False),  # SQL 이 이름 낱말('비빔밥')로 맞춘 행 — 문턱을 바꿔도 SQL 이 답
    ("전주", "한옥마을 국수", True),
    ("서울 연남동", "한옥마을 국수", False),  # 표 밖 지역
])
def test_guards_ok_is_the_production_rule_without_the_threshold(mos, region, sql_name, ok) -> None:
    from trippilot.orchestrator.dialogue.dialogue_handlers import HandlerPorts, TaskResult

    name, intent, args, utt, kind = next(c for c in mos.CASES if c[0] == "전주/비빔밥")
    ctx = mos._turn((name, intent, {**args, "region": region}, utt, kind), HandlerPorts(), "g")
    radius = {"status": "OK", "candidates": [{"poi_id": "r1", "name": "반경 식당", "category": "음식", "reason": "음식"}],
              "doc": "NO_EVIDENCE", "doc_backed": 0}  # 상태·근거 수는 보지 않는다 — 문턱만 뺀 판정이다
    sql = {"status": "OK", "candidates": [{"poi_id": "s1", "name": sql_name, "category": "음식", "reason": "음식"}]}
    results = {"explore": TaskResult.ok("explore", radius), "explore_sql": TaskResult.ok("explore_sql", sql)}
    assert mos._guards_ok(ctx, results) is ok
    assert mos._guards_ok(ctx, {"explore": results["explore"]}) is True  # SQL 행이 없으면 가드가 없다


def test_sql_arm_replays_the_rows_through_the_production_handler(mos) -> None:
    cases = {c[0]: c for c in mos.CASES}
    rows = [{**{f: getattr(r, f) for f in mos._ROW_FIELDS}, "source_ref": ref, "tags": tags}
            for r, ref, tags in zip(_BUSAN, ("12345", None, "555"), (["실내"], [], []))]
    arm = mos.sql_answer(cases["부산/비"], {"status": "OK", "rows": rows}, None)
    assert [p.name for p in arm] == ["부산시립미술관", "실내 서핑"]  # 부산 앵커 밖(서울) 행은 운영 핸들러가 거른다
    assert arm[0].source_ref == "12345" and arm[0].tags == ("실내",) and arm[0].category is PoiCategory.ART
    seoul_only = [rows[2]]
    # SQL 팔이 없다 — 반경이 답이라 (A, B) 로 센다: 거르기 뒤 빈 행 · 0건 · NL2SQL 실패 · 추천(반경이 먼저)
    assert mos.sql_answer(cases["부산/비"], {"status": "OK", "rows": seoul_only}, None) is None
    assert mos.sql_answer(cases["부산/비"], {"status": "ZERO", "rows": []}, None) is None
    assert mos.sql_answer(cases["부산/비"], {"status": "NONE", "rows": None}, None) is None
    assert mos.sql_answer(cases["부산/국밥2"], {"status": "OK", "rows": rows}, None) is None


def test_tag_contrast_cases_are_counted_apart_from_wrong_answers(mos) -> None:
    tags = {c[0]: c for c in mos.CASES if c[0].startswith("태그/")}
    assert set(tags) == {"태그/강릉주차카페", "태그/부산아이실내", "태그/제주반려견카페"}
    assert {c[4] for c in tags.values()} == {"tag:주차", "tag:아이동반", None}
    assert all(c[4] not in mos._WRONG_KINDS for c in tags.values())  # 태그 미충족은 오답이 아니다(태그는 방문자 투표라 성기다)
    assert not mos._wrong("tag:주차", _poi("골목 카페", None, PoiCategory.CAFE))
