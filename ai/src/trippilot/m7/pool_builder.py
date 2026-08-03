"""CandidatePoolBuilder — 6단계 필터 파이프라인 (ai-data-design §3, U3 FD §2).

이 출력이 INV-1 화이트리스트의 원천. 결정론:
- I/O는 ①의 PoiDbPort 한 번, now는 주입 (wall-clock 직접 호출 금지)
- 인기 정렬 tie-break = poi_id 오름차순
"""

from __future__ import annotations

from datetime import datetime

from trippilot.domain.llm import CandidatePool
from trippilot.domain.m7 import CandidatePoolRequest
from trippilot.domain.poi import DataQuality, Poi
from trippilot.m7.config import M7Config

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

        # ⑤ 인기 정렬 (rating desc, None=0) → ⑥ 상한
        pois.sort(key=lambda p: (-(p.rating or 0.0), str(p.poi_id)))
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
