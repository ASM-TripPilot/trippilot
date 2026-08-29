import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { Itinerary } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-562 · AC-4 페이지 파트 — 라이브 화면 진입 FAB 를 누르면 페이지가 **감시 목록 라우트로만**
 * 이동한다(`/trips/{tripId}/planb/triggers`). execution→planb 직접 import 없이 라우팅으로만.
 *
 * 왜 통합 버킷인가: 진입 FAB 은 페이지가 `router.push` 로 배선하고 화면은 콜백만 받는다 — 이 배선
 * 한 줄을 실 조회 상태(active 얼굴) 위에서 태워야 "FAB→감시목록 라우트" 도달을 잠글 수 있다. 셋업은
 * 프로즌 `LiveItineraryPage.trigger.integration.test.tsx`(TRIP-561)의 핸들러·목·헬퍼를 복제한다.
 *
 * ⚠️ 통과형 목 사각(★9): router.push 는 "불렸다·이 인자로"까지만 — 실제 네비게이션·FAB 실터치·지도
 * 겹침(repo-traps: KakaoMapView 위 오버레이 터치 흡수)은 6-b 실기(`live-itinerary` 프리뷰) 소관.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// FAB → router.push(감시목록), 탭바 → router.replace. 정적 싱글턴 목(useRouter 훅 아님).
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';

/** 오늘 1일 1슬롯(upcoming). 시각은 계획값 그대로. */
const itinerary = (): Itinerary =>
  ({
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: TODAY,
        slots: [
          {
            poiId: 'p1',
            startAt: '10:00:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            nameKo: '해운대 해변',
            distanceRange: null,
            openingHours: null,
            tags: [],
          },
        ],
      },
    ],
  }) as unknown as Itinerary;

const trip = () => ({
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: TODAY,
  endDate: '2026-08-22',
  party: 2,
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'PLANNED',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
});

/** 트리거 빈 목록 — 칩 없음 → 유일한 push 는 FAB 이다. 4핸들러 전부 등록해 unhandled 소음 0. */
const baseHandlers = () => [
  http.get(`${BASE}/trips/:tripId/itinerary`, () =>
    HttpResponse.json(itinerary())
  ),
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
  http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
    HttpResponse.json({ visits: [] })
  ),
  http.get(`${BASE}/trips/:tripId/triggers`, () =>
    HttpResponse.json({ triggers: [] })
  ),
];

/** router.push 인자를 문자열로 정규화 — 문자열/객체 두 형태를 모두 받아 경로만 잰다(★9). */
function hrefString(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  const obj = (arg ?? {}) as {
    pathname?: string;
    params?: Record<string, unknown>;
  };
  const qs = Object.entries(obj.params ?? {})
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return qs ? `${obj.pathname ?? ''}?${qs}` : (obj.pathname ?? '');
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => setAccessToken('a'));
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  mockReplace.mockClear();
  mockPush.mockClear();
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('🔴 LiveItineraryPage · 감시 목록 진입 FAB (AC-4)', () => {
  it('W1 FAB press → /trips/{id}/planb/triggers 로 router.push 한다', async () => {
    server.use(...baseHandlers());

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
    );

    fireEvent.press(screen.getByTestId('execution-live-watchlist-fab'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(hrefString(mockPush.mock.calls[0][0])).toBe(
      `/trips/${TRIP_ID}/planb/triggers`
    );
  });
});
