"""수집 게이트 5단 — 스키마·실재·중복·신뢰·정책 (INV-1 입구, TRIP-246).

설계 정본: ai-implementation-design.md §2.1 `ingest_gate` (FR-3.5). U6-04(TRIP-245)의
ai측 게이트 코드가 부재해(백엔드 C7 `PoiCollectionGate`만 실재) 여기 소싱 경로에
5단을 구현한다. 결정론 순수 함수 — LLM·네트워크 없음.

단계별 조정 (TourAPI = 정형 공공데이터 특성):
1. 스키마 — 이름·좌표 필수 (GeoPoint 생성 = 범위 검증). 영업시간은 필수 아님:
   "정보 없음 ≠ 배제" 원칙 + dataQuality PARTIAL로 표시 (TRIP-326 합의와 동형).
2. 실재 — 좌표가 서비스 권역(한국 bbox) 안인지 결정론 검사. 설계의 Places API
   교차확인은 교차 어댑터 부재로 이연 (정형 공공데이터라 웹 추출 대비 위험 낮음).
3. 중복 — source_ref 동일 또는 (동일 카테고리 + 정규화 이름 동일 + 50m 이내) 병합.
   병합은 먼저 온 레코드를 지키되 결측 필드(영업시간)만 보충 — 조용한 덮어쓰기 금지.
4. 신뢰 — 출처 태깅: 정형 API이므로 PoiSource.PLACES_API (WEB 아님 — confidence
   비필수). dataQuality는 백엔드 판정 기준과 동형(영업시간+대표사진 완비=FULL).
5. 정책 — 가격 미캐싱(D13): 산출 Poi의 avg_cost는 항상 None (구조 보장 + 방어 검사).

통과분도 **등록 제안**일 뿐이다 — 백엔드 정본 등록 전에는 후보 풀에 들어가지
않는다 (INV-1).
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource

# 서비스 권역 bbox (제주 남단 마라도 ~ 최북단, 서해 ~ 독도 포함)
_KR_LAT = (32.5, 39.5)
_KR_LNG = (124.0, 132.5)
_DUP_RADIUS_M = 50.0

# 드롭 사유 키 (통계·로그 계약 — 파이프라인 산출 JSON에 그대로 실린다)
DROP_SCHEMA_NAME = "schema_missing_name"
DROP_SCHEMA_COORD = "schema_missing_or_invalid_coord"
DROP_EXISTENCE = "existence_out_of_service_region"
DROP_POLICY_PRICE = "policy_priced"


@dataclass(frozen=True, slots=True)
class SourcingCandidate:
    """카테고리 매핑을 마친 게이트 입력 (매핑 불가분은 게이트 전에 드롭됨)."""

    source_ref: str
    kind: str
    name: str
    address: str | None
    lat: float | None
    lng: float | None
    category: PoiCategory
    category_codes: tuple[str, ...]  # 벤더 원 분류 코드 (태그 파생용)
    open_hours: tuple[OpenHour, ...]
    hours_raw: str | None            # 영업시간 원문 (backend opening_hours 병행 수록용)
    image_url: str | None
    modified_at: str | None


@dataclass(frozen=True, slots=True)
class GatePass:
    """게이트 통과 1건 — 도메인 Poi + provenance 원문."""

    poi: Poi
    candidate: SourcingCandidate


@dataclass(frozen=True, slots=True)
class GateReport:
    passed: tuple[GatePass, ...]
    drops: Mapping[str, int]   # 사유 키 → 건수 (0건 사유는 미포함)
    merged: int                # 중복 병합 건수 (드롭과 구분 — 정보는 보존됨)


class CollectionGate:
    """5단 수집 게이트. 입력 순서 보존 — 같은 입력이면 같은 출력 (결정론)."""

    def apply(self, candidates: Sequence[SourcingCandidate]) -> GateReport:
        drops: dict[str, int] = {}

        def drop(reason: str) -> None:
            drops[reason] = drops.get(reason, 0) + 1

        # 1·2단 — 스키마 + 실재
        verified: list[tuple[SourcingCandidate, GeoPoint]] = []
        for c in candidates:
            if not c.name.strip():
                drop(DROP_SCHEMA_NAME)
                continue
            if c.lat is None or c.lng is None:
                drop(DROP_SCHEMA_COORD)
                continue
            try:
                coord = GeoPoint(lat=c.lat, lng=c.lng)
            except ValueError:
                drop(DROP_SCHEMA_COORD)
                continue
            if not (_KR_LAT[0] <= coord.lat <= _KR_LAT[1]
                    and _KR_LNG[0] <= coord.lng <= _KR_LNG[1]):
                drop(DROP_EXISTENCE)
                continue
            verified.append((c, coord))

        # 3단 — 중복 병합 (먼저 온 것 유지 + 결측 보충)
        kept: list[tuple[SourcingCandidate, GeoPoint]] = []
        by_ref: dict[str, int] = {}
        merged = 0
        for c, coord in verified:
            idx = by_ref.get(c.source_ref)
            if idx is None:
                idx = self._find_near_duplicate(kept, c, coord)
            if idx is None:
                by_ref[c.source_ref] = len(kept)
                kept.append((c, coord))
                continue
            merged += 1
            base, base_coord = kept[idx]
            if not base.open_hours and c.open_hours:
                base = replace(base, open_hours=c.open_hours)
            if not base.hours_raw and c.hours_raw:
                base = replace(base, hours_raw=c.hours_raw)
            if not base.image_url and c.image_url:
                base = replace(base, image_url=c.image_url)
            kept[idx] = (base, base_coord)

        # 4·5단 — 신뢰 태깅 + 정책
        passed: list[GatePass] = []
        for c, coord in kept:
            poi = Poi(
                poi_id=PoiId(f"tourapi-{c.source_ref}"),  # 잠정 ID — 정본 ID는 백엔드 부여
                name=c.name.strip(),
                category=c.category,
                coord=coord,
                open_hours=c.open_hours,
                avg_cost=None,   # 5단 정책 — 가격 미저장(D13)
                rating=None,     # TourAPI 미제공 — 지어내지 않음
                quality=(DataQuality.FULL if c.open_hours and c.image_url
                         else DataQuality.PARTIAL),
                source=PoiSource.PLACES_API,  # 정형 API 소싱 (WEB 아님)
                confidence=None,
            )
            if poi.avg_cost is not None:  # 방어 — 구조상 도달 불가
                drop(DROP_POLICY_PRICE)
                continue
            passed.append(GatePass(poi=poi, candidate=c))
        return GateReport(passed=tuple(passed), drops=drops, merged=merged)

    @staticmethod
    def _find_near_duplicate(
        kept: list[tuple[SourcingCandidate, GeoPoint]],
        c: SourcingCandidate,
        coord: GeoPoint,
    ) -> int | None:
        name = _normalize_name(c.name)
        for i, (k, k_coord) in enumerate(kept):
            if (k.category is c.category
                    and _normalize_name(k.name) == name
                    and _haversine_m(coord, k_coord) <= _DUP_RADIUS_M):
                return i
        return None


def _normalize_name(name: str) -> str:
    return "".join(name.split()).casefold()


def _haversine_m(a: GeoPoint, b: GeoPoint) -> float:
    """근접 판정 전용 — solver_engine.travel과 독립 (하위 계층이 형제 계층 미참조)."""
    lat1, lng1, lat2, lng2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * 6_371_000.0 * math.asin(math.sqrt(h))
