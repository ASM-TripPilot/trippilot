"""PgPlaceSql — 도우미 장소 조회(NL2SQL)의 실행기. 출구 게이트를 통과한 SELECT 를 `poi_public` 뷰에 읽기 전용으로 돌린다.

방어 셋째 겹(첫째 DB 롤·뷰 V2.77, 둘째 `gates/dialogue_sql.py`):
  · 트랜잭션을 READ ONLY 로 열고 문장 시한 `STATEMENT_TIMEOUT_MS` 를 건다 — 롤에도 같은 설정이 있지만(bootstrap.sql) 롤 설정이 빠진
    환경(로컬 수동 롤 등)에서도 같게 돈다. 끝은 늘 ROLLBACK 이다
  · 모델 SQL 은 `SELECT q.poi_id FROM (<sql>) q LIMIT ROW_CAP` 으로 감싸 **순서와 id 만** 받는다. 사용자에게 갈 칸은 두 번째 조회에서
    코드가 고른다(`PlaceRow`) — 모델이 어떤 열을 골랐든 화면에 나갈 수 있는 것은 이름·종류·시도·구군·두 표지뿐이다
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
    sido: str | None  # 시·도 정식 이름 — 핸들러가 분류 인자의 지역과 맞는지 대조한다
    sigungu: str | None
    trending: bool  # '요즘 인기' 표지
    nightlife: bool  # 나이트라이프 표지 — 밤 주제가 아니면 핸들러가 뺀다
    rich: bool = False  # 사진·영업시간이 다 있는가(BE dataQuality FULL 과 같은 판정, V2.78)


_ROW_COLUMNS = "poi_id::text, name, category, sido, sigungu, tags, rich"


def _row(r: tuple) -> PlaceRow:
    return PlaceRow(poi_id=r[0], name=r[1], category=r[2], sido=r[3], sigungu=r[4],
                    trending=TRENDING_TAG in (r[5] or ()), nightlife=NIGHTLIFE_TAG in (r[5] or ()), rich=bool(r[6]))


class PgPlaceSql:
    def __init__(self, connect: Callable[[], Any]) -> None:
        self._connect = connect

    def find_by_name(self, name: str, area: str | None = None) -> PlaceRow | None:
        """일정 밖 장소를 이름으로 한 곳 찾는다 — **우리가 쓴** 매개변수 SQL(LLM 없음). 공백만 뗀 **완전 일치**만 본다.
        여러 곳이면(체인점) 여행 지역(`area` — 지역 표 이름: "서울"·"제주"·"강릉")으로 좁힌다. 행의 시·도나 구·군이 그 이름으로 시작하면
        같은 지역이다("강릉"→강릉시, 도 아래 시군 여행도 걸린다). 그 안에서 정보가 충실한 곳(rich — 사진·영업시간)이 하나뿐이면 그곳이다
        ("경복궁"은 서울에만 9곳 — 같은 이름의 식당·업소 사업자 등록 사이에서 관광지 한 곳만 사진·영업시간을 갖췄다, 2026-10-21 로컬 적재).
        그래도 둘 이상이면 None — 하나를 골라 다른 곳의 영업시간을 말하면
        "못 찾았어요"보다 나쁘다. 별칭·부분 일치("남산타워"↔"N서울타워")는 같은 이유로 하지 않는다. 2자 미만은 찾지 않는다.
        한 곳만 맞으면 지역이 달라도 돌려준다 — 대신 호출측이 그 위치(시·도·구군)를 카드에 싣는다(다른 지역의 같은 이름이면 드러나게)."""
        key = "".join(name.split())
        if len(key) < 2:
            return None
        with self._connect() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute("SET TRANSACTION READ ONLY")
                    cur.execute(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")
                    cur.execute(
                        f"SELECT {_ROW_COLUMNS} FROM poi_public WHERE replace(name, ' ', '') = %(key)s "
                        "ORDER BY (sido LIKE %(area)s OR sigungu LIKE %(area)s) DESC, rich DESC, poi_id LIMIT 5",
                        {"key": key, "area": f"{area}%" if area else "%"},
                    )
                    hits = [_row(r) for r in cur.fetchall()]
            finally:
                conn.rollback()
        if len(hits) == 1:
            return hits[0]
        local = [h for h in hits if area and ((h.sido or "").startswith(area) or (h.sigungu or "").startswith(area))]
        if len(local) == 1:
            return local[0]
        rich = [h for h in (local or hits) if h.rich]  # 지역 안(없으면 전체)에서 정보 충실한 곳이 하나뿐인가 — 정렬이 rich 를 앞에 둔다
        return rich[0] if len(rich) == 1 else None

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
                    cur.execute(f"SELECT {_ROW_COLUMNS} FROM poi_public WHERE poi_id::text = ANY(%s)", (ids,))
                    by_id = {r[0]: r for r in cur.fetchall()}
            finally:
                conn.rollback()
        # 모델이 고른 집합(≤ROW_CAP) 안에서 '요즘 인기' → 정보 충실(rich) 순으로 한 번 더 — 반경 탐색과 같은 신호. 안정 정렬이라 그 안은
        # 모델 순서다. 모델이 정렬 끝의 rich 를 빠뜨려도(프롬프트 규칙) 화면 앞자리에 사업자 법인명만 남지 않게 코드가 지킨다.
        return sorted((_row(by_id[i]) for i in ids if i in by_id), key=lambda r: (not r.trending, not r.rich))
