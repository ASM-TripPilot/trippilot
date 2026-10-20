"""여러 날을 날마다 다른 동네로 — 생성 전용 (2026-10-20 사용자: "강남도 연희동도 성수동도 가야지").

서울 2박3일(숙소 없음 → 앵커 = 시청)이 사흘 모두 시청 1km 안이었다(로컬 실측, 취향 없음). 같은 앵커·같은 점수로
날마다 고르면 장소가 가장 몰린 곳(을지로·종로)이 매일 이긴다. 점수(취향이 실린 값)가 몰린 곳 여럿을 **서로
떨어지게** 골라 날마다 하나씩 주고, 그날 자유 후보를 그 근처로 좁힌다 — 고정 블록·필수 방문은 좁히지 않는다.

ponytail: 동네 경계를 모르고 "점수 몰린 점 + 반경"으로만 본다. 행정동·상권 경계가 필요해지면 그 데이터로 바꾼다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date

from trippilot.assembly_engine.travel import haversine_km
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.llm import ScoredPoi
from trippilot.domain.poi import Poi

TOP_K = 150        # 동네를 고를 때 보는 상위 후보 수(점수순)
MASS_KM = 1.5      # 한 점 둘레의 점수 합을 잴 반경 — "몰린 정도"
MIN_GAP_KM = 4.0   # 날마다의 동네끼리 최소 거리 — 걸어서 이어지는 거리면 같은 동네다
FOCUS_KM = 3.0     # 그날 자유 후보 반경
FOCUS_MIN = 25     # 반경 안 후보가 이보다 적으면 좁히지 않는다 — 하루(최대 8곳)를 못 채운다


def pick_day_focus(candidates: Sequence[ScoredPoi], index: Mapping[PoiId, Poi],
                   days: Sequence[date]) -> dict[date, GeoPoint]:
    """날짜 → 그날의 동네 중심. 점수 합이 큰 곳부터, 이미 고른 곳과 `MIN_GAP_KM` 이상 떨어진 곳만.

    하루짜리는 빈 결과(좁힐 이유가 없다). 떨어진 동네가 날보다 적으면 앞 날짜만 채운다 — 남는 날은 종전대로.
    """
    if len(days) < 2:
        return {}
    top = sorted((c for c in candidates if c.poi_id in index),
                 key=lambda c: (-c.score, str(c.poi_id)))[:TOP_K]
    pts = [(index[c.poi_id].coord, c.score) for c in top]
    mass = sorted(((sum(s for q, s in pts if haversine_km(p, q) <= MASS_KM), p) for p, _ in pts),
                  key=lambda m: (-m[0], m[1].lat, m[1].lng))
    centers: list[GeoPoint] = []
    for _, p in mass:
        if all(haversine_km(p, c) >= MIN_GAP_KM for c in centers):
            centers.append(p)
            if len(centers) == len(days):
                break
    return dict(zip(days, centers))


def focus_candidates(candidates: Sequence[ScoredPoi], index: Mapping[PoiId, Poi],
                     center: GeoPoint | None) -> Sequence[ScoredPoi]:
    """그날 자유 후보를 동네 반경 안으로. 중심이 없거나 안쪽이 `FOCUS_MIN` 미만이면 그대로."""
    if center is None:
        return candidates
    near = tuple(c for c in candidates
                 if c.poi_id in index and haversine_km(index[c.poi_id].coord, center) <= FOCUS_KM)
    return near if len(near) >= FOCUS_MIN else candidates
