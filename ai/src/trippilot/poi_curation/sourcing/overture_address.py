"""Overture 주소 → 우리 지역 코드가 붙는 주소. **좌표로 추측하지 않는다.**

## 왜 따로 있나

Overture 주소 칸은 자유 문자열이라 제각각이다 — 실측(서울·부산·제주 bbox 34,092곳):

    서울특별시 금천구 벚꽃로 278     정식. 그대로 풀린다
    금천구 벚꽃로 278              시도 없음
    부산 중구 영주동 91-7          시도 **약칭**
    서초동 1327-1                 동 이름만
    37-55 Yongdusan-gil         로마자 (한글 음절 0)
    (빈 칸)

지역 코드는 백엔드 `RegionResolver` 가 **주소 문자열로만** 붙인다(TRIP-359) — 안 풀리면
그 POI 는 어느 여행에도 안 걸린다. 그래서 복원이 수집량을 그대로 좌우한다.

## 세 가지만 쓴다 — 전부 **이름 대조**다

1. **시도 약칭 확장** — `부산` → `부산광역시`. 카탈로그 정식 명칭에서 접미어를 떼어 표를
   만든다(손으로 적으면 갈린다). 약칭이 가리키는 시도는 하나뿐이라 모호성이 없다.
2. **시군구 접두** — 첫 토큰이 시군구면 그 시도를 앞에 붙인다. 같은 이름의 시군구가 여러
   시도에 있으면(`중구`) 붙여 본 결과가 실제로 풀리는 것만 쓰고, **둘 이상 풀리면 포기한다.**
3. **동 표** — 공유본의 "풀리는" 주소에서 (동 → 시도·시군구) 표를 만든다. 한 구에서만
   쓰이는 동(95% 이상 한쪽)만 표에 넣는다.

## 최근접 이웃은 **배정에 쓰지 않는다** — 거부권만 준다

가장 가까운 아는 POI 의 시군구를 쓰면 경계에서 틀린다(실측 87.8%: `N서울타워` 가 용산↔중구
132m). 틀린 지역 코드는 조용히 엉뚱한 여행에 POI 를 노출하므로 안 넣는 것보다 나쁘다.

다만 **시도가 맞는지 보는 데는 충분하다.** 동 표가 깨진 주소에 걸리면 엉뚱한 데로 간다 —
`올림픽 수영장`(좌표 서울)이 주소의 `양덕동` 때문에 창원으로, `삼산타운…`(인천)이 `삼산동`
때문에 울산으로 갔다. 그래서 복원한 시도가 최근접 POI 의 시도와 다르면 **버린다**(32곳).
배정이 아니라 거부권이다.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from collections import Counter, defaultdict

from trippilot.domain.common import GeoPoint
from trippilot.poi_curation.sourcing.collection_gate import _haversine_m

# 시도 정식 명칭의 접미어 — 떼면 약칭이 된다
_SIDO_SUFFIX = ("특별자치도", "특별자치시", "특별시", "광역시", "도")
# 동 이름. 뒤에 한글이 붙으면 동이 아니다(`영주동길` 의 `영주동`)
# 행정 하위 단위 — 동뿐 아니라 **리·읍·면**도 본다. 동만 보면 군 지역 주소가 통째로 빠진다
# (`제주특별자치도 서귀포시 남원읍 신례리 산 2-1` 에서 시군구가 없으면 걸 데가 없다).
# 뒤에 한글이 붙으면 단위가 아니다(`영주동길` 의 `영주동` · `면회실` 의 `면`).
_SUBUNIT = re.compile(r"([가-힣]+\d*(?:동|리|읍|면))(?![가-힣])")
_HANGUL = re.compile(r"[가-힣]")
# 좌표 거부권이 쓰는 격자 칸 크기(도) — 1.1km 쯤
_CELL = 0.01
# 거부권을 행사할 최대 거리. 이보다 멀면 "아는 POI 가 없다"로 보고 통과시킨다
_VETO_RADIUS_M = 5000.0
# 동 표에 넣을 최소 쏠림 — 한 구에서만 쓰이는 동만 쓴다
_DONG_MAJORITY = 0.95
# 주소 맨 앞의 나라 이름 — Overture 가 붙여 보내는 것이 있다(`대한민국 부산광역시 기장군 …`)
_COUNTRY = frozenset({"대한민국", "한국", "KR", "Korea", "South"})

Regions = Sequence[tuple[str, str, str, str, bool]]


def sido_abbreviations(regions: Regions) -> dict[str, str]:
    """`{"부산": "부산광역시", "경남": "경상남도", "제주도": "제주특별자치도", …}`.

    **카탈로그에서 유도한다** — 손으로 적으면 카탈로그가 바뀔 때 갈린다(통합시 신설 등).
    네 가지 꼴을 만든다. 꼴은 모두 실데이터에서 관측한 것이다(꼴을 시도 전부에 적용하므로, 관측한 적 없는 키도 생긴다 —
    `대구광역`·`세종특별자치` 등):

        접미어 떼기       `부산광역시`   → `부산`      (Overture `부산 중구 영주동`)
        도 이름 축약       `경상남도`     → `경남`      (`경남 김해시 진례면`)
        축약 + 도         `제주특별자치도` → `제주도`    (`제주도 서귀포시 성산읍`)
        끝 글자 떼기       `부산광역시`   → `부산광역`  (TourAPI `부산광역 사하구 하단동 1195`,
                          `제주특별자치 서귀포시 색달동 …` — #1427 병합본 2건, TRIP-1471)
                          정확히 한 글자만 잘린 꼴만 잡는다(`제주특별` 같은 더 짧은 잘림은 못 잡는다 — 그런 주소는
                          수집 워크플로의 병합 직후 검사가 PR 전에 막는다).

    도 이름 축약은 한국어 관용(첫 글자 + 셋째 글자)이다 — `경상남도`·`전라북도`·`충청남도`
    처럼 네 글자 도 이름에만 쓴다. 다른 꼴에는 적용하지 않는다.
    """
    out: dict[str, str] = {}
    for _, name, _, level, _ in regions:
        if level != "SIDO":
            continue
        out.setdefault(name[:-1], name)                   # `부산광역시` → `부산광역` (잘려 온 원본)
        short = next((name[: -len(s)] for s in _SIDO_SUFFIX
                      if name.endswith(s) and len(name) > len(s)), None)
        if short is None:
            continue
        out.setdefault(short, name)
        if name.endswith("도"):
            # 도에만 `…도` 꼴을 만든다 — 전부 만들면 `부산도` 같은 없는 말이 생긴다
            out.setdefault(f"{short}도", name)            # `제주특별자치도` → `제주도`
            if len(name) == 4:
                out.setdefault(name[0] + name[2], name)   # `경상남도` → `경남`
    # 정식 명칭 자신은 키가 아니다 — 확장이 자기를 또 확장한다
    for _, name, _, level, _ in regions:
        if level == "SIDO":
            out.pop(name, None)
    return out


def expand_sido(address: str | None, abbrev: Mapping[str, str]) -> str:
    """첫 토큰이 시도 약칭이면 정식 명칭으로 바꾼다. 아니면 그대로 돌려준다.

    약칭이 가리키는 시도는 하나뿐이라(`부산` → 부산광역시) 모호성이 없다. 엉뚱한 확장은
    뒤의 시군구 검사에서 걸러진다 — `서울 식당 앞` 은 확장돼도 시군구가 없어 안 풀린다.
    """
    tokens = (address or "").split()
    if tokens and (full := abbrev.get(tokens[0])):
        return " ".join([full, *tokens[1:]])
    return address or ""


def dong_table(addresses: Iterable[str], regions: Regions,
                *, majority: float = _DONG_MAJORITY) -> dict[str, tuple[str, str]]:
    """풀리는 주소들에서 `{동 이름: (시도, 시군구)}` — **한 구에서만 쓰이는 동만.**

    같은 동 이름이 여러 구에 있으면(`신흥동` 은 전국에 여러 곳) 표에 넣지 않는다. 쏠림
    기준을 낮추면 소수 쪽이 조용히 틀린 구로 간다.
    """
    sido_names = {n for _, n, _, lvl, _ in regions if lvl == "SIDO"}
    sido_of = {c: n for c, n, _, lvl, _ in regions if lvl == "SIDO"}
    by_sido: dict[str, set[str]] = defaultdict(set)
    for _, name, sido_code, level, _ in regions:
        if level == "SIGUNGU":
            by_sido[sido_of.get(sido_code, "")].add(name)

    votes: dict[str, Counter] = defaultdict(Counter)
    for address in addresses:
        tokens = (address or "").split()
        if len(tokens) < 2 or tokens[0] not in sido_names:
            continue
        # 두 토큰 시군구(`창원시 진해구`)를 먼저 본다 — 한 토큰이 먼저 맞으면 구를 잃는다
        candidates = (" ".join(tokens[1:3]), tokens[1])
        gu = next((c for c in candidates if c in by_sido[tokens[0]]), None)
        if gu is None:
            continue
        for dong in set(_SUBUNIT.findall(address)):
            votes[dong][(tokens[0], gu)] += 1
    return {d: c.most_common(1)[0][0] for d, c in votes.items()
            if c.most_common(1)[0][1] / sum(c.values()) >= majority}


def resolve_address(
    address: str | None,
    regions: Regions,
    *,
    abbrev: Mapping[str, str],
    dongs: Mapping[str, tuple[str, str]],
    region_check: Callable[[str, Regions], str],
) -> str | None:
    """시군구까지 풀리는 주소, 아니면 None. `region_check` 는 백엔드 판정의 거울이다.

    약칭 확장 → 그대로 → 시군구 접두 → 동 표 순서다. **시군구 접두가 둘 이상 풀리면
    포기한다** — `중구 ○○동` 은 서울·부산·대구 … 어디든 될 수 있고, 하나를 고르는 근거가 없다.

    ## 접두를 붙이기 전에 머리를 정리한다

    실데이터에 **지역명이 이미 들었는데 꼴이 달라** 안 풀리는 주소가 있다. 그대로 접두를
    붙이면 지역이 두 번 적힌 주소가 나온다(2026-10-14 실측, 그냥 넣었으면 그대로 저장됐다):

        대한민국 부산광역시 기장군 기장읍 서부리  → 부산광역시 기장군 **대한민국 부산광역시 기장군** …
        경남 김해시 진례면 담안리              → 경상남도 김해시 **경남 김해시** 진례면 …
        제주도 서귀포시 성산읍 일출로269         → 제주특별자치도 서귀포시 **제주도 서귀포시** …

    그래서 `대한민국` 을 떼고, 약칭을 정식 명칭으로 바꾼 **뒤에** 판정한다. 위 셋은 모두
    머리 정리만으로 풀려서 접두 경로에 가지 않는다.
    """
    raw = (address or "").strip()
    if not raw or not _HANGUL.search(raw):
        return None
    if (tokens := raw.split()) and tokens[0] in _COUNTRY:
        raw = " ".join(tokens[1:])
    expanded = expand_sido(raw, abbrev).strip()
    # **빈 문자열을 `region_check` 에 넘기지 않는다.** 그 함수는 백엔드 판정의 거울이라
    # `tokens[0]` 을 그대로 읽고 IndexError 를 낸다 — 나라 이름만 있는 주소(`대한민국`)가
    # 머리 정리 뒤 빈 문자열이 되어 실데이터에서 터졌다. 거울을 고치는 대신 여기서 막는다.
    if not expanded:
        return None
    if region_check(expanded, regions) == "sigungu":
        return expanded

    sido_of = {c: n for c, n, _, lvl, _ in regions if lvl == "SIDO"}
    by_sido: dict[str, set[str]] = defaultdict(set)
    for _, name, sido_code, level, _ in regions:
        if level == "SIGUNGU":
            by_sido[sido_of.get(sido_code, "")].add(name)

    # **두 토큰 시군구를 먼저 본다** — 카탈로그 이름이 `창원시 진해구` 다. 한 토큰만 보면
    # `창원시` 가 카탈로그에 없어 통째로 포기한다(테스트가 잡은 빈틈, `dong_table` 은 보던 것).
    # 머리를 정리해도 지역명이 남아 있으면 **접두를 붙이지 않는다** — 붙이면 두 번 적힌다.
    # 꼴이 우리가 모르는 변종이라는 뜻이므로, 지어 붙이는 대신 포기하는 쪽이 맞다.
    sido_names = {n for _, n, _, lvl, _ in regions if lvl == "SIDO"}
    if any(n in expanded for n in sido_names):
        return None

    sido_of = {c: n for c, n, _, lvl, _ in regions if lvl == "SIDO"}
    by_sido: dict[str, set[str]] = defaultdict(set)
    for _, name, sido_code, level, _ in regions:
        if level == "SIGUNGU":
            by_sido[sido_of.get(sido_code, "")].add(name)

    # **두 토큰 시군구를 먼저 본다** — 카탈로그 이름이 `창원시 진해구` 다. 한 토큰만 보면
    # `창원시` 가 카탈로그에 없어 통째로 포기한다(테스트가 잡은 빈틈, `dong_table` 은 보던 것).
    tokens = expanded.split()
    if not tokens:          # 머리를 떼고 나니 아무것도 안 남았다(`대한민국` 하나뿐인 주소)
        return None
    heads = [" ".join(tokens[:2]), tokens[0]] if len(tokens) >= 2 else [tokens[0]]
    for head in heads:
        prefixed = [f"{sido} {expanded}" for sido, gus in by_sido.items()
                    if head in gus and region_check(f"{sido} {expanded}", regions) == "sigungu"]
        if len(prefixed) == 1:
            return prefixed[0]
        if len(prefixed) > 1:
            return None   # 모호하다 — 고르지 않는다

    for dong in _SUBUNIT.findall(expanded):
        if (hit := dongs.get(dong)) is None:
            continue
        guessed = f"{hit[0]} {hit[1]} {expanded}"
        if region_check(guessed, regions) == "sigungu":
            return guessed
    return None


class SidoVeto:
    """좌표가 복원된 시도를 **거부**할 수 있게 한다 — 배정은 하지 않는다.

    아는 POI(공유본)의 좌표·시도로 격자를 만들고, 물어본 좌표의 최근접 시도를 돌려준다.
    5km 안에 아는 POI 가 없으면 None — 판단을 보류한다(거부도 승인도 아니다).
    """

    def __init__(self, known: Iterable[tuple[GeoPoint, str]]) -> None:
        self._grid: dict[tuple[int, int], list[tuple[GeoPoint, str]]] = defaultdict(list)
        for point, sido in known:
            key = (round(point.lat / _CELL), round(point.lng / _CELL))
            self._grid[key].append((point, sido))

    def nearest_sido(self, lat: float, lng: float) -> str | None:
        here = GeoPoint(lat, lng)
        gy, gx = round(lat / _CELL), round(lng / _CELL)
        best: str | None = None
        best_d = _VETO_RADIUS_M
        # 고리를 넓히며 찾고, 뭔가 찾은 고리에서 멈춘다 — 한 칸이 1.1km 라 충분하다
        for radius in (1, 2, 3, 4):
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    for point, sido in self._grid.get((gy + dy, gx + dx), ()):
                        d = _haversine_m(here, point)
                        if d < best_d:
                            best, best_d = sido, d
            if best is not None:
                return best
        return None

    def rejects(self, address: str, lat: float, lng: float) -> bool:
        """복원한 주소의 시도가 좌표와 어긋나면 True. 아는 POI 가 없으면 False(보류)."""
        near = self.nearest_sido(lat, lng)
        if near is None:
            return False
        tokens = address.split()
        return bool(tokens) and tokens[0] != near


# 같은 이름이 이 거리 안에 있으면 같은 곳이다 — 수집 게이트 ㉠ 과 같은 값
_SAME_PLACE_M = 50.0


class SamePlaceIndex:
    """공유본에 **이름이 같고 50m 안인 POI** 가 있는지 — 카테고리를 보지 않는다.

    ## 왜 게이트로 안 되나

    수집 게이트 3단은 이 쌍을 둘 다 놓친다(2026-10-14 실측, 부산 `황령산 봉수대` 좌표 0m):

    - ㉠ 이름+50m 은 **같은 카테고리**일 때만 병합한다. 공유본 쪽을 NIGHT_VIEW 로
      재분류했더니 SIGHT 후보와 짝이 안 맞아 통과했다 — **재분류가 dedup 을 깬다.**
    - ㉢ 주소+상호는 `addr_key`(시도·시군구·도로명·건물번호)를 쓰는데, 지번 주소
      (`부산진구 전포동 50-1`)엔 도로명이 없어 키가 안 만들어진다.

    게이트의 카테고리 조건을 푸는 쪽은 LOCALDATA 경로까지 흔들어서, 이 출처에만 거는
    좁은 가드로 둔다. 같은 이름이 같은 자리에 있으면 같은 곳이고, 카테고리가 다른 것은
    **우리가 한쪽을 고쳤다는 뜻**이라 새 행을 만들 이유가 없다.
    """

    def __init__(self, known: Iterable[tuple[str, GeoPoint]]) -> None:
        self._by_name: dict[str, list[GeoPoint]] = defaultdict(list)
        for name, point in known:
            self._by_name[(name or "").strip()].append(point)

    def has(self, name: str, lat: float, lng: float,
            *, radius_m: float = _SAME_PLACE_M) -> bool:
        here = GeoPoint(lat, lng)
        return any(_haversine_m(here, p) <= radius_m
                   for p in self._by_name.get((name or "").strip(), ()))
