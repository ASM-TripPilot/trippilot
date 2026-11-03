"""FakePlaceDb — 편집 이름 조회(`PgPlaceSql.find_said`, F9)가 보는 `poi_public` 의 psycopg 연결 흉내 (실 DB 0).

`said_sql` 은 `_SAID_SQL` 의 WHERE·ORDER BY 를 **SQL 문자열 함수 그대로** 옮긴 것이다(lower·replace·strpos·substr·reverse·left, 1-기준 위치) —
고르는 코드(`said_matches`)를 되쓰지 않는다. 거울이 실물을 되쓰면 둘이 함께 틀려도 초록이다(그래서 두 셈이 맞는지는 따로 속성 테스트로 본다).
"""

from __future__ import annotations

from collections.abc import Sequence

from trippilot.poi_curation.adapters.pg_place_sql import SAID_CAP


def said_sql(name: str, words: Sequence[str], spans: Sequence[str]) -> tuple[bool, bool]:
    """(돌려주나, 이름 그대로 맞나) — `_SAID_SQL` 의 WHERE 와 ORDER BY 첫 키."""
    n = name.lower()  # lower(name) — 위치·자르기 모두 이 글 위에서 센다
    exact = n.replace(" ", "") in words or n in spans
    sp = n.find(" ") + 1  # strpos(n, ' ')
    rest = n[sp:]  # substr(n, strpos + 1)
    region = sp > 0 and (rest.replace(" ", "") in words or rest in spans)
    core = n[:len(n) - (n[::-1].find(" ") + 1)]  # left(n, length(n) - strpos(reverse(n), ' '))
    branch = sp > 0 and n[-1:] == "점" and (core.replace(" ", "") in words or core in spans)
    return exact or region or branch, exact


class FakePlaceDb:
    """연결 팩토리이자 연결·커서 — `poi_public` 행 표(`(poi_id, name, 종류, 시도, 구군, tags, rich)`)에 매개변수 SQL 을 적용한다.
    `down` 이면 연결부터 실패한다. 받은 매개변수는 `queries` 에 남는다."""

    def __init__(self, rows: list[tuple], *, down: bool = False) -> None:
        self.rows, self.down, self.queries = rows, down, []
        self._result: list = []

    def __call__(self):
        if self.down:
            raise OSError("connection refused")
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        return None

    def cursor(self):
        return self

    def execute(self, sql: str, params=None) -> None:
        if params is None:  # SET TRANSACTION READ ONLY · SET LOCAL statement_timeout
            return
        if isinstance(params, tuple):  # 둘째 조회 — id 로 칸(`poi_id = ANY(%s::uuid[])`)
            wanted = {str(i) for i in params[0]}
            self._result = [r for r in self.rows if r[0] in wanted]
            return
        self.queries.append(params)  # 첫 조회 — 말 → id(이름 그대로 먼저, poi_id · LIMIT)
        words, spans = params["words"], params["spans"]
        hits = [(not exact, r[0]) for r in self.rows for ok, exact in [said_sql(r[1], words, spans)] if ok]
        self._result = [(pid,) for _, pid in sorted(hits)][:SAID_CAP + 1]

    def fetchall(self):
        return self._result

    def rollback(self) -> None:
        return None
