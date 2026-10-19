"""CandidatePoolBuilder — 6단계 필터 파이프라인 (ai-data-design §3, U3 FD §2).

INV-1 화이트리스트의 정본은 backend C7 후보풀 — 본 빌더는 AI측 조립
(read-only 소비, PR #76 결정3). 결정론:
- I/O는 ①의 PoiDbPort 한 번, now는 주입 (wall-clock 직접 호출 금지)
- 인기 정렬 tie-break = poi_id 오름차순
"""

from __future__ import annotations

from datetime import datetime

from trippilot.domain.common import TransportMode
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.poi import DataQuality, Poi, PoiCategory
from trippilot.poi_curation.config import M7Config

_ALLOWED_QUALITY = frozenset({DataQuality.FULL, DataQuality.PARTIAL})

# 빈 풀 1회 확대 배율(2026-10-14 사용자 결정 — "검색 결과가 비면 자동으로 넓혀 다시 찾는다").
# 상한은 자차 반경(`radius_km[CAR]`) — 그보다 넓히면 "주변"이 아니다.
WIDEN_FACTOR = 1.5


def base_radius_km(request: CandidatePoolRequest, cfg: M7Config) -> float:
    """풀 반경 규칙 **한 곳** — 명시 반경이 우선, 없으면 수단별 기본에 다일 축소(×0.7).

    코디네이터가 "비면 넓혀 다시" 를 위해 같은 규칙을 읽는다 — 두 벌이면 한쪽만 바뀐다.
    """
    if request.radius_override_km is not None:
        return request.radius_override_km
    radius = cfg.radius_km[request.transport]
    if len(request.dates) > 1:
        radius *= cfg.multi_day_factor
    return radius


def widened_radius_km(request: CandidatePoolRequest, cfg: M7Config) -> float | None:
    """빈 풀을 한 번 더 찾을 반경 — 넓힐 여지가 없으면 None(이미 상한이거나 호출자가 반경을 정했다).

    **다일 축소분 위에 ×1.5 다** — PUBLIC 단일 10→15, 다일 7→10.5, WALK 2→3, 자차 단일 20→None(상한).
    다일 ×0.7 은 "밀집 지역이라 좁혀도 된다"는 가정이고 빈 풀은 그 가정이 깨진 상태라 축소를
    먼저 되돌리는 안도 있었지만, 상대 50% 한 단으로 통일했다(사용자 체감은 같은 "한 단").
    """
    if request.radius_override_km is not None:
        return None
    base = base_radius_km(request, cfg)
    widened = min(base * WIDEN_FACTOR, cfg.radius_km[TransportMode.CAR])
    return widened if widened > base else None


class CandidatePoolBuilder:
    def __init__(self, poi_db, config: M7Config) -> None:
        self._db = poi_db
        self._cfg = config

    @property
    def config(self) -> M7Config:
        """반경 규칙을 같은 설정으로 읽어야 하는 쪽(빈 풀 1회 확대)에 내준다 — 기본값을 따로 만들지 않게."""
        return self._cfg

    def build(self, request: CandidatePoolRequest, now: datetime) -> CandidatePool:
        # ① 반경 (다일 여행 ×0.7) — 규칙은 `base_radius_km` 한 곳
        radius = base_radius_km(request, self._cfg)
        pois = list(self._db.find_by_radius(request.anchor, radius))

        # ② 예산 — avg_cost None=통과 (미확인=배제 안 함), HIGH=무제한
        limit = self._cfg.budget_limit[request.budget]
        if limit is not None:
            pois = [p for p in pois if p.avg_cost is None or p.avg_cost <= limit]

        # ③ 영업일 — 정보 없으면 통과, 여행일 중 하루라도 영업 요일이면 통과
        travel_dows = {d.weekday() for d in request.dates}
        pois = [p for p in pois if self._open_on_any(p, travel_dows)]

        # ④ 품질 — MINIMAL 제외
        pois = [p for p in pois if p.quality in _ALLOWED_QUALITY]

        # ⑤ 정렬: 영업시간 보유 우선 → 인기(saved_count desc → rating desc, None=0)
        #        → poi_id asc(tie-break)
        #
        # [임시] 영업시간 보유 여부를 최상위 정렬 키로 둔다 (TRIP-326, backend PR #104 합의).
        # 근거: dataQuality MINIMAL 등급 도입이 U6까지 보류돼 그 전까지는 영업시간 없는 POI를
        # 걸러낼 신호가 양쪽 모두 없다 — ③ 영업일 필터는 open_hours가 비면 통과시키고
        # (정보 없음 ≠ 배제), HC1도 같은 이유로 미적용이라 휴무·폐점 장소가 하드 제약 위반
        # 없이 편성될 수 있다. 그래서 **배제가 아니라 순위 강등**으로 완화한다: 후보가 희소한
        # 지역에서도 POI가 사라지지 않고, ⑥ 상한 절단 시 영업시간 보유분이 먼저 살아남는다.
        # 필터(①~④)는 그대로 — 특히 ④ _ALLOWED_QUALITY는 백엔드 합의대로 변경 없음.
        # U6에서 structured 영업시간(openHours[{day,open,close}])이 들어오면 이 신호의 존치를
        # 재평가한다.
        # 인기 1순위는 saved_count — 백엔드 PoiReadService 의 반경 조회 정렬(savedCount↓)과
        # 같은 신호다. rating 은 별점 소스가 생길 때까지 항상 None 이라 사실상 무동작.
        #
        # 지도 실재 검증(TRIP-898)은 여기서 하지 않는다 — 일정 생성 경로는 풀 순서를
        # 읽지 않아(점수 워커는 poi_id 로 재정렬, 어셈블리는 점수로 고른다) 순위 강등이
        # 일정에 닿지 않았다. 점수가 나온 뒤 ScheduleAgent ②′ 가 한다 (TRIP-904).
        # 예외: PlanB 는 LLM 선택이 closed-set 에서 전량 드롭되면 풀 순서 그대로 대안을
        # 낸다(rag.py `kept = available`) — 그 폴백 경로의 지도 강등은 이번에 빠졌다(후속).
        pois.sort(key=self._rank_key)
        pois = _fair_cut(pois, self._cfg.max_candidates)

        return CandidatePool(
            poi_ids=frozenset(p.poi_id for p in pois),
            pois=tuple(pois),
            generated_at=now,
            anchor=request.anchor,
            radius_km=radius,
        )

    @staticmethod
    def _rank_key(p) -> tuple:
        """풀 정렬 키 — ⑥ 상한 절단에서 누가 살아남는지를 정한다."""
        return (0 if p.open_hours else 1, -p.saved_count,
                -(p.rating or 0.0), str(p.poi_id))

    @staticmethod
    def _open_on_any(poi: Poi, travel_dows: set[int]) -> bool:
        if not poi.open_hours:
            return True  # 정보 없음 → 배제 안 함 (U2 checker와 동일 철학)
        return any(oh.day_of_week in travel_dows for oh in poi.open_hours)


def _fair_cut(ranked: list[Poi], cap: int) -> list[Poi]:
    """⑥ 상한 절단 — 카테고리마다 공평한 몫(작은 카테고리는 통째로, 넘치는 쪽만 자른다). 순서는 `ranked` 그대로.

    U3 FD §2 ⑥ 은 "상위 max_candidates" 였다(정본 이탈, 2026-10-19). 서울 반경 10km 는 1.4만 곳 중 FOOD 가 89% 라
    정렬 앞부분(영업시간 보유 → 저장 수)을 영업시간 있는 FOOD 가 다 차지해, 자연 132곳 중 11곳·쇼핑 251곳 중 46곳만
    5,000 안에 들었다(공유본 실측). 그 뒤 점수·프리필터는 남은 것만 보므로 하루가 식당·명소로만 채워졌다.
    몫은 작은 카테고리부터 `남은 자리 ÷ 남은 카테고리 수` — 몫보다 작으면 다 넣고 남은 자리를 뒤로 넘긴다.
    카테고리 안에서는 종전 정렬의 앞부분이 남는다(영업시간 보유분 우선 생존 TRIP-326 은 카테고리 안 규칙).
    """
    if len(ranked) <= cap:
        return ranked
    groups: dict[PoiCategory, list[Poi]] = {}
    for p in ranked:
        groups.setdefault(p.category, []).append(p)
    keep: set = set()
    left = cap
    by_size = sorted(groups.items(), key=lambda kv: (len(kv[1]), kv[0].value))
    for i, (_, group) in enumerate(by_size):
        take = min(len(group), left // (len(by_size) - i))
        keep.update(p.poi_id for p in group[:take])
        left -= take
    return [p for p in ranked if p.poi_id in keep]
