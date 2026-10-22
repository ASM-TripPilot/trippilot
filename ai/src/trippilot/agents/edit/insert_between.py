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

import re
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
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


_ADD = re.compile(r"추가|넣|끼워|끼우|들르|들를|하나\s?더|한\s?(군데|곳)|갈\s?만한|가\s?볼\s?만한|더\s?가")
_NOT_ADD = re.compile(r"빼(?!고)|삭제|지워|지우|없애|취소|대신|옮겨|옮기|바꿔|바꾸|순서")
# "추가하지 마"·"넣지 말아줘"·"안 넣어도 돼" — 더하지 말라는 말을 더하라는 말로 읽지 않는다
_NEG_ADD = re.compile(
    r"(?:추가|넣|끼우|끼워|들르)\S*?\s?(?:하지|지)\s?(?:마|말|않)|(?<![가-힣])안\s?(?:넣|추가|끼우|끼워|들르|들러)")
_MANY = re.compile(r"(두|세|네|2|3|4)\s?(군데|곳|개|개소)")
_BETWEEN = (
    re.compile(r"(?P<a>\S+(?:\s\S+)?)\s?에서\s?(?P<b>\S+?)\s?(?:으로|로)?\s?(?:넘어|이동|건너|옮겨\s?가|갈|가)\S*\s?(?:때|길|중|사이|중간|도중)"),
    re.compile(r"(?P<a>\S+?)\s?(?:이랑|랑|와|과|하고)\s?(?P<b>\S+?)\s?(?:사이|중간)"),
    re.compile(r"(?P<a>\S+?)\s?(?:다음에|다음|끝나고|보고\s?나서|들렀다가|후에|뒤에)\s?(?P<b>\S+?)\s?(?:가기\s?전|전에)"),
)
_AFTER = re.compile(r"(?P<a>\S+?)\s?(?:다음에|다음|끝나고|보고\s?나서|들렀다가|후에|뒤에)(?:\s|$)")
_BEFORE = re.compile(r"(?P<b>\S+?)\s?(?:(?:으로|로)?\s?가는\s?길|가기\s?전|전에)")
_JOSA = re.compile(r"(?:에서|으로|로|이랑|랑|와|과|하고|은|는|이|가|을|를|에)$")
# 종류 — 하나만 걸릴 때만 쓴다(둘 이상이면 종류 없음으로 — 오탐보다 미탐)
_KINDS: tuple[tuple[PoiCategory, re.Pattern[str]], ...] = (
    (PoiCategory.CAFE, re.compile(r"카페|커피|디저트|빵집|베이커리")),
    (PoiCategory.FOOD, re.compile(r"맛집|식당|밥집|음식점|먹을\s?(?:데|곳|만한)")),
    (PoiCategory.SHOPPING, re.compile(r"쇼핑|시장|백화점|소품|편집샵")),
    (PoiCategory.NIGHT_VIEW, re.compile(r"야경|전망")),
    (PoiCategory.NATURE, re.compile(r"공원|산책|자연|숲")),
    (PoiCategory.CULTURE, re.compile(r"박물관|역사|문화재")),
    (PoiCategory.ART, re.compile(r"미술관|전시|갤러리")),  # 2026-10-21 문화에서 갈라졌다(TRIP-1545)
    (PoiCategory.BAR, re.compile(r"술집|펍|칵테일|와인바|이자카야|호프")),
    (PoiCategory.ACTIVITY, re.compile(r"체험|액티비티|놀거리")),
    (PoiCategory.SIGHT, re.compile(r"명소|관광지|볼거리|구경")),
)
_NEGATED = r"\S*\s?(?:말고|말구|빼고|아닌|아니고|제외)"
_NIGHT = re.compile(r"야경|야간|밤|술집|펍|칵테일|와인|바(?![가-힣])")
# 이름 대조 정규화 — planb `request_verification.normalize` 와 같은 꼴(형제 agents import 금지 L-2 라 여기 둔다)
_NORMALIZE = re.compile(r"[\s\-·.,'\"()\[\]]+")
# 목적어가 **정해지지 않은 한 곳**일 때만 코드가 맡는다 — "효창공원(하나) 넣어줘"처럼 이름을 콕 집은 말은 번역기 몫이다
# (맨 "하나"는 이름 뒤에도 붙어 받지 않는다. 이름에 종류 낱말이 들어 있어도 — 효창'공원' — 앞에 한글이 붙으면 종류로 읽지 않는다)
_KIND_WORDS = "카페|커피|디저트|빵집|베이커리|맛집|식당|밥집|음식점|쇼핑|시장|백화점|소품샵|편집샵|야경|전망대|공원|산책|숲|박물관|미술관|전시|갤러리|술집|펍|체험|액티비티|명소|관광지|볼거리|구경"
_INDEFINITE = re.compile(
    r"(?<![가-힣])(?:한\s?(?:군데|곳)|하나\s?더|(?:어디|뭐|아무\s?(?:데|곳))(?:\s?하나)?"
    r"|(?:갈|가\s?볼|들를)\s?만\s?한\s?(?:곳|데)?|들를\s?(?:곳|데))"
    rf"|(?<![가-힣])(?:{_KIND_WORDS})\s?(?:하나|한\s?(?:곳|군데)|좀|같은\s?(?:곳|데))")


def _norm(name: str) -> str:
    return _NORMALIZE.sub("", name).lower()


def _end(text: str | None) -> str | None:
    if not text:
        return None
    t = _JOSA.sub("", text.strip())
    return t if len(_norm(t)) >= 2 else None


def parse_insert_ask(utterance: str) -> InsertAsk | None:
    """'사이·다음·전'에 **정해지지 않은 한 곳 더하기**만 잡는다 — 빼기·옮기기·바꾸기·여럿·이름 지목·부정은 None(번역기 몫)."""
    ask = parse_insert_place(utterance)
    return ask if ask is not None and _INDEFINITE.search(" ".join(utterance.split())) else None


def parse_insert_place(utterance: str) -> InsertAsk | None:
    """더하기 말의 **자리**만 — 목적어는 따지지 않는다. 이름을 콕 집은 말("효창공원을 경리단길 끝나고 넣어줘")은 번역기가 무엇을,
    코드가 어디를 맡는다(번역이 기준점을 빼면 이것으로 채운다)."""
    text = " ".join(utterance.split())
    if not _ADD.search(text) or _NOT_ADD.search(text) or _NEG_ADD.search(text) or _MANY.search(text):
        return None
    for pattern in _BETWEEN:
        m = pattern.search(text)
        if m and _end(m.group("a")) and _end(m.group("b")):
            return InsertAsk(Shape.BETWEEN, _end(m.group("a")), _end(m.group("b")), *_kind(text[m.end():]))
    m = _BEFORE.search(text)
    if m and _end(m.group("b")):
        return InsertAsk(Shape.BEFORE, None, _end(m.group("b")), *_kind(text[m.end():]))
    m = _AFTER.search(text)
    if m and _end(m.group("a")):
        return InsertAsk(Shape.AFTER, _end(m.group("a")), None, *_kind(text[m.end():]))
    return None


def _kind(rest: str) -> tuple[PoiCategory | None, bool, frozenset[PoiCategory]]:
    """(종류, 밤 여부, 뺄 종류). 낱말 앞에 한글이 붙은 것(효창공원·광장시장)은 이름의 일부라 종류로 읽지 않고,
    뒤에 '말고·빼고·아닌'이 붙은 것은 뺄 종류다("카페 말고 한 군데 더" — 카페를 고르면 반대로 읽은 것이다)."""
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


def _hits(text: str, slots: Sequence[SlotRef]) -> tuple[set[int], str]:
    key = _norm(text)
    tokens = [_norm(t) for t in text.split() if len(_norm(t)) >= 2]
    named = {i for i, s in enumerate(slots) if s.name and len(_norm(s.name)) >= 2
             and (_norm(s.name) in key or key in _norm(s.name) or any(t in _norm(s.name) for t in tokens))}
    if named:
        return named, "name"
    hit = region_center(text)
    if hit is None:
        return set(), "none"
    _, center, km = hit
    return {i for i, s in enumerate(slots) if s.coord is not None and haversine_km(center, s.coord) <= km}, "region"


def _run(indices: set[int]) -> tuple[int, int] | None:
    """연속 구간 하나면 (처음, 끝), 아니면 None."""
    if not indices:
        return None
    lo, hi = min(indices), max(indices)
    return (lo, hi) if hi - lo + 1 == len(indices) else None


def resolve_gap(slots: Sequence[SlotRef], ask: InsertAsk) -> Gap | str:
    """끝 말 → 그 날 이웃 짝. 못 풀면 사유 문자열(지어내지 않는다)."""
    if ask.shape is Shape.BETWEEN:
        a, by_a = _hits(ask.frm or "", slots)
        b, by_b = _hits(ask.to or "", slots)
        if not a:
            return "unresolved_from"
        if not b:
            return "unresolved_to"
        pairs = [i for i in sorted(a) if i + 1 in b and i + 1 not in a]
        if len(pairs) != 1:
            return "not_adjacent" if not pairs else "ambiguous_gap"
        return Gap(pairs[0], pairs[0] + 1, (by_a, by_b))
    if ask.shape is Shape.AFTER:
        a, by_a = _hits(ask.frm or "", slots)
        run = _run(a)
        if run is None:
            return "unresolved_from" if not a else "ambiguous_from"
        after = run[1]
        return Gap(after, after + 1 if after + 1 < len(slots) else None, (by_a,))
    b, by_b = _hits(ask.to or "", slots)
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

    def key(item: tuple[Poi, float]) -> tuple:
        # 양 끝이 있으면 **가운데에 가까운 곳** 먼저(두 끝까지 거리 중 짧은 쪽이 긴 곳) — 우회만 보면 끝점 바로 옆이 늘 0 이라
        # "넘어가는 길에 들를 곳"이 아니라 앞·뒤 일정의 옆집이 뽑힌다. 한쪽만 있으면(맨 앞·맨 끝) 가까운 곳 먼저
        p, d = item
        spread = (-min(haversine_km(a, p.coord), haversine_km(p.coord, b)) if a is not None and b is not None else d)
        return (d > slack_km / 2, TRENDING_TAG not in p.tags, -reputation_bonus(p.tags), 0 if p.open_hours else 1,
                -p.saved_count, round(spread, 1), round(d, 3), str(p.poi_id))

    return tuple(sorted(keep, key=key))
