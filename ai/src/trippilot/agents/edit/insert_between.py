"""두 슬롯 사이 넣기 — 발화 해석·자리 해소·후보 순위 (결정론, LLM 0회). 설계: `ai/specs/003-edit-insert-between/spec.md`.

```
"이태원에서 홍대로 넘어갈 때 한 군데 더"
  ─▶ parse_insert_ask   모양(BETWEEN·AFTER·BEFORE) + 양 끝 말 + 종류(없으면 None)·뺄 종류
  ─▶ resolve_gap        끝 말 → 그 날 슬롯 (이름 부분일치 → 지역 중심표 반경) → 이웃 짝 정확히 하나
  ─▶ segment_anchor     풀 중심·반경 — 우회 타원(초점 A·B, 우회 ≤ slack)을 덮는 가장 작은 원
  ─▶ rank_on_segment    우회 거리 필터 + 결정론 순위
```

못 읽거나 못 풀면 None·사유 문자열이다 — 지어내지 않고 번역기(LLM)로 넘긴다(`EditAgent.run`).
"""

from __future__ import annotations

import math
import re
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import date
from enum import Enum

from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint, PoiId, TransportMode
from trippilot.domain.poi import (
    NIGHTLIFE_TAG,
    TRENDING_TAG,
    HolidayCalendar,
    Poi,
    PoiCategory,
    counts_as_food,
    open_windows_on,
    reputation_bonus,
)
from trippilot.domain.region_centers import region_center
from trippilot.llm_gateway.gates.base import has_contact_like


class Shape(Enum):
    BETWEEN = "BETWEEN"
    AFTER = "AFTER"
    BEFORE = "BEFORE"


@dataclass(frozen=True, slots=True)
class InsertAsk:
    shape: Shape
    frm: str | None
    to: str | None
    kind: PoiCategory | None
    night: bool
    not_kinds: frozenset[PoiCategory] = frozenset()  # "카페 말고" — 후보에서 뺀다
    extra_clause: bool = False  # 자리 말 밖에 다른 서술절("점심 먹고")이 있다 — 어느 틈인지 단정하지 않는다


_ADD = re.compile(r"추가|넣|끼워|끼우|들르|들를|하나\s?더|한\s?(군데|곳)|갈\s?만한|가\s?볼\s?만한|더\s?가")
# 자리 말을 뺀 나머지에서만 본다 — "옮겨 갈 때"는 자리 말이다. '빼고'는 제외("카페는 빼고")라 따로 본다
_NOT_ADD = re.compile(r"빼(?!고)|삭제|지워|지우|없애|취소|대신|옮겨|옮기|바꿔|바꾸|순서")
# "추가하지 마"·"넣진 마"·"안 넣어도 돼"·"넣을 필요 없어" — 더하지 말라는 말을 더하라는 말로 읽지 않는다
# 부정은 더하기 동사에 붙은 꼴만 본다 — '예약 필요 없는 카페'의 '필요 없'은 조건이다(2026-10-22 2차 리뷰)
_NEG_ADD = re.compile(
    r"(?:추가|넣|끼우|끼워|들르)\S*?\s?(?:하지|지|진|지는|지도)\s?(?:마|말|않)"
    r"|(?<![가-힣])안\s?(?:넣|추가|끼우|끼워|들르|들러|해도)"
    r"|(?:추가|넣|끼우|끼워|들르)\S*\s?(?:필요\S{0,2}\s?없|건\s?별로|기\s?싫|고\s?싶지\s?않)")
_MANY = re.compile(r"(?:두|세|네|다섯|여섯|일곱|여덟|아홉|열|[2-9]|몇|여러)\s?(?:군데|곳|개)|두어|씩"
                   r"|(?:하나|한\s?곳)\s?(?:랑|하고|와|과|,)\s?\S{0,15}\s?(?:하나|한\s?곳)")
# 끝 말 한 낱말 — 길이를 묶는다(무공백 긴 말에서 역추적이 n³ 으로 늘었다, 2026-10-22 리뷰 실측 500자 5.8s)
_W = r"\S{1,15}"
_AFTER_WORDS = r"(?:바로\s?)?(?:다음에|다음으로|다음|끝나고|끝나면|보고\s?나서|들렀다가|갔다가|다녀와서|후에|이후에|직후에|뒤에)"
_BEFORE_WORDS = (r"(?:(?:으로|로)?\s?가는\s?길|(?:(?:들어|돌아|되돌아)?\s?가기|타기|들르기|도착하기)\s?(?:바로\s?|직)?전"
                 r"|(?:바로\s?|직)?전에)")
_POSITIONS: tuple[tuple[Shape, re.Pattern[str]], ...] = (
    (Shape.BETWEEN, re.compile(
        rf"(?P<a>{_W})\s?에서\s?(?P<b>{_W}?)\s?(?:으로|로|까지)?\s?(?:넘어|이동|건너|옮겨\s?가|갈|가)\S{{0,6}}\s?"
        r"(?:중간|도중|사이|때|길|중)")),
    (Shape.BETWEEN, re.compile(rf"(?P<a>{_W}?)\s?(?:이랑|랑|와|과|하고)\s?(?P<b>{_W}?)\s?(?:사이|중간)")),
    (Shape.BETWEEN, re.compile(rf"(?P<a>{_W}?)\s?{_AFTER_WORDS}\s?(?P<b>{_W}?)\s?(?:가기\s?전|전에)")),
    (Shape.BEFORE, re.compile(rf"(?P<b>{_W}?)\s?{_BEFORE_WORDS}")),
    (Shape.AFTER, re.compile(rf"(?P<a>{_W}?)\s?{_AFTER_WORDS}(?:\s|$)")),
)
_JOSA = re.compile(r"(?:에서|으로|까지|부터|로|이랑|랑|와|과|하고|은|는|이|가|을|를|에|도)$")
# 끝 말이 될 수 없는 말 — "바로 다음에"의 '바로'를 장소로 읽으면 다음 일치를 본다
_NOT_END = frozenset("바로 그 이 저 거기 오늘 내일 그날 거".split())
# 출발이 지금 있는 곳인 말("지금 있는 곳에서·숙소에서 연남동 가는 길에") — 사이가 아니라 B 앞이다
_HERE = re.compile(r"^(?:지금|여기|현재|있는\s?곳|현\s?위치|숙소|호텔|집)$")
# 하루 끝 — 꼴로 가른다(2026-10-22 2차 리뷰: '공항 다음에'·'마지막 일정 전에'가 끝으로 갔다). 일정에 그 이름이 없을 때만이다.
# 떠나는 곳(B 쪽 끝 말: "공항·숙소·서울역·KTX 타기 전에") = 마지막 슬롯 뒤. 하루 마지막(A 쪽: "일정 끝나고", "마지막 일정 다음에") = 같은 자리.
# "마지막 일정 전에"(B 쪽 '마지막')는 마지막 슬롯 앞이다
_DAY_END_TO = re.compile(r"^(?:숙소|호텔|집|\S*공항|\S*역|\S*터미널|기차|KTX|비행기|버스)$")
_DAY_END_FROM = re.compile(r"^(?:오늘\s?)?(?:마지막\s?)?(?:일정|코스)$|^마지막$")
_LAST_SLOT = re.compile(r"^마지막(?:\s?(?:일정|장소|코스|곳))?$")
# 동네 권역(반경 ≤ 이 값)은 하루 끝 말보다 먼저 본다 — '홍대입구역'은 홍대다. 광역('서울역'의 서울)만 하루 끝에 진다
_NEIGHBORHOOD_KM = 3.0
# 끝 말만으로 뜻이 서지 않는 말 — 앞 낱말과 붙여 읽는다("이태원 쪽", "마지막 일정", "오전 일정"). 부정 꼴은 붙이지 않는다
_GENERIC_END = re.compile(r"^(?:일정|코스|장소|곳|쪽|근처|앞|옆|뒤|주변|부근|건너편|입구|길)$")
_NEG_WORD = re.compile(r"(?:말고|말구|말곤|빼고|싫고|됐고|아니면|아니고)$")
# 자리 말 밖의 다른 서술절 — 행위 동사만("점심 먹고"·"구경하고"). '가보고 싶은데'(바람)·'조용하고 예쁜'(나열)·'데리고'는 절이 아니다
_CLAUSE = re.compile(r"(?<![가-힣])[가-힣]{0,4}(?:먹고|마시고|보고|구경하고|쇼핑하고|산책하고|놀고|쉬고|찍고)(?!\s?싶)(?=\s|$)")
# 종류 — 하나만 걸릴 때만 쓴다(둘 이상이면 종류 없음으로 — 오탐보다 미탐)
_KINDS: tuple[tuple[PoiCategory, re.Pattern[str]], ...] = (
    (PoiCategory.CAFE, re.compile(r"카페|커피|디저트|빵집|베이커리")),
    (PoiCategory.FOOD, re.compile(r"맛집|식당|밥집|음식점|먹을\s?(?:데|곳|만한)")),
    (PoiCategory.SHOPPING, re.compile(r"쇼핑|시장|백화점|소품|편집샵")),
    (PoiCategory.NIGHT_VIEW, re.compile(r"야경|전망")),
    (PoiCategory.NATURE, re.compile(r"공원|산책|자연|숲")),
    (PoiCategory.CULTURE, re.compile(r"박물관|역사|문화재")),
    (PoiCategory.ART, re.compile(r"미술관|전시|갤러리")),  # 2026-10-21 문화에서 갈라졌다(TRIP-1545)
    (PoiCategory.BAR, re.compile(r"술집|펍|칵테일|와인\s?바|재즈\s?바|루프탑\s?바|이자카야|호프|맥주")),
    (PoiCategory.ACTIVITY, re.compile(r"체험|액티비티|놀거리")),
    (PoiCategory.SIGHT, re.compile(r"명소|관광지|볼거리|구경")),
)
_NEGATED = r"\S*\s?(?:말고|말구|말곤|빼고|아닌|아니고|아니면|제외|싫고|됐고|없이)"
# 밤 말 — 술·클럽을 말했는데 밤 규칙이 술집을 빼면 반대로 읽은 것이다('미술관'의 술은 밤 말이 아니다)
_NIGHT = re.compile(r"야경|야간|밤|(?<![가-힣])술|맥주|한잔|클럽|펍|칵테일|와인|(?<![가-힣])바(?![가-힣])")
# 이름 대조 정규화 — planb `request_verification.normalize` 와 같은 꼴(형제 agents import 금지 L-2 라 여기 둔다)
_NORMALIZE = re.compile(r"[\s\-·.,'\"()\[\]]+")
# 목적어가 **정해지지 않은 한 곳**일 때만 코드가 맡는다 — "효창공원(하나) 넣어줘"처럼 이름을 콕 집은 말은 번역기 몫이다
_KIND_WORDS = "카페|커피|디저트|빵집|베이커리|맛집|식당|밥집|음식점|쇼핑|시장|백화점|소품샵|편집샵|야경|전망대|공원|산책|숲|박물관|미술관|전시|갤러리|술집|펍|체험|액티비티|명소|관광지|볼거리|구경"
_INDEFINITE = re.compile(
    r"(?<![가-힣])(?:한\s?(?:군데|곳)|하나\s?더|(?:어디|뭐|아무\s?(?:데|곳))(?:\s?하나)?"
    r"|(?:갈|가\s?볼|들를)\s?만\s?한\s?(?:곳|데)?|들를\s?(?:곳|데))"
    rf"|(?<![가-힣])(?:{_KIND_WORDS})\s?(?:하나|한\s?(?:곳|군데)|좀|같은\s?(?:곳|데))")
_ADD_WORD = re.compile(r"(?:추가|넣|끼워|끼우|들르|들를|들러)\S*")
# ①a 가 맡는 말의 나머지 — 자리·한 곳·더하기·종류·밤 말을 지우고 이것만 남아야 한다(그 밖의 낱말은 이름·교체·부정·다른 절일 수 있다)
_FILLER = frozenset("""더 좀 꼭 같이 하나 하나만 한 곳 데 군데 거 것 좋겠어 좋겠다 좋겠는데 좋겠어요 싶어 싶다 싶은데 싶어요 주세요 줘 줘요
줄래 줄래요 주라 해 해줘 해줘요 해줄래 해주세요 할래 하자 해요 요 있어 있어요 있을까 있을까요 있나 만한 만 수 정도 쯤 새로 추가로
괜찮은 좋은 예쁜 유명한 핫한 요즘 뜨는 인기 있는 어디 뭐 아무 어디든 아무데나 그냥 하루 저녁 오후 오전 낮
중간 도중 사이 길 오늘 내일 모레 지금 여기 현재 마지막""".split())


def _norm(name: str) -> str:
    return _NORMALIZE.sub("", name).lower()


def _end(text: str | None) -> str | None:
    if not text:
        return None
    t = text.strip()
    stripped = _JOSA.sub("", t)
    t = stripped if len(_norm(stripped)) >= 2 else t  # '종로'의 '로'는 조사가 아니다
    return t if len(_norm(t)) >= 2 and t not in _NOT_END else None


def _with_prev(text: str, start: int, raw: str | None) -> tuple[str | None, int]:
    """끝 말이 뜻이 안 서는 낱말(쪽·근처·일정·1자)이면 바로 앞 낱말을 붙인다 → (끝 말, 새 시작)."""
    if raw is None:
        return None, start
    core = _JOSA.sub("", raw.strip()) or raw
    if not (_GENERIC_END.match(core) or len(_norm(core)) < 2):
        return raw, start
    head = text[:start].rstrip()
    prev = head.rsplit(" ", 1)[-1] if head else ""
    if not prev or _NEG_WORD.search(prev):
        return raw, start
    return f"{prev} {raw}", start - (len(text[:start]) - len(head)) - len(prev)


def _position(text: str) -> tuple[Shape, str | None, str | None, int, int] | None:
    """첫 자리 말 — 꼴마다 끝 말이 유효한 첫 일치를 고른다(BETWEEN → BEFORE → AFTER). (꼴, A, B, 구절 시작, 구절 끝)."""
    for shape, pattern in _POSITIONS:
        for m in pattern.finditer(text):
            g = m.groupdict()
            raw_a, start = _with_prev(text, m.start(), g.get("a")) if g.get("a") is not None else (None, m.start())
            if g.get("b") is not None and g.get("a") is None:  # BEFORE — 끝 말이 구절 맨 앞
                raw_b, start = _with_prev(text, m.start(), g.get("b"))
            else:
                raw_b = g.get("b")
            a, b = _end(raw_a), _end(raw_b)
            if (shape is Shape.BETWEEN and a and b) or (shape is Shape.BEFORE and b) or (shape is Shape.AFTER and a):
                return shape, a, b, start, m.end()
    return None


# 자리 단서 — 이 말이 있는데 자리를 못 읽었으면 끝에 붙이지 않는다(번역이 기준점을 빼면 '반영됨' 위장, 2026-10-22 2차 리뷰 안전망)
_POSITION_CUE = re.compile(r"다음(?!\s?(?:날|주|달|번|여행))|뒤에|가기\s?전|전에|사이에|중간에|가는\s?길|넘어갈|넘어가는"
                           r"|끝나고|끝나면|들렀다가|갔다가|이후에|직후에|직전에")


def position_cue(utterance: str) -> bool:
    """더하기 말에 자리 단서가 있나 — 자리를 못 읽은 기준점 없는 추가를 끝에 붙이지 않을 때 본다."""
    text = " ".join(utterance.split())
    return bool(_ADD.search(text) and _POSITION_CUE.search(text) and not _NEG_ADD.search(text))


def parse_insert_ask(utterance: str) -> InsertAsk | None:
    """'사이·다음·전'에 **정해지지 않은 한 곳 더하기**만 잡는다 — 빼기·옮기기·바꾸기·여럿·이름 지목·부정·다른 절은 None(번역기 몫).

    자리·한 곳·더하기·종류 말을 지운 나머지가 채움말(`_FILLER`)뿐일 때만 맡는다 — 낱말 표에 없는 말이 남았다면 그 말이 뜻을 바꾼다
    (2026-10-22 리뷰: "효창공원 하나 더"·"카페 빼고 공원 하나"·"카페는 싫고"·"점심 먹고"를 결정론이 다른 안으로 바꿨다)."""
    text = " ".join(utterance.split())
    ask = parse_insert_place(text)
    found = _position(text) if ask is not None else None
    if ask is None or found is None or not _INDEFINITE.search(text):
        return None
    start, end = found[3], found[4]
    rest = _ADD_WORD.sub(" ", _INDEFINITE.sub(" ", text[:start] + " " + text[end:]))
    if "빼고" in rest and ask.kind is not None:
        return None  # "카페 빼고 공원 하나" — 교체일 수 있다(번역기가 REPLACE 로 옮긴다)
    for _, pattern in _KINDS:
        rest = re.sub(rf"(?<![가-힣])(?:{pattern.pattern})(?:{_NEGATED})?", " ", rest)
    rest = _NIGHT.sub(" ", rest)
    words = re.split(r"[\s,.!?~…]+", rest)
    return ask if all(not w or w in _FILLER or _JOSA.sub("", w) in _FILLER | {""} for w in words) else None


def parse_insert_place(utterance: str) -> InsertAsk | None:
    """더하기 말의 **자리**만 — 목적어는 따지지 않는다. 이름을 콕 집은 말("효창공원을 경리단길 끝나고 넣어줘")은 번역기가 무엇을,
    코드가 어디를 맡는다(번역이 기준점을 빼면 이것으로 채운다)."""
    text = " ".join(utterance.split())
    if not _ADD.search(text) or _NEG_ADD.search(text) or _MANY.search(text):
        return None
    found = _position(text)
    if found is None:
        return None
    shape, frm, to, start, end = found
    outside = text[:start] + " " + text[end:]
    if _NOT_ADD.search(outside):
        return None
    if shape is Shape.BETWEEN and frm is not None and _HERE.match(frm):
        shape, frm = Shape.BEFORE, None  # 지금 있는 곳 → B: 지금부터 B 앞이다
    extra = bool(_CLAUSE.search(outside) or _position(outside))
    return InsertAsk(shape, frm, to, *_kind(outside), extra_clause=extra)


def _kind(rest: str) -> tuple[PoiCategory | None, bool, frozenset[PoiCategory]]:
    """(종류, 밤 여부, 뺄 종류) — 자리 구절을 뺀 말 전체에서 읽는다("공원 하나 경리단길 다음에"). 낱말 앞에 한글이 붙은 것
    (효창공원·광장시장)은 이름의 일부라 종류로 읽지 않고, 뒤에 '말고·빼고·싫고'가 붙은 것은 뺄 종류다."""
    said, negated = set(), set()
    for cat, pattern in _KINDS:
        for m in re.finditer(rf"(?<![가-힣])(?:{pattern.pattern})", rest):
            (negated if re.match(_NEGATED, rest[m.end():]) else said).add(cat)
    wanted = [cat for cat, _ in _KINDS if cat in said and cat not in negated]
    return (wanted[0] if len(wanted) == 1 else None), bool(_NIGHT.search(rest)), frozenset(negated - said)


# ── 자리 해소 ────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class SlotRef:
    poi_id: PoiId
    name: str | None
    coord: GeoPoint | None


@dataclass(frozen=True, slots=True)
class Gap:
    after: int | None  # 그 날 순서 인덱스 — None 이면 맨 앞에 넣는다
    before: int | None  # None 이면 맨 끝
    resolved_by: tuple[str, ...]


def _hits(text: str, slots: Sequence[SlotRef], role: str) -> tuple[set[int], str]:
    """끝 말 → 슬롯 인덱스와 푼 방법. 이름 → 동네 권역 → 하루 끝(꼴별, `role` from|to) → 광역 순."""
    key = _norm(text)
    tokens = [_norm(t) for t in text.split() if len(_norm(t)) >= 2]
    named = {i for i, s in enumerate(slots) if s.name and len(_norm(s.name)) >= 2
             and (_norm(s.name) in key or key in _norm(s.name) or any(t in _norm(s.name) for t in tokens))}
    if named:
        return named, "name"
    hit = region_center(text)
    near: set[int] = set()
    km = 0.0
    if hit is not None:
        _, center, km = hit
        near = {i for i, s in enumerate(slots) if s.coord is not None and haversine_km(center, s.coord) <= km}
        if len(slots) > 1 and len(near) == len(slots):
            near = set()  # 그 날 슬롯을 다 덮는 지역은 가리키는 게 없다('서울역'의 서울 5km, 2026-10-22 리뷰)
    if near and km <= _NEIGHBORHOOD_KM:
        return near, "region"
    core = _JOSA.sub("", text) or text  # '집에'·'집으로'
    if role == "to" and (_DAY_END_TO.match(text) or _DAY_END_TO.match(core)):
        return set(), "day_end"
    if role == "to" and _LAST_SLOT.match(text):
        return set(), "last_slot"
    if role == "from" and (_DAY_END_FROM.match(text) or _DAY_END_FROM.match(core)):
        return set(), "day_end"
    return (near, "region") if near else (set(), "none")


def _run(indices: set[int]) -> tuple[int, int] | None:
    """연속 구간 하나면 (처음, 끝), 아니면 None."""
    if not indices:
        return None
    lo, hi = min(indices), max(indices)
    return (lo, hi) if hi - lo + 1 == len(indices) else None


def resolve_gap(slots: Sequence[SlotRef], ask: InsertAsk) -> Gap | str:
    """끝 말 → 그 날 이웃 짝. 못 풀면 사유 문자열(지어내지 않는다).

    하루 끝으로 가는 말(공항·숙소·서울역 가기 전에, 일정 끝나고)은 그 이름의 슬롯이 없으면 마지막 슬롯 뒤다 — 종전 끝 추가가 맞던 말을
    '못 알아들음'으로 바꾸지 않는다(2026-10-22 리뷰)."""
    if ask.extra_clause:
        return "ambiguous_clause"
    last = len(slots) - 1
    end_of_day = Gap(last, None, ("day_end",))
    if ask.shape is Shape.BETWEEN:
        a, by_a = _hits(ask.frm or "", slots, "from")
        b, by_b = _hits(ask.to or "", slots, "to")
        if by_a == "day_end":  # "오늘 일정 끝나고 숙소 가기 전에" — 하루 마지막에서 출발
            a = {last}
        if not a:
            return "unresolved_from"
        if by_b == "day_end":  # "경복궁에서 숙소 갈 때" — 경복궁이 마지막이어야 그 길이다
            return replace(end_of_day, resolved_by=(by_a, "day_end")) if max(a) == last else "not_adjacent"
        if by_b == "last_slot":
            b = {last}
        if not b:
            return "unresolved_to"
        pairs = [i for i in sorted(a) if i + 1 in b and i + 1 not in a]
        if len(pairs) != 1:
            return "not_adjacent" if not pairs else "ambiguous_gap"
        return Gap(pairs[0], pairs[0] + 1, (by_a, by_b))
    if ask.shape is Shape.AFTER:
        a, by_a = _hits(ask.frm or "", slots, "from")
        if by_a == "day_end":
            return end_of_day
        run = _run(a)
        if run is None:
            return "unresolved_from" if not a else "ambiguous_from"
        after = run[1]
        return Gap(after, after + 1 if after + 1 < len(slots) else None, (by_a,))
    b, by_b = _hits(ask.to or "", slots, "to")
    if by_b == "day_end":
        return end_of_day
    if by_b == "last_slot":  # "마지막 일정 전에" — 마지막 슬롯 앞
        return Gap(last - 1 if last > 0 else None, last, ("last_slot",))
    run = _run(b)
    if run is None:
        return "unresolved_to" if not b else "ambiguous_to"
    before = run[0]
    return Gap(before - 1 if before > 0 else None, before, (by_b,))


# ── 후보 ────────────────────────────────────────────────────────────────

# 우회 허용(직선 km) — "가는 길"의 폭. ponytail: 수단별 고정값, DEV 로그(edit_insert)의 within·tried 로 조정한다.
SLACK_KM: dict[TransportMode, float] = {TransportMode.WALK: 1.0, TransportMode.PUBLIC: 2.0, TransportMode.CAR: 5.0}
MAX_TRIES = 5
RADIUS_CAP_KM = 20.0


def segment_anchor(a: GeoPoint | None, b: GeoPoint | None, slack_km: float) -> tuple[GeoPoint, float]:
    """우회 ≤ slack 타원(장축 = d + slack)을 덮는 가장 작은 원 — 중점, 반지름 (d + slack)/2. 한쪽만 있으면 그 점, slack/2."""
    if a is not None and b is not None:
        center = GeoPoint((a.lat + b.lat) / 2, (a.lng + b.lng) / 2)
        return center, min((haversine_km(a, b) + slack_km) / 2, RADIUS_CAP_KM)
    point = a if a is not None else b
    assert point is not None
    return point, slack_km / 2


def _progress(a: GeoPoint, b: GeoPoint, x: GeoPoint) -> float:
    """A→B 에 투영한 X 의 진행률(0=A, 1=B) — 평면 근사(경도는 cos 위도 배). 수 km 구간이라 충분하다."""
    k = math.cos(math.radians((a.lat + b.lat) / 2))
    dx, dy = (b.lng - a.lng) * k, b.lat - a.lat
    length = dx * dx + dy * dy
    return 0.5 if length == 0 else ((x.lng - a.lng) * k * dx + (x.lat - a.lat) * dy) / length


def detour_km(a: GeoPoint | None, b: GeoPoint | None, x: GeoPoint) -> float:
    if a is not None and b is not None:
        return haversine_km(a, x) + haversine_km(x, b) - haversine_km(a, b)
    point = a if a is not None else b
    assert point is not None
    return 2 * haversine_km(point, x)


def _displayable(name: str) -> bool:
    text = name.strip()
    return 2 <= len(text) <= 60 and text.isprintable() and not has_contact_like(text)


def rank_on_segment(
    pois: Iterable[Poi], a: GeoPoint | None, b: GeoPoint | None, *, slack_km: float,
    exclude: Collection[PoiId], taken_names: Collection[str], kind: PoiCategory | None,
    not_kinds: Collection[PoiCategory], night: bool, day: date, holidays: HolidayCalendar | None,
) -> tuple[tuple[Poi, float], ...]:
    """우회 ≤ slack 인 등록 POI 를 결정론 순서로. 종류를 안 정했으면 먹는 곳은 다른 게 없을 때만.

    `taken_names` 는 일정에 이미 있는 곳의 이름 — 이름이 서로 들어가는 곳(경의선숲길 ↔ 경의선숲길공원)은 같은 곳이라 뺀다
    (2026-10-22 실측: 우회 0.06km 로 1등이 된 것이 바로 다음 슬롯의 옆 입구였다)."""
    taken = [n for n in (_norm(x) for x in taken_names) if len(n) >= 3]
    keep: list[tuple[Poi, float]] = []
    for p in pois:
        if (p.poi_id in exclude or p.category is PoiCategory.STAY or p.category in not_kinds
                or not _displayable(p.name) or any(n in _norm(p.name) or _norm(p.name) in n for n in taken)):
            continue
        if ((NIGHTLIFE_TAG in p.tags or p.category is PoiCategory.BAR)
                and not (night or kind in (PoiCategory.NIGHT_VIEW, PoiCategory.BAR))):
            continue  # 술집·클럽은 밤 말에만 — 낮 사이에 넣지 않는다
        if kind is not None and p.category is not kind:
            continue
        if open_windows_on(p, day, holidays) == ():  # 그 날 휴무가 증명된 곳(정보 없음은 막지 않는다)
            continue
        d = detour_km(a, b, p.coord)
        if d <= slack_km:
            keep.append((p, d))
    if kind is None:
        non_food = [(p, d) for p, d in keep if not counts_as_food(p)]
        keep = non_food or keep

    span = haversine_km(a, b) if a is not None and b is not None else None

    def key(item: tuple[Poi, float]) -> tuple:
        # 양 끝이 있으면 **길 위 가운데** 먼저 — A→B 에 투영한 진행률 t 가 0.5 에 가까운 곳, 같으면 우회가 작은 곳.
        # 우회만 보면 끝점 바로 옆이 늘 0 이라 앞·뒤 일정의 옆집이 뽑힌다(2026-10-22 실측: 다음 슬롯 옆 입구 0.06km). 끝점 옆
        # (t < 0.2·> 0.8, 구간 1km 이상)은 인기 키보다도 뒤다 — 재적재 데이터에서 B 옆 0.48km '요즘 인기' 암장이 1등이었다.
        # '두 끝까지 짧은 쪽이 긴 곳'으로 재면 우회 한도 가장자리(길에서 먼 곳)가 1등이 됐다(2차 리뷰 모의). 한쪽만 있으면 가까운 곳 먼저
        p, d = item
        if span is not None:
            t = _progress(a, b, p.coord)
            near_end, spread = span >= 1.0 and not 0.2 <= t <= 0.8, round(abs(t - 0.5), 1)
        else:
            near_end, spread = False, round(d, 1)
        nightish = NIGHTLIFE_TAG in p.tags or p.category in (PoiCategory.BAR, PoiCategory.NIGHT_VIEW)
        return (d > slack_km / 2, near_end, night and kind is None and not nightish, TRENDING_TAG not in p.tags,
                -reputation_bonus(p.tags), 0 if p.open_hours else 1, -p.saved_count, spread, round(d, 2), str(p.poi_id))

    return tuple(sorted(keep, key=key))
