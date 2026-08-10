"""당일 휴무 배치 접점 — batch_check_closed의 Plan-B 연결 (U3 FD §2 ③ 비고).

M7 필터 ③(영업일)은 여행일 요일 창만 본다. 당일 휴무(is_closed_today) 확인은
Plan-B(인트립 재계획) 소유 — 이 모듈은 PoiDbPort.batch_check_closed를 호출
가능한 접점(함수 + 결과 계약)으로만 노출한다. 재계획 로직은 Plan-B 본체 몫.

INV-4: 포트 호출 실패가 조용히 "휴무 없음"으로 수렴하면 안 된다 — status로 구분.
결정론: I/O는 batch_check_closed 한 번, 빈 입력은 포트 호출 없이 즉시 반환.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum

from trippilot.domain.common import PoiId


class ClosureCheckStatus(Enum):
    OK = "OK"
    FAILED = "FAILED"  # 포트 실패 — "휴무 없음"(OK+빈 집합)과 구분 (INV-4)


@dataclass(frozen=True, slots=True)
class ClosureCheckResult:
    status: ClosureCheckStatus
    closed_poi_ids: frozenset[PoiId]  # 당일 휴무 POI (입력의 부분집합)
    checked_on: date
    reason: str | None = None  # FAILED 사유 (침묵 금지)

    def __post_init__(self) -> None:
        if self.status is ClosureCheckStatus.FAILED:
            if self.closed_poi_ids:
                raise ValueError("FAILED엔 휴무 집합 없음 — 실패를 결과처럼 보이게 금지")
            if not self.reason:
                raise ValueError("FAILED엔 reason 필수 (침묵 실패 금지)")
        elif self.reason is not None:
            raise ValueError("OK엔 reason 없음 (상태-사유 정합)")

    def to_dict(self) -> dict:
        return {
            "status": self.status.value,
            "closed_poi_ids": sorted(str(p) for p in self.closed_poi_ids),
            "checked_on": self.checked_on.isoformat(),
            "reason": self.reason,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ClosureCheckResult":
        return cls(
            status=ClosureCheckStatus(d["status"]),
            closed_poi_ids=frozenset(PoiId(p) for p in d["closed_poi_ids"]),
            checked_on=date.fromisoformat(d["checked_on"]),
            reason=d["reason"],
        )


def check_closures(
    poi_db, poi_ids: frozenset[PoiId], on: date
) -> ClosureCheckResult:
    """일정에 포함된 POI들의 당일 휴무를 일괄 확인 (PoiDbPort 경유만).

    poi_db는 PoiDbPort — 운영에선 CachedPoiRepository(위임 경로)를 넘긴다.
    """
    if not poi_ids:  # 빈 일정 — 포트 호출 없이 결정론 반환
        return ClosureCheckResult(ClosureCheckStatus.OK, frozenset(), on)
    try:
        closed = frozenset(poi_db.batch_check_closed(poi_ids, on))
    except Exception as e:  # 포트 장애 — "휴무 없음"으로 수렴 금지 (INV-4)
        return ClosureCheckResult(
            ClosureCheckStatus.FAILED, frozenset(), on,
            reason=f"{type(e).__name__}: {e}")
    ghosts = closed - poi_ids  # 계약 위반(입력 밖 id) — 조용히 고치지 않는다
    if ghosts:
        return ClosureCheckResult(
            ClosureCheckStatus.FAILED, frozenset(), on,
            reason=f"port 계약 위반 — 입력 밖 poi_id {len(ghosts)}건")
    return ClosureCheckResult(ClosureCheckStatus.OK, closed, on)
