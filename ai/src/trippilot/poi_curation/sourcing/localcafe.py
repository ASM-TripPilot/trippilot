"""LOCALDATA 휴게음식점 → 카페 등록 제안 (사용자 결정 2026-10-19).

**왜 있나.** 일정에 카페가 거의 안 나오는 것은 데이터에 카페가 없어서다 — 서울시청 10km 안
공유본(`collected_pois.json`) CAFE 126곳 대 FOOD 12,728곳. 사용자 결정: "공공데이터 휴게음식점 중
카페·제과를 수집에 넣는다." 식당 보강(`localdata.py`)과 같은 인허가 대장의 다른 업종 파일이다
(행정안전부_휴게음식점, data.go.kr 15006730 — `poi_business_status.json` 이 이미 읽는 그 파일).

**식당 경로를 그대로 탄다.** 행 판정은 `localdata.to_candidate` 를 채택 업태만 바꿔 부르고(영업 중 ·
관광 무관 이름 · 고속도로 휴게소 · 전국 체인 · 좌표 규칙이 다 같다), 반경 질의는 `pick_near`,
병합은 `gate_against_tourapi`, 문서는 `to_output_document` 다. 다른 것은 셋뿐이다:

- **공백 지역만이 아니다.** 카페는 어디나 얇다 — 숙소·지역 중심 앵커 전부에 넣는다.
- **가까운 순이 아니라 큰 순이다**(시설총규모). 서울 영업 중 커피숍만 1.5만 곳이라 가까운 순이면
  동네 테이크아웃이 앵커 몫을 채운다. 넓은 매장을 "찾아갈 만한 카페"의 대리 지표로 쓴다.
- **잠정 ID 접두가 `localdata-cafe`** 다 — 식당 문서(`localdata-`)와 한눈에 갈린다. 수신 멱등 키
  (출처 LOCALDATA, 관리번호)는 원래도 안 겹친다: 관리번호 둘째 칸이 업종(일반음식점 `101` ·
  휴게음식점 `104`)이다(2026-09 원본 전수 실측).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace

from trippilot.domain.common import GeoPoint
from trippilot.domain.poi import PoiCategory
from trippilot.poi_curation.sourcing.collection_gate import SourcingCandidate
from trippilot.poi_curation.sourcing.localdata import (
    PICK_RADIUS_KM,
    pick_near,
    to_candidate,
)

SOURCE = "localdata-cafe"   # SourcingCandidate.source — 잠정 ID `localdata-cafe-<관리번호>`
KIND = "휴게음식점"           # 인허가 업종 (SourcingCandidate.kind)

# ── 업태: 채택 목록 ───────────────────────────────────────────────────
# 원본 영업 중 19.9만 행의 업태 23종 중 앉아서 머무는 카페만(영업 중 건수): 커피숍 78,654 ·
# 전통찻집 926 · 떡카페 694. 뺀 것: 기타 휴게음식점 3.7만(상호로 못 가른다 — 식당 '기타'와 같은
# 이유)·편의점 3.3만·일반조리판매 2.3만·패스트푸드 8,456(버거 체인 — 식당 쪽 체인 결정)·다방 7,210
# (옛 다방·티켓다방이 섞인다)·푸드트럭·아이스크림·백화점·고속도로·키즈카페·과자점·역·극장·공항 등.
CAFE_TYPES: frozenset[str] = frozenset({"커피숍", "전통찻집", "떡카페"})

# 앵커당 상한. 반경은 식당과 같은 도보 2km(`PICK_RADIUS_KM`). 하루 카페 한두 번이면 2박3일에
# 서너 곳이라 그 두 배 남짓 — 시작값이고, 산출 크기·서울 10km 안 건수로 본다.
PER_ANCHOR = 8


def facility_size(row: Mapping[str, str]) -> float:
    """시설총규모(㎡). 비었거나 못 읽거나 음수면 0 — 크기를 모르는 곳은 맨 뒤로 간다."""
    try:
        return max(float((row.get("시설총규모") or "").strip()), 0.0)
    except ValueError:
        return 0.0


def to_cafe(
    row: Mapping[str, str],
    to_wgs84: Callable[[float, float], tuple[float, float]],
) -> tuple[SourcingCandidate, float] | str:
    """CSV 한 행 → (게이트 입력, 시설총규모). 못 쓰는 행은 식당과 같은 **드롭 사유 문자열**."""
    out = to_candidate(row, to_wgs84, adopted=CAFE_TYPES)
    if isinstance(out, str):
        return out
    return replace(out, kind=KIND, category=PoiCategory.CAFE, source=SOURCE), facility_size(row)


def pick_largest_near(
    anchors: Sequence[GeoPoint],
    cafes: Sequence[tuple[SourcingCandidate, float]],
    *,
    radius_km: float = PICK_RADIUS_KM,
    per_anchor: int = PER_ANCHOR,
) -> list[SourcingCandidate]:
    """앵커마다 반경 안 카페를 **큰 순**(동률은 가까운 순 → 관리번호 순)으로 최대 `per_anchor` 곳 — 합집합."""
    size = {c.source_ref: s for c, s in cafes}
    return pick_near(anchors, [c for c, _ in cafes], radius_km=radius_km, per_anchor=per_anchor,
                     rank=lambda d, c: (-size[c.source_ref], d, c.source_ref))
