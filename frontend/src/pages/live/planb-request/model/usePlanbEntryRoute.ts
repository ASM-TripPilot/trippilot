import { useState } from 'react';

import { isNotFound } from '@/shared/api';
import {
  useGetTripsTripIdReplanSessionsPrepared,
  useGetTripsTripIdTriggersTriggerId,
} from '@/shared/api/index.hooks';
import { useElapsedFlag } from '@/shared/lib/useElapsedFlag';

import { entryRoute, type EntryLookup, type EntryRoute } from './entryRoute';

/**
 * 상황 감지 FE-B · frontend-components §3.2 — 진입 게이트의 두 조회와 3초 상한을 판정(`entryRoute`)에 잇는다.
 *
 *  - 트리거 상세 → 그 `affectedDate` 로 준비된 대안(날짜 키 — 해제 뒤 다시 선 트리거도 같은 대안으로 이어진다).
 *  - 둘 합쳐 최대 3초(`useElapsedFlag` — 마운트부터 결정 전까지). 재시도하지 않는다 — 실패는 곧장 i04 다(막다른 길 없음).
 *  - **결정은 한 번만 굳힌다** — 처음 `wait` 가 아닌 답을 상태로 쥐고, 그 뒤 재조회·포커스 복귀가 다른 답을 줘도 그대로다.
 *    굳은 뒤에는 두 조회를 끈다(쓸 데 없는 재조회 0). `gcTime: 0` — 다음 진입이 지난 진입의 캐시로 판정하지 않게.
 */

export const ENTRY_WAIT_MS = 3_000;

function lookupOf<T>(query: {
  data: T | undefined;
  isError: boolean;
  error: unknown;
}): EntryLookup<T> {
  if (query.data !== undefined) return { kind: 'found', value: query.data };
  if (query.isError) {
    return isNotFound(query.error) ? { kind: 'notFound' } : { kind: 'failed' };
  }
  return { kind: 'pending' };
}

export function usePlanbEntryRoute(
  tripId: string,
  triggerId: string,
  today: string
): EntryRoute {
  const [decided, setDecided] = useState<EntryRoute | null>(null);
  const open = decided === null;

  const detail = useGetTripsTripIdTriggersTriggerId(tripId, triggerId, {
    query: { enabled: open, retry: false, gcTime: 0 },
  });
  const date = detail.data?.affectedDate;
  const prepared = useGetTripsTripIdReplanSessionsPrepared(
    tripId,
    { date: date ?? '' },
    { query: { enabled: open && date !== undefined, retry: false, gcTime: 0 } }
  );
  const timedOut = useElapsedFlag(open, ENTRY_WAIT_MS);

  const live = entryRoute({
    trigger: lookupOf(detail),
    prepared: lookupOf(prepared),
    timedOut,
    today,
  });
  // 렌더 중 조정 — 처음 나온 결정을 그 자리에서 굳힌다(LiveItineraryPage 의 seenAppliedSessionId 선례).
  if (open && live.kind !== 'wait') setDecided(live);
  return decided ?? live;
}
