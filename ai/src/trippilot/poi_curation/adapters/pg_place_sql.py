"""PgPlaceSql — 도우미 장소 조회(NL2SQL)의 실행기. 출구 게이트를 통과한 SELECT 를 `poi_public` 뷰에 읽기 전용으로 돌린다.

방어 셋째 겹(첫째 DB 롤·뷰 V2.77, 둘째 `gates/dialogue_sql.py`):
  · 트랜잭션을 READ ONLY 로 열고 문장 시한 `STATEMENT_TIMEOUT_MS` 를 건다 — 롤에도 같은 설정이 있지만(bootstrap.sql) 롤 설정이 빠진
    환경(로컬 수동 롤 등)에서도 같게 돈다. 끝은 늘 ROLLBACK 이다
  · 모델 SQL 은 `SELECT q.poi_id FROM (<sql>) q LIMIT ROW_CAP` 으로 감싸 **순서와 id 만** 받는다. 사용자에게 갈 칸은 두 번째 조회에서
    코드가 고른다(`PlaceRow`) — 모델이 어떤 열을 골랐든 화면에 나갈 수 있는 것은 이름·종류·구군·두 표지뿐이다
  · 모델 SQL 에는 바인딩 인자를 주지 않는다 — psycopg 는 인자가 없으면 `%` 를 해석하지 않으므로 LIKE '%서울%' 이 그대로 간다

커넥션은 팩토리 주입(psycopg 3 호환, `PgDialogueMemoryStore` 와 같은 패턴 — 호출마다 연결, 풀 없음). 예외는 호출측으로 올린다 —
반경 탐색으로 내려가는 것은 핸들러 몫이다(INV-4).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from trippilot.domain.poi import NIGHTLIFE_TAG, TRENDING_TAG

ROW_CAP = 20  # 핸들러는 ≤5 를 쓴다 — 표시 불가 이름·나이트라이프를 거르고도 남게 넉넉히
STATEMENT_TIMEOUT_MS = 1500  # 팬아웃 작업 예산(≤3s) 안에서 LLM(~1.5s) 뒤에 남는 몫


@dataclass(frozen=True, slots=True)
class PlaceRow:
    """사용자에게 나갈 수 있는 칸의 전부 — 이 밖의 열(주소·저장 수·태그 원문)은 실행기 밖으로 나가지 않는다."""

    poi_id: str
    name: str
    category: str  # 한글 종류('카페') — 백엔드 정본 어휘
    sigungu: str | None
    trending: bool  # '요즘 인기' 표지
    nightlife: bool  # 나이트라이프 표지 — 밤 주제가 아니면 핸들러가 뺀다


class PgPlaceSql:
    def __init__(self, connect: Callable[[], Any]) -> None:
        self._connect = connect

    def run(self, sql: str) -> list[PlaceRow]:
        """검사를 통과한 SELECT → 그 순서의 `PlaceRow` (≤ `ROW_CAP`). DB 오류·시한은 예외로 올라간다."""
        with self._connect() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute("SET TRANSACTION READ ONLY")
                    cur.execute(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")
                    cur.execute(f"SELECT q.poi_id FROM ({sql}) AS q LIMIT {ROW_CAP}")
                    ids = list(dict.fromkeys(str(r[0]) for r in cur.fetchall()))
                    if not ids:
                        return []
                    cur.execute(
                        "SELECT poi_id::text, name, category, sigungu, tags FROM poi_public WHERE poi_id::text = ANY(%s)",
                        (ids,),
                    )
                    by_id = {r[0]: r for r in cur.fetchall()}
            finally:
                conn.rollback()
        return [PlaceRow(poi_id=i, name=by_id[i][1], category=by_id[i][2], sigungu=by_id[i][3],
                         trending=TRENDING_TAG in (by_id[i][4] or ()), nightlife=NIGHTLIFE_TAG in (by_id[i][4] or ()))
                for i in ids if i in by_id]
