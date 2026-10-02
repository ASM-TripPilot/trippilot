import type { BaseAssignment } from '@/shared/api/index.schemas';

import { deriveEndDate } from '@/features/create-trip';

/** 배정 목록을 "밤 ISO → savedStayId" 지도로 편다(`[dateFrom, dateTo)`, 체크아웃 배타). 다음 밤은
 * 달력 계산(`deriveEndDate`)으로 구한다 — 문자열에 일만 더하면 월 경계에서 끝나지 않는다. */
function nightMap(rows: readonly BaseAssignment[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    for (
      let night = row.dateFrom;
      night < row.dateTo;
      night = deriveEndDate(night, 1)
    ) {
      map.set(night, row.savedStayId);
    }
  }
  return map;
}

/**
 * TRIP-1082 — 거점이 실제로 바뀌었나. 행 id·행 수·순서가 아니라 **밤마다 어느 숙소인가**로 비교한다.
 * 교체(DELETE→자투리 재POST→새 POST)는 밤의 숙소가 같아도 행을 갈고(A→B→A), 부분 실패는 밤을
 * 비운다 — 둘 다 행 비교로는 틀린다.
 */
export function basesChanged(
  before: readonly BaseAssignment[],
  after: readonly BaseAssignment[]
): boolean {
  const a = nightMap(before);
  const b = nightMap(after);
  if (a.size !== b.size) return true;
  for (const [night, stay] of a) {
    if (b.get(night) !== stay) return true;
  }
  return false;
}
