"""TourAPI 수집 파이프라인 — 조회 → 변환 → 수집 게이트 → 등록 제안 (TRIP-246).

흐름: PoiSourcingPort 페이지 순회(목록 1페이지 + 항목별 영업시간 1건씩 인터리브)
→ 카테고리 매핑(불가분 드롭+카운트) → 수집 게이트 5단 → 등록 제안 문서.
다지역 실행은 `collect_areas`가 지역별 `collect`를 공평 배분으로 조립한다
(전국 골고루 — 균등 분할 + 라운드로빈 이월, TRIP-246 후속).

**호출 예산이 1급 규칙**: 포트 메서드 1회 = HTTP 1건 계약 위에서, max_calls
도달 시 **그 시점까지 산출하고 정상 종료** (부분 성공 = 성공). 재시도 없음,
실패 페이지·항목은 로그 후 스킵 (침묵 금지 — 로그·카운트로 드러낸다).
여기의 max_calls는 **총** 예산이다 — 키 여러 개면 키 수 × 키당 상한을 넘겨라
(키당 상한·키 전환은 어댑터 키링 소관, tourapi.py 참조).

**INV-1 부기**: 산출물은 "등록 제안" JSON일 뿐, 후보 풀에 직접 들어가지 않는다.
POI 정본은 backend C7 단일 소유(PR #76) — 정본 등록 후에만 closed-set 후보가 된다.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
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
from trippilot.poi_curation.sourcing.state import (
    CollectState,
    KindCursor,
    empty_state,
)

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
# 백엔드 poi.source CHECK 허용값('KAKAO_LOCAL'|'TOURAPI'|'MANUAL')과 동일 어휘.
# 실제 피드는 TourAPI 4.0 KorService2.
SOURCE_NAME = "TOURAPI"
_OPENING_HOURS_MAX = 200  # backend poi.opening_hours varchar(200)
_NO_HOURS = SourcedHours(hours_raw=None, rest_raw=None)

# TourAPI(KorService2) areaCode ↔ 광역 지자체 이름 — 17개 전부 (기본 순회 대상).
# 1 서울 · 2 인천 · 3 대전 · 4 대구 · 5 광주 · 6 부산 · 7 울산 · 8 세종 ·
# 31 경기 · 32 강원 · 33 충북 · 34 충남 · 35 경북 · 36 전북 · 37 전남 ·
# 38 경남 · 39 제주
AREA_NAMES: Mapping[str, str] = {
    "1": "서울", "2": "인천", "3": "대전", "4": "대구", "5": "광주",
    "6": "부산", "7": "울산", "8": "세종", "31": "경기", "32": "강원",
    "33": "충북", "34": "충남", "35": "경북", "36": "전북", "37": "전남",
    "38": "경남", "39": "제주",
}
DEFAULT_AREA_CODES: tuple[str, ...] = tuple(AREA_NAMES)


def resolve_area_codes(single: str | None, multi: str | None) -> list[str]:
    """env → 순회 지역 목록 (순서 = 설정 순서 고정, 결정론).

    단수 `TOURAPI_AREA_CODE`가 설정되면 그 지역만(하위호환), 아니면 쉼표 목록
    `TOURAPI_AREA_CODES`, 그것도 없으면 광역 17개 전부 (전국 골고루 기본).
    """
    if single and single.strip():
        return [single.strip()]
    codes = [a.strip() for a in (multi or "").split(",") if a.strip()]
    return codes if codes else list(DEFAULT_AREA_CODES)


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
    # ── TRIP-348 커서 이어가기 (기본값 유지 — 상태 없는 기존 호출과 완전 호환) ──
    skipped_unchanged: int = 0                    # 기제안·modifiedtime 동일 → 상세 호출 없이 스킵
    resumed_from: dict[str, int] = field(default_factory=dict)  # kind → 재개 시작 pageNo (>1만)
    completed_kinds: tuple[str, ...] = ()         # 이번 실행 종료 시점 완주 상태인 kind

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
            "skipped_unchanged": self.skipped_unchanged,
            "resumed_from": dict(self.resumed_from),
            "completed_kinds": list(self.completed_kinds),
        }


@dataclass(frozen=True, slots=True)
class CollectResult:
    report: GateReport
    stats: CollectStats
    # 이번 실행을 반영한 다음 상태 (커서 + 기제안 색인) — 저장은 스크립트 소관
    next_state: CollectState = field(default_factory=empty_state)


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
    state: CollectState | None = None,
) -> CollectResult:
    """수집 실행. max_calls 도달 시 그 시점까지의 산출로 정상 반환한다.

    `state`(TRIP-348)를 주면: 미완주 커서는 그 pageNo부터 재개하고, 완주 커서는
    처음부터 재순회하되 기제안 색인(modifiedtime 동일)으로 싸게 통과한다 — 스킵된
    항목은 상세 호출도 안 나간다. 미주입이면 기존과 완전히 동일 (처음부터, 스킵 0).

    TODO(TRIP-348 후속): 완주 후 재순회는 TourAPI 증분 엔드포인트
    (areaBasedSyncList2 — modifiedtime 기준 변경분만)로 전환할 이음매다.
    실키로 응답 형태를 검증할 수 있는 시점에 별도 티켓으로 — 지어내지 않는다.
    """
    if max_calls <= 0:
        raise ValueError(f"max_calls 양수 필요: {max_calls}")
    prior = state if state is not None else empty_state()
    budget = _CallBudget(max_calls)
    listed: list[SourcedPlaceRecord] = []
    hours_by_ref: dict[str, SourcedHours] = {}
    page_failures = 0
    detail_failures = 0
    skipped_unchanged = 0
    resumed_from: dict[str, int] = {}
    cursors: dict[tuple[str, str], KindCursor] = dict(prior.cursors)

    for kind in content_types:
        cursor = prior.cursors.get((area_code, kind))
        start_page = 1
        if cursor is not None and not cursor.completed and cursor.next_page > 1:
            start_page = cursor.next_page
            resumed_from[kind] = start_page
            logger.info("재개: kind=%s page=%d부터", kind, start_page)
        page_no = start_page
        total_pages: int | None = None  # 첫 성공 페이지 응답으로 확정
        attempted = False               # 이 kind로 호출을 한 번이라도 소모했는가
        while total_pages is None or page_no <= total_pages:
            if not budget.take():
                logger.warning(
                    "호출 한도 %d 도달 — kind=%s page=%d 에서 중단, 확보분 %d건으로 산출 진행",
                    max_calls, kind, page_no, len(listed))
                break
            attempted = True
            try:
                page = source.fetch_page(area_code, kind, page_no, rows_per_page)
            except SourcingError as e:
                page_failures += 1
                logger.warning("목록 페이지 실패(스킵): kind=%s page=%d — %s", kind, page_no, e)
                if total_pages is None:
                    break  # 총량을 모름 — 다음 타입으로 (커서는 같은 페이지 재시도)
                page_no += 1
                continue
            if total_pages is None:
                total_pages = -(-page.total_count // rows_per_page)  # ceil
            for record in page.records:
                if not record.source_ref:
                    continue  # 식별자 없는 레코드는 상세 조회·병합 불가 — 목록에서 제외
                known = prior.proposed.get(record.source_ref)
                if known is not None and known == record.modified_at:
                    skipped_unchanged += 1
                    continue  # 기제안·변경 없음 — 상세 호출도 안 나감 (쿼터 절약의 본체)
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
        if attempted:  # 호출 0건인 kind는 커서를 건드리지 않는다 (완주 마킹 보존)
            if total_pages is not None and page_no > total_pages:
                cursors[(area_code, kind)] = KindCursor(next_page=1, completed=True)
            else:
                cursors[(area_code, kind)] = KindCursor(next_page=page_no, completed=False)
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

    # 기제안 색인 갱신 — 이번 실행 통과분을 누적 (modifiedtime 없는 항목은 색인하지
    # 않는다: 변경 여부를 판정할 수 없으니 다음 실행에도 재수록 — 지어내기 금지).
    proposed = dict(prior.proposed)
    for p in report.passed:
        if p.candidate.modified_at:
            proposed[p.candidate.source_ref] = p.candidate.modified_at
    completed_kinds = tuple(
        kind for kind in content_types
        if (c := cursors.get((area_code, kind))) is not None and c.completed
    )

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
        skipped_unchanged=skipped_unchanged,
        resumed_from=resumed_from,
        completed_kinds=completed_kinds,
    )
    logger.info("수집 완료: %s", stats.to_dict())
    return CollectResult(
        report=report,
        stats=stats,
        # 라운드로빈 포인터는 단일 지역 수집의 관심사가 아니다 — 입력값 보존만
        # (회전은 collect_areas 소관)
        next_state=CollectState(cursors=cursors, proposed=proposed,
                                next_area=prior.next_area),
    )


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


# ── 전국 다지역 공평 순회 (TRIP-246 후속) ─────────────────────────────


@dataclass(frozen=True, slots=True)
class MultiCollectResult:
    """지역별 실행 결과 — 실행 순서(회전 순서) 그대로, 호출 0건 지역은 미포함."""

    area_results: tuple[tuple[str, CollectResult], ...]  # (area_code, 결과)
    next_state: CollectState  # 전 지역 커서·색인 + 회전된 라운드로빈 포인터


def collect_areas(
    source: PoiSourcingPort,
    *,
    area_codes: Sequence[str],
    content_types: Sequence[str],
    max_calls: int,
    rows_per_page: int = 100,
    gate: CollectionGate | None = None,
    state: CollectState | None = None,
) -> MultiCollectResult:
    """다지역 공평 수집 — 총 예산(max_calls)을 지역별로 나눠 `collect`를 조립한다.

    배분 규칙 (결정론 — 지역 순서는 `area_codes` 그대로, 포인터만 회전):
    - 시작 지역 = 상태의 라운드로빈 포인터(next_area). 매 실행 다음 지역으로
      한 칸 회전해 저장 — 시작 지역이 순환하므로 장기적으로 공평하다.
    - **미완주 지역**(어느 타입이든 완주 전)에만 총 예산을 균등 분할(floor).
      분할 나머지는 회전 순서 앞쪽 지역부터 1씩 더 배분한다.
    - 조기 종료분(지역이 자기 몫을 다 못 쓰면)은 회전 순서상 다음 지역으로 이월.
    - **완주 지역**(모든 타입 커서 completed)은 색인 스킵 재순회가 저렴하므로
      배분에서 빼고, 잔여 예산이 남으면 마지막에 회전 순서대로 돈다.

    지역 내부 동작(타입 순회·커서 재개·기제안 스킵)은 `collect` 그대로다.
    """
    if not area_codes:
        raise ValueError("area_codes 비어 있음")
    if max_calls <= 0:
        raise ValueError(f"max_calls 양수 필요: {max_calls}")
    current = state if state is not None else empty_state()

    ordered = list(area_codes)
    start = 0
    if current.next_area is not None and current.next_area in ordered:
        start = ordered.index(current.next_area)
    # 포인터 지역이 목록에서 사라졌으면(env 변경) 처음부터 — 결정론 유지
    rotated = ordered[start:] + ordered[:start]
    next_pointer = ordered[(start + 1) % len(ordered)]

    def _fully_completed(s: CollectState, area: str) -> bool:
        return all(
            (c := s.cursors.get((area, kind))) is not None and c.completed
            for kind in content_types
        )

    pending = [a for a in rotated if not _fully_completed(current, a)]
    finished = [a for a in rotated if _fully_completed(current, a)]

    area_results: list[tuple[str, CollectResult]] = []
    if pending:
        share, remainder = divmod(max_calls, len(pending))
        leftover = 0
    else:
        share, remainder = 0, 0
        leftover = max_calls  # 전 지역 완주 — 전액 잔여 예산으로 재순회

    carry = 0
    for i, area in enumerate(pending):
        alloc = share + (1 if i < remainder else 0) + carry
        carry = 0
        if alloc <= 0:
            continue  # 예산 < 지역 수 — 이번 실행 몫 없음 (다음 실행에 포인터가 돈다)
        result = collect(
            source, area_code=area, content_types=content_types,
            max_calls=alloc, rows_per_page=rows_per_page, gate=gate, state=current,
        )
        area_results.append((area, result))
        current = result.next_state
        carry = alloc - result.stats.http_calls  # 조기 종료분 이월
    leftover += carry

    for area in finished:  # 완주 지역은 잔여 예산으로 마지막에 (색인 스킵 — 저렴)
        if leftover <= 0:
            break
        result = collect(
            source, area_code=area, content_types=content_types,
            max_calls=leftover, rows_per_page=rows_per_page, gate=gate, state=current,
        )
        area_results.append((area, result))
        current = result.next_state
        leftover -= result.stats.http_calls

    return MultiCollectResult(
        area_results=tuple(area_results),
        next_state=replace(current, next_area=next_pointer),
    )


def to_multi_output_document(
    result: MultiCollectResult,
    *,
    area_codes: Sequence[str],
    content_types: Sequence[str],
    collected_at: datetime,
) -> dict:
    """다지역 등록 제안 문서 — 제안 스키마는 to_output_document와 동일, 통계는
    합산 + 지역별 분해(per_area). 지역 단수 필드(area_code) 대신 area_codes 목록."""
    per_area = {
        area: {"calls": 0, "passed": 0, "skipped": 0} for area in area_codes
    }
    totals = {
        "http_calls": 0, "listed": 0, "page_failures": 0, "detail_failures": 0,
        "category_unmapped": 0, "merged": 0, "passed": 0, "skipped_unchanged": 0,
    }
    gate_drops: dict[str, int] = {}
    budget_exhausted = False
    proposals: list[dict] = []
    for area, r in result.area_results:
        s = r.stats
        per_area[area] = {
            "calls": s.http_calls, "passed": s.passed,
            "skipped": s.skipped_unchanged,
        }
        totals["http_calls"] += s.http_calls
        totals["listed"] += s.listed
        totals["page_failures"] += s.page_failures
        totals["detail_failures"] += s.detail_failures
        totals["category_unmapped"] += s.category_unmapped
        totals["merged"] += s.merged
        totals["passed"] += s.passed
        totals["skipped_unchanged"] += s.skipped_unchanged
        for reason, count in s.gate_drops.items():
            gate_drops[reason] = gate_drops.get(reason, 0) + count
        budget_exhausted = budget_exhausted or s.budget_exhausted
        area_doc = to_output_document(
            r, area_code=area, content_types=content_types,
            collected_at=collected_at,
        )
        proposals.extend(area_doc["proposals"])
    return {
        "schema_version": SCHEMA_VERSION,
        "source": SOURCE_NAME,
        "collected_at": collected_at.isoformat(),
        "area_codes": list(area_codes),
        "content_types": list(content_types),
        "stats": {
            **totals,
            "gate_drops": gate_drops,
            "budget_exhausted": budget_exhausted,
            "per_area": per_area,
        },
        "proposals": proposals,
    }
