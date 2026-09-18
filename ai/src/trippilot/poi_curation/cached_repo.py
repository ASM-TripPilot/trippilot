"""CachedPoiRepository — PoiDbPort 래퍼 + TTL 정책 (ai-data-design §6, U3 FD §4).

가격 캐싱 금지(G195)의 구조 강제: 캐시 저장은 `Poi.to_cacheable_dict()`만 사용
(avg_cost 필드가 직렬화 경로에서 제거됨 — U1이 만든 차단을 그대로 통과).
캐시 히트 복원 시 avg_cost=None — "가격은 항상 원본 조회"임을 타입이 드러낸다.
시계는 CachePort 구현체 소유 (테스트: InMemoryCache 논리 시계 — 결정론).
"""

from __future__ import annotations

from datetime import date

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import OpenHour, Poi, PoiCategory
from trippilot.poi_curation.config import M7Config
from trippilot.ports.poi_db_port import PoiLookup, lookup_from

_CLOSED = {"closed": True}  # 해당 요일 영업창 없음 마커 (미스와 구분)


class CachedPoiRepository:
    """PoiDbPort Protocol 만족 — source 위임 + 캐시 계층."""

    def __init__(self, source, cache, config: M7Config) -> None:
        self._src = source
        self._cache = cache
        self._cfg = config

    # ── 캐시 적용 경로 ──────────────────────────────
    def find_by_ids(self, ids: frozenset[PoiId]) -> tuple[Poi, ...]:
        found: dict[PoiId, Poi] = {}
        misses: set[PoiId] = set()
        for pid in ids:
            hit = self._cache.get(f"poi:{pid}")
            if hit is not None:
                d = dict(hit)
                d["avg_cost"] = None  # 가격은 캐시에 없음 — 원본 조회 필요 명시
                found[pid] = Poi.from_dict(d)
            else:
                misses.add(pid)
        if misses:
            for poi in self._src.find_by_ids(frozenset(misses)):
                self._cache.set(f"poi:{poi.poi_id}", poi.to_cacheable_dict(),
                                ttl_sec=self._cfg.poi_ttl_sec)  # 가격 구조 차단
                found[poi.poi_id] = poi
        return tuple(found[k] for k in sorted(found, key=str))

    def lookup_by_ids(self, ids: frozenset[PoiId]) -> PoiLookup:
        """누락 보고 (TRIP-537). 캐시 계층은 원본의 사유를 못 본다 — 여기서는 전부
        not_found 로 수렴한다(캐시 히트/미스가 섞여 어느 행이 매핑 실패였는지
        되짚을 수 없다). 검증 경계는 원본 어댑터를 직접 받으므로(배선 참조) 사유
        구분이 필요한 경로는 이쪽을 지나지 않는다."""
        return lookup_from(self.find_by_ids(ids), ids)

    def get_open_window(self, poi_id: PoiId, on: date) -> OpenHour | None:
        key = f"hours:{poi_id}:{on.weekday()}"
        hit = self._cache.get(key)
        if hit is not None:
            return None if hit == _CLOSED else OpenHour.from_dict(hit)
        window = self._src.get_open_window(poi_id, on)
        self._cache.set(key, _CLOSED if window is None else window.to_dict(),
                        ttl_sec=self._cfg.hours_ttl_sec)
        return window

    # ── 위임 경로 (공간 쿼리 캐싱은 후속 검토) ─────────
    def find_by_radius(self, center: GeoPoint, radius_km: float) -> tuple[Poi, ...]:
        return self._src.find_by_radius(center, radius_km)

    def find_nearby(self, coord: GeoPoint, radius_m: int,
                    category: PoiCategory) -> tuple[Poi, ...]:
        return self._src.find_nearby(coord, radius_m, category)

    def batch_check_closed(self, poi_ids: frozenset[PoiId],
                           on: date) -> frozenset[PoiId]:
        return self._src.batch_check_closed(poi_ids, on)
