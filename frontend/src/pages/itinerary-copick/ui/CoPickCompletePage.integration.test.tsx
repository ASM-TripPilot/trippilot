import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { CoPickCompletePage } from './CoPickCompletePage';

/**
 * h17 완성 배선 — itinerary GET 을 실 DTO 로 받아 완성 화면을 조립한다.
 *
 * 무엇을 보장하나(화면 T6 은 내가 준 props 만 재지만, 여기선 실 DTO 로):
 *  - AC-7: 페이지가 비고정 슬롯의 startAt(검증 시각)을 화면에 흘리지 않는다 — 시간대 라벨만.
 *          고정 블록만 시각(21:00 도착).
 *  - AC-9: 총 거리는 legDistance 재사용(서버 distanceRange 합산, 재발명 0).
 *
 * 시계 정규식 /\d{1,2}:\d{2}/ 은 밴드/거리에 오탐 0(02a §5 실검증).
 */

const CLOCK = /\d{1,2}:\d{2}/;

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const DAY1 = '2026-06-10';

function itinerary(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        {
          poiId: 'a',
          nameKo: '광안리 해변',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          distanceRange: null,
          tags: [],
        },
        {
          poiId: 'b',
          nameKo: '부산시립미술관',
          startAt: '13:00:00',
          endAt: '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          distanceRange: '1.4km',
          tags: [],
        },
        {
          poiId: 'hotel',
          nameKo: '해운대 OO호텔',
          startAt: '21:00:00',
          endAt: '21:00:00',
          isFixed: true,
          endsNextDay: false,
          hasViolation: false,
          distanceRange: null,
          tags: [],
        },
      ],
    },
  ];
  return {
    itineraryId: 'itin-4',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'CO_PLAN',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<CoPickCompletePage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

describe('🔴 CoPickCompletePage (h17) 배선', () => {
  it('C1 · AC-7 실 DTO startAt → 비고정 슬롯 시각 렌더 0 · 고정만 21:00', async () => {
    renderPage();
    await screen.findByTestId('itinerary-copick-complete-root');

    // 비고정 슬롯(a·b): startAt 09:30/13:00 이 화면으로 새면 안 된다.
    for (const key of [`${DAY1}#a`, `${DAY1}#b`]) {
      const card = within(
        screen.getByTestId(`itinerary-copick-complete-slot-${key}`)
      );
      expect(card.queryByText(CLOCK)).toBeNull();
    }
    // 고정 슬롯만 시각.
    const fixed = within(
      screen.getByTestId(`itinerary-copick-complete-slot-${DAY1}#hotel`)
    );
    expect(fixed.getByText(/21:00/)).toBeTruthy();
  });

  it('C2 · AC-9 총 거리 = legDistance 재사용(서버 distanceRange 합산)', async () => {
    renderPage();

    const total = await screen.findByTestId('itinerary-copick-complete-total');
    // legDistance(['', '1.4km', '']) → "이동 1.4km"(서버값 합산, 재발명 0).
    expect(total).toHaveTextContent(/이동 1\.4km/);
  });
});
