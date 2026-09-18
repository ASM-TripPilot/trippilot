import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useEffect } from 'react';

import { resolveReplanState } from '@/features/planb/model/replanState';
import { useReplanSession } from '@/features/planb/model/useReplanSession';
import { NoAlternativeScreen } from '@/features/planb/ui/NoAlternativeScreen';
import { ReplanDraftScreen } from '@/features/planb/ui/ReplanDraftScreen';

/**
 * TRIP-563 · AC-6·AC-7 — i13/i16 재계획안 페이지 배선판. 세션 GET 을 폴링해 판정 1회로 접고
 * kind 별로 화면을 그리거나 라우팅한다(선례 `PlanbSolvingPage` 동형 — dispatch 정본).
 *
 * `useReplanSession`(폴링) → `resolveReplanState(status)`:
 *  - 'draft'      → `ReplanDraftScreen`(i13). 계약 존재 필드(reasons·excludedPoiIds)만 바인딩하고
 *                    **slots 는 []** — 제안 days/slots(ReplanSession.draft) 계약 공백의 정직한 degrade
 *                    (페이지가 슬롯을 지어내지 않는다). apply 훅은 import 하지 않는다(INV-U4-05 무쓰기).
 *  - 'noSolution' → `NoAlternativeScreen`(i16). skipCount 는 이월 개수로 채운다(계약 공백이라 심판은
 *                    값을 강제 안 함 — brief 열린 판단).
 *  - 'failed'     → `router.push(planb/manual?variant=error)` 1회(침묵 없이 수동 편집으로, INV-4 ·
 *                    선례 106-A). 진입 신호는 variant(정상 i15 와 error 를 가른다).
 *  - 'solving'·'closed'·미도착 → null(폴링 대기·세션 종료·조회 미도착, 화면 없음).
 *
 * 배선 목적지: i13/i16 `onManualEdit` → planb/manual(variant 없음=정상 i15) · i13 `onApply` →
 * planb/diff(확정은 i18) · i16 `onSkip`·`onRestMode` → no-op 자리표시(계약·제품 정의 부재).
 */

export interface PlanbDraftPageProps {
  tripId: string;
  sessionId: string;
}

export function PlanbDraftPage({
  tripId,
  sessionId,
}: PlanbDraftPageProps): ReactElement | null {
  const router = useRouter();
  const session = useReplanSession(tripId, sessionId);

  const data = session.data;
  const state =
    data === undefined ? undefined : resolveReplanState(data.status);

  // FAILED → i22(수동 편집·error)로 전환한다(INV-4 침묵 금지). failed 일 때만 발화하고 폴링 재렌더로
  // kind 가 그대로면 재발화하지 않는다(1회 push, 선례 106-A).
  const failed = state?.kind === 'failed';
  useEffect(() => {
    if (failed) {
      router.push({
        pathname: '/trips/[tripId]/planb/manual',
        params: { tripId, variant: 'error' },
      });
    }
  }, [failed, tripId, router]);

  const goManual = () =>
    router.push({
      pathname: '/trips/[tripId]/planb/manual',
      params: { tripId },
    });

  if (data !== undefined && state !== undefined) {
    if (state.kind === 'draft') {
      return (
        <ReplanDraftScreen
          reasons={data.reasons ?? []}
          excludedPoiIds={data.excludedPoiIds ?? []}
          slots={[]}
          onManualEdit={goManual}
          onApply={() =>
            router.push({
              pathname: '/trips/[tripId]/planb/diff',
              params: { tripId, sessionId },
            })
          }
          onPressCandidates={() => {}}
        />
      );
    }
    if (state.kind === 'noSolution') {
      return (
        <NoAlternativeScreen
          skipCount={(data.excludedPoiIds ?? []).length}
          onSkip={() => {}}
          onRestMode={() => {}}
          onManualEdit={goManual}
        />
      );
    }
  }

  return null;
}
