"""DIALOGUE_SQL — 출구 게이트 허용 목록·워커 변수·실행기 감싸기.

  ① 장소 조회 SELECT 는 통과한다(지역·종류·태그·정렬·LIMIT)
  ② 허용 목록 밖은 하나라도 있으면 통째로 버린다 — 다른 표·스키마·함수·주석·세미콜론·형변환·따옴표 식별자·달러 인용·부질의·UNION·별칭
  ③ 속성: 위험 조각을 아무 데나 끼운 SQL 은 절대 통과하지 않는다 / 문법으로 만든 정상 SELECT 는 늘 통과한다
  ④ null·빈 문자열 = 성공·0건(반경 탐색으로), 깨진 JSON·탈락 = 실패(폴백 계측)
  ⑤ 워커 변수는 결정론이고 발화·인자를 한 줄로 누른다
  ⑥ 실행기는 READ ONLY·시한·행 상한으로 감싸고, 보여 줄 칸만 돌려준다
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trippilot.domain.common import TraceId
from trippilot.domain.llm.llm import LlmFeature
from trippilot.llm_gateway.gates.dialogue.dialogue_sql import MAX_LIMIT, DialogueSqlGate, check_select
from trippilot.llm_gateway.workers.dialogue.dialogue_sql import build_dialogue_sql_vars
from trippilot.poi_curation.adapters.pg_place_sql import ROW_CAP, STATEMENT_TIMEOUT_MS, PgPlaceSql

_NOW = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)
_TID = TraceId("t-sql")

_OK = (
    "SELECT poi_id, name FROM poi_public WHERE sido LIKE '서울%' ORDER BY saved_count DESC LIMIT 20",
    "select * from poi_public where category in ('명소','문화','자연') limit 5",
    "SELECT poi_id, name FROM poi_public WHERE sigungu = '종로구' AND tags && ARRAY['박물관','전시관']",
    "SELECT poi_id, name FROM poi_public WHERE address LIKE '%성수%' AND NOT category = '맛집' "
    "ORDER BY ('요즘 인기' = ANY(tags)) DESC, saved_count DESC NULLS LAST LIMIT 10",
    "SELECT DISTINCT poi_id, name FROM poi_public WHERE name ILIKE '%it''s%' AND saved_count BETWEEN 1 AND 100",
)

_BAD = (
    "SELECT poi_id FROM poi_public; DROP TABLE poi",
    "SELECT poi_id FROM app.poi",
    "SELECT poi_id FROM poi",
    "SELECT poi_id FROM pg_catalog.pg_user",
    "SELECT poi_id FROM poi_public WHERE pg_sleep(10) IS NULL",
    "SELECT poi_id FROM poi_public WHERE lower(name) = 'a'",
    "SELECT poi_id FROM poi_public UNION SELECT poi_id FROM poi_public",
    "SELECT poi_id FROM (SELECT poi_id FROM poi_public) q",
    "WITH x AS (SELECT 1) SELECT poi_id FROM poi_public",
    "SELECT poi_id FROM poi_public -- 주석",
    "SELECT poi_id FROM poi_public /* 주석 */",
    "SELECT name FROM poi_public",
    "SELECT name AS poi_id FROM poi_public",
    "SELECT poi_id FROM poi_public LIMIT 500",
    "SELECT poi_id FROM poi_public LIMIT 5 OFFSET 1",
    "SELECT poi_id FROM poi_public WHERE name = 'a'::text",
    'SELECT "poi_id" FROM poi_public',
    "SELECT poi_id FROM poi_public WHERE name = $$a$$",
    "SELECT poi_id FROM poi_public WHERE name = E'\\x41'",
    "SELECT poi_id FROM poi_public, poi_public",
    "SELECT poi_id FROM poi_public WHERE 이름 = 'a'",
    "DELETE FROM poi_public",
    "UPDATE poi_public SET name = 'x'",
    "SELECT poi_id FROM poi_public FOR UPDATE",
    "SELECT poi_id INTO x FROM poi_public",
    "SELECT poi_id FROM poi_public WHERE source_ref = 'x'",  # 뷰에 없는 열
    "",
    "SELECT poi_id FROM poi_public WHERE name = '" + "a" * 900 + "'",
)


@pytest.mark.parametrize("sql", _OK)
def test_place_lookup_selects_pass(sql: str) -> None:
    assert check_select(sql) is None


@pytest.mark.parametrize("sql", _BAD)
def test_anything_outside_the_allowlist_is_rejected_whole(sql: str) -> None:
    assert check_select(sql) is not None


_DANGER = st.sampled_from([
    ";", "--", "/*", "::", '"', "$$", "\\", ".", "drop", "insert", "update", "delete", "pg_sleep(1)", "union",
    "pg_catalog", "information_schema", "app", "poi", "copy", "grant", "set", "into", "join", "with", "as", "current_user",
    "now()", "version()", "lo_import", "dblink",
])


@given(base=st.sampled_from(_OK), danger=_DANGER, at=st.integers(min_value=0, max_value=400))
def test_a_dangerous_fragment_anywhere_outside_a_string_never_passes(base: str, danger: str, at: int) -> None:
    # 문자열 리터럴 안이면 그냥 글자다 — 그 밖의 경계(공백)에만 끼운다
    cuts = [i for i, ch in enumerate(base) if ch == " " and base[:i].count("'") % 2 == 0]
    pos = cuts[at % len(cuts)]
    assert check_select(f"{base[:pos]} {danger} {base[pos:]}") is not None


_COL = st.sampled_from(["name", "category", "sido", "sigungu", "address"])
_LIT = st.text(alphabet="서울강남카페명소 %_'", min_size=1, max_size=8).map(lambda s: "'" + s.replace("'", "''") + "'")
_COND = st.one_of(
    st.tuples(_COL, st.sampled_from(["=", "<>", "LIKE", "ILIKE"]), _LIT).map(" ".join),
    _LIT.map(lambda v: f"{v} = ANY(tags)"),
    st.lists(_LIT, min_size=1, max_size=3).map(lambda vs: f"tags && ARRAY[{','.join(vs)}]"),
    st.integers(0, 999).map(lambda n: f"saved_count >= {n}"),
)


@given(conds=st.lists(_COND, min_size=0, max_size=3), join=st.sampled_from([" AND ", " OR "]),
       order=st.sampled_from(["", " ORDER BY saved_count DESC", " ORDER BY name ASC"]),
       limit=st.one_of(st.none(), st.integers(1, MAX_LIMIT)))
def test_grammar_made_place_selects_always_pass(conds, join, order, limit) -> None:
    where = f" WHERE {join.join(conds)}" if conds else ""
    sql = f"SELECT poi_id, name FROM poi_public{where}{order}" + (f" LIMIT {limit}" if limit else "")
    assert check_select(sql) is None, sql


def _gate(raw: object):
    text = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    return DialogueSqlGate().apply(text, None, feature=LlmFeature.DIALOGUE_SQL, trace_id=_TID, now=_NOW)


def test_gate_passes_a_checked_select_and_drops_one_trailing_semicolon() -> None:
    out = _gate({"sql": _OK[0] + ";"})
    assert out.error is None and out.value == _OK[0] and out.drop_event is None


@pytest.mark.parametrize("raw", [{"sql": None}, {"sql": "  "}])
def test_null_sql_is_success_with_nothing_to_run(raw) -> None:
    out = _gate(raw)
    assert out.error is None and out.value == ""


def test_rejected_sql_is_a_failure_with_a_drop_event_and_no_sql_in_the_label() -> None:
    out = _gate({"sql": "SELECT poi_id FROM app.poi WHERE name = '비밀'"})
    assert out.value == "" and out.error == "sql_rejected: bad_char" and out.drop_event.dropped_count == 1
    assert "비밀" not in out.error


@pytest.mark.parametrize("raw", ["not json", {"query": "SELECT 1"}, {"sql": 3}])
def test_broken_output_is_a_parse_error(raw) -> None:
    assert _gate(raw).error.startswith("parse_error")


def test_every_sql_example_in_the_prompt_passes_the_gate() -> None:
    """모델은 프롬프트 예시 꼴을 그대로 따라 쓴다 — 예시에 허용 목록 밖 낱말이 섞이면 그 꼴의 말이 전부 게이트에서 떨어진다(0.2.3 야경 예시 포함)."""
    text = (Path(__file__).resolve().parents[3] / "prompts" / "dialogue_sql.yaml").read_text(encoding="utf-8")
    examples = re.findall(r'→ (\{"sql": "[^\n]+\})', text)
    assert any("category = '야경'" in raw for raw in examples)  # 야경은 표지가 아니라 종류
    for raw in examples:
        out = _gate(raw)
        assert out.error is None and out.value, raw


def test_worker_vars_are_one_line_and_keep_only_explore_args() -> None:
    v = build_dialogue_sql_vars("서울\n요즘 핫한 곳", {"region": "서울", "theme": "요즘\n핫한", "date": "내일"})
    assert "\n" not in v["utterance"] and json.loads(v["args"]) == {"region": "서울", "theme": "요즘 핫한"}
    assert v == build_dialogue_sql_vars("서울\n요즘 핫한 곳", {"region": "서울", "theme": "요즘\n핫한", "date": "내일"})
    assert build_dialogue_sql_vars("", {})["args"] == "(없음)"


class _Cursor:
    def __init__(self, log: list, rows: list) -> None:
        self.log, self.rows = log, rows

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        return None

    def execute(self, sql: str, params=None) -> None:
        self.log.append((sql, params))

    def fetchall(self):
        return self.rows.pop(0)


class _Conn:
    def __init__(self, rows: list) -> None:
        self.log: list = []
        self.rows = rows
        self.rolled_back = False

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        return None

    def cursor(self):
        return _Cursor(self.log, self.rows)

    def rollback(self) -> None:
        self.rolled_back = True


def test_executor_wraps_read_only_with_timeout_and_cap_and_returns_only_display_fields() -> None:
    conn = _Conn([[("b",), ("a",), ("b",)],
                  [("a", "경복궁", "명소", "서울특별시", "종로구", ["요즘 인기", "역사관광지"], True),
                   ("b", "클럽 X", "야경", "서울특별시", "마포구", ["술집"], False)]])
    rows = PgPlaceSql(lambda: conn).run(_OK[0])
    statements = [s for s, _ in conn.log]
    assert statements[0] == "SET TRANSACTION READ ONLY"
    assert statements[1] == f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"
    assert statements[2] == f"SELECT q.poi_id FROM ({_OK[0]}) AS q LIMIT {ROW_CAP}" and conn.log[2][1] is None  # 모델 SQL 엔 인자 없음
    assert conn.log[3][1] == (["b", "a"],) and conn.rolled_back
    # 칸 조회는 uuid 같음으로 — `poi_id::text` 로 견주면 보안 장벽 뷰가 모든 행의 태그를 만든 뒤 거른다(로컬 85ms → 0.2ms)
    assert statements[3].endswith("WHERE poi_id = ANY(%s::uuid[])")
    # 모델 순서는 b, a 지만 '요즘 인기'·정보 충실한 a 가 앞으로(안정 정렬)
    assert [(r.poi_id, r.name, r.trending, r.nightlife) for r in rows] == [("a", "경복궁", True, False), ("b", "클럽 X", False, True)]
    assert set(rows[0].__slots__) == {"poi_id", "name", "category", "sido", "sigungu", "trending", "nightlife", "rich"}  # 주소·저장 수·태그 원문은 안 나간다


def test_executor_with_no_ids_skips_the_second_query_and_still_rolls_back() -> None:
    conn = _Conn([[]])
    assert PgPlaceSql(lambda: conn).run(_OK[1]) == [] and len(conn.log) == 3 and conn.rolled_back


def test_executor_keeps_the_model_order_when_it_ends_with_both_signals_else_puts_trending_first() -> None:
    """성격 표지를 맨 앞에 둔 모델 정렬('뷰' → '요즘 인기' → … → rich)은 그대로 — 다시 '요즘 인기' 먼저로 덮으면 표지 없는 인기 장소가
    앞자리를 채운다("서울 경치 좋은 곳" 맨 앞에 미술관, 2026-11-04 개발). 정렬 끝을 빠뜨린 SQL 만 코드가 '요즘 인기' → rich 로 지킨다(#1500)."""
    head = "SELECT poi_id, name FROM poi_public WHERE sido LIKE '서울%' AND category IN ('명소','자연') ORDER BY ('뷰' = ANY(tags)) DESC, "
    view, museum = (("v", "인왕산 수성동계곡", "명소", "서울특별시", "종로구", ["뷰"], False),
                    ("m", "서울시립미술관", "문화", "서울특별시", "중구", ["요즘 인기"], True))

    def ids(sql: str) -> list[str]:
        return [r.poi_id for r in PgPlaceSql(lambda: _Conn([[("v",), ("m",)], [museum, view]])).run(sql)]

    assert ids(head + "('요즘 인기' = ANY(tags)) DESC, saved_count DESC, rich DESC, poi_id LIMIT 20") == ["v", "m"]
    assert ids(head + "('요즘 인기' = ANY(tags)) DESC, saved_count DESC LIMIT 20") == ["m", "v"]  # rich 를 빠뜨렸다
    assert ids(head + "saved_count DESC, rich DESC, poi_id LIMIT 20") == ["m", "v"]  # '요즘 인기'를 빠뜨렸다
    assert ids("SELECT poi_id, name FROM poi_public WHERE sido LIKE '서울%' LIMIT 20") == ["m", "v"]  # 정렬이 없다


def _name_conn(hits: list[tuple]) -> _Conn:
    """find_by_name 용 — 첫 조회는 id 만, 둘째 조회가 그 id 의 칸(맞은 곳이 없으면 둘째 조회 없음)."""
    return _Conn([[(h[0],) for h in hits], hits])


def _hit(pid: str, sido: str, sigungu: str = "종로구", rich: bool = True, category: str = "쇼핑") -> tuple:
    return (pid, "광장시장", category, sido, sigungu, [], rich)


@pytest.mark.parametrize("hits,sido,expected", [
    ([_hit("a", "서울특별시")], "서울", "a"),  # 한 곳
    ([_hit("a", "서울특별시"), _hit("b", "부산광역시")], "서울", "a"),  # 여럿이면 여행 시·도로 좁힌다
    # 광주 여행 — 통합 특별시('전남광주통합특별시')의 광주 다섯 구가 지역 안이다. 앞글자 대조는 지역 안을 못 찾아 정보 충실한 여수 쪽을 골랐다
    ([_hit("a", "전남광주통합특별시", "여수시"), _hit("b", "전남광주통합특별시", "동구", rich=False)], "광주", "b"),
    ([_hit("a", "경기도", "광주시"), _hit("b", "전남광주통합특별시", "동구", rich=False)], "광주", "b"),  # 시·도 이름은 시·도로만
    ([_hit("a", "서울특별시"), _hit("b", "서울특별시")], "서울", None),  # 그래도 여럿(체인점) — 고르지 않는다
    ([_hit("a", "서울특별시"), _hit("b", "부산광역시")], None, None),  # 좁힐 지역이 없으면 고르지 않는다
    # 같은 이름 사업자 등록 사이에서 정보 충실(rich)한 곳이 하나뿐이면 그곳 — "경복궁"(서울 9곳 중 관광지 하나만 rich)
    ([_hit("a", "서울특별시"), _hit("b", "서울특별시", rich=False), _hit("c", "서울특별시", rich=False)], "서울", "a"),
    ([_hit("a", "서울특별시"), _hit("b", "서울특별시", rich=False)], None, "a"),  # 여행이 없어도
    ([_hit("a", "서울특별시"), _hit("b", "부산광역시", rich=False)], "제주", "a"),  # 다른 지역 여행 중에 물어도
    ([_hit("a", "서울특별시", rich=False), _hit("b", "서울특별시", rich=False)], "서울", None),  # 다 빈약하면 고르지 않는다
    ([_hit("a", "서울특별시", rich=False), _hit("b", "서울특별시", rich=False), _hit("c", "부산광역시")], "서울", None),
    ([], "서울", None),
    # 그래도 여럿이면 관광 종류가 하나뿐일 때 그곳 — 여행 없이 "경복궁"(궁궐·울산 식당 둘 다 rich, 2026-11-02 개발 DB)
    ([_hit("a", "울산광역시", "남구", category="맛집"), _hit("b", "서울특별시", category="명소")], None, "b"),
    ([_hit("a", "서울특별시", rich=False, category="명소"), _hit("b", "서울특별시", rich=False, category="맛집")], None, "a"),
    ([_hit("a", "서울특별시", category="명소"), _hit("b", "부산광역시", category="자연")], None, None),  # 관광지끼리면 고르지 않는다
    # rich 가 둘 이상이면 rich 안에서만 — 빈약한 관광지를 rich 둘보다 앞세우지 않는다
    ([_hit("a", "서울특별시", category="맛집"), _hit("b", "부산광역시", category="카페"), _hit("c", "서울특별시", rich=False, category="명소")],
     None, None),
])
def test_find_by_name_is_exact_and_never_guesses_among_many(hits, sido, expected) -> None:
    conn = _name_conn(hits)
    found = PgPlaceSql(lambda: conn).find_by_name("광장 시장", sido)
    assert (found.poi_id if found else None) == expected and conn.rolled_back
    sql, params = conn.log[2]
    assert "replace(name, ' ', '') = %(key)s" in sql and "ILIKE" not in sql and params["key"] == "광장시장"  # 완전 일치만
    # 이름으로 거르는 조회는 id 만 — 칸(태그)까지 고르면 보안 장벽 뷰가 모든 행의 태그를 만든 뒤 거른다(로컬 80ms → 11ms)
    assert sql.startswith("SELECT poi_id FROM poi_public ")
    assert len(conn.log) == (4 if hits else 3)
    if hits:
        assert conn.log[3] == ("SELECT poi_id::text, name, category, sido, sigungu, tags, rich FROM poi_public"
                               " WHERE poi_id = ANY(%s::uuid[])", ([h[0] for h in hits],))


def test_find_by_name_skips_one_letter_names_without_a_query() -> None:
    conn = _name_conn([])
    assert PgPlaceSql(lambda: conn).find_by_name(" 가 ", "서울") is None and conn.log == []



def test_executor_puts_rich_places_before_bare_registrations_but_keeps_model_order_otherwise() -> None:
    def row(pid, rich):
        return (pid, pid, "카페", "서울특별시", "강남구", [], rich)

    conn = _Conn([[("c",), ("b",), ("a",), ("d",)], [row("a", True), row("b", False), row("c", False), row("d", True)]])
    rows = PgPlaceSql(lambda: conn).run(_OK[0])
    assert [r.poi_id for r in rows] == ["a", "d", "c", "b"]  # 정보 충실(a·d)이 먼저, 그 안·그 밖은 모델 순서(c→b→a→d)


def test_rich_column_is_allowed_in_place_selects() -> None:
    assert check_select("SELECT poi_id FROM poi_public WHERE category = '카페' ORDER BY saved_count DESC, rich DESC LIMIT 20") is None



def test_find_by_name_narrows_by_a_city_inside_a_province_too() -> None:
    # 강릉 여행 — 시·도("강원특별자치도")가 아니라 구·군("강릉시")이 지역 표 이름으로 시작한다
    conn = _name_conn([_hit("a", "강원특별자치도", "강릉시"), _hit("b", "강원특별자치도", "속초시")])
    found = PgPlaceSql(lambda: conn).find_by_name("광장시장", "강릉")
    assert found is not None and found.poi_id == "a"
    assert "sigungu LIKE %(area)s" in conn.log[2][0] and conn.log[2][1]["area"] == "강릉%"


def test_find_by_name_orders_a_sido_area_like_in_sido_so_gyeonggi_gwangju_is_not_put_first() -> None:
    """SQL 선순위 술어는 `_pick_one` 의 지역 안 판정과 같아야 한다 — 다르면 LIMIT 에 잘리는 쪽이 지역 안 행이다.
    종전 `sido LIKE OR sigungu LIKE '광주%'` 는 경기 광주시를 앞세우고 통합 특별시의 광주 다섯 구는 못 잡았다(리뷰 1109)."""
    from trippilot.domain.poi.region_centers import GWANGJU_GU, MERGED_SIDO

    conn = _name_conn([_hit("a", "경기도", "광주시"), _hit("b", MERGED_SIDO, "동구", rich=False)])
    PgPlaceSql(lambda: conn).find_by_name("광장시장", "광주")
    sql, params = conn.log[2]
    order = sql.split("ORDER BY", 1)[1]
    assert "sigungu LIKE" not in order  # 구·군 앞글자 '광주%' 가 경기 광주시를 앞세웠다
    assert "sido LIKE %(area)s" in order and "(sido = %(merged)s AND sigungu = ANY(%(gu)s::text[]))" in order
    assert params["area"] == "광주%" and params["merged"] == MERGED_SIDO and set(params["gu"]) == GWANGJU_GU


def test_rows_by_ids_is_one_read_only_primary_key_query_and_skips_empty_input() -> None:
    """미리 찾기의 지역 조회 — 우리가 쓴 매개변수 SQL 한 번, 칸 조회와 같은 uuid 같음(기본키 색인)."""
    conn = _Conn([[_hit("a", "부산광역시", "기장군")]])
    rows = PgPlaceSql(lambda: conn).rows(("a",))
    assert [(r.poi_id, r.sido, r.sigungu) for r in rows] == [("a", "부산광역시", "기장군")] and conn.rolled_back
    assert [s for s, _ in conn.log][:2] == ["SET TRANSACTION READ ONLY", f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"]
    assert conn.log[2] == ("SELECT poi_id::text, name, category, sido, sigungu, tags, rich FROM poi_public"
                           " WHERE poi_id = ANY(%s::uuid[])", (["a"],))
    empty = _Conn([])
    assert PgPlaceSql(lambda: empty).rows(()) == [] and empty.log == []
