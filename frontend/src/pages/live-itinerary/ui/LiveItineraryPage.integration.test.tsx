import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { Itinerary } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-395 · LiveItineraryPage 배선을 실 HTTP로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - GET /trips/{id}/itinerary 의 오늘 슬롯이 화면(`execution-live-screen`)에 뜬다.
 *  - 오늘이 여행 구간 밖이면 안내를, 조회 실패(500)면 실패 얼굴을 준다(INV-4 — 침묵 실패 금지).
 *
 * 왜 통합 버킷인가: resolveLiveState 판정이 실 조회 상태(로딩·오류·데이터)와 오늘 날짜의 조합에서
 * 갈리므로, 훅을 목킹하면 그 조합이 테스트의 가정이 되어 버린다.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';

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
            nameKo: '감천문화마을',
            distanceRange: null,
            openingHours: null,
            tags: [],
          },
        ],
      },
    ],
  }) as unknown as Itinerary;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => setAccessToken('a'));
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

describe('LiveItineraryPage', () => {
  it('I1 오늘이 구간 안이면 오늘 슬롯 타임라인을 그린다', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      )
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
    );
    expect(screen.getByTestId(`execution-live-slot-${TODAY}#p1`)).toBeTruthy();
  });

  it('I2 오늘이 여행 구간 밖이면 안내를 준다', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      )
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today="2026-12-25" />, {
      wrapper,
    });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-outside')).toBeTruthy()
    );
    expect(screen.queryByTestId('execution-live-screen')).toBeNull();
  });

  it('I3 조회가 실패하면 실패 얼굴을 준다 (INV-4)', async () => {
    server.use(
      http.get(
        `${BASE}/trips/:tripId/itinerary`,
        () => new HttpResponse(null, { status: 500 })
      )
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-error')).toBeTruthy()
    );
  });
});
