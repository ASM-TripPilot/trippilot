import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useEffect } from 'react';

import type { ReplanSlotVM } from '@/entities/itinerary-slot/model';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { buildStatePins } from '@/entities/itinerary-slot/lib/slotMapPin';
import { projectSlotProgress } from '@/features/execution/model/slotProgress';
import { useLiveItinerary } from '@/features/execution/model/useLiveItinerary';
import { deriveVisitProgress } from '@/features/execution/model/visitProgress';
import { formatCoPickDayHeader } from '@/features/itinerary/model/draftView';
import { readFromInstant } from '@/features/planb/model/replanFromInstant';
import { deriveReplanMapAnchor } from '@/features/planb/model/replanMapCenter';
import { resolveReplanState } from '@/features/planb/model/replanState';
import { useReplanSession } from '@/features/planb/model/useReplanSession';
import {
  useGetTripsTripIdVisitsDaysDay,
  usePostTripsTripIdReplanSessionsSessionIdCancel,
} from '@/shared/api/generated/trips/trips';

import { ReplanSolvingView } from './ReplanSolvingView';

/**
 * TRIP-752 · i05 다시 짜는 중 배선판. 세션 GET 폴링 → 판정 1회 → 짜는 중이면 `ReplanSolvingView`.
 *
 *  - 보여 줄 날 = `fromInstant` 의 **여행지(KST) 날짜**(서버의 "오늘"과 같다). 그날 일정 슬롯 중 방문
 *    기록상 완료된 것만 일정 순서대로 행으로 그린다(BR-U4-34 — 진행 상태는 기록에서 온다, 시계 추정 없음).
 *    헤더 곳 수 = 완료 + 진행 중(둘 다 기준 시각 이전이라 그대로 둔다, BR-U4-17·18).
 *    그날을 모르면(일정 미도착·그날 없음) 제목만 남기고 화면은 그대로 그린다.
 *  - [취소] → cancel 요청만(itinerary PUT 없음 — INV-U4-05). **성공한 뒤에만** 뒤로(없으면 허브로 replace).
 *  - ‹ → `router.back()` — 세션을 살린 채 나간다(옛 [백그라운드로]).
 *  - DRAFT·NO_SOLUTION·FAILED → i06(`planb/draft`)으로 **replace** 1회. push 면 i06 에서 뒤로 갔을 때 이
 *    화면이 다시 떠 곧장 i06 로 되돌려 보내는 루프가 생긴다. 의존성을 kind 문자열로 둬 폴링 재렌더에
 *    다시 발화하지 않는다.
 *  - closed·미도착 → null.
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
  const itinerary = useLiveItinerary(tripId);

  const data = session.data;
  const kind =
    data === undefined ? undefined : resolveReplanState(data.status).kind;
  const from =
    data === undefined ? undefined : readFromInstant(data.fromInstant);
  const days = itinerary.data?.days ?? [];
  const dayIndex =
    from === undefined ? -1 : days.findIndex((day) => day.date === from.date);
  const day = dayIndex === -1 ? undefined : days[dayIndex];

  // 훅 규칙상 조기 반환 위에서 무조건 부른다 — 그날을 모르면 쿼리를 끈다.
  const visits = useGetTripsTripIdVisitsDaysDay(tripId, day?.date ?? '', {
    query: { enabled: day !== undefined },
  });

  useEffect(() => {
    if (kind === 'draft' || kind === 'noSolution' || kind === 'failed') {
      router.replace({
        pathname: '/trips/[tripId]/planb/draft',
        params: { tripId, sessionId },
      });
    }
  }, [kind, tripId, sessionId, router]);

  if (kind !== 'solving' || data === undefined || from === undefined) {
    return null;
  }

  // 방문 기록을 모르면(조회 중·실패) 곳 수·행을 비운다 — "방문한 0곳"은 거짓이다.
  const visitsKnown = visits.data !== undefined;
  const progress = deriveVisitProgress(visits.data ?? { visits: [] });
  const projected = day
    ? projectSlotProgress(day.slots, {
        completedPoiIds: progress.completedPoiIds,
        activePoiId: progress.activePoiId,
      })
    : [];
  const doneIndexes = visitsKnown
    ? projected.flatMap((entry, index) =>
        entry.state === 'done' ? [index] : []
      )
    : [];
  const kept =
    doneIndexes.length +
    projected.filter((entry) => entry.state === 'active').length;

  const slotKeyAt = (index: number) =>
    buildSlotKey(from.date, projected[index].slot.poiId);
  // 원 일정에서 바로 앞 슬롯이 완료 행이 아니면 그 앞 커넥터를 뺀다(거리는 바로 앞 슬롯 기준).
  const unlinkedSlotKeys = doneIndexes
    .filter((index, i) => i > 0 && doneIndexes[i - 1] !== index - 1)
    .map(slotKeyAt);

  const slots: ReplanSlotVM[] = doneIndexes.map((index) => {
    const { slot } = projected[index];
    return {
      slotKey: slotKeyAt(index),
      placeName: slot.nameKo ?? '',
      tone: 'visited',
      photo: slot.imageUrl ? { uri: slot.imageUrl } : null,
      category: slot.category ?? null,
      // 서버 검증 시각을 자르기만 한다(INV-2).
      timeLabel: `${slot.startAt.slice(0, 5)} 방문`,
      // 서버 category 는 코드값이라 Figma 의 한글 부제(`마을 · 벽화`)를 만들 재료가 없다.
      categoryLabel: null,
      distanceRange: slot.distanceRange ?? null,
      isFixed: slot.isFixed,
    };
  });

  return (
    <ReplanSolvingView
      // 세션 출발 좌표 → 그날 첫 좌표 슬롯 → 일정 전체 → 서울시청(TRIP-979 B).
      center={
        deriveReplanMapAnchor({
          days,
          preferredDate: from.date,
          origin: { lat: data.originLat, lng: data.originLng },
        }).center
      }
      pins={buildStatePins(
        projected.map(({ slot, state }) => ({
          lat: slot.lat,
          lng: slot.lng,
          progress: state,
        }))
      )}
      solvingLabel={`${from.hour}시 이후 다시 짜는 중`}
      dayLabel={day ? `${dayIndex + 1}일차` : ''}
      dateLabel={day ? formatCoPickDayHeader(day.date) : ''}
      meta={day && visitsKnown ? `방문한 ${kept}곳 그대로` : ''}
      slots={slots}
      unlinkedSlotKeys={unlinkedSlotKeys}
      cancelPending={cancel.isPending}
      onBack={() => router.back()}
      onCancel={() =>
        cancel.mutate(
          { tripId, sessionId },
          {
            onSuccess: () => {
              if (router.canGoBack()) router.back();
              else router.replace(`/trips/${tripId}/live`);
            },
          }
        )
      }
    />
  );
}
