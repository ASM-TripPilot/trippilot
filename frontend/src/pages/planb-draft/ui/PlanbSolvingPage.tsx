import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useEffect } from 'react';

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
 * TRIP-443 · AC-5(106-A · INV-4) — FAILED(재계획 불가)면 침묵 실패 없이 수동 편집 화면으로
 * 전환한다: `resolveReplanState` FAILED → `planb/manual?variant=error`(i22) push 1회. 진입 신호는
 * variant(isFallback/solveMode 아님). SOLVING·기타 kind 동작은 무변경(effect 가 failed 에서만 발화).
 *
 * SOLVING 외(DRAFT·NO_SOLUTION·closed·미도착)는 이번 사이클 미구현(draft 계약 갭·i16 범위 밖) —
 * null 로 접는다(정직한 미표시, AC 없음). 그 화면들은 후속 티켓.
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

  // 106-A — 재계획이 FAILED 면 i22(수동 편집·error) 로 전환한다(INV-4 침묵 금지). kind 가 failed 일
  // 때만 발화하고 폴링 재렌더로 kind 가 그대로면 재발화 없음(1회 push).
  const failed = state?.kind === 'failed';
  useEffect(() => {
    if (failed) {
      router.push({
        pathname: '/trips/[tripId]/planb/manual',
        params: { tripId, variant: 'error' },
      });
    }
  }, [failed, tripId, router]);

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
