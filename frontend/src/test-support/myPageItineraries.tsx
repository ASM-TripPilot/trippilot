import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';

/**
 * TRIP-1123 · l03 마이페이지 테스트 공용 — 페이지가 여행마다 부르는 일정 조회(`useQueries` +
 * `getGetTripsTripIdItineraryQueryOptions`)를 대본으로 돌린다. h06 `MyTripsListPage.hookMock.test` 「여행 중 여행 맨 위 고정」(옛 `.ongoing.test`) 장치를 옮겼다.
 *
 * 쓰는 법: 테스트 파일의 trips 목 팩토리에 `getGetTripsTripIdItineraryQueryOptions: jest.fn()` 을 두고,
 * 그 목을 `scriptItineraryOptions` 에 넘긴다. 목 옵션 함수의 `queryFn` 이 진짜로 돈다 — 실 `QueryClient` 필요.
 *
 * 시계는 흉내 내지 않는다: 기간 안 = 2020~2099, 과거 = 2026-06, 미래 = 2099-06(실제 오늘이 그 사이인 한 결정론).
 */

export const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' };
export const PAST = { startDate: '2026-06-10', endDate: '2026-06-13' };
export const FUTURE = { startDate: '2099-06-10', endDate: '2099-06-13' };

export function itin(status: Itinerary['status']): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: 'x',
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [],
  };
}

export const CONFIRMED = itin('CONFIRMED');
export const PLANNED = itin('PLANNED');
export const AXIOS_404 = { isAxiosError: true, response: { status: 404 } };
export const AXIOS_500 = { isAxiosError: true, response: { status: 500 } };

/** 여행별 일정 대본 — 성공 · 404 · 500 · 영영 미도착 · 손으로 푸는 약속. */
export type ItinScript =
  Itinerary | 'notFound' | 'serverError' | 'never' | Promise<Itinerary>;

function fetchFor(s: ItinScript | undefined): Promise<Itinerary> {
  if (s === undefined) {
    return Promise.reject(new Error('대본에 없는 여행의 일정 조회'));
  }
  if (s instanceof Promise) return s;
  if (s === 'never') return new Promise(() => {});
  if (s === 'notFound') return Promise.reject(AXIOS_404);
  if (s === 'serverError') return Promise.reject(AXIOS_500);
  return Promise.resolve(s);
}

/** 목 옵션 함수가 여행 id 별 대본대로 `queryKey`·`queryFn` 을 돌려주게 한다(실앱과 같은 키 모양). */
export function scriptItineraryOptions(
  mockOptions: jest.Mock,
  itins: Record<string, ItinScript>
): void {
  mockOptions.mockImplementation((tripId: string) => ({
    queryKey: [`/trips/${tripId}/itinerary`],
    queryFn: () => fetchFor(itins[tripId]),
  }));
}

/** 손으로 푸는 약속 — "모름이 풀리면 숫자가 나온다"를 한 테스트 안에서 본다. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export function newTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

/** 실 `QueryClient` 아래에서 그린다 — `useQueries` 는 Provider 가 없으면 여행 0건이어도 던진다. */
export function renderWithQueryClient(
  ui: ReactElement,
  client: QueryClient = newTestQueryClient()
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, ...render(ui, { wrapper: Wrapper }) };
}

/** 비동기 전부 흘려보내기 — react-query 알림은 setTimeout(0)(h06 doneBar·ongoing 선례). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** 최소 Trip — 서버 `status` 는 일부러 받아 둔다: 판정이 그 값을 쓰면 테스트가 잡도록. */
export function myPageTrip(
  tripId: string,
  period: { startDate: string; endDate: string },
  over: Partial<Trip> = {}
): Trip {
  return {
    tripId,
    title: `${tripId} 여행`,
    ...period,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
  };
}
