"""PgPlaceSql — 도우미 장소 조회(NL2SQL)의 실행기. 출구 게이트를 통과한 SELECT 를 `poi_public` 뷰에 읽기 전용으로 돌린다.

방어 셋째 겹(첫째 DB 롤·뷰 V2.77, 둘째 `gates/dialogue_sql.py`):
  · 트랜잭션을 READ ONLY 로 열고 문장 시한 `STATEMENT_TIMEOUT_MS` 를 건다 — 롤에도 같은 설정이 있지만(bootstrap.sql) 롤 설정이 빠진
    환경(로컬 수동 롤 등)에서도 같게 돈다. 끝은 늘 ROLLBACK 이다
  · 모델 SQL 은 `SELECT q.poi_id FROM (<sql>) q LIMIT ROW_CAP` 으로 감싸 **순서와 id 만** 받는다. 사용자에게 갈 칸은 두 번째 조회에서
    코드가 고른다(`PlaceRow`) — 모델이 어떤 열을 골랐든 화면에 나갈 수 있는 것은 이름·종류·시도·구군·두 표지뿐이다
  · 모델 SQL 에는 바인딩 인자를 주지 않는다 — psycopg 는 인자가 없으면 `%` 를 해석하지 않으므로 LIKE '%서울%' 이 그대로 간다

커넥션은 팩토리 주입(psycopg 3 호환, `PgDialogueMemoryStore` 와 같은 패턴 — 호출마다 연결, 풀 없음). 예외는 호출측으로 올린다 —
반경 탐색으로 내려가는 것은 핸들러 몫이다(INV-4).

이름 찾기 둘은 모델 SQL 이 아니라 **우리가 쓴** 매개변수 SQL 이다 — 도우미의 `find_by_name`(이름 하나), 편집 번역의 `find_said`(발화의 이름
말 여럿 한 번에 · 지역 접두·지점 접미를 뗀 꼴까지, F9). 같은 이름 여럿에서 고르는 규칙은 둘이 같다(`_pick_one`).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Collection, Sequence
from dataclasses import dataclass
from typing import Any

from trippilot.domain.poi.poi import NIGHTLIFE_TAG, TRENDING_TAG
from trippilot.domain.poi.region_centers import GWANGJU_GU, MERGED_SIDO, bare_region, in_sido, region_area

ROW_CAP = 20  # 핸들러는 ≤5 를 쓴다 — 표시 불가 이름·나이트라이프를 거르고도 남게 넉넉히
STATEMENT_TIMEOUT_MS = 1500  # 팬아웃 작업 예산(≤3s) 안에서 LLM(~1.5s) 뒤에 남는 몫
# 관광 종류 — 같은 이름이 여럿일 때 관광지와 그 이름을 딴 식당·가게(궁궐 "경복궁" ↔ 울산 식당 "경복궁", 속초항 ↔ 횟집)를 가른다
_SIGHT_CATEGORIES = frozenset({"명소", "자연", "문화", "미술", "야경"})
# 편집 이름 조회(`find_said`)의 행 상한 — 말 여럿 × 같은 이름 여럿. 이름 그대로 맞은 행이 앞이라 잘려도 지역 접두·지점 접미 쪽이 먼저 잘린다
SAID_CAP = 60
# 모델 정렬의 끝 — 프롬프트 규칙대로 '요즘 인기'·rich 를 다 실었는지 마지막 ORDER BY 뒤만 본다(`run`)
_ORDER_BY = re.compile(r"\border\s+by\b", re.IGNORECASE)
_RICH_DESC = re.compile(r"\brich\s+desc\b", re.IGNORECASE)


def _model_ordered(sql: str) -> bool:
    heads = list(_ORDER_BY.finditer(sql))
    tail = sql[heads[-1].end():] if heads else ""
    return f"'{TRENDING_TAG}'" in tail and _RICH_DESC.search(tail) is not None


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
# 보안 장벽 뷰(V2.77 security_barrier)는 누수 안전(leakproof)하지 않은 술어 — `poi_id::text` 변환·`replace(name, …)` — 를 장벽 아래로
# 내리지 못한다. 그런 술어로 칸까지 고르면 거르기 전에 모든 행의 태그 배열을 만든다(로컬 11.2만 행 80~85ms, SubPlan 이 행마다).
# 그래서 세 조회 모두 거르는 조회는 **id 만** 받고 칸은 이 둘째 조회로 받는다 — uuid 같음은 leakproof 라 기본키 색인을 탄다(0.2ms).
_BY_IDS_SQL = f"SELECT {_ROW_COLUMNS} FROM poi_public WHERE poi_id = ANY(%s::uuid[])"


def _row(r: tuple) -> PlaceRow:
    return PlaceRow(poi_id=r[0], name=r[1], category=r[2], sido=r[3], sigungu=r[4],
                    trending=TRENDING_TAG in (r[5] or ()), nightlife=NIGHTLIFE_TAG in (r[5] or ()), rich=bool(r[6]))


def _name_order(area: str | None) -> tuple[str, dict[str, Any]]:
    """`find_by_name` ORDER BY 선순위 술어 — `_pick_one` 의 지역 안 판정(이 바로 아래)과 같은 꼴이어야 한다.
    다르면 SQL 이 앞세운 행과 `_pick_one` 이 지역 안으로 보는 행이 달라, `ROW_CAP` 에 잘리는 쪽이 사실은 지역 안 행일 수 있다.
    시·도 이름(area 가 시·도 그 자체)이면 `sido LIKE` 만(광주는 통합 특별시 다섯 구도) — 시·군이면 `sigungu LIKE` 만."""
    if area is None:
        return "sido LIKE %(area)s", {"area": "%"}
    if region_area(area) == (area, ()):  # 시·도 이름(앞글자만) — `_pick_one` 의 sido_level
        if area == "광주":
            return ("(sido LIKE %(area)s OR (sido = %(merged)s AND sigungu = ANY(%(gu)s::text[])))",
                    {"area": f"{area}%", "merged": MERGED_SIDO, "gu": list(GWANGJU_GU)})
        return "sido LIKE %(area)s", {"area": f"{area}%"}
    return "sigungu LIKE %(area)s", {"area": f"{area}%"}


def _pick_one(hits: Sequence[PlaceRow], area: str | None) -> PlaceRow | None:
    """같은 이름 여럿에서 한 곳 — 한 곳뿐 → 지역 안 한 곳 → 정보 충실(rich) 한 곳 → 관광 종류 한 곳, 아니면 None(`find_by_name` 규칙)."""
    if len(hits) == 1:
        return hits[0]
    sido_level = area is not None and region_area(area) == (area, ())  # 시·도 이름("광주")은 시·도로만 — 구·군 앞글자면 경기 광주시가 걸렸다
    local = [h for h in hits if area and (in_sido(area, h.sido, h.sigungu)
                                          or (not sido_level and (h.sigungu or "").startswith(area)))]
    if len(local) == 1:
        return local[0]
    rich = [h for h in (local or hits) if h.rich]  # 지역 안(없으면 전체)에서 정보 충실한 곳이 하나뿐인가 — 정렬이 rich 를 앞에 둔다
    if len(rich) == 1:
        return rich[0]
    sights = [h for h in (rich or local or hits) if h.category in _SIGHT_CATEGORIES]
    return sights[0] if len(sights) == 1 else None


# 편집 이름 조회 — 말(붙여 쓴 한 낱말 `words` · 띄어 쓴 여러 낱말 `spans`, 둘 다 소문자)과 맞는 이름. 세 꼴을 한 번에 본다:
#   이름 그대로 · 맨 앞 낱말(지역 접두 "서귀포 하논분화구")을 뗀 꼴 · 맨 뒤 '…점' 낱말(지점 접미 "고집돌우럭 중문점")을 뗀 꼴.
# 한 낱말 말은 이름의 띄어쓰기를 무시하고, 여러 낱말 말은 이름의 띄어쓰기 그대로다(편집 번역 `_named_beyond_cap` 과 같은 규칙 —
# 이름에 없는 띄어쓰기를 건너 붙이지 않는다). 지역 접두가 정말 그 곳의 지역인지는 SQL 이 아니라 `said_matches` 가 본다.
# 이름 그대로 맞은 행을 앞에 둔다 — 상한에 잘려도 그쪽은 남는다(`pick_said` 가 잘림을 안다).
# 첫 조회는 **id 만** 받고 칸은 `_BY_IDS_SQL` 로 받는다(그 註 — 로컬 실측 11.2만 행: 칸까지 154ms · id 만 38ms).
_N = "lower(name)"  # 위치·자르기를 모두 소문자 이름 위에서 센다 — `said_matches` 가 같은 글을 가른다
_SAID_SQL = (
    "SELECT poi_id FROM poi_public WHERE"
    f" replace({_N}, ' ', '') = ANY(%(words)s::text[]) OR {_N} = ANY(%(spans)s::text[])"
    f" OR (strpos({_N}, ' ') > 0 AND ("
    f"replace(substr({_N}, strpos({_N}, ' ') + 1), ' ', '') = ANY(%(words)s::text[])"
    f" OR substr({_N}, strpos({_N}, ' ') + 1) = ANY(%(spans)s::text[])))"
    f" OR (strpos({_N}, ' ') > 0 AND right({_N}, 1) = '점' AND ("
    f"replace(left({_N}, length({_N}) - strpos(reverse({_N}), ' ')), ' ', '') = ANY(%(words)s::text[])"
    f" OR left({_N}, length({_N}) - strpos(reverse({_N}), ' ')) = ANY(%(spans)s::text[])))"
    f" ORDER BY (replace({_N}, ' ', '') = ANY(%(words)s::text[]) OR {_N} = ANY(%(spans)s::text[])) DESC,"
    f" poi_id LIMIT {SAID_CAP + 1}"
)


def _region_head(head: str, row: PlaceRow) -> bool:
    """이름 맨 앞 낱말이 그 곳의 지역인가 — 지역 표 이름(+시·도·구, "제주"·"서귀포"·"중문") 또는 그 행의 시·도·구군 앞부분("양평"→양평군)."""
    return len(head) >= 2 and (bare_region(head) is not None
                               or (row.sido or "").startswith(head) or (row.sigungu or "").startswith(head))


def said_matches(row: PlaceRow, words: Collection[str], spans: Collection[str]) -> list[tuple[str, int]]:
    """행 이름이 맞은 (말, 급) 전부 — 0 이름 그대로 · 1 지역 접두를 뗀 꼴 · 2 지점 접미를 뗀 꼴. 셈은 `_SAID_SQL` 과 같다."""
    def hit(text: str) -> list[str]:
        squashed = text.replace(" ", "")
        return [k for k in (squashed if squashed in words else None, text if text in spans else None) if k]

    name = row.name.lower()
    found = [(k, 0) for k in hit(name)]
    if " " in name:
        head, rest = name.split(" ", 1)
        if _region_head(head, row):
            found += [(k, 1) for k in hit(rest)]
        core, tail = name.rsplit(" ", 1)
        if len(tail) >= 2 and tail.endswith("점"):
            found += [(k, 2) for k in hit(core)]
    return found


def pick_said(rows: Sequence[PlaceRow], usable: Collection[str], words: Collection[str], spans: Collection[str],
              *, cap: int = SAID_CAP) -> tuple[str, ...]:
    """말마다 한 곳(poi_id) — `usable`(부르는 쪽이 거리·자격으로 거른 id) 안에서. 이름 그대로 맞은 곳이 하나라도 있는 말은 그 안에서만
    `find_by_name` 규칙으로 고르고(여행 지역 대신 거리로 이미 걸렀다), 없으면 지역 접두·지점 접미를 뗀 꼴이 **하나뿐**일 때만 그곳이다 —
    같은 상호의 지점 여럿("고집돌우럭 중문점·제주공항점")에서 하나를 고르지 않는다. 행이 상한을 넘었으면(`cap`) 뗀 꼴은 믿지 않고, 이름
    그대로 맞은 행까지 잘렸으면 아무것도 고르지 않는다 — 잘린 쪽에 같은 이름이 더 있을 수 있다."""
    words, spans = frozenset(words), frozenset(spans)
    truncated = len(rows) > cap
    if truncated and any(tier == 0 for _, tier in said_matches(rows[cap], words, spans)):
        return ()  # 잘린 첫 행도 이름 그대로 맞은 행 — 그 이름의 같은 곳이 더 있을 수 있다
    rows = rows[:cap]
    by_key: dict[str, tuple[list[PlaceRow], list[PlaceRow]]] = {}
    for row in rows:
        if row.poi_id not in usable:
            continue
        for key, tier in said_matches(row, words, spans):
            exact, core = by_key.setdefault(key, ([], []))
            if row not in (exact if tier == 0 else core):
                (exact if tier == 0 else core).append(row)
    picked: list[str] = []
    for exact, core in by_key.values():
        one = _pick_one(exact, None) if exact else (core[0] if len(core) == 1 and not truncated else None)
        if one is not None and one.poi_id not in picked:
            picked.append(one.poi_id)
    return tuple(picked)


class PgPlaceSql:
    def __init__(self, connect: Callable[[], Any]) -> None:
        self._connect = connect

    def find_by_name(self, name: str, area: str | None = None) -> PlaceRow | None:
        """일정 밖 장소를 이름으로 한 곳 찾는다 — **우리가 쓴** 매개변수 SQL(LLM 없음). 공백만 뗀 **완전 일치**만 본다.
        여러 곳이면(체인점) 여행 지역(`area` — 지역 표 이름: "서울"·"제주"·"강릉")으로 좁힌다. 시·도 이름이면 행의 시·도로(`in_sido` — 광주는
        통합 특별시의 다섯 구, 경기 광주시는 아니다), 시·군이면 구·군이 그 이름으로 시작하면 같은 지역이다("강릉"→강릉시, 도 아래 시군 여행도
        걸린다). 그 안에서 정보가 충실한 곳(rich — 사진·영업시간)이 하나뿐이면 그곳이다
        ("경복궁"은 서울에만 9곳 — 같은 이름의 식당·업소 사업자 등록 사이에서 관광지 한 곳만 사진·영업시간을 갖췄다, 2026-10-21 로컬 적재).
        그래도 둘 이상이면 그중 관광 종류(`_SIGHT_CATEGORIES`)가 하나뿐일 때 그곳이다 — 여행이 없으면 지역으로 못 좁히는데 개발 DB 의
        "경복궁" 11곳 중 rich 가 궁궐(종로)과 울산 식당 둘이었다(2026-11-02). 그래도 둘 이상이면 None — 하나를 골라 다른 곳의 영업시간을 말하면
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
                    order_sql, order_params = _name_order(area)
                    cur.execute(
                        "SELECT poi_id FROM poi_public WHERE replace(name, ' ', '') = %(key)s "
                        f"ORDER BY {order_sql} DESC, rich DESC, poi_id LIMIT {ROW_CAP}",
                        {"key": key, **order_params},
                    )
                    ids = [str(r[0]) for r in cur.fetchall()]
                    if not ids:
                        return None
                    cur.execute(_BY_IDS_SQL, (ids,))
                    by_id = {r[0]: r for r in cur.fetchall()}
            finally:
                conn.rollback()
        return _pick_one([_row(by_id[i]) for i in ids if i in by_id], area)

    def find_said(self, words: Sequence[str], spans: Sequence[str]) -> list[PlaceRow]:
        """편집 이름 조회 — 발화의 이름 말(`said_name_keys`)과 맞는 등록 장소 행(≤ `SAID_CAP` + 1, 넘었는지는 `pick_said` 가 본다).
        `find_by_name` 과 같은 읽기 전용·시한·매개변수 SQL(LLM 없음)이고, 이름 그대로에 더해 지역 접두·지점 접미를 뗀 꼴도 본다.
        고르기(말마다 한 곳)는 부르는 쪽이 좌표로 거른 뒤 `pick_said` 로 한다 — 이 뷰에는 좌표가 없다."""
        if not words and not spans:
            return []
        with self._connect() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute("SET TRANSACTION READ ONLY")
                    cur.execute(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")
                    cur.execute(_SAID_SQL, {"words": list(words), "spans": list(spans)})
                    ids = [r[0] for r in cur.fetchall()]
                    if not ids:
                        return []
                    cur.execute(_BY_IDS_SQL, (ids,))
                    by_id = {r[0]: r for r in cur.fetchall()}
            finally:
                conn.rollback()
        return [_row(by_id[str(i)]) for i in ids if str(i) in by_id]  # 첫 조회 순서(이름 그대로 먼저) 그대로

    def rows(self, poi_ids: Sequence[str]) -> list[PlaceRow]:
        """id 로 보여 줄 칸 — **우리가 쓴** 매개변수 SQL 한 번(`_BY_IDS_SQL`, 기본키 색인). 없는 id 는 빠진다. 미리 찾기의 지역 조회가 쓴다."""
        if not poi_ids:
            return []
        with self._connect() as conn:
            try:
                with conn.cursor() as cur:
                    cur.execute("SET TRANSACTION READ ONLY")
                    cur.execute(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")
                    cur.execute(_BY_IDS_SQL, (list(poi_ids),))
                    return [_row(r) for r in cur.fetchall()]
            finally:
                conn.rollback()

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
                    cur.execute(_BY_IDS_SQL, (ids,))
                    by_id = {r[0]: r for r in cur.fetchall()}
            finally:
                conn.rollback()
        rows = [_row(by_id[i]) for i in ids if i in by_id]
        # 모델이 정렬에 두 신호('요즘 인기'·rich)를 다 실었으면 그 순서 그대로 — 말의 성격 표지('뷰'·'아이동반'…)를 맨 앞에 둔 정렬
        # (프롬프트 0.2.1, 0.2.2 부터 표지는 정렬에만)을 여기서 '요즘 인기' 먼저로 다시 덮으면 표지 없는 인기 장소가 앞자리를 채운다
        # (2026-11-04 개발: "서울 경치 좋은 곳" 맨 앞에 미술관, "제주 아이랑 가기 좋은 곳" 아이동반 0/5 — 모델 순서면 5/5·2/5).
        # 빠뜨렸을 때만 '요즘 인기' → 정보 충실(rich) 순으로 한 번 더 지킨다 — 화면 앞자리에 사업자 법인명만 남지 않게(#1500).
        # 안정 정렬이라 그 안은 모델 순서다
        if _model_ordered(sql):
            return rows
        return sorted(rows, key=lambda r: (not r.trending, not r.rich))
