"""CandidatePoolBuilder — 6단계 필터 파이프라인 (ai-data-design §3, U3 FD §2).

INV-1 화이트리스트의 정본은 backend C7 후보풀 — 본 빌더는 AI측 조립
(read-only 소비, PR #76 결정3). 결정론:
- I/O는 ①의 PoiDbPort 한 번, now는 주입 (wall-clock 직접 호출 금지)
- 인기 정렬 tie-break = poi_id 오름차순
"""

from __future__ import annotations

import logging
from datetime import datetime

from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.domain.poi import DataQuality, Poi
from trippilot.poi_curation.config import M7Config

_ALLOWED_QUALITY = frozenset({DataQuality.FULL, DataQuality.PARTIAL})


_log = logging.getLogger(__name__)


class CandidatePoolBuilder:
    def __init__(self, poi_db, config: M7Config, existence=None) -> None:
        self._db = poi_db
        self._cfg = config
        # PlaceExistencePort | None. **미주입이 기본**이다 — 근거가 없으면
        # 판정을 안 하는 것이 맞고(있는 근거만 쓴다), 주입 전 동작은 불변이다.
        self._existence = existence

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
        # 2순위는 **지도 미검출 강등** (TRIP-683). 위 [임시] 주석의 논리를 그대로
        # 따른다 — 배제가 아니라 강등이다. 실측(`ai-existence-probe`, 반경 300m,
        # 무리별 200건)이 배제를 기각했다:
        #     영업 중  FOUND 96.0% · NOT_FOUND  4.0%  → 오탐률 4.0%
        #     폐업     FOUND 51.5% · NOT_FOUND 48.5%  → 적중률 48.5%
        # 7,837건 환산: 잡는 폐업 ≈102건 vs 잘못 버리는 영업 중 ≈305건 —
        # **멀쩡한 가게를 3배 더 버린다**(모집단이 폐업보다 36배 크다).
        # 적중률 48.5% 는 튜닝으로 못 올린다 — 폐업 절반이 아직 지도에 남아 있는
        # 것(지도 데이터 신선도)이라 반경·질의를 바꿔도 그대로다.
        # 지역 쏠림은 없었다(표본 5건 이상 지역 전부 오탐 0%).
        #
        # **정렬 → 절단 → 상위 N 검증 → 재정렬** 순서다. 검증을 먼저 하면 마감
        # (1.5s, 순차 1건=1HTTP)에 잘려 앞 수십 건만 조회되는데, 그 "앞"을 정하는
        # 것이 `PoiDbPort.find_by_radius` 의 반환 순서다 — **포트 계약에 순서
        # 규정이 없다**(백엔드가 savedCount↓ 로 주는 것은 구현 우연). 즉 실제로
        # 노출될 후보가 아니라 엉뚱한 것을 검증하게 된다. 뒤로 미루면 (a) 화면에
        # 오를 것만 검증하고 (b) 벤더 호출이 두 자릿수 배 줄어든다.
        pois.sort(key=self._rank_key)
        pois = pois[: self._cfg.max_candidates]

        missing = self._not_found_on_map(pois[: self._cfg.existence_verify_top_n])
        if missing:
            pois.sort(key=lambda p: (self._rank_key(p)[0],
                                     1 if p.poi_id in missing else 0,
                                     *self._rank_key(p)[1:]))

        return CandidatePool(
            poi_ids=frozenset(p.poi_id for p in pois),
            pois=tuple(pois),
            generated_at=now,
            anchor=request.anchor,
            radius_km=radius,
        )

    @staticmethod
    def _rank_key(p) -> tuple:
        """지도 신호를 뺀 기본 순위 키. 강등은 이 키의 1번 칸 뒤에 끼워진다."""
        return (0 if p.open_hours else 1, -p.saved_count,
                -(p.rating or 0.0), str(p.poi_id))

    def _not_found_on_map(self, pois) -> frozenset:
        """지도에서 못 찾은 poi_id 집합. 미주입·실패 시 빈 집합(= 강등 없음).

        **FOUND 만 양성 신호이고, UNVERIFIED 는 강등 대상이 아니다.** 장애를
        강등으로 수렴시키면 카카오가 죽는 날 후보 순서가 통째로 뒤집힌다.
        NOT_FOUND 만 뒤로 민다.

        ⑥ 상한 절단 **앞**에서 돌므로 후보 전체를 조회하게 된다. 상한(기본
        5,000)만큼 외부 호출이 나갈 수 있으니 예산·마감은 어댑터가 쥔다 —
        여기서는 빠진 판정을 "모름"으로 두고 넘어간다(개수 보존은 포트 계약).
        """
        if self._existence is None or not pois:
            return frozenset()
        from trippilot.ports.place_existence_port import (
            ExistenceQuery,
            ExistenceStatus,
        )
        try:
            verdicts = self._existence.verify(
                tuple(ExistenceQuery(poi_id=p.poi_id, name=p.name, coord=p.coord)
                      for p in pois),
                deadline_ms=self._cfg.existence_deadline_ms,
            )
        except Exception:   # noqa: BLE001
            # 포트 계약(DL-5)은 예외를 경계 밖으로 던지지 않는다고 정하지만,
            # 계약을 어기는 구현이 하나 꽂히면 **순위 곁가지 하나 때문에 생성
            # 경로 전체가 죽는다**. 강등은 있으면 좋은 신호지 필수가 아니므로
            # 없는 셈 치고 간다 — 다만 조용히는 아니다 (INV-4).
            _log.warning("실재 검증 포트가 예외를 던졌다 — 강등 없이 진행", exc_info=True)
            return frozenset()
        return frozenset(
            v.poi_id for v in verdicts
            if v.status is ExistenceStatus.NOT_FOUND
        )

    @staticmethod
    def _open_on_any(poi: Poi, travel_dows: set[int]) -> bool:
        if not poi.open_hours:
            return True  # 정보 없음 → 배제 안 함 (U2 checker와 동일 철학)
        return any(oh.day_of_week in travel_dows for oh in poi.open_hours)
