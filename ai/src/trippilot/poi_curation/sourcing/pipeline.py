"""TourAPI 수집 파이프라인 — 조회 → 변환 → 수집 게이트 → 등록 제안 (TRIP-246).

흐름: PoiSourcingPort 페이지 순회(목록 1페이지 + 항목별 영업시간 1건씩 인터리브)
→ 카테고리 매핑(불가분 드롭+카운트) → 수집 게이트 5단 → 등록 제안 문서.

**호출 예산이 1급 규칙**: 포트 메서드 1회 = HTTP 1건 계약 위에서, max_calls
도달 시 **그 시점까지 산출하고 정상 종료** (부분 성공 = 성공). 재시도 없음,
실패 페이지·항목은 로그 후 스킵 (침묵 금지 — 로그·카운트로 드러낸다).

**INV-1 부기**: 산출물은 "등록 제안" JSON일 뿐, 후보 풀에 직접 들어가지 않는다.
POI 정본은 backend C7 단일 소유(PR #76) — 정본 등록 후에만 closed-set 후보가 된다.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from trippilot.ports.poi_sourcing_port import (
    PoiSourcingPort,
    SourcedHours,
    SourcedPlaceRecord,
    SourcingError,
)
from trippilot.poi_curation.sourcing.collection_gate import (
    CollectionGate,
    GateReport,
    SourcingCandidate,
)
from trippilot.poi_curation.sourcing.mapping import (
    category_tags,
    extract_region,
    map_category,
    parse_open_hours,
)

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
# 백엔드 poi.source CHECK 허용값('KAKAO_LOCAL'|'TOURAPI'|'MANUAL')과 동일 어휘.
# 실제 피드는 TourAPI 4.0 KorService2.
SOURCE_NAME = "TOURAPI"
_OPENING_HOURS_MAX = 200  # backend poi.opening_hours varchar(200)
_NO_HOURS = SourcedHours(hours_raw=None, rest_raw=None)


@dataclass(frozen=True, slots=True)
class CollectStats:
    http_calls: int          # 실제 소모한 호출 수 (실패 호출 포함 — 한도는 시도 기준)
    listed: int              # 목록에서 확보한 레코드 수
    page_failures: int       # 실패한 목록 페이지 수 (로그 후 스킵)
    detail_failures: int     # 실패한 상세(영업시간) 조회 수 (open_hours=() 로 계속)
    category_unmapped: int   # 매핑 불가 드롭 (게이트 전)
    gate_drops: dict[str, int]
    merged: int
    passed: int
    budget_exhausted: bool   # 한도 도달로 조기 종료했는가 (부분 성공 표시)

    def to_dict(self) -> dict:
        return {
            "http_calls": self.http_calls,
            "listed": self.listed,
            "page_failures": self.page_failures,
            "detail_failures": self.detail_failures,
            "category_unmapped": self.category_unmapped,
            "gate_drops": dict(self.gate_drops),
            "merged": self.merged,
            "passed": self.passed,
            "budget_exhausted": self.budget_exhausted,
        }


@dataclass(frozen=True, slots=True)
class CollectResult:
    report: GateReport
    stats: CollectStats


class _CallBudget:
    """남은 호출 수. take()가 False면 즉시 산출 단계로 넘어간다 (예외 아님 — 정상 경로)."""

    def __init__(self, max_calls: int) -> None:
        self.remaining = max_calls
        self.used = 0
        self.exhausted_hit = False

    def take(self) -> bool:
        if self.remaining <= 0:
            self.exhausted_hit = True
            return False
        self.remaining -= 1
        self.used += 1
        return True


def collect(
    source: PoiSourcingPort,
    *,
    area_code: str,
    content_types: Sequence[str],
    max_calls: int,
    rows_per_page: int = 100,
    gate: CollectionGate | None = None,
) -> CollectResult:
    """수집 실행. max_calls 도달 시 그 시점까지의 산출로 정상 반환한다."""
    if max_calls <= 0:
        raise ValueError(f"max_calls 양수 필요: {max_calls}")
    budget = _CallBudget(max_calls)
    listed: list[SourcedPlaceRecord] = []
    hours_by_ref: dict[str, SourcedHours] = {}
    page_failures = 0
    detail_failures = 0

    for kind in content_types:
        page_no, total_pages = 1, 1  # total은 1페이지 응답으로 갱신
        while page_no <= total_pages:
            if not budget.take():
                logger.warning(
                    "호출 한도 %d 도달 — kind=%s page=%d 에서 중단, 확보분 %d건으로 산출 진행",
                    max_calls, kind, page_no, len(listed))
                break
            try:
                page = source.fetch_page(area_code, kind, page_no, rows_per_page)
            except SourcingError as e:
                page_failures += 1
                logger.warning("목록 페이지 실패(스킵): kind=%s page=%d — %s", kind, page_no, e)
                if page_no == 1:
                    break  # 총량을 모름 — 다음 타입으로
                page_no += 1
                continue
            if page_no == 1:
                total_pages = -(-page.total_count // rows_per_page)  # ceil
            for record in page.records:
                if not record.source_ref:
                    continue  # 식별자 없는 레코드는 상세 조회·병합 불가 — 목록에서 제외
                listed.append(record)
                if not budget.take():
                    continue  # 남은 항목은 영업시간 없이 산출 ("정보 없음 ≠ 배제")
                try:
                    hours_by_ref[record.source_ref] = source.fetch_hours(
                        record.source_ref, record.kind)
                except SourcingError as e:
                    detail_failures += 1
                    logger.warning("상세 실패(영업시간 없이 계속): contentid=%s — %s",
                                   record.source_ref, e)
            page_no += 1
        if budget.exhausted_hit:
            break

    # 카테고리 매핑 — 불가분은 게이트로 보내지 않고 드롭+카운트
    candidates: list[SourcingCandidate] = []
    unmapped = 0
    for record in listed:
        category = map_category(record.kind, record.category_codes)
        if category is None:
            unmapped += 1
            continue
        hours = hours_by_ref.get(record.source_ref, _NO_HOURS)
        candidates.append(SourcingCandidate(
            source_ref=record.source_ref,
            kind=record.kind,
            name=record.name,
            address=record.address,
            lat=record.lat,
            lng=record.lng,
            category=category,
            category_codes=record.category_codes,
            open_hours=parse_open_hours(hours.hours_raw, hours.rest_raw),
            hours_raw=hours.hours_raw,
            image_url=record.image_url,
            modified_at=record.modified_at,
        ))

    report = (gate or CollectionGate()).apply(candidates)
    stats = CollectStats(
        http_calls=budget.used,
        listed=len(listed),
        page_failures=page_failures,
        detail_failures=detail_failures,
        category_unmapped=unmapped,
        gate_drops=dict(report.drops),
        merged=report.merged,
        passed=len(report.passed),
        budget_exhausted=budget.exhausted_hit,
    )
    logger.info("수집 완료: %s", stats.to_dict())
    return CollectResult(report=report, stats=stats)


def to_output_document(
    result: CollectResult,
    *,
    area_code: str,
    content_types: Sequence[str],
    collected_at: datetime,
) -> dict:
    """등록 제안 문서 (json.dumps 가능). poi는 Poi.to_dict() 왕복 스키마 그대로.

    백엔드 poi 정본 스키마(V2.0·V2.5) 실측 대조로 병행 수록하는 필드:
    - tags: cat2/cat3 분류 **명칭** 배열 (poi.tags text[] — 열린 집합)
    - region: addr1에서 추출한 시·군·구 (poi.region — 추출 실패 시 null)
    - opening_hours_raw: usetime 원문 200자 절단 (poi.opening_hours varchar(200)
      — 백엔드는 원문 문자열을 저장하므로 파싱본만 주면 원문이 소실된다)
    - source: 백엔드 CHECK 허용값 어휘 "TOURAPI"
    """
    return {
        "schema_version": SCHEMA_VERSION,
        "source": SOURCE_NAME,
        "collected_at": collected_at.isoformat(),
        "area_code": area_code,
        "content_types": list(content_types),
        "stats": result.stats.to_dict(),
        "proposals": [
            {
                "provisional_id": str(p.poi.poi_id),  # 정본 ID는 백엔드가 부여
                "source": SOURCE_NAME,
                "poi": p.poi.to_dict(),
                "tags": list(category_tags(p.candidate.category_codes)),
                "region": extract_region(p.candidate.address),
                "opening_hours_raw": _truncate(p.candidate.hours_raw, _OPENING_HOURS_MAX),
                "provenance": {
                    "content_id": p.candidate.source_ref,
                    "content_type_id": p.candidate.kind,
                    "address": p.candidate.address,
                    "image_url": p.candidate.image_url,
                    "modified_time": p.candidate.modified_at,
                },
            }
            for p in result.report.passed
        ],
    }


def _truncate(text: str | None, limit: int) -> str | None:
    """저장 상한에 맞춰 자른다(거부 아님) — 잘림은 말줄임표로 드러낸다 (안티패턴 로그)."""
    if text is None or len(text) <= limit:
        return text
    return text[: limit - 1] + "…"
