"""F9 — 편집 번역의 풀 밖 이름 장소: 등록 장소 이름 조회(`PgPlaceSql.find_said`)와 말마다 한 곳 고르기(`pick_said`).

증명하는 것 (실 DB 0 — 가짜 연결):
  ① 읽기 전용·문장 시한·매개변수 SQL 한 번(LLM 없음) — 말은 배열 인자로만 간다(SQL 문자열에 섞이지 않는다)
  ② 세 꼴 — 이름 그대로 · 지역 접두를 뗀 꼴("서귀포 하논분화구" ↔ "하논분화구") · 지점 접미를 뗀 꼴("고집돌우럭 중문점" ↔ "고집돌우럭")
  ③ 고르기 — 이름 그대로가 이긴다 · 같은 이름 여럿은 도우미 이름 찾기 규칙(rich·관광 종류 하나) · 지점 여럿은 고르지 않는다 ·
     부르는 쪽이 거른 id(거리·자격) 밖은 보지 않는다 · 상한에 잘렸으면 뗀 꼴을 믿지 않는다
"""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from tests.fakes.fake_place_db import said_sql
from trippilot.poi_curation.adapters.pg_place_sql import (
    SAID_CAP,
    STATEMENT_TIMEOUT_MS,
    PgPlaceSql,
    PlaceRow,
    pick_said,
    said_matches,
)


class _Cursor:
    def __init__(self, conn) -> None:
        self._conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        return None

    def execute(self, sql: str, params=None) -> None:
        self._conn.log.append((sql, params))

    def fetchall(self):
        return self._conn.results.pop(0)


class _Conn:
    """fetchall 마다 정해진 결과를 차례로 — 첫 조회(id)·둘째 조회(칸)."""

    def __init__(self, results: list[list]) -> None:
        self.log: list = []
        self.results = results
        self.rolled_back = False

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        return None

    def cursor(self):
        return _Cursor(self)

    def rollback(self) -> None:
        self.rolled_back = True


def _row(pid: str, name: str, *, category: str = "명소", sido: str = "제주특별자치도", sigungu: str = "서귀포시",
         rich: bool = True) -> PlaceRow:
    return PlaceRow(poi_id=pid, name=name, category=category, sido=sido, sigungu=sigungu, trending=False,
                    nightlife=False, rich=rich)


# ── ① 조회 ──────────────────────────────────────────────────────────────


def test_find_said_reads_ids_then_columns_in_one_read_only_transaction() -> None:
    """말 → id(첫 조회, 순서 = 이름 그대로 먼저) → 칸(둘째 조회, id 로 — 장벽 아래 기본키 색인). 순서는 첫 조회 그대로, 그 사이 사라진 id 는 뺀다."""
    row_a = ("a", "서귀포 하논분화구", "자연", "제주특별자치도", "서귀포시", ["요즘 인기"], True)
    row_b = ("b", "하논분화구", "자연", "제주특별자치도", "서귀포시", [], False)
    conn = _Conn([[("b",), ("a",), ("gone",)], [row_a, row_b]])
    rows = PgPlaceSql(lambda: conn).find_said(("하논분화구",), ("하논 분화구",))
    statements = [s for s, _ in conn.log]
    assert statements[0] == "SET TRANSACTION READ ONLY"
    assert statements[1] == f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"
    sql, params = conn.log[2]
    assert params == {"words": ["하논분화구"], "spans": ["하논 분화구"]}
    assert "하논" not in sql  # 말은 인자로만 — SQL 문자열에 섞이지 않는다
    assert sql.startswith("SELECT poi_id FROM poi_public WHERE")  # 첫 조회는 id 만 — 뷰가 모든 행의 칸을 만들지 않게
    assert "= ANY(%(words)s::text[])" in sql and "= ANY(%(spans)s::text[])" in sql and sql.endswith(f"LIMIT {SAID_CAP + 1}")
    assert conn.log[3] == ("SELECT poi_id::text, name, category, sido, sigungu, tags, rich FROM poi_public "
                           "WHERE poi_id = ANY(%s::uuid[])", (["b", "a", "gone"],))
    assert [(r.poi_id, r.name, r.trending) for r in rows] == [("b", "하논분화구", False), ("a", "서귀포 하논분화구", True)]
    assert conn.rolled_back


def test_find_said_without_words_skips_the_query_and_without_ids_skips_the_second() -> None:
    conn = _Conn([])
    assert PgPlaceSql(lambda: conn).find_said((), ()) == [] and conn.log == []
    conn = _Conn([[]])
    assert PgPlaceSql(lambda: conn).find_said(("효창공원",), ()) == [] and len(conn.log) == 3 and conn.rolled_back


# ── ② 세 꼴 ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("name", "words", "spans", "expected"), [
    ("효창공원", {"효창공원"}, set(), [("효창공원", 0)]),
    ("사라오름 전망대", {"사라오름전망대"}, set(), [("사라오름전망대", 0)]),  # 한 낱말 말은 이름의 띄어쓰기를 무시
    ("사라오름 전망대", set(), {"사라오름 전망대"}, [("사라오름 전망대", 0)]),  # 여러 낱말 말은 띄어쓰기 그대로
    ("내일카페", set(), {"내일 카페"}, []),  # 이름에 없는 띄어쓰기를 건너 붙이지 않는다
    ("서귀포 하논분화구", {"하논분화구"}, set(), [("하논분화구", 1)]),  # 지역 표 이름 접두
    ("양평 두물머리", {"두물머리"}, set(), [("두물머리", 1)]),  # 표 밖이어도 그 행의 구·군(양평군)이면 지역 접두
    ("카페 하논분화구", {"하논분화구"}, set(), []),  # 맨 앞 낱말이 지역이 아니면 떼지 않는다
    ("고집돌우럭 중문점", {"고집돌우럭"}, set(), [("고집돌우럭", 2)]),  # 지점 접미
    ("고집돌우럭 중문점", set(), {"고집돌우럭 중문점"}, [("고집돌우럭 중문점", 0)]),
    ("고집돌우럭 중문", {"고집돌우럭"}, set(), []),  # '…점' 이 아니면 지점이 아니다
    ("Cafe KNOTTED", {"cafeknotted"}, set(), [("cafeknotted", 0)]),  # 말은 소문자다(워커 `_spoken` 과 같은 꼴)
])
def test_said_matches_three_forms(name, words, spans, expected) -> None:
    sigungu = "양평군" if name.startswith("양평") else "서귀포시"
    sido = "경기도" if name.startswith("양평") else "제주특별자치도"
    assert said_matches(_row("x", name, sido=sido, sigungu=sigungu), words, spans) == expected


_VOCAB = ("서귀포", "하논분화구", "고집돌우럭", "중문점", "본점", "카페", "효창공원", "서울", "Cafe", "점")


@given(st.lists(st.sampled_from(_VOCAB), min_size=1, max_size=4),
       st.lists(st.lists(st.sampled_from(_VOCAB), min_size=1, max_size=3), max_size=4))
def test_pbt_python_matches_agree_with_the_sql_prefilter(name_words: list[str], said: list[list[str]]) -> None:
    """두 셈이 어긋나지 않는다 — SQL(`said_sql`, 문자열 함수 그대로)이 돌려주지 않는 행을 `said_matches` 가 맞다고 보지 않고, '이름
    그대로'(ORDER BY 첫 키 · 잘림 판정)도 같다. SQL 은 지역 접두가 정말 지역인지 안 보는 거름망이라 넓기만 하다."""
    words = {"".join(w).lower() for w in said if len(w) == 1}
    spans = {" ".join(w).lower() for w in said if len(w) > 1}
    name = " ".join(name_words)
    matches = said_matches(_row("x", name), words, spans)
    returned, exact = said_sql(name, words, spans)
    assert returned or not matches
    assert exact == any(tier == 0 for _, tier in matches)


# ── ③ 고르기 ────────────────────────────────────────────────────────────


def _ids(rows, words=(), spans=(), usable=None, **kw) -> tuple[str, ...]:
    usable = {r.poi_id for r in rows} if usable is None else usable
    return pick_said(rows, usable, set(words), set(spans), **kw)


def test_exact_name_wins_over_cut_forms() -> None:
    rows = [_row("a", "효창공원"), _row("b", "서울 효창공원", sido="서울특별시", sigungu="용산구")]
    assert _ids(rows, words=("효창공원",)) == ("a",)


def test_region_prefixed_registration_is_found_by_its_core_name() -> None:
    assert _ids([_row("a", "서귀포 하논분화구")], words=("하논분화구",)) == ("a",)


def test_one_branch_is_found_but_many_branches_are_not_guessed() -> None:
    one = [_row("a", "고집돌우럭 중문점", category="맛집")]
    many = [*one, _row("b", "고집돌우럭 제주공항점", category="맛집", sigungu="제주시")]
    assert _ids(one, words=("고집돌우럭",)) == ("a",)
    assert _ids(many, words=("고집돌우럭",)) == ()  # 같은 상호 지점 여럿 — 하나를 고르지 않는다
    # 지점까지 말했으면 그 이름 그대로 — 다른 지점이 있어도
    assert _ids(many, words=("고집돌우럭", "중문점"), spans=("고집돌우럭 중문점",)) == ("a",)


def test_same_name_many_follows_the_assistant_name_rule() -> None:
    """이름 그대로 여럿 — 도우미 `find_by_name` 과 같은 규칙: 정보 충실(rich) 한 곳 → 관광 종류 한 곳, 아니면 고르지 않는다."""
    palace = _row("a", "경복궁", sido="서울특별시", sigungu="종로구")
    shops = [_row(f"s{i}", "경복궁", category="맛집", sido="서울특별시", sigungu="중구", rich=False) for i in range(3)]
    assert _ids([palace, *shops], words=("경복궁",)) == ("a",)
    twins = [_row("a", "중앙공원", category="자연"), _row("b", "중앙공원", category="자연")]
    assert _ids(twins, words=("중앙공원",)) == ()


def test_only_rows_the_caller_kept_are_considered() -> None:
    """부르는 쪽이 거리(여행지 50km)·풀 자격으로 거른 id 밖은 보지 않는다 — 먼 같은 이름이 빠지면 가까운 한 곳이 하나뿐이다."""
    near, far = _row("a", "광장시장", category="쇼핑"), _row("b", "광장시장", category="쇼핑", sido="부산광역시")
    assert _ids([near, far], words=("광장시장",)) == ()
    assert _ids([near, far], words=("광장시장",), usable={"a"}) == ("a",)
    assert _ids([near, far], words=("광장시장",), usable=set()) == ()


def test_each_said_word_gets_at_most_one_place_and_ids_do_not_repeat() -> None:
    rows = [_row("a", "효창공원"), _row("b", "성산일출봉")]
    assert _ids(rows, words=("효창공원", "성산일출봉", "효창공원을")) == ("a", "b")


def test_truncated_rows_do_not_trust_cut_forms() -> None:
    """행이 상한을 넘었다 — 이름 그대로 맞은 행이 앞이라 그쪽은 다 왔지만, 뗀 꼴(지점)은 잘린 쪽에 같은 상호가 더 있을 수 있다."""
    exact = _row("a", "효창공원")
    branches = [_row(f"b{i:02d}", f"고집돌우럭 {i}호점", category="맛집") for i in range(SAID_CAP)]
    rows = [exact, *branches]  # SAID_CAP + 1 행 — 잘렸다
    assert _ids(rows, words=("효창공원",)) == ("a",)
    assert _ids(branches[:1], words=("고집돌우럭",)) == ("b00",)  # 다 왔고 지점이 한 곳뿐이면 그곳
    assert _ids(branches[:2], words=("고집돌우럭",), cap=1) == ()  # 지점 한 곳만 보였어도 잘렸으면 고르지 않는다


def test_truncated_inside_exact_rows_picks_nothing() -> None:
    rows = [_row(f"k{i:02d}", "중앙공원", category="자연", rich=(i == 0)) for i in range(SAID_CAP + 1)]
    assert _ids(rows, words=("중앙공원",)) == ()  # 잘린 쪽에도 같은 이름 — rich 한 곳이 '하나뿐'인지 모른다
