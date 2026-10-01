"""같은 장소 계열 판정 (TRIP-1181) — 순수 함수, LLM 0회·결정론.

**왜**: 후보 풀·점수·어셈블리·차선책 어디에도 계열 중복 억제가 없었다(제외는 poi_id 뿐).
TourAPI 는 산과 그 전망대, 관광특구와 그 안 해수욕장, 한 공원 안의 명소들을 각각 별도
레코드로 주고, 점수도 서로 비슷하게 높다 — 그래서 '황령산 전망대'(1일차)+'황령산'(2일차),
'남산공원'·'남산골한옥마을'·'남산 팔각정'(같은 날)이 한 일정에 함께 들어갔다(QA 6회차,
재현 8판 중 7판에서 계열 쌍 26건 — 진짜 이중 레코드는 0건, 부속·구역 8, 같은 단지 18).
사용자 결정(2026-10-02): 단지 안 다른 명소도 하루·여행에 1곳 — 대표 외는 **강등**(배제 아님).

**쌍 판정** (`same_family`) — 정규화 이름(괄호 접미·앞머리 시·도 토큰·공백·기호 제거) 기준:
  ① 좌표 ≤ 5m  ② 이름 포함관계 + ≤ 1.5km  ③ 한글 2자+ 공통 접두 + ≤ 700m
  맛집·카페가 낀 쌍은 계열이 아니다 — 식당 밀집(같은 건물·먹자골목)은 정상이다.
  실측(ACTIVE 1,138곳, 수작업 판정 141쌍): 계열 정밀도 85.8%, 알려진 계열 138쌍 대비 재현율 87.7%.
  시·도 이름을 지우지 않으면 '서울 우정총국'↔'서울 운현궁'·'부산시립미술관'↔'부산영화촬영스튜디오'
  같은 도시명 접두가 오탐의 대부분이었다. 남은 오탐은 구·동 이름 접두('구로'·'강화')다.

**묶음은 점수순 스타** (`family_followers`) — 대표마다 **직접** 맞는 것만 그 계열원이다.
union-find 이행 폐포는 사슬로 번져('남산' 7곳·'강화' 5곳) 과강등했다: A~B, B~C 라고
A 와 C 가 같은 단지인 것은 아니다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence

from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import PoiId
from trippilot.domain.poi import Poi, PoiCategory

_SAME_COORD_KM = 0.005
_CONTAIN_KM = 1.5
_PREFIX_KM = 0.7
_PREFIX_MIN_HANGUL = 2

# 앞머리 시·도 이름. 이름 정규화(포함관계)에서는 **토큰 단위로만** 지운다 — '서울숲'·'부산역'
# 같은 한 토큰 이름을 깎으면 포함관계가 엉뚱하게 맞는다. 접두 규칙에서는 붙여 쓴 것도 지운다
# ('부산시립미술관'↔'부산영화촬영스튜디오'·'대구제일교회'↔'대구화교협회' 오탐).
_ADMIN = frozenset((
    "서울특별시", "서울시", "서울", "부산광역시", "부산", "대구광역시", "대구",
    "인천광역시", "인천", "광주광역시", "광주", "대전광역시", "대전", "울산광역시", "울산",
    "세종특별자치시", "세종", "제주특별자치도", "제주도", "제주", "경기도", "경기",
    "강원특별자치도", "강원도", "강원",
))
_ADMIN_LONGEST_FIRST = tuple(sorted(_ADMIN, key=len, reverse=True))
_PAREN = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_PUNCT = re.compile(r"[\s&·,.\-_'\"!?/:]+")
_EATERY = frozenset((PoiCategory.FOOD, PoiCategory.CAFE))


def normalize_name(name: str) -> str:
    """'남산공원(서울)' → '남산공원', '부산 영화의 전당' → '영화의전당'."""
    tokens = _PAREN.sub(" ", name).split()
    while len(tokens) > 1 and tokens[0] in _ADMIN:
        tokens = tokens[1:]
    return _PUNCT.sub("", "".join(tokens)).lower()


def _bare(name: str) -> str:
    """접두 비교용 — 붙여 쓴 시·도 이름까지 뗀다(남는 게 2자 미만이면 그대로)."""
    for admin in _ADMIN_LONGEST_FIRST:
        if name.startswith(admin) and len(name) - len(admin) >= 2:
            return name[len(admin):]
    return name


@dataclass(frozen=True, slots=True)
class _Sig:
    poi: Poi
    name: str
    bare: str

    @staticmethod
    def of(poi: Poi) -> "_Sig":
        name = normalize_name(poi.name)
        return _Sig(poi, name, _bare(name))


def _hangul_prefix(a: str, b: str) -> int:
    """공통 접두 안의 한글 음절 수."""
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += "가" <= x <= "힣"
    return n


def _related(a: _Sig, b: _Sig) -> bool:
    if a.poi.category in _EATERY or b.poi.category in _EATERY:
        return False
    km = haversine_km(a.poi.coord, b.poi.coord)
    if km <= _SAME_COORD_KM:
        return True
    if km > _CONTAIN_KM:
        return False
    if len(a.name) >= 2 and len(b.name) >= 2 and (a.name in b.name or b.name in a.name):
        return True
    return km <= _PREFIX_KM and _hangul_prefix(a.bare, b.bare) >= _PREFIX_MIN_HANGUL


def same_family(a: Poi, b: Poi) -> bool:
    """두 POI 가 같은 장소 계열인가 — 대칭·결정론."""
    return _related(_Sig.of(a), _Sig.of(b))


def family_followers(
    anchors: Sequence[Poi], ranked: Sequence[Poi]
) -> dict[PoiId, PoiId]:
    """{계열원 id: 그 대표 id} — 대표는 강등하지 않고 계열원만 강등한다.

    `anchors`(고정 블록 → 앞 일자 배치분)는 **무조건 대표**다 — 사용자가 고른 곳·이미
    배치된 곳은 후보가 아니라서 강등할 대상이 아니고, 그 계열의 후보를 눌러야 한다.
    `ranked` 는 호출측이 (점수↓, poi_id↑) 로 줄 세운 후보 — 앞에서부터 훑어 이미 정해진
    대표 중 하나와 **직접** 맞으면 첫 대표의 계열원, 아니면 새 대표다. 계열원끼리는 비교하지
    않는다(스타 — 사슬 금지).
    """
    leaders = [_Sig.of(p) for p in anchors]
    out: dict[PoiId, PoiId] = {}
    for p in ranked:
        me = _Sig.of(p)
        leader = next((ld for ld in leaders if _related(ld, me)), None)
        if leader is None:
            leaders.append(me)
        elif p.poi_id != leader.poi.poi_id:
            out[p.poi_id] = leader.poi.poi_id
    return out


def related_to_any(pois: Sequence[Poi], taken: Sequence[Poi]) -> frozenset[PoiId]:
    """`taken` 중 하나와라도 같은 계열인 `pois` 의 id — 차선책 후순위 판정용."""
    sigs = [_Sig.of(t) for t in taken]
    out = set()
    for p in pois:
        me = _Sig.of(p)
        if any(_related(me, t) for t in sigs):
            out.add(p.poi_id)
    return frozenset(out)
