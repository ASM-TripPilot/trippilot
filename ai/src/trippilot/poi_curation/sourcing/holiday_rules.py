"""휴무 원문 → 휴일 규칙 (상황 감지 H1 · BR-SA-17).

`mapping._parse_rest_days` 는 휴무 원문에서 **매주 쉬는 요일만** 읽고 명절·공휴일·날짜 휴무(`_IRREGULAR_REST`)는
주간 스케줄로 못 써서 버린다. 여기는 그 버린 쪽을 읽는다 — 결과는 `Poi.holiday_rules`(닫힌 집합: 태그
`PUBLIC`·명절 6종·`BUDDHA` + 날짜 명시형 "MM-DD")이고, 판정은 특일 달력과 함께 `poi.open_windows_on` 이 한다.

**어휘는 실물 빈도로만 넣었다** — 공유본(`data/collected_pois.json` 59,469건, 휴무 원문 19,272건, 2026-10-19)의
괄호·비고를 뺀 절 빈도: `설·추석 연휴` 427 · `1월 1일` 424(+`1월1일` 38) · `설·추석 당일` 393 · `공휴일` 184 ·
`법정공휴일` 150(+`법정 공휴일` 50) · `명절` 126 · `설·추석` 77 · `명절 연휴` 36(+`명절연휴` 20) · `명절 당일` 35 ·
`근로자의 날` 20 · `국경일` 10 · `신정` 6 · `성탄절` 4 · `설·추석 전일 및 당일` 4 · `부처님 오신날` 1 · `삼일절`·`광복절`·
`어린이날` 각 1. `석가탄신일`·`크리스마스` 는 0건이라 넣지 않았다(mapping.py `_NOT_OPEN_SEGMENT` 의 교훈 —
감으로 만든 목록은 틀린다).

읽는 규칙:
- 명절 한정자는 그 자리대로 — `연휴` = 세 날, `전날`(`전일`)·`당일`·`다음날` = 그 날. **한정자 없는 맨
  `설날`·`추석`·`명절` 은 당일만**(원문이 말한 날만 — 넓혀 읽지 않는다). `명절` = 설·추석. 쉼표로 떨어진 한정자
  절(`설·추석 전날, 당일` — mapping `_HOLIDAY_TAIL`)은 앞 절의 명절에 붙는다.
- `공휴일`(법정·관공서·정부지정 …)·`국경일` → PUBLIC. `1월 1일`·`신정` 같은 날짜·이름 있는 날 → "MM-DD".
- 해석 못 하는 절은 **그 절만** 버린다(빈 규칙 — 지어내지 않는다). 다른 절의 규칙은 산다 — 절마다 닫는 날을
  더할 뿐이라, 모르는 절을 버려도 없는 휴무를 만들지 않는다.

함정(전부 규칙 없음):
- `공휴일 다음날 휴관` — 뜻이 뒤집힌다(공휴일엔 연다). 실물 20건 남짓(공휴일 규칙 약 420건의 5%)이라
  `PUBLIC_NEXT` 태그를 두지 않았다 — 규칙 없음 = 종전과 같다.
- `공휴일 정상 운영`·`… 개관` — 여는 날이다. 괄호·※ 안의 조건 단서(`월요일이 공휴일인 경우 다음 평일`)도 규칙이
  아니다 — 단 괄호가 휴무일 목록 자체면(`휴관일(1월 1일, 설날·추석 당일)`) 읽는다: 괄호 안 절이 **전부**
  해석될 때만 목록으로 본다(`(전쟁박물관은 …)` 같은 딴 시설 이야기·조건은 한 절이라도 해석이 안 된다).
- `임시 휴무`·`지정한 날`·`월 1회`·기간(`11월 1일 ~ 3월 31일 휴장`)·반나절(`설·추석 오전`)·`시설`의 설.
- 수식된 공휴일(`일요일을 제외한 법정공휴일`·`평일 법정공휴일`)·`대체공휴일` 단독 — PUBLIC 으로 넓히지 않는다.
- 여는 말이 휴무를 좁히는 꼴 — 여는 말로 끝나는 괄호(`공휴일(단, 3·1절과 광복절은 운영)`)는 **붙은 절**을,
  구분자로 떨어진 여는 절(`공휴일/정상운영`)은 **원문 전체**를 모른다. 괄호만 버리면 여는 날까지 닫는다.
  요일 절의 단서(`매주 월요일 (… 공휴일인 경우 정상 개관)`)는 그 절에 휴일 규칙이 없어 잃는 것이 없다.
- 시설 머리가 여럿(`- 전망대 (연중무휴)- 홍보관 (1월 1일 …)`) — `[A] … [B] …` 처럼 어느 시설의 휴무인지 모른다.
"""

from __future__ import annotations

import re

from trippilot.domain.poi import BUDDHA, CHUSEOK, PUBLIC_HOLIDAY, SEOLLAL, is_holiday_rule
from trippilot.poi_curation.sourcing.mapping import (
    _HOLIDAY_TAIL,
    _HOURS_REST_WORD,
    _RANGE_RE,
    _REST_BREAK,
    _REST_CLAUSE_SEP,
    _REST_PAREN,
    _REST_PERIOD,
    _REST_REMARK,
    _SECTION_HEAD,
)

# 절 하나를 낱말로 자른다 — 여기 없는 글자가 하나라도 남으면 그 절은 해석 못 한 것이다.
_TOKEN = re.compile(r"""
    (?P<sep>[ \t]*(?:[·∙ㆍ・]|및|과)[ \t]*)
  | (?P<ws>[ \t]+)
  | (?P<seol>(?<![가-힣])설(?:날)?(?=$|[^가-힣]|연휴|당일|전날|전일|다음|명절))
  | (?P<chuseok>추석)
  | (?P<myeongjeol>명절)
  | (?P<all>연휴(?:[ \t]*기간)?)
  | (?P<eve>전날|전일)
  | (?P<day>당일(?:만)?)
  | (?P<next>다음[ \t]*날)
  | (?P<public>(?:(?:법정|국정|국가|관공서의?|(?:정부|국가)[ \t]*지정)[ \t]*)*공휴일|국경일)
  | (?P<subst>대체[ \t]*(?:공휴일|휴일|휴무일))
  | (?P<date>\d{1,2}[ \t]*월[ \t]*\d{1,2}[ \t]*일)
  | (?P<named>신정|삼일절|근로자의[ \t]*날|어린이날|광복절|성탄절|부처님[ \t]*오신[ \t]*날)
  | (?P<weekday>(?:매주[ \t]*)?(?:[월화수목금토일]요일|주말|평일|주중))
  | (?P<rest>(?:정기[ \t]*)?(?:휴무|휴관|휴업|휴점|휴장|휴원|휴일)(?:일)?)
  | (?P<prefix>매년|매해)
""", re.VERBOSE)

_NAMED = {"신정": "01-01", "삼일절": "03-01", "근로자의날": "05-01", "어린이날": "05-05",
          "광복절": "08-15", "성탄절": "12-25", "부처님오신날": BUDDHA}
_QUAL = {"eve": 0, "day": 1, "next": 2}  # 명절 튜플(전날·당일·다음날)의 자리
_HOLIDAY_NAME = {"seol": SEOLLAL, "chuseok": CHUSEOK}
_INVISIBLE = re.compile(r"[﻿​]")
# 시설·시기 머리(`- 전망대 (연중무휴)- 홍보관 (1월 1일 …)`·`- 공원 : 연중무휴<br>- 감락원 : …`). 공유본 9건, 규칙이
# 붙던 4건은 전부 한 시설이 연중무휴다 — 딴 시설의 휴무를 장소 전체에 붙였다. 머리가 휴일 낱말이면(`- 설날 (…)`)
# 글머리표다.
_FACILITY_HEAD = re.compile(r"(?:^|(?<=[\s)）]))-[ \t]*([^\s\-/,()（）:·]+)[ \t]*[:(（]")
# 여는 말로 끝나는 괄호 — 붙은 절의 휴무를 좁히는 예외다(`공휴일(단, 3·1절과 광복절은 운영)`, 공유본 3건).
_OPEN_TAIL = re.compile(r"(?:개관|개장|운영|영업)(?:함|합니다)?\s*$")
# 여는 말뿐인 절(`공휴일/정상운영`) — 구분자 앞 어느 절을 여는지 모른다(공유본 0건).
_OPEN_CLAUSE = re.compile(r"(?:정상[ \t]*)?(?:운영|영업|개관|개장)(?:함|합니다|중)?\.?")


def parse_holiday_rules(rest_raw: str | None, hours_raw: str | None = None) -> frozenset[str]:
    """휴무 원문(+ 영업 원문 안의 휴무 줄) → 휴일 규칙. 못 읽으면 빈 집합 — 예외를 던지지 않는다.

    영업 원문은 시각 범위가 없고 휴무 낱말이 든 **줄**만 본다(`mapping._hours_rest_days` 와 같은 규칙) —
    `주말·공휴일 10:00~18:00` 은 공휴일에 **여는** 줄이다.
    """
    rules: set[str] = set()
    if rest_raw:
        rules |= _text_rules(rest_raw)
    if hours_raw:
        for line in _REST_BREAK.sub("\n", hours_raw).split("\n"):
            if not _RANGE_RE.search(line) and _HOURS_REST_WORD.search(line):
                rules |= _text_rules(line)
    return frozenset(rules)


def _text_rules(raw: str) -> set[str]:
    text = _INVISIBLE.sub("", _REST_BREAK.sub("\n", raw)).strip()
    if (not text or len(_SECTION_HEAD.findall(text)) > 1
            or sum(_clause(h) is None for h in _FACILITY_HEAD.findall(text)) > 1):
        return set()  # 구역·시설이 여럿이면 어느 시설의 휴무인지 모른다(mapping 의 `[A] … [B]` 와 같다)
    text = _REST_REMARK.sub("", text)  # ※ 비고는 그 줄 끝까지 버린다 — 안의 괄호도 같이
    # 괄호 단서는 걷어 내되, 여는 말로 끝나는 괄호가 붙은 절은 못 읽게 한다(NUL 은 낱말이 아니다)
    body = _REST_PAREN.sub(lambda m: "\0" if _OPEN_TAIL.search(m.group(0)[1:-1]) else " ", text)
    if any(_OPEN_CLAUSE.fullmatch(c.strip(" -")) for c in _REST_CLAUSE_SEP.split(body)):
        return set()
    rules: set[str] = set()
    for paren in _REST_PAREN.finditer(text):
        listed = _clauses(paren.group(0)[1:-1], strict=True)
        if listed is not None:
            rules |= listed  # 휴무일 목록 괄호 — 절이 전부 해석될 때만
    rules |= _clauses(body, strict=False) or set()
    return rules


def _clauses(text: str, *, strict: bool) -> set[str] | None:
    """절마다 읽어 더한다. strict 면 한 절이라도 못 읽으면 None(괄호를 통째로 버린다)."""
    rules: set[str] = set()
    names: tuple[tuple[str, ...], ...] = ()  # 앞 절이 남긴 명절 — 꼬리 한정자 절이 붙는다
    for clause in (c.strip(" -") for c in _REST_CLAUSE_SEP.split(text)):
        if not clause:
            continue
        if _HOLIDAY_TAIL.fullmatch(clause.replace(" ", "")) and names:
            rules |= _expand(names, {_qual_of(clause)})
            continue
        got = None if _REST_PERIOD.search(clause) else _clause(clause)
        if got is None:
            if strict:
                return None
            names = ()
            continue
        clause_rules, names = got
        rules |= clause_rules
    return {r for r in rules if is_holiday_rule(r)}


def _qual_of(word: str) -> str:
    word = word.replace(" ", "")
    return "all" if word == "연휴" else "eve" if word in ("전날", "전일") else "next" if word.startswith("다음") else "day"


def _clause(clause: str) -> tuple[set[str], tuple[tuple[str, ...], ...]] | None:
    """절 하나 → (규칙, 마지막 명절 묶음의 이름). 낱말로 다 못 자르거나 문법이 어긋나면 None."""
    tokens: list[tuple[str, str, str]] = []  # (종류, 원문, 앞 구분: "" | "ws" | "sep")
    pos, gap = 0, ""
    while pos < len(clause):
        m = _TOKEN.match(clause, pos)
        if m is None:
            return None
        kind = m.lastgroup
        if kind in ("ws", "sep"):
            gap = "sep" if kind == "sep" or gap == "sep" else "ws"
        else:
            tokens.append((kind, m.group(kind), gap))
            gap = ""
        pos = m.end()

    rules: set[str] = set()
    groups: list[tuple[list[str], set[str], set[str]]] = []  # (명절 이름, 이름 있는 날, 한정자)
    current: tuple[list[str], set[str], set[str]] | None = None
    prev_kind = ""
    for kind, text, gap in tokens:
        if kind in ("seol", "chuseok", "myeongjeol", "named"):
            if current is None or current[2]:  # 한정자 뒤 이름 = 새 묶음(`명절 당일 및 명절 전날`)
                current = ([], set(), set())
                groups.append(current)
            if kind == "named":
                current[1].add(_NAMED[re.sub(r"[ \t]", "", text)])
            else:
                current[0].append(kind)
        elif kind in ("all", "eve", "day", "next"):
            if current is None:
                return None  # 이름 없는 한정자(`연휴 및 공휴일`·`공휴일 다음날`) — 무슨 날인지 모른다
            if current[2] and gap != "sep":
                return None  # 한정자끼리 붙음(`연휴 다음날` = 연휴가 끝난 다음날) — 세 날 중 어느 것도 아니다
            current[2].add(kind)
        elif kind == "public":
            if prev_kind == "weekday" and gap != "sep":
                return None  # 수식된 공휴일(`평일 법정공휴일`) — 넓혀 읽지 않는다. `주말 및 공휴일` 은 목록이다
            rules.add(PUBLIC_HOLIDAY)
            current = None
        elif kind == "date":
            m = re.fullmatch(r"(\d{1,2})[ \t]*월[ \t]*(\d{1,2})[ \t]*일", text)
            token = f"{int(m.group(1)):02d}-{int(m.group(2)):02d}"
            if not is_holiday_rule(token):
                return None  # 없는 날짜(`2월 30일`)
            rules.add(token)
            current = None
        elif kind in ("weekday", "subst"):
            current = None  # 주간 휴무는 mapping 몫, 대체공휴일 단독은 규칙이 아니다
        prev_kind = kind  # rest·prefix 는 뜻이 없다(`명절 휴무`·`매년 1월 1일`)

    last: tuple[tuple[str, ...], ...] = ()
    for holidays, named, quals in groups:
        if named and quals - {"day"}:
            return None  # `성탄절 연휴` — 이름 있는 날은 그 날뿐이다
        rules |= named
        rules |= _expand(_names(holidays), quals or {"day"})
        last = _names(holidays)
    return rules, last


def _names(kinds: list[str]) -> tuple[tuple[str, ...], ...]:
    """`명절` = 설·추석. 설·추석을 직접 말했으면 뒤의 `명절` 은 같은 날을 다시 부른 것이다(`추석 명절`)."""
    named = tuple(dict.fromkeys(_HOLIDAY_NAME[k] for k in kinds if k in _HOLIDAY_NAME))
    if named:
        return named
    return (SEOLLAL, CHUSEOK) if "myeongjeol" in kinds else ()


def _expand(names: tuple[tuple[str, ...], ...], quals: set[str]) -> set[str]:
    out: set[str] = set()
    for triple in names:
        for qual in quals:
            out |= set(triple) if qual == "all" else {triple[_QUAL[qual]]}
    return out
