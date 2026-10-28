"""날마다 동네를 정해 일정 다시 짜기 — 말 읽기·날 확인 (spec 004, 편집 ①b). 순수 함수, LLM 0회.

"1일차는 종로 2일차는 강남구쪽으로 일정을 바꾸어줘" → (1일차 → 종로, 2일차 → 강남구).
챗봇의 해석 확인(`orchestrator/edit_day_areas.py`)과 편집 에이전트 ①b 가 **같은 함수**를 쓴다 — 두 쪽 해석이 갈리지 않는다.
동네 이름 → 좌표는 여기서 풀지 않는다(동네 표는 planb 소유라 형제 import 금지 L-2) — 경계(wiring)가 콘센트로 푼다.

자리 원칙(spec 003 FR-001 과 같다): 날·동네·바꾸기 말·채움말을 지운 나머지가 비어야 맡는다. 남는 말("카페 위주로"·"한 곳 넣어"·"비 와서")이
있으면 그 말이 뜻을 바꾼다 — None 으로 번역기·종전 경로에 넘긴다(오탐보다 미탐).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from trippilot.agents.edit.insert_between import _JOSA, _KIND_WORDS

# 날 표현 — 순번·상대·날짜·요일. 이 밖("다음 날"·"마지막에서 두 번째")은 읽지 않는다(넘겨짚지 않는다)
_DAY = re.compile(
    r"(?P<n>\d{1,2})\s?일\s?차"
    r"|(?P<ko>첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)\s?째\s?(?:날|날짜)?"
    r"|(?P<nth>\d{1,2}|첫|두|세|네|다섯)\s?번째\s?날"
    r"|(?P<first>첫\s?날)"
    r"|(?P<last>마지막\s?날|막\s?날)"
    r"|(?P<rel>내일\s?모레|오늘|내일|모레)"
    r"|(?:(?P<m>\d{1,2})\s?월\s?)?(?P<d>\d{1,2})\s?일(?!\s?(?:차|동안|간|째))"
    r"|(?P<wd>[월화수목금토일])\s?요일"
)
_KO = {"첫": 1, "둘": 2, "두": 2, "셋": 3, "세": 3, "넷": 4, "네": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9, "열": 10}
_REL = {"오늘": 0, "내일": 1, "모레": 2}
_WEEKDAYS = "월화수목금토일"
# 날 사이 잇는 말만 있으면 두 날이 한 동네를 같이 받는다("1일차랑 2일차는 종로로")
_JOIN = re.compile(r"^\s?(?:이랑|랑|와|과|하고|및|그리고|이나|나)?\s?,?\s?$")
# 날 말 바로 뒤 조사 — "1일차는"·"1일차를 종로로"·"1일차에 종로 쪽으로"·"1일차의 일정을"
_TOPIC = re.compile(r"^(?:에는|에도|만은|은|는|엔|에|도|만|을|를|의)(?=\s|$)")
# 동네 앞에 오는 일정 낱말("2일차 일정을 강남 쪽으로")
_SCHEDULE_WORD = re.compile(r"^(?:의)?(?:일정|동선|코스|계획|여행)(?:은|는|을|를|도|만)?$")
# 꼬리 — 공간 꼬리(쪽·근처…)는 표에 없는 이름도 동네로 받는 근거다("롯데월드 쪽으로"·"경복궁 근처로"). 위주·중심·편·권은 뜻이 '무엇
# 위주'라 표 이름에만 근거로 쓴다("한옥 위주로"·"역사 중심으로"는 종류 조건이다, 2026-10-23 2차 리뷰)
_SPATIAL = "쪽|근처|주변|일대|부근|방면"
_SUFFIX = rf"(?:{_SPATIAL}|위주|중심|권|편)"
_SUFFIX_TOKEN = re.compile(rf"^{_SUFFIX}(?:으로|로|에서|에|엔|은|는|도|만)?$")
_SUFFIX_TAIL = re.compile(rf"{_SUFFIX}(?:으로|로|에서|에|엔|은|는|도|만)?$")
_SPATIAL_AT = re.compile(rf"^(?:{_SPATIAL})")
# 행정·역 이름 꼴("망원동"·"마포구"·"합정역") — 세 글자 이상만 동네라고 말한 것으로 본다('이동'·'운동'·'지역'·'친구'는 아니다).
# 합성어 끝이 일반 낱말이면 아니다("야외활동"·"놀이기구"·"다른지역")
_ADMIN_TAIL = re.compile(r"^[가-힣]{2,}(?:구|동|역)$")
_ADMIN_NOT = re.compile(r"(?:활동|행동|이동|운동|지역|구역|친구|기구|도구|공구)$")
# 표에 없는 이름이 동네가 아닌 꼴 — 꾸밈말("가까운"·"짧은"·"조용한"·"다른"), 종류 말이 든 말("감성카페"·"한옥"·"브런치"), 숙소
_ADJECTIVE = re.compile(r"(?:운|은|는|인|한|던|른|된)$|^(?:다른|반대|딴|새|옛)$")
_KIND_IN = re.compile(r"카페|커피|디저트|빵집|베이커리|맛집|식당|밥집|음식|먹거리|맛|쇼핑|시장|백화점|소품|편집샵|야경|전망|공원|산책|자연|숲"
                      r"|박물관|미술관|전시|갤러리|술집|펍|체험|액티비티|놀거리|놀이|명소|관광|볼거리|구경|한옥|브런치|투어|핫플|노포|사진"
                      r"|고궁|역사|해변|바다|실내|실외|야외|힐링|휴식")
_LODGING = re.compile(r"숙소|호텔|게스트하우스|펜션|리조트|에어비앤비|민박|모텔|호스텔")
# 동네 낱말 끝의 조사 — '로'는 뺀다('종로'·'을지로'의 로는 조사가 아니다 — 표 대조가 뒤 '로'를 따로 본다)
_PARTICLE_TAIL = re.compile(r"(?:으로|에서|에|엔|은|는|도|만)$")
_NEGATE = frozenset("말고 말구 말곤 아니고 대신".split())
# 동네 자리에 오면 동네가 아닌 말 — 종류·분위기·때·지시어("2일차는 카페 위주로"는 종류 조건이다 — 번역기 몫)
_NOT_AREA = re.compile(
    rf"^(?:{_KIND_WORDS}|맛집|식당|음식점|카페|실내|실외|야외|자연|바다|산|휴식|힐링|조용한|여유|오전|오후|저녁|아침|낮|밤|새벽"
    r"|여기|거기|저기|그쪽|이쪽|저쪽|그곳|이곳|저곳|다른\s?곳|다른\s?데|동네|시내|근처|주변|가까운\s?곳|일정|하루|전체|전부|다|모두"
    r"|숙소|호텔|집|공항|역)$")
# 바꾸기 말 — '짜'는 '짜장면'이 아니게, '해'는 '해변'이 아니게 뒤를 본다. 지난 일('바꿨어'·'바꿨는데')은 요청이 아니다 — '바꿨으면'만
_VERB_WORD = re.compile(
    r"^(?:다시\s?)?(?:바꿔|바꾸어|바꾸|바꿨으면|바꿀|변경|옮겨|옮기|재구성|구성|조정|수정|재배치"
    r"|짜(?=줘|주|줄|봐|볼|서|고|여|인|자|요|면|$)|해(?=줘|주|줄|봐|볼|요|$)|하자)[가-힣]{0,7}$")
# 지난 일을 말하는 끝 — "바꿔줬어?"·"변경했어?"·"바꿔놨어"는 요청이 아니라 물음·알림이다(2026-10-23 2차 리뷰). '바꿨으면'은 바람이라 아니다
_PAST = re.compile(r"(?:했|됐|놨|줬|꿨|겼|었|았|였|웠)(?:어|니|나|지|잖|네|는|고|다|죠)")
# 나머지에 남아도 되는 말 — 이 밖의 낱말이 남으면 이 꼴이 아니다
_FILLER = frozenset("""지금 현재 이미 짜여진 짜여있는 짜인 짠 잡힌 잡혀있는 정해진 만든 만들어진 기존 원래 내 제 우리 일정 동선 코스 계획 여행
전체 전부 좀 그냥 혹시 그리고 하고 이고 고 및 싶은데 싶은데요 싶어 싶어요 싶다 원해 원해요 주세요 줘 줘요 줄래 줄래요 주라 줄 수
있어 있어요 있을까 있을까요 있나 있나요 가능해 가능해요 가능할까 가능할까요 부탁해 부탁해요 부탁 해 해요 요 다시 쪽 각각 따로
이렇게 그렇게 좋겠어 좋겠어요 좋겠다 근데 그럼 그러면 아 음 저기 주실래요 주시겠어요 주실 부탁드려요 부탁드립니다 바랍니다""".split())
_SPLIT = re.compile(r"[\s,.!?~…]+")
_LAUGH = re.compile(r"[ㅎㅋㅠㅜ^]+")
# 서술어 꼴 끝 — 동네 자리에 오면 동네가 아니다("보여줘"·"알려줄래"·"어때")
_ASK_TAIL = re.compile(r"(?:줘|줘요|주세요|줄래|줄래요|해|해요|하자|어때|할까|볼까|있어|없어|이야|예요|에요)$")
_NORM = re.compile(r"[\s\-·.,'\"()\[\]]+")


@dataclass(frozen=True, slots=True)
class DayClause:
    """말에서 읽은 한 절 — 날 말 하나 이상("1일차랑 2일차는 종로로")과 동네 말 하나.

    `key` = 동네 표 이름으로 읽혔으면 그 키(대화가 분류를 고칠 근거), `framed` = 꼬리·행정 꼴로 동네라고 말했는가.
    둘 다 아니면 절이 되지 못한다 — 아무 낱말("순서"·"점심"·"경복궁")이나 동네로 읽으면 한 곳 바꾸기·추천을 가로챈다(2026-10-23 리뷰)."""

    days: tuple[str, ...]
    area: str
    key: str | None = None
    framed: bool = False


@dataclass(frozen=True, slots=True)
class DayArea:
    day: date
    area: str


@dataclass(frozen=True, slots=True)
class DayAreaIssue:
    """날을 확정하지 못한 까닭 — 되묻기 재료. code ∈ day_out_of_trip · past_day · duplicate_day · ambiguous_day."""

    code: str
    said: str
    clauses: tuple[DayClause, ...]


def _clean_area(token: str) -> tuple[str, bool, bool]:
    """동네 낱말 → (꼬리·조사 뗀 말, 꼬리가 있었나, 공간 꼬리였나)."""
    t, framed, spatial = token, False, False
    while True:
        m = _SUFFIX_TAIL.search(t)
        if m and len(t) - len(m.group(0)) >= 2:
            framed, spatial = True, spatial or bool(_SPATIAL_AT.match(m.group(0)))
            t = t[:m.start()]
            continue
        cut = _PARTICLE_TAIL.sub("", t)
        if cut != t and len(cut) >= 2:
            t = cut
            continue
        return t, framed, spatial


def table_key(word: str, known: Iterable[str]) -> tuple[str, str] | None:
    """동네 표 이름 대조 → (키, 보일 이름). 키 + 행정·역 꼴 + 조사 '로'까지만 같다고 본다 — "강남구"·"홍대입구역"·"종로로"는
    맞고 "명동교자"·"강남스타일"은 아니다(부분 일치로 받으면 가게 이름을 동네로 읽는다)."""
    w = _NORM.sub("", word)
    for key in sorted(known, key=len, reverse=True):
        m = re.fullmatch(rf"({re.escape(key)}(?:\d가|입구역|입구|구|동|역)?)(?:으로|로)?", w)
        if m:
            return key, m.group(1)
    return None


def _not_area(word: str) -> bool:
    forms = {word, word[:-1] if len(word) > 2 and word.endswith("로") else word,
             word[:-2] if len(word) > 3 and word.endswith("으로") else word}
    return (not 2 <= len(word) <= 15 or not re.search(r"[가-힣A-Za-z]", word)
            or any(_NOT_AREA.match(f) or _DAY.fullmatch(f) or _VERB_WORD.match(f) or f in _FILLER or _ASK_TAIL.search(f)
                   for f in forms))


def _area_word(token: str, after: Sequence[str], known: Iterable[str]) -> tuple[str, str | None, bool, int] | None:
    """동네 낱말 하나 → (보일 이름, 표 키, 동네라고 말했나, 소비한 꼬리 낱말 수). 동네가 아니면 None."""
    word, framed, spatial = _clean_area(token)
    used = 0
    while used < len(after) and _SUFFIX_TOKEN.match(after[used]):
        framed, spatial = True, spatial or bool(_SPATIAL_AT.match(after[used]))
        used += 1
    for tail in ("을", "를", "로"):  # "강남을 중심으로"·"마포구로" — 뗀 꼴이 표 이름·행정 꼴일 때만 뗀다("북촌한옥마을"을 깎지 않는다)
        cut = word[:-1]
        if word.endswith(tail) and len(cut) >= 2 and (table_key(cut, known) or _admin(cut)):
            word = cut
            break
    if _not_area(word):
        return None
    hit = table_key(word, known)
    if hit is not None:
        return hit[1], hit[0], framed or _admin(word), used
    # 표에 없는 이름 — 공간 꼬리나 행정 꼴로 동네라고 말했을 때만, 꾸밈말·종류 말·숙소가 아닐 때만
    if _ADJECTIVE.search(word) or _KIND_IN.search(word) or _LODGING.search(word) or not (spatial or _admin(word)):
        return None
    return word, None, True, used


def _admin(word: str) -> bool:
    return bool(_ADMIN_TAIL.match(word)) and not _ADMIN_NOT.search(word)


def _area_of(body: str, known: Iterable[str]) -> tuple[DayClause, list[str]] | None:
    """절 몸통 → (동네 절(날 칸은 비움), 남은 낱말들). 동네가 없거나 동네가 아닌 말이면 None."""
    tokens = [t for t in _SPLIT.split(_TOPIC.sub("", body.strip())) if t]
    i = 0
    while i < len(tokens) and _SCHEDULE_WORD.match(tokens[i]):
        i += 1
    if i >= len(tokens):
        return None
    got = _area_word(tokens[i], tokens[i + 1:], known)
    if got is None:
        return None
    i += 1 + got[3]
    if i < len(tokens) and tokens[i] in _NEGATE:  # "종로 말고 강남으로" — 앞도 동네여야 한다("경복궁 말고 창덕궁으로"는 한 곳 바꾸기)
        if i + 1 >= len(tokens):
            return None
        got = _area_word(tokens[i + 1], tokens[i + 2:], known)
        if got is None:
            return None
        i += 2 + got[3]
    area, key, framed, _ = got
    return DayClause((), area, key, framed), tokens[i:]


def parse_day_areas(utterance: str, known: Iterable[str] = ()) -> tuple[DayClause, ...] | None:
    """날마다 동네를 정한 바꾸기 말만 잡는다 → 절 목록. 이 꼴이 아니면 None(번역기·종전 경로 몫).

    `known` = 동네 표 이름(`KNOWN_AREAS` 키 — planb 소유라 부르는 쪽이 넘긴다). 대화와 편집이 같은 표를 넘긴다."""
    known = tuple(known)
    text = " ".join(utterance.split())
    found = list(_DAY.finditer(text))
    if not found:
        return None
    rest: list[str] = _SPLIT.split(text[:found[0].start()])
    clauses: list[DayClause] = []
    group: list[str] = []
    for k, m in enumerate(found):
        group.append(m.group(0))
        body = text[m.end():found[k + 1].start()] if k + 1 < len(found) else text[m.end():]
        if k + 1 < len(found) and _JOIN.match(body):
            continue
        parsed = _area_of(body, known)
        if parsed is None:
            return None
        clause, left = parsed
        clauses.append(DayClause(tuple(group), clause.area, clause.key, clause.framed))
        rest.extend(w for tok in left for w in _SPLIT.split(_LAUGH.sub("", tok)))
        group = []
    verb = False
    for w in rest:
        if not w:
            continue
        if _PAST.search(w):
            return None  # 지난 일 — 요청이 아니다
        if _VERB_WORD.match(w):
            verb = True
        elif w not in _FILLER and _JOSA.sub("", w) not in _FILLER:
            return None
    return tuple(clauses) if verb else None


def day_of(said: str, days: Sequence[date], today: date) -> date | str:
    """날 말 → 여행 날 하나, 아니면 사유 코드. 순번은 여행 첫날 + N − 1(대화 `resolve_day` 와 같은 셈)."""
    m = _DAY.fullmatch(said)
    if m is None:
        return "day_out_of_trip"
    g = m.groupdict()
    first, last, inside = days[0], days[-1], set(days)
    n = (int(g["n"]) if g["n"] else _KO[g["ko"]] if g["ko"] else
         (int(g["nth"]) if g["nth"].isdigit() else _KO[g["nth"]]) if g["nth"] else 1 if g["first"] else None)
    if n is not None:
        on = first + timedelta(days=n - 1)
    elif g["last"]:
        on = last
    elif g["rel"]:
        on = today + timedelta(days=_REL.get(g["rel"].replace(" ", ""), 2))
    elif g["d"]:
        month, day = (int(g["m"]) if g["m"] else None), int(g["d"])
        hits = [x for x in days if x.day == day and (month is None or x.month == month)]
        if len(hits) > 1:
            return "ambiguous_day"
        on = hits[0] if hits else None
    else:
        hits = [x for x in days if x.weekday() == _WEEKDAYS.index(g["wd"])]
        if len(hits) > 1:
            return "ambiguous_day"
        on = hits[0] if hits else None
    return on if on is not None and on in inside else "day_out_of_trip"


def resolve_day_areas(clauses: Sequence[DayClause], trip_days: Sequence[date],
                      today: date) -> tuple[DayArea, ...] | DayAreaIssue:
    """절 → 여행 날마다 동네. 여행 밖·지난 날·같은 날 두 번이면 사유(되묻기 재료) — 넘겨짚어 다른 날을 고치지 않는다."""
    days = sorted(set(trip_days))
    if not days:
        return DayAreaIssue("day_out_of_trip", clauses[0].days[0], tuple(clauses))
    out: list[DayArea] = []
    for c in clauses:
        for said in c.days:
            on = day_of(said, days, today)
            if isinstance(on, str):
                return DayAreaIssue(on, said, tuple(clauses))
            if on < today:
                return DayAreaIssue("past_day", said, tuple(clauses))
            same = next((x for x in out if x.day == on), None)
            if same is not None and same.area == c.area:
                continue  # "24일 토요일은 종로로" — 한 날을 두 말로 가리켰을 뿐
            if same is not None:
                return DayAreaIssue("duplicate_day", said, tuple(clauses))
            out.append(DayArea(on, c.area))
    return tuple(sorted(out, key=lambda x: x.day))


def encode(pairs: Sequence[DayArea]) -> str:
    """FRAME 인자(문자열 하나, `Map<String,String>` 경계)로 — "2026-10-24=종로;2026-10-25=강남구"."""
    return ";".join(f"{p.day.isoformat()}={p.area}" for p in pairs)


def as_params(pairs: Sequence[DayArea]) -> dict[str, str]:
    """편집 명령 `SET_DAY_AREAS` params — {ISO 날짜: 동네}."""
    return {p.day.isoformat(): p.area for p in pairs}


def from_params(params: Mapping[str, object]) -> tuple[DayArea, ...] | None:
    """구조화 진입의 params → 짝. 날짜·동네가 하나라도 못 읽히면 None(형식 오류)."""
    out: list[DayArea] = []
    for k, v in params.items():
        try:
            on = date.fromisoformat(str(k))
        except ValueError:
            return None
        if not isinstance(v, str) or len(v.strip()) < 2:
            return None
        out.append(DayArea(on, v.strip()))
    return tuple(sorted(out, key=lambda x: x.day)) or None
