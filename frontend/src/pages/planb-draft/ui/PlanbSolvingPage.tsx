import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';

import { resolveReplanState } from '@/features/planb/model/replanState';
import { useReplanSession } from '@/features/planb/model/useReplanSession';
import { ReplanSolvingScreen } from '@/features/planb/ui/ReplanSolvingScreen';
import { usePostTripsTripIdReplanSessionsSessionIdCancel } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-440 · AC-1·2·3 — i12 재계획 로딩 배선판. 세션 GET 을 폴링해 판정하고 i12 를 그린다.
 *
 * `useReplanSession`(폴링) → `resolveReplanState(status)` → 'solving' 이면 `ReplanSolvingScreen`.
 *  - [취소] → `usePostTripsTripIdReplanSessionsSessionIdCancel().mutate({tripId, sessionId})` — 세션만
 *    닫는다. **itinerary PUT 훅은 import 하지 않는다**(INV-U4-05, APPLIED 전엔 원 일정 미변경 —
 *    소스 스캔이 잠근다).
 *  - [백그라운드로] → `router.back()` — 세션을 살린 채 이탈(취소와 구별, D3).
 *
 * SOLVING 외(DRAFT·NO_SOLUTION·FAILED·closed·미도착)는 이번 사이클 미구현(draft 계약 갭·i16 범위
 * 밖) — null 로 접는다(정직한 미표시, AC 없음). 그 화면들은 후속 티켓.
 */

export interface PlanbSolvingPageProps {
  tripId: string;
  sessionId: string;
}

export function PlanbSolvingPage({
  tripId,
  sessionId,
}: PlanbSolvingPageProps): ReactElement | null {
  const router = useRouter();
  const session = useReplanSession(tripId, sessionId);
  const cancel = usePostTripsTripIdReplanSessionsSessionIdCancel();

  const state =
    session.data === undefined
      ? undefined
      : resolveReplanState(session.data.status);

  if (state?.kind === 'solving') {
    return (
      <ReplanSolvingScreen
        onBackground={() => router.back()}
        onCancel={() => cancel.mutate({ tripId, sessionId })}
      />
    );
  }

  return null;
}
