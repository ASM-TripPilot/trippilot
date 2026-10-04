"""같은 장소 계열 판정 (TRIP-1181) — 순수 함수, LLM 0회·결정론.

**왜**: 후보 풀·점수·어셈블리·차선책 어디에도 계열 중복 억제가 없었다(제외는 poi_id 뿐).
TourAPI 는 산과 그 전망대, 관광특구와 그 안 해수욕장, 한 공원 안의 명소들을 각각 별도
레코드로 주고, 점수도 서로 비슷하게 높다 — 그래서 '황령산 전망대'(1일차)+'황령산'(2일차),
'남산공원'·'남산골한옥마을'·'남산 팔각정'(같은 날)이 한 일정에 함께 들어갔다(QA 6회차,
재현 8판 중 7판에서 계열 쌍 26건 — 진짜 이중 레코드는 0건, 부속·구역 8, 같은 단지 18).
사용자 결정(2026-10-02): 단지 안 다른 명소도 하루·여행에 1곳 — 대표 외는 **강등**(배제 아님).

**쌍 판정** (`same_family`) — 정규화 이름(괄호 접미·앞머리 시·도 토큰·공백·기호 제거) 기준:
  ① 좌표 ≤ 5m  ② 이름 포함관계 + ≤ 1.5km  ③ 한글 2자+ 공통 접두 + ≤ 700m
  맛집·카페(+ 이름이 음식 골목인 것)가 낀 쌍은 계열이 아니다 — 식당 밀집(같은 건물·먹자골목)은 정상이다.
  단 ④ 정규화 이름이 **완전히 같고** ≤ 200m 면 카테고리와 무관하게 계열이다 — 출처·카테고리만 다른
  한 장소다(TRIP-1228: '동문재래시장' 쇼핑 TOURAPI ↔ 맛집 MANUAL 148m 가 한 일정에 둘 다 들어갔다).
  실측(ACTIVE 1,138곳, 수작업 판정 141쌍): 계열 정밀도 85.8%, 알려진 계열 138쌍 대비 재현율 87.7%.
  시·도 이름을 지우지 않으면 '서울 우정총국'↔'서울 운현궁'·'부산시립미술관'↔'부산영화촬영스튜디오'
  같은 도시명 접두가 오탐의 대부분이었다. '국립'·'한국'·'중앙' 같은 기관·범용 접두도 같은 이유로 뗀다.
남은 오탐은 구·동·시 이름 접두('해운대'·'구로'·'강화'·'경주')다 — 떼면 '해운대해수욕장'↔'해운대
관광특구' 같은 진짜 계열도 잃는다. 배제가 아니라 강등이라 감수한다.

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
from trippilot.domain.poi import EATERY_NAME, Poi, PoiCategory

_SAME_COORD_KM = 0.005
_CONTAIN_KM = 1.5
_PREFIX_KM = 0.7
_PREFIX_MIN_HANGUL = 2
# ④ 이름까지 같은 같은 자리 — 맛집·카페가 껴도 계열이다. 반경 근거(2026-10-04 실측): 공유본+LOCALDATA
# 29,786곳에서 맛집·카페가 낀 동명 쌍 중 주소 키까지 같은 15쌍이 전부 174m 안이다(최대 '청산수목원'
# 수목원↔그 식당). 재현 쌍 '동문재래시장'(쇼핑 TOURAPI ↔ 맛집 MANUAL 시드)은 148m. 500m 로 넓히면
# 늘어나는 쌍은 전부 주소가 다르고 대부분 길이 다른 별개 가게다('가원갈비' 308m·'호남식당' 363m).
# 같은 가게의 교차 출처 좌표 차는 p95 52m(poi_curation/sourcing/mapping.py) — 넓은 시장·단지는
# 대표점이 갈려 더 벌어진다. 200m 안에서 새로 묶이는 25쌍 중 별개 가게로 보이는 것은 3쌍(LOCALDATA
# 동명 식당 57~154m)이고 체인 지점은 0 — 배제가 아니라 강등이라 감수한다.
_SAME_NAME_KM = 0.2

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
# 접두 규칙에서 시·도 이름 다음에 한 번 더 떼는 기관·범용 접두 — 같은 단지가 아니라 운영
# 주체·수식어다('국립현대미술관'↔'국립민속박물관' 350m·'조선왕릉 선릉'↔'조선호텔' 오탐).
_GENERIC_PREFIX = ("국립", "시립", "도립", "구립", "군립", "한국", "대한", "중앙", "시민", "조선")
# 먹자골목·음식 골목(EATERY_NAME — domain/poi.py)은 맛집·카페처럼 계열에서 뺀다
# ('자갈치 양곱창 골목'이 '자갈치 크루즈'를, '닭한마리 골목'이 DDP 를 눌렀다).
_PAREN = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_PUNCT = re.compile(r"[\s&·,.\-_'\"!?/:]+")
_EATERY = frozenset((PoiCategory.FOOD, PoiCategory.CAFE))


def normalize_name(name: str) -> str:
    """'남산공원(서울)' → '남산공원', '부산 영화의 전당' → '영화의전당'."""
    tokens = _PAREN.sub(" ", name).split()
    while len(tokens) > 1 and tokens[0] in _ADMIN:
        tokens = tokens[1:]
    return _PUNCT.sub("", "".join(tokens)).lower()


def _strip_one(name: str, prefixes: Sequence[str]) -> str:
    for head in prefixes:
        if name.startswith(head) and len(name) - len(head) >= 2:
            return name[len(head):]
    return name


def _bare(name: str) -> str:
    """접두 비교용 — 붙여 쓴 시·도 이름, 이어서 기관·범용 접두를 뗀다(남는 게 2자 미만이면 그대로)."""
    return _strip_one(_strip_one(name, _ADMIN_LONGEST_FIRST), _GENERIC_PREFIX)


@dataclass(frozen=True, slots=True)
class _Sig:
    poi: Poi
    name: str
    bare: str
    eatery: bool

    @staticmethod
    def of(poi: Poi) -> "_Sig":
        name = normalize_name(poi.name)
        return _Sig(poi, name, _bare(name),
                    poi.category in _EATERY or EATERY_NAME.search(name) is not None)


def _hangul_prefix(a: str, b: str) -> int:
    """공통 접두 안의 한글 음절 수."""
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += "가" <= x <= "힣"
    return n


def _related(a: _Sig, b: _Sig) -> bool:
    if a.eatery or b.eatery:
        # 식당 밀집은 계열이 아니다 — 이름까지 같은 같은 자리(④)만 묶는다. 비식당 쌍의 같은
        # 이름은 ② 포함관계가 이미 덮는다.
        return (len(a.name) >= 2 and a.name == b.name
                and haversine_km(a.poi.coord, b.poi.coord) <= _SAME_NAME_KM)
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
