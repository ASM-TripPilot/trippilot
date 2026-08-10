"""CandidatePoolBuilder — 6단계 필터 파이프라인 (ai-data-design §3, U3 FD §2).

INV-1 화이트리스트의 정본은 backend C7 후보풀 — 본 빌더는 AI측 조립
(read-only 소비, PR #76 결정3). 결정론:
- I/O는 ①의 PoiDbPort 한 번, now는 주입 (wall-clock 직접 호출 금지)
- 인기 정렬 tie-break = poi_id 오름차순
"""

from __future__ import annotations

from datetime import datetime

from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.poi import DataQuality, Poi
from trippilot.poi_curation.config import M7Config

_ALLOWED_QUALITY = frozenset({DataQuality.FULL, DataQuality.PARTIAL})


class CandidatePoolBuilder:
    def __init__(self, poi_db, config: M7Config) -> None:
        self._db = poi_db
        self._cfg = config

    def build(self, request: CandidatePoolRequest, now: datetime) -> CandidatePool:
        # ① 반경 (다일 여행 ×0.7)
        radius = request.radius_override_km
        if radius is None:
            radius = self._cfg.radius_km[request.transport]
            if len(request.dates) > 1:
                radius *= self._cfg.multi_day_factor
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

        # ⑤ 정렬: 영업시간 보유 우선 → 인기(rating desc, None=0) → poi_id asc(tie-break)
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
        pois.sort(key=lambda p: (0 if p.open_hours else 1, -(p.rating or 0.0), str(p.poi_id)))
        pois = pois[: self._cfg.max_candidates]

        return CandidatePool(
            poi_ids=frozenset(p.poi_id for p in pois),
            pois=tuple(pois),
            generated_at=now,
            anchor=request.anchor,
            radius_km=radius,
        )

    @staticmethod
    def _open_on_any(poi: Poi, travel_dows: set[int]) -> bool:
        if not poi.open_hours:
            return True  # 정보 없음 → 배제 안 함 (U2 checker와 동일 철학)
        return any(oh.day_of_week in travel_dows for oh in poi.open_hours)
