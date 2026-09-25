import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';

import { resolveReplanState } from '@/features/planb/model/replanState';
import { useApplyReplan } from '@/features/planb/model/useApplyReplan';
import { useReplanSession } from '@/features/planb/model/useReplanSession';

import { ReplanDraftView } from './ReplanDraftView';

/**
 * TRIP-751 · AC-9·AC-10 — i06 재계획안 페이지 배선판. 세션 GET 을 폴링해 판정 1회로 접고
 * 같은 순수 뷰(`ReplanDraftView`)의 세 얼굴 중 하나로 그린다.
 *
 * `useReplanSession`(폴링) → `resolveReplanState(status)`:
 *  - 'draft'      → variant 'draft'. [적용하기]는 **바로 확정**한다(E1 — 확정 지점이 i06 페이지로
 *                    옮겨졌다. 쓰기는 여전히 seam `useApplyReplan` 하나만 통과한다, BR-U4-28).
 *                    성공하면 허브로 `replace`(뒤로가기로 초안에 돌아와 409 를 맞는 길을 없앤다) +
 *                    `applied=sessionId`(i08 시트 신호, 소비는 754).
 *  - 'noSolution' → variant 'noSolution'. 서버가 사유를 주지 않으므로 부제는 뒤 절만(Seed Q4).
 *  - 'failed'     → variant 'failed'(E3 — 다른 화면으로 튕기지 않고 같은 자리에 안내, INV-4).
 *  - 'solving'·'closed'·미도착 → null.
 *
 * 라이브 얼굴은 제목 + 안내 + CTA 뿐이다(E4·Q8) — 세션 계약에 슬롯·거리·일차·날짜가 없어 지어내지 않는다.
 */

// 라이브 대안 없음 부제 — Figma 앞 절("17시 이후 …")은 데이터별 사유라 서버가 주기 전엔 쓰지 않는다.
const NO_SOLUTION_DESCRIPTION = '조건을 줄이거나 직접 고쳐 주세요';
// 출발 좌표가 없는 세션(originLat/Lng nullable)의 지도 중심 — 옛 i13 화면의 부산 중심 플레이스홀더 계승.
const FALLBACK_CENTER = { lat: 35.1587, lng: 129.1604 };

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
  const apply = useApplyReplan();

  const data = session.data;
  if (data === undefined) return null;
  const state = resolveReplanState(data.status);
  if (
    state.kind !== 'draft' &&
    state.kind !== 'noSolution' &&
    state.kind !== 'failed'
  ) {
    return null;
  }

  return (
    <ReplanDraftView
      variant={state.kind}
      center={{
        lat: data.originLat ?? FALLBACK_CENTER.lat,
        lng: data.originLng ?? FALLBACK_CENTER.lng,
      }}
      days={[]}
      selectedDayIndex={0}
      dayLabel=""
      dateLabel=""
      meta=""
      slots={[]}
      noSolutionDescription={NO_SOLUTION_DESCRIPTION}
      applyPending={apply.isPending}
      applyFailed={apply.isError}
      onBack={() => router.back()}
      onManualEdit={() =>
        router.push({
          pathname: '/trips/[tripId]/planb/manual',
          params: { tripId },
        })
      }
      onApply={() =>
        apply.mutate(
          { tripId, sessionId },
          {
            onSuccess: () =>
              router.replace({
                pathname: '/trips/[tripId]/live',
                params: { tripId, applied: sessionId },
              }),
          }
        )
      }
      onReopenRequest={() => router.push(`/trips/${tripId}/planb`)}
    />
  );
}
