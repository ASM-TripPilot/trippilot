import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useQueries,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';

import type { BootstrapDestination } from '@/features/auth/index.view';
import {
  isGenerationRunning,
  itineraryDestinationHref,
  pollIntervalMs,
  resolveItineraryDestination,
} from '@/features/itinerary';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdItineraryQueryOptions,
} from '@/shared/api/index.hooks';
import type {
  Itinerary,
  ItineraryGenerationState,
} from '@/shared/api/index.schemas';
import { showToast } from '@/shared/ui/Toast';

import {
  GENERATION_COMPLETE_MESSAGE,
  GENERATION_COMPLETE_TOAST_ID,
  GENERATION_FAILED_MESSAGE,
  GENERATION_FAILED_TOAST_ID,
  detectGenerationTransition,
  isGenerationScreenOf,
  shouldSkipToast,
  tripIdFromItineraryKey,
} from './generationWatch';

/**
 * 앱 셸의 "생성 완료 감지" — TRIP-1618. 일정 탭 한 화면이 하던 2초 폴링을 여기로 모으고, 끝난 순간 앱 안 토스트로 알린다.
 *
 * - **누굴 묻나**: 여행 목록이 아니라 쿼리 캐시(서버 응답 저장소)에서 "생성 중"으로 적힌 일정 칸만 본다 — 그런 칸이 없으면
 *   요청 0건. 칸마다 `refetchInterval` 이 걸린 관찰자를 하나 붙여 같은 캐시 칸을 갱신하므로, 그 칸을 읽는 홈 계획 카드·
 *   일정 탭 카드가 저절로 바뀐다. 폴링 술어는 예전 일정 탭과 같다(PARTIAL 이거나 세션 있음, 조회 오류면 멈춤, 상한 없음 —
 *   멈춘 생성은 서버가 약 11분 뒤 FAILED 로 닫는다). 앱이 백그라운드면 `focusManager`(AppProviders)가 틱을 건너뛴다.
 * - **언제 알리나**: 캐시 변경 알림을 듣다가 한 칸이 `PARTIAL → COMPLETE|FAILED` 로 바뀐 그 순간 한 번(전이 감지 — 같은 값 반복·
 *   처음부터 완료인 값은 알리지 않는다). 그 여행의 진행 화면이나 일정 탭을 보고 있으면 생략 — 카드는 어차피 바뀐다.
 * - **진행 화면 양보**: 그 여행의 생성 중·초안·슬롯 채우기 화면은 자체 폴링이 있어, 그동안 셸이 같이 물으면 한 간격에 2건이 나간다.
 *   경로를 state(`usePathname`)로 읽어 관찰자 목록에서 빼므로 화면을 떠나는 순간 셸이 이어받는다.
 * - HOME 이 그려진 뒤에만 동작한다(로그인 전·로그아웃 뒤엔 0건 — 로그아웃은 `queryClient.clear()` 가 칸도 비운다).
 *
 * 놓치는 것: 감시 기억(직전 값)은 이 마운트의 메모리뿐이라 안드로이드 Activity 재생성 순간에 걸친 전이는 토스트가 없다
 * (카드가 따라잡는다). 앱이 꺼져 있는 동안의 완료도 토스트 대상이 아니다.
 */

type Kind = 'COMPLETE' | 'FAILED';

/** 폴링 대상 — 예전 일정 탭과 같다: 생성 중(PARTIAL)이거나 세션이 도는 중(재생성). */
function isInFlight(itinerary: Itinerary | undefined): boolean {
  return (
    itinerary?.generationState === 'PARTIAL' || isGenerationRunning(itinerary)
  );
}

function generationStateOf(
  data: unknown
): ItineraryGenerationState | undefined {
  return (data as Itinerary | undefined)?.generationState;
}

/** 지금 캐시에서 생성 중인 일정 칸의 id 들(정렬, '|' 로 이음). */
function watchedKeyOf(queryClient: QueryClient): string {
  return queryClient
    .getQueryCache()
    .getAll()
    .flatMap((query) => {
      const id = tripIdFromItineraryKey(query.queryKey);
      return id !== null &&
        isInFlight(query.state.data as Itinerary | undefined)
        ? [id]
        : [];
    })
    .sort()
    .join('|');
}

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

export function useGenerationWatch(
  drawn: boolean,
  destination: BootstrapDestination | null
): void {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const active = drawn && destination === 'HOME';

  // 토스트 생략 판정은 전이 순간의 경로면 된다 — ref 로 읽는다(폴링 양보는 아래에서 state 로 읽는다).
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  // "보기" — 누른 시점의 캐시 값으로 목적지를 정한다. 캐시에서 밀려났으면 모르는 곳으로 보내지 않는다(INV-4).
  const open = useCallback(
    (tripId: string) => {
      const itinerary = queryClient.getQueryData<Itinerary>(
        getGetTripsTripIdItineraryQueryKey(tripId)
      );
      if (itinerary === undefined) return;
      const destinationOf = resolveItineraryDestination({
        notFound: false,
        generationState: itinerary.generationState,
        status: itinerary.status,
        generationMode: itinerary.generationMode,
      });
      router.push(
        itineraryDestinationHref(tripId, destinationOf, itinerary.days)
      );
    },
    [queryClient]
  );

  // 감시 대상 목록 — 문자열 하나(id 를 '|' 로 이음, 트립 id 는 서버 UUID 라 '|' 가 없다)로 state 에 둔다. 값이 같으면 setState 를
  // 부르지 않는다: useQueries 가 관찰자를 만드는 렌더 중에도 캐시 이벤트가 오는데, 거기서 같은 훅의 state 를 또 바꾸면 렌더 중
  // 갱신(무한 재렌더·경고)이 된다. useSyncExternalStore 로 바꾸지 마라 — 그 스냅샷 비교는 렌더 중엔 직전 커밋 값과 하므로
  // 관찰자를 만드는 그 렌더에서 같은 경고가 난다(실측).
  const [watchedKey, setWatchedKey] = useState(() => watchedKeyOf(queryClient));
  const watchedKeyRef = useRef(watchedKey);

  // 캐시 변경 알림을 듣는다 — ① 감시 목록 갱신 ② 전이 감지: 칸별 직전 값을 기억하고 `PARTIAL → COMPLETE|FAILED` 가 되는 순간 알린다.
  useEffect(() => {
    if (!active) return undefined;
    const cache = queryClient.getQueryCache();
    const syncWatched = (): void => {
      const next = watchedKeyOf(queryClient);
      if (next === watchedKeyRef.current) return;
      watchedKeyRef.current = next;
      setWatchedKey(next);
    };
    const last = new Map<string, ItineraryGenerationState | undefined>();
    cache.getAll().forEach((query) => {
      const id = tripIdFromItineraryKey(query.queryKey);
      if (id !== null) last.set(id, generationStateOf(query.state.data));
    });
    syncWatched(); // 마운트 전에 바뀐 것을 따라잡는다.
    return cache.subscribe((event) => {
      syncWatched();
      const id = tripIdFromItineraryKey(event.query.queryKey);
      if (id === null) return;
      if (event.type === 'removed') {
        last.delete(id);
        return;
      }
      const next = generationStateOf(event.query.state.data);
      const kind = detectGenerationTransition(last.get(id), next);
      last.set(id, next);
      if (kind !== null && !shouldSkipToast(pathRef.current, id)) {
        announce(kind, id, open);
      }
    });
  }, [active, queryClient, open]);

  const watched =
    active && watchedKey !== ''
      ? watchedKey
          .split('|')
          .filter((id) => !isGenerationScreenOf(pathname, id))
      : [];

  useQueries({
    queries: watched.map((id) =>
      getGetTripsTripIdItineraryQueryOptions(id, {
        query: {
          // 조회 실패면 멈춘다 — 실패해도 직전 PARTIAL data 가 남으므로 error 를 먼저 본다(조용한 무한 재시도 금지, INV-4).
          refetchInterval: (query) =>
            query.state.status !== 'error' && isInFlight(query.state.data)
              ? pollIntervalMs(query.state.dataUpdateCount)
              : false,
        },
      })
    ),
  });
}
