"""DIALOGUE_SQL 출구 게이트 — 도우미 장소 조회(NL2SQL)에서 LLM 이 쓴 SELECT 를 실행 전에 거른다.

2026-10-20 사용자 결정: LLM 이 SQL 을 직접 쓰되 프롬프트 인젝션 방어를 두고, 사용자에게 보여 줄 수 있는 범위를 정해 둔다.
방어는 세 겹이고 이 게이트는 가운데 겹이다.
  ① DB — ai_user 는 `poi_public` 뷰(보여 줘도 되는 열·ACTIVE 행) SELECT 만, 롤에 읽기 전용·문장 시한(V2.77·bootstrap.sql)
  ② 이 게이트 — 아래 허용 목록 밖의 낱말·기호가 하나라도 있으면 통째로 버린다(고쳐 쓰지 않는다)
  ③ 실행기 — 읽기 전용 트랜잭션·문장 시한·행 상한으로 감싸고, 화면에 나갈 칸은 코드가 다시 고른다(`pg_place_sql`)
①이 진짜 경계다. ②는 ①에 닿기 전에 엉뚱한 SQL 을 걸러 오류·부하·로그 오염을 줄이고, 거른 사실을 폴백으로 남긴다(INV-4).

허용 목록(대소문자 무시):
  · 문장 모양 — `SELECT … FROM poi_public [WHERE …] [ORDER BY …] [LIMIT n]` 한 문장. SELECT·FROM 은 한 번씩만(부질의·UNION·JOIN 없음)
  · 낱말 — 아래 `_KEYWORDS`·`_COLUMNS`·`poi_public` 만. 함수·별칭(AS)·다른 표·스키마 이름·시스템 카탈로그는 낱말 단계에서 떨어진다
  · 기호 — 비교·논리·배열 겹침(`&&`·`@>`)·괄호·쉼표·`*`. 주석(`--`·`/*`)·세미콜론·형변환(`::`)·따옴표 식별자(`"`)·달러 인용·
    역슬래시는 없다. 문자열은 작은따옴표 리터럴만(안의 `''` 는 이스케이프)
  · 고른 열에 `poi_id` 가 있어야 한다(`*` 도 된다) — 실행기가 `SELECT q.poi_id FROM (<sql>) q` 로 감싸 id 만 꺼낸다
  · LIMIT 은 정수 ≤ `MAX_LIMIT`
"""

from __future__ import annotations

import re
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.llm_gateway.gates.base import GateOutcome, _load_json_object

MAX_SQL_CHARS = 800
MAX_LIMIT = 50
VIEW = "poi_public"

_COLUMNS = frozenset({"poi_id", "name", "category", "sido", "sigungu", "address", "tags", "saved_count"})
_KEYWORDS = frozenset({
    "select", "distinct", "from", "where", "and", "or", "not", "in", "like", "ilike", "is", "null", "true", "false",
    "between", "any", "array", "order", "by", "asc", "desc", "nulls", "first", "last", "limit",
})
_ALLOWED_WORDS = _COLUMNS | _KEYWORDS | {VIEW}

# 앞에서부터 하나씩 먹는다 — 어느 것에도 안 맞는 글자가 나오면 그 자리에서 거절(문자열 밖 한글·따옴표 식별자·`;`·`::`·`.`·`$`·`\\` 등)
_TOKEN = re.compile(r"""
    (?P<ws>\s+)
  | (?P<str>'(?:[^'\\]|'')*')
  | (?P<num>\d+)
  | (?P<word>[A-Za-z_][A-Za-z0-9_]*)
  | (?P<op><=|>=|<>|!=|@>|&&|[=<>(),*\[\]])
""", re.VERBOSE)


def _tokens(sql: str) -> list[tuple[str, str]] | None:
    out: list[tuple[str, str]] = []
    pos = 0
    while pos < len(sql):
        m = _TOKEN.match(sql, pos)
        if m is None:
            return None
        pos = m.end()
        if m.lastgroup != "ws":
            out.append((m.lastgroup, m.group().lower() if m.lastgroup == "word" else m.group()))
    return out


def check_select(sql: str) -> str | None:
    """허용 목록 검사 — 통과면 None, 아니면 거절 사유(로그용 짧은 라벨, SQL 원문은 싣지 않는다)."""
    if len(sql) > MAX_SQL_CHARS:
        return "too_long"
    if "--" in sql or "/*" in sql:
        return "comment"
    tokens = _tokens(sql)
    if tokens is None:
        return "bad_char"
    words = [t for kind, t in tokens if kind == "word"]
    if any(w not in _ALLOWED_WORDS for w in words):
        return "word_not_allowed"
    if not tokens or tokens[0] != ("word", "select") or words.count("select") != 1 or words.count("from") != 1:
        return "shape"
    at = tokens.index(("word", "from"))
    if tokens[at + 1: at + 2] != [("word", VIEW)] or words.count(VIEW) != 1:
        return "table"
    if not {("word", "poi_id"), ("op", "*")} & set(tokens[1:at]):
        return "no_poi_id"
    if "limit" in words:
        tail = tokens[tokens.index(("word", "limit")):]
        if len(tail) != 2 or tail[1][0] != "num" or int(tail[1][1]) > MAX_LIMIT:
            return "limit"
    return None


class DialogueSqlGate:
    """{"sql": "SELECT …" | null} → 검사를 통과한 SQL 문자열. null·빈 문자열 = 장소 조회로 답할 말이 아님(성공·0건 — 호출측이
    반경 탐색으로 간다). 검사 탈락은 실패(error)라 게이트웨이가 폴백으로 계측한다 — 고쳐 쓰지 않는다(고친 SQL 은 아무도 검토하지 않았다)."""

    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        try:
            sql = _load_json_object(raw_text, "sql")
        except ValueError as e:
            return GateOutcome(value="", drop_event=None, error=f"parse_error: {e}")
        if sql is None or (isinstance(sql, str) and not sql.strip()):
            return GateOutcome(value="", drop_event=None, error=None)
        if not isinstance(sql, str):
            return GateOutcome(value="", drop_event=None, error="parse_error: sql 이 문자열이 아님")
        sql = sql.strip().removesuffix(";").strip()  # 끝 세미콜론 하나는 모델 습관이다 — 가운데 것은 검사에서 bad_char
        reason = check_select(sql)
        if reason is None:
            return GateOutcome(value=sql, drop_event=None, error=None)
        drop = GateDropEvent(trace_id=trace_id, occurred_at=now, component="c1.gate", feature=feature.value,
                             dropped_ids=(), total_count=1, dropped_count=1)
        return GateOutcome(value="", drop_event=drop, error=f"sql_rejected: {reason}")
