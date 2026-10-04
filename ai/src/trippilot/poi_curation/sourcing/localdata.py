"""LOCALDATA 일반음식점 → 등록 제안 — 식당 공백 지역 보강 (TRIP-1224).

**왜 있나.** TourAPI 음식점은 전수 수집이 끝났는데도 숙소 12,936곳 중 22.9% 가 반경 7km 안
식당 6곳 미만이다(군 지역 49.6%, 0곳 4.0% — 2026-10-02 실측). 카카오 장소는 약관상 저장할 수
없고, Overture 는 공백 숙소 표본 20곳 중 7곳을 못 채웠다. 지방행정 인허가 대장의 **일반음식점
표준데이터**(data.go.kr 15096283, 이용허락범위 제한 없음)는 영업 상태를 함께 주고, 공백 숙소의
94% 에 2km 안 식당을 1곳 이상 준다(반박 검증 실측).

**공백 지역에만 넣는다.** 영업 중인 채택 업태만 47만 곳이라 통째로 넣으면 후보 풀이 동네 식당
대장이 된다. TourAPI 식당이 모자란 앵커 둘레에서 가까운 몇 곳만 고르고(`gap_anchors` →
`pick_near`), 고른 것도 기존 수집 게이트를 그대로 태워 TourAPI 와 같은 가게는 병합으로 뺀다
(`gate_against_tourapi`).

순수 함수만 둔다 — CSV 읽기·좌표 변환(EPSG:5174 → WGS84, pyproj)·파일 쓰기는
`ai/scripts/collect_localdata.py` 몫이고 변환기는 주입받는다. 산출은 TourAPI 와 같은 **등록
제안** 문서일 뿐이다 — 백엔드 C7 수신 게이트를 다시 탄 뒤에야 후보가 된다(INV-1).
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Generic, TypeVar

from trippilot.domain.common import GeoPoint
from trippilot.domain.poi import PoiCategory
from trippilot.poi_curation.sourcing.collection_gate import (
    CollectionGate,
    GatePass,
    SourcingCandidate,
    _haversine_m,  # 게이트와 같은 거리 — 반경 판정이 게이트 판정과 어긋나지 않게
)
from trippilot.poi_curation.sourcing.mapping import extract_region
from trippilot.poi_curation.sourcing.pipeline import SCHEMA_VERSION

SOURCE_NAME = "LOCALDATA"   # 백엔드 PoiSource 어휘 (V2.61 poi_source_check)
SOURCE = "localdata"        # SourcingCandidate.source — 잠정 ID `localdata-<관리번호>`
KIND = "일반음식점"           # 인허가 업종 (SourcingCandidate.kind — TourAPI 의 contentTypeId 자리)
# 영업 중 표기. `scripts/match_business_status.py` 의 OPEN_STATUS 와 같은 값이다 — 원본의
# 영업상태명은 이것과 `폐업` 두 값뿐이다(2026-09 원본 229만 행 실측).
OPEN_STATUS = "영업/정상"

# ── 업태: 채택 목록 ───────────────────────────────────────────────────
# **채택 목록이지 배제 목록이 아니다** — 원본이 업태를 하나 늘려도 조용히 새어들지 않는다
# (Overture 채택 목록과 같은 원칙). 원본 영업 중 67.6만 행의 업태 30종을 세어 끼니를 먹으러
# 가는 곳만 골랐다. 뺀 것과 이유(영업 중 건수):
#   주점 — 호프/통닭 5.9만 · 정종/대포집/소주방 1.3만 · 감성주점 1,446 · 라이브카페 1,152
#   카페 — 까페 3,688 · 키즈카페 250 · 전통찻집 154 · 커피숍 2 · 기타 휴게음식점 1
#     (끼니가 아니다. 카페는 FOOD 공백을 메우지도 못한다)
#   자리가 없는 영업 — 출장조리 487 · 푸드트럭 173 · 이동조리 28 (찾아갈 수 있는 매장이 아니다)
#   기타 10.3만 — 표본 60곳 중 절반이 카페·맥주집·당구장·스크린골프였다. 상호로 가를 수 없어
#     통째로 뺐다. 빼고도 공백 숙소 2km 커버리지 93.8%(넣으면 94.9%) — 반박 검증 실측
#   빈 값 46
# '통닭(치킨)'(1만)은 주점 업태 '호프/통닭'과 별개인 치킨 전문점이라 남겼다.
ADOPTED_TYPES: frozenset[str] = frozenset({
    "한식", "식육(숯불구이)", "분식", "경양식", "중국식", "일식", "횟집", "통닭(치킨)",
    "외국음식전문점(인도,태국등)", "탕류(보신용)", "김밥(도시락)", "뷔페식", "패스트푸드",
    "냉면집", "패밀리레스트랑", "복어취급",
})

# ── 이름: 관광과 무관한 식당 ─────────────────────────────────────────
# 업태는 식당인데 여행자가 끼니를 먹으러 갈 수 없는 곳. 공백 앵커는 대개 시골이라 가까운 순으로
# 고르면 골프장 그늘집·공단 구내식당이 앵커 몫(K)을 먼저 채운다 — 실측: 이 규칙 없이 고른
# 11,527곳 중 골프장 시설 98 · 구내·직원식당 31 · 장례식장 13 · 보신탕 7 · 예식장 6.
# 규칙은 **넓히지 않는다** — `학교`·`회사`·`병원`·`급식`·`그늘집`·`CC` 를 그대로 걸면
# 육식사관학교(고깃집)·주식회사 ○○(법인 식당)·○○병원점·특급식당·시청앞그늘집·씨씨엘치킨이
# 죽는다(테스트 `_SURVIVORS` 가 실제 상호로 고정).
_NOT_A_MEAL_STOP: tuple[tuple[str, re.Pattern[str]], ...] = (
    # 구내·직원·학생식당과 급식 — 학교·회사·병원·관공서 안의 식당. 병원은 '병원식당'만
    # (병원 앞·안의 일반 식당 '○○병원점'은 손님을 받는다). '급식'은 '특급식당'·'국가대표급
    # 식육식당'이 걸려 급식소·급식센터·급식실·단체급식·'○○급식'(끝)으로 좁혔다.
    ("cafeteria",
     re.compile(r"구내식당|직원식당|사원식당|학생식당|교직원식당|급식(소|센터|실)|단체급식|급식$|병원\s*식당")),
    # 장례식장 식당 — 조문객 식당이다.
    ("funeral", re.compile(r"장례")),
    # 예식장 뷔페 — 하객 식당이다. '예식'만 걸면 '상예식당'이 걸린다.
    ("wedding", re.compile(r"웨딩|예식장")),
    # 골프장 시설(그늘집·스타트하우스·클럽하우스 식당)과 스크린골프 — 골퍼만 들어간다.
    # 'CC·GC·씨씨'는 상호 일부일 수 있어(씨씨엘치킨·케이씨씨점) 시설어가 뒤따를 때만,
    # '그늘집'은 골프장 밖 식당 상호로도 흔해(시청앞그늘집·그늘집냉면) 단독으로는 안 건다.
    # 체력단련장 = 군 골프장.
    ("golf",
     re.compile(r"골프|컨트리\s*클럽|스타트하우스|체력단련장"
                r"|(?:(?<![A-Za-z])(?:CC|GC)(?![A-Za-z])|씨씨).*(?:그늘집|하우스|식당)")),
    # 개고기 — 개식용종식법으로 2027-02 까지 문을 닫는 업종이다. '영양탕'은 흔한 완곡어라 걸되,
    # 흑염소·오리 영양탕은 남긴다. 닭·잡탕 영양탕 몇 곳이 같이 빠지는 것은 감수한다.
    ("dog_meat", re.compile(r"보신탕|사철탕|(?<!오리)(?<!염소)영양탕")),
)

# ── 주소: 옛 시도 명칭 → 카탈로그 정식 명칭 ─────────────────────────
# 백엔드 `RegionResolver` 는 주소 첫 토큰이 카탈로그(R__seed_region_catalog) 시도 정식 명칭과
# **같아야** 지역 코드를 붙인다 — 못 붙이면 커버리지에서 조용히 빠진다(regionUnresolved).
# 2026-09 원본은 이미 정식 명칭만 쓰지만(채택 행 전수 실측), 옛 덤프·지번주소가 섞여도 깨지지
# 않게 첫 토큰만 바꾼다. 시군구 이관(군위군 경북 → 대구)은 시도만 봐서는 못 고친다 — 원본이
# 이미 '대구광역시 군위군'이다.
_SIDO_RENAMES: Mapping[str, str] = {
    "강원도": "강원특별자치도",
    "전라북도": "전북특별자치도",
    "전라남도": "전남광주통합특별시",
    "광주광역시": "전남광주통합특별시",
}

# ── 공백 선별 수치 ───────────────────────────────────────────────────
# 공백 판정 반경 — 대중교통 다일 여행의 후보풀 반경(M7Config PUBLIC 10km × multi_day_factor 0.7).
# 일정이 실제로 고르는 범위 안에서 식당이 모자란지를 본다.
GAP_RADIUS_KM = 7.0
# 공백 기준 — 2박3일 점심·저녁 6끼. 어셈블러는 쓴 POI 를 다음 날 후보에서 빼므로(ortools
# `used`) 끼니마다 다른 식당이 필요하다. 실측: 숙소 2,961곳(22.9%)이 이 기준 미만이다.
GAP_MIN_FOOD = 6
# 보강 반경 — 도보 후보풀 반경(M7Config WALK 2.0km). 가까운 곳만 넣어야 동선이 늘지 않는다:
# 반박 시뮬레이션에서 가까운 식당 보강은 식사 거리 중앙 0.7km·식사창 151/160 이었고, FOOD 반경만
# 20km 로 넓힌 안은 12.6km·98/160 이었다.
PICK_RADIUS_KM = 2.0
# 앵커당 상한 — 6끼의 두 배. 영업시간을 모르는 식당(PARTIAL)이라 어셈블러가 고를 여지를 둔다.
# 시뮬레이션은 앵커당 8곳으로 식사창 151/160 — 12 는 그 위의 여유이고, 산출은 수 MB 에 그친다.
PER_ANCHOR = 12

# ── 드롭 사유 (산출 통계 키) ──────────────────────────────────────────
DROP_NOT_OPEN = "not_open"
DROP_TYPE_NOT_ADOPTED = "type_not_adopted"
DROP_NO_NAME = "no_name"
DROP_NOT_MEAL_STOP = "not_meal_stop"   # 뒤에 ":사유" — cafeteria · funeral · wedding · golf · dog_meat
DROP_NO_ADDRESS = "address_missing"
DROP_NO_COORD = "no_coord"
DROP_NO_REF = "no_source_ref"


def _cell(row: Mapping[str, str], key: str) -> str:
    return (row.get(key) or "").strip()


def normalize_address(address: str | None) -> str | None:
    """첫 토큰(시도)의 옛 명칭을 카탈로그 정식 명칭으로, 공백을 한 칸으로. 비면 None."""
    tokens = (address or "").split()
    if not tokens:
        return None
    tokens[0] = _SIDO_RENAMES.get(tokens[0], tokens[0])
    return " ".join(tokens)


def not_a_meal_stop(name: str) -> str | None:
    """여행자가 끼니를 먹으러 갈 수 없는 식당이면 그 사유, 아니면 None(= "이름으로는 모른다")."""
    for reason, rx in _NOT_A_MEAL_STOP:
        if rx.search(name):
            return reason
    return None


def to_candidate(
    row: Mapping[str, str],
    to_wgs84: Callable[[float, float], tuple[float, float]],
) -> SourcingCandidate | str:
    """CSV 한 행 → 게이트 입력. 못 쓰는 행은 **드롭 사유 문자열**을 돌려준다(산출 통계 키).

    `to_wgs84(x, y) -> (경도, 위도)` — pyproj `Transformer.transform` 순서. 원본 좌표는
    EPSG:5174(중부원점 TM)라 변환 없이 쓰면 위도가 45만이 된다.
    판정 순서가 통계를 정한다: 영업상태 → 업태 → 이름 → 주소 → 좌표 → 관리번호.
    """
    if _cell(row, "영업상태명") != OPEN_STATUS:
        return DROP_NOT_OPEN
    kind = _cell(row, "업태구분명")
    if kind not in ADOPTED_TYPES:
        return DROP_TYPE_NOT_ADOPTED
    name = _cell(row, "사업장명")
    if not name:
        return DROP_NO_NAME
    reason = not_a_meal_stop(name)
    if reason is not None:
        return f"{DROP_NOT_MEAL_STOP}:{reason}"
    # 도로명이 우선이다 — 게이트 3단 주소 키(addr_key)가 도로명주소만 읽는다
    address = normalize_address(row.get("도로명주소")) or normalize_address(row.get("지번주소"))
    if address is None:
        return DROP_NO_ADDRESS
    try:
        lng, lat = to_wgs84(float(_cell(row, "좌표정보(X)")), float(_cell(row, "좌표정보(Y)")))
        GeoPoint(lat, lng)   # 범위 검증 — 빈 값·NaN·inf(투영 범위 밖)가 여기서 걸린다
    except ValueError:
        return DROP_NO_COORD
    ref = _cell(row, "관리번호")
    if not ref:
        return DROP_NO_REF
    return SourcingCandidate(
        source_ref=ref, kind=KIND, name=name, address=address, lat=lat, lng=lng,
        category=PoiCategory.FOOD, category_codes=(kind,),
        open_hours=(), hours_raw=None, image_url=None,   # 원본에 없다 — 지어내지 않는다
        modified_at=_cell(row, "데이터갱신시점") or None, source=SOURCE,
    )


def shared_food_candidates(doc: Mapping) -> list[SourcingCandidate]:
    """공유본(`collected_pois.json`, TourAPI 등록 제안) → 게이트 비교 대상. FOOD 만.

    게이트 3단은 같은 카테고리끼리만 병합하므로 LOCALDATA(FOOD)와 견줄 것은 FOOD 뿐이다.
    """
    out: list[SourcingCandidate] = []
    for item in doc.get("proposals", ()):
        poi = item["poi"]
        if poi.get("category") != PoiCategory.FOOD.value:
            continue
        prov = item.get("provenance") or {}
        out.append(SourcingCandidate(
            source_ref=str(prov.get("content_id") or poi["poi_id"]),
            kind=str(prov.get("content_type_id") or ""), name=poi["name"],
            address=prov.get("address"), lat=poi["coord"]["lat"], lng=poi["coord"]["lng"],
            category=PoiCategory.FOOD, category_codes=(), open_hours=(), hours_raw=None,
            image_url=prov.get("image_url"), modified_at=prov.get("modified_time"),
            source="tourapi",
        ))
    return out


# ── 공백 선별 ─────────────────────────────────────────────────────────

_T = TypeVar("_T")


class _Grid(Generic[_T]):
    """위경도 칸 색인 — 반경 질의를 이웃 칸으로 좁힌다(앵커 1.3만 × 식당 47만 전수 비교 대신).

    판정은 하버사인이 한다. 칸 상자는 원의 **상위집합**이어야 하므로 위도 1도를 짧게(110.574km),
    경도는 상자 안 가장 높은 위도의 cos 로, 5% 여유를 더 얹어 잡는다 — 결과가 전수 비교와 같다는
    것은 테스트가 무작위 배치로 대조한다.
    """

    def __init__(self, radius_km: float) -> None:
        self._cell = max(radius_km, 0.1) / 100.0   # 반경 ≈ 칸 하나 — 질의가 3×3 칸 남짓을 본다
        self._cells: defaultdict[tuple[int, int], list[tuple[GeoPoint, _T]]] = defaultdict(list)

    def _key(self, lat: float, lng: float) -> tuple[int, int]:
        return math.floor(lat / self._cell), math.floor(lng / self._cell)

    def add(self, point: GeoPoint, item: _T) -> None:
        self._cells[self._key(point.lat, point.lng)].append((point, item))

    def within(self, center: GeoPoint, radius_km: float) -> list[tuple[float, _T]]:
        """(거리 km, 항목) — 반경 안(경계 포함)만."""
        dlat = radius_km / 110.574 * 1.05
        cos = math.cos(math.radians(min(89.0, abs(center.lat) + dlat)))
        dlng = radius_km / (111.320 * cos) * 1.05
        (i0, j0), (i1, j1) = (self._key(center.lat - dlat, center.lng - dlng),
                              self._key(center.lat + dlat, center.lng + dlng))
        out: list[tuple[float, _T]] = []
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                for point, item in self._cells.get((i, j), ()):
                    d = _haversine_m(center, point) / 1000.0
                    if d <= radius_km:
                        out.append((d, item))
        return out


def gap_anchors(
    anchors: Sequence[GeoPoint],
    tour_food: Sequence[GeoPoint],
    *,
    radius_km: float = GAP_RADIUS_KM,
    min_food: int = GAP_MIN_FOOD,
) -> list[GeoPoint]:
    """반경 안 TourAPI 식당이 `min_food` 곳 미만인 앵커만 — 입력 순서 그대로."""
    grid: _Grid[None] = _Grid(radius_km)
    for f in tour_food:
        grid.add(f, None)
    return [a for a in anchors if len(grid.within(a, radius_km)) < min_food]


def pick_near(
    anchors: Sequence[GeoPoint],
    candidates: Sequence[SourcingCandidate],
    *,
    radius_km: float = PICK_RADIUS_KM,
    per_anchor: int = PER_ANCHOR,
) -> list[SourcingCandidate]:
    """앵커마다 반경 안 후보를 가까운 순(동률은 관리번호 순)으로 최대 `per_anchor` 곳 — 합집합.

    관리번호 순으로 낸다 — 재생성 diff 가 앵커 순서에 흔들리지 않게. 게이트 3단의 "먼저 온 것을
    지킨다"도 이 순서를 따르므로 같은 가게가 두 번 등록돼 있으면 번호가 앞선 쪽이 남는다.
    """
    grid: _Grid[SourcingCandidate] = _Grid(radius_km)
    for c in candidates:
        if c.lat is not None and c.lng is not None:
            grid.add(GeoPoint(c.lat, c.lng), c)
    picked: dict[str, SourcingCandidate] = {}
    for a in anchors:
        near = sorted(grid.within(a, radius_km), key=lambda t: (t[0], t[1].source_ref))
        for _, c in near[:per_anchor]:
            picked.setdefault(c.source_ref, c)
    return [picked[ref] for ref in sorted(picked)]


# ── 게이트 경유 ───────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class GateOutcome:
    """LOCALDATA 몫만 — 통과분, 병합된 수, 드롭 사유(TourAPI 쪽 병합·드롭은 빼고 센다)."""

    passed: tuple[GatePass, ...]
    merged: int
    drops: Mapping[str, int]


def _sido(address: str | None) -> str:
    tokens = (address or "").split()
    return tokens[0] if tokens else ""


def gate_against_tourapi(
    tour_food: Sequence[SourcingCandidate],
    picks: Sequence[SourcingCandidate],
    gate: CollectionGate | None = None,
) -> GateOutcome:
    """기존 수집 게이트를 그대로 태운다 — TourAPI FOOD **뒤에** LOCALDATA 를 붙여서.

    게이트 3단은 먼저 온 것을 지키므로 같은 가게(같은 이름 50m 안 · 같은 주소 키 + 같은 상호)면
    TourAPI 쪽이 남고(영업시간·사진이 있다) LOCALDATA 는 병합으로 빠진다. 산출은 LOCALDATA 만이고,
    순서는 시도 이름 순 → 그 안에서 들어온 순(관리번호 순)이다.

    **시도 단위로 나눠 태운다.** 게이트 3단은 kept 전체를 선형 탐색해 한 지역 배치 규모에서만
    감당된다 — TourAPI 수집도 지역(시도)별로 게이트를 탄다. 시도 경계를 넘는 같은 가게는 주소
    시도가 같을 수밖에 없어(주소 키에 시도가 들어 있다) 잃는 병합이 사실상 없다.

    LOCALDATA 몫은 TourAPI 만 태운 결과와의 차로 센다 — TourAPI 행이 앞에 있어 그쪽 판정은 뒤에
    붙인 행과 무관하게 같다. 폐업 필터(`closed_refs`)는 넣지 않는다: LOCALDATA 는 원본에서 영업
    중만 오고, TourAPI 쪽 폐업 표시는 같은 대장에서 이름·주소로 붙인 것이라(재개업은 영업으로
    잡힌다 — match_business_status `pick`) 영업 중 인허가 식당과 같은 가게가 폐업일 수 없다.
    """
    gate = gate or CollectionGate()
    batches: defaultdict[str, tuple[list[SourcingCandidate], list[SourcingCandidate]]] = (
        defaultdict(lambda: ([], [])))
    for c in tour_food:
        batches[_sido(c.address)][0].append(c)
    for c in picks:
        batches[_sido(c.address)][1].append(c)
    passed: list[GatePass] = []
    merged = 0
    drops: Counter[str] = Counter()
    for key in sorted(batches):
        tours, ours = batches[key]
        if not ours:
            continue
        base = gate.apply(tours)
        both = gate.apply([*tours, *ours])
        passed.extend(p for p in both.passed if p.candidate.source == SOURCE)
        merged += both.merged - base.merged
        drops.update(Counter(both.drops) - Counter(base.drops))
    return GateOutcome(passed=tuple(passed), merged=merged, drops=dict(drops))


# ── 제안 문서 ─────────────────────────────────────────────────────────


def to_output_document(
    passed: Sequence[GatePass],
    *,
    collected_at: datetime,
    stats: Mapping[str, object],
) -> dict:
    """등록 제안 문서 — 칸 구성은 TourAPI 산출(`pipeline.to_output_document`)과 같다.

    백엔드 수신 DTO(`PoiProposalDtos.kt`)가 그 모양을 그대로 받는다. 출처가 주지 않는 것은
    비운다: 영업시간 원문 None, 사진 None(PARTIAL). `tags` 는 업태 원문 한 개다.
    """
    return {
        "schema_version": SCHEMA_VERSION,
        "source": SOURCE_NAME,
        "collected_at": collected_at.isoformat(),
        "stats": dict(stats),
        "proposals": [
            {
                "provisional_id": str(p.poi.poi_id),   # 정본 ID 는 백엔드가 준다
                "source": SOURCE_NAME,
                "poi": p.poi.to_dict(),
                "tags": list(p.candidate.category_codes),
                "region": extract_region(p.candidate.address),
                "opening_hours_raw": None,
                "provenance": {
                    "content_id": p.candidate.source_ref,   # 인허가 관리번호 — 수신 멱등 키
                    "address": p.candidate.address,          # 지역 코드의 유일한 근거(TRIP-359)
                    "image_url": None,
                },
            }
            for p in passed
        ],
    }
