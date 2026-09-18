"""PoiSourcingPort — 외부 POI 소싱 피드 조회 콘센트 (TRIP-246, U6-05).

PlacesPort(§2.3 — 카테고리 검색·지오코딩)와 달리 이 포트는 **지역 단위 일괄 수집
피드**를 페이지 순회로 읽는다 (한국관광공사 TourAPI 류). 조회 전용 — 쓰기 메서드를
추가하지 않는다 (POI 정본은 backend C7 단일 소유, PR #76 결정).

**호출 예산 계약**: 포트 메서드 1회 호출 = 외부 HTTP 호출 정확히 1건.
일일 호출 한도(개발계정 1,000/일)를 파이프라인이 메서드 호출 수로 세기 때문에,
구현체가 내부에서 재시도·추가 호출을 하면 이 계약이 깨진다 — 재시도 금지.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class SourcingError(Exception):
    """소싱 피드 호출 실패 (HTTP 오류·비정상 응답 봉투). 파이프라인이 로그 후 스킵."""


@dataclass(frozen=True, slots=True)
class SourcedPlaceRecord:
    """소싱 피드의 장소 1건 원시 레코드 (수집 게이트 전 단계 — 후보 아님, INV-1)."""

    source_ref: str            # 벤더 항목 식별자 (TourAPI contentid)
    kind: str                  # 벤더 분류 축 (TourAPI contentTypeId)
    name: str
    address: str | None
    lat: float | None          # 파싱 실패·부재 시 None — 게이트 스키마 단이 격리
    lng: float | None
    category_codes: tuple[str, ...]  # 벤더 카테고리 코드 (TourAPI cat1~cat3)
    image_url: str | None
    modified_at: str | None    # 벤더 표기 그대로 (provenance 용도)


@dataclass(frozen=True, slots=True)
class SourcedPage:
    """목록 1페이지. total_count로 파이프라인이 페이지 수를 계산한다."""

    records: tuple[SourcedPlaceRecord, ...]
    total_count: int


@dataclass(frozen=True, slots=True)
class SourcedHours:
    """영업시간 원문 (파싱 전). 파싱 가능한 것만 OpenHour가 된다 — 지어내기 금지."""

    hours_raw: str | None      # 영업시간 원문 (TourAPI usetime류)
    rest_raw: str | None       # 휴무일 원문 (TourAPI restdate류)


class PoiSourcingPort(Protocol):
    def fetch_page(
        self, area_code: str, kind: str, page_no: int, rows: int
    ) -> SourcedPage: ...

    def fetch_hours(self, source_ref: str, kind: str) -> SourcedHours: ...
