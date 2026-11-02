import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';

import { tripItinerarySummary } from '@/entities/trip';
import type { BootstrapDestination } from '@/features/auth/index.view';
import {
  ITINERARY_OPEN_FAILED_MESSAGE,
  ITINERARY_OPEN_FAILED_TOAST_ID,
  fetchTripItineraryHref,
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary';
import { getGetTripsQueryKey, useGetTrips } from '@/shared/api/index.trips';
import type {
  ItineraryGenerationState,
  Trip,
} from '@/shared/api/index.schemas';
import { showToast } from '@/shared/ui/Toast';

import {
  GENERATION_COMPLETE_MESSAGE,
  GENERATION_COMPLETE_TOAST_ID,
  GENERATION_FAILED_MESSAGE,
  GENERATION_FAILED_TOAST_ID,
  detectGenerationTransition,
  shouldSkipToast,
  tripsRefetchInterval,
} from './generationWatch';

/**
 * 앱 셸의 "생성 완료 감지" — TRIP-1618 · TRIP-1677 에서 여행별 일정 폴링을 목록(`GET /trips`) 한 칸 폴링으로 바꿨다.
 *
 * - **누굴 묻나**: 여행 목록 한 칸만 — 목록이 여행마다 일정 상태 네 칸을 싣기 때문이다. 이 훅이 **목록의 유일한 폴링 관찰자**다
 *   (`refetchInterval: tripsRefetchInterval` — 생성 중 여행이 없으면 요청 0). 목록 칸을 읽는 홈·내 여행·마이·기록 화면은 옵션 없는
 *   관찰자라 이 폴링이 갱신한 값이 저절로 보인다. 앱이 백그라운드면 `focusManager`(AppProviders)가 틱을 건너뛴다.
 *   결과는 구독하지 않는다(`notifyOnChangeProps: []`) — 틱마다 앱 루트가 다시 그려지지 않게.
 * - **언제 알리나**: 쿼리 캐시 변경 알림을 듣다가 목록 속 한 여행이 `PARTIAL → COMPLETE|FAILED` 로 바뀐 그 순간 한 번(전이 감지 —
 *   같은 값 반복·처음부터 완료인 값은 알리지 않는다). 그 여행의 진행 화면이나 일정 탭을 보고 있으면 생략 — 카드는 어차피 바뀐다.
 *   `useSyncExternalStore` 로 바꾸지 마라 — 렌더 중 갱신 경고(실측, TRIP-1618).
 * - HOME 이 그려진 뒤에만 동작한다(로그인 전·로그아웃 뒤엔 0건 — 로그아웃은 `queryClient.clear()` 가 목록 칸도 비운다).
 *
 * 놓치는 것: 감시 기억(직전 값)은 이 마운트의 메모리뿐이라 안드로이드 Activity 재생성 순간에 걸친 전이는 토스트가 없다
 * (카드가 따라잡는다). 앱이 꺼져 있는 동안의 완료도 토스트 대상이 아니다.
 */

type Kind = 'COMPLETE' | 'FAILED';

function announce(
  kind: Kind,
  tripId: string,
  open: (tripId: string) => void
): void {
  const complete = kind === 'COMPLETE';
  showToast({
    message: complete ? GENERATION_COMPLETE_MESSAGE : GENERATION_FAILED_MESSAGE,
    testID: complete
      ? GENERATION_COMPLETE_TOAST_ID
      : GENERATION_FAILED_TOAST_ID,
    tone: complete ? 'success' : 'error',
    action: { label: '보기', onPress: () => open(tripId) },
  });
}

/** 목록 캐시 칸의 키인가 — 이 칸만 듣는다. */
const LIST_KEY_HEAD = getGetTripsQueryKey()[0];
function isTripsList(queryKey: readonly unknown[]): boolean {
  return queryKey.length === 1 && queryKey[0] === LIST_KEY_HEAD;
}

function stateMap(
  trips: Trip[] | undefined
): Map<string, ItineraryGenerationState | undefined> {
  return new Map(
    (trips ?? []).map((trip) => [
      trip.tripId,
      tripItinerarySummary(trip).generationState,
    ])
  );
}

export function useGenerationWatch(
  drawn: boolean,
  destination: BootstrapDestination | null
): void {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const active = drawn && destination === 'HOME';

  // 토스트 생략 판정은 전이 순간의 경로면 된다 — ref 로 읽는다.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  // 목록의 폴링 관찰자 — 값은 읽지 않는다(전이는 아래 캐시 구독이 본다).
  useGetTrips({
    query: {
      enabled: active,
      refetchInterval: tripsRefetchInterval,
      notifyOnChangeProps: [],
    },
  });

  // "보기" — 누른 시점의 목록 캐시로 목적지를 정한다. 목록에서 밀려났으면 모르는 곳으로 보내지 않는다(INV-4).
  // 같이 짜기(copick) 생성 중일 때만 슬롯 키를 위해 일정을 한 번 받는다(연타는 한 번 — 잠금 ref).
  const openingRef = useRef(false);
  const open = useCallback(
    (tripId: string) => {
      const trip = queryClient
        .getQueryData<Trip[]>(getGetTripsQueryKey())
        ?.find((t) => t.tripId === tripId);
      if (trip === undefined) return;
      const { notFound, generationState, status, generationMode } =
        tripItinerarySummary(trip);
      const target = resolveItineraryDestination({
        notFound,
        generationState,
        status,
        generationMode,
      });
      if (target !== 'copick') {
        router.push(itineraryDestinationHref(tripId, target, undefined));
        return;
      }
      if (openingRef.current) return;
      openingRef.current = true;
      fetchTripItineraryHref(queryClient, tripId)
        .then(
          (href) => router.push(href),
          () =>
            showToast({
              message: ITINERARY_OPEN_FAILED_MESSAGE,
              testID: ITINERARY_OPEN_FAILED_TOAST_ID,
              tone: 'error',
            })
        )
        .finally(() => {
          openingRef.current = false;
        });
    },
    [queryClient]
  );

  // 캐시 변경 알림을 듣는다 — 여행별 직전 값을 기억하고 `PARTIAL → COMPLETE|FAILED` 가 되는 순간 알린다.
  useEffect(() => {
    if (!active) return undefined;
    const cache = queryClient.getQueryCache();
    // 마운트 때 현재 목록으로 직전 값을 채운다 — 처음부터 완료인 여행은 알리지 않고, 이미 PARTIAL 인 여행은 끝나는 순간 알린다.
    let last = stateMap(
      queryClient.getQueryData<Trip[]>(getGetTripsQueryKey())
    );
    return cache.subscribe((event) => {
      if (!isTripsList(event.query.queryKey)) return;
      if (event.type === 'removed') {
        last = new Map();
        return;
      }
      const trips = event.query.state.data as Trip[] | undefined;
      if (trips === undefined) return;
      const next = stateMap(trips);
      next.forEach((state, id) => {
        const kind = detectGenerationTransition(last.get(id), state);
        if (kind !== null && !shouldSkipToast(pathRef.current, id)) {
          announce(kind, id, open);
        }
      });
      last = next;
    });
  }, [active, queryClient, open]);
}
