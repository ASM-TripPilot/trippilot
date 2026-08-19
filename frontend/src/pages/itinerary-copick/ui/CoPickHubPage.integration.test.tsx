import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { CoPickHubPage } from './CoPickHubPage';

/**
 * h16 허브 배선 — itinerary GET 을 재조회해 찬/빈 슬롯을 다시 그린다(로컬 상태 미보유).
 *
 * 무엇을 보장하나:
 *  - AC-6: GET 슬롯에서 진행 카운터를 산출해(coPickProgress 단일 출처 — 구조는 T10) 화면에 내린다.
 *  - E2: remaining=0(전부 채운 픽스처)이면 확정 CTA 가 살아 눌리고 이동한다.
 *  - 슬롯 "변경" 은 그 슬롯 픽 화면으로 이동한다(죽은 버튼 아님).
 *
 * 픽스처는 **전부 채운 일정**(찬2 + 고정1 = remaining 0) — 빈 슬롯 스켈레톤은 계약 미결(★9).
 * remaining>0 disabled 는 화면 T5 가 props 로 잠근다(계약 무의존).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
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
          poiId: 'p1',
          nameKo: '광안리 해변',
          startAt: '09:00:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
        {
          poiId: 'p2',
          nameKo: '돼지국밥',
          startAt: '12:00:00',
          endAt: '13:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
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
          tags: [],
        },
      ],
    },
  ];
  return {
    itineraryId: 'itin-3',
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
  mockPush.mockClear();
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
  return render(<CoPickHubPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

describe('🔴 CoPickHubPage (h16) 배선', () => {
  it('C1 · AC-6 GET 슬롯에서 진행 카운터를 산출해 렌더한다', async () => {
    renderPage();

    const progress = await screen.findByTestId('itinerary-copick-hub-progress');
    // 3슬롯(찬2+고정1) 전부 결정 → "3/3" 계열. 정규식(공백 허용).
    expect(progress).toHaveTextContent(/3\s*\/\s*3/);
  });

  it('C2 · E2 remaining=0 → 확정 CTA 활성 · press → 이동', async () => {
    renderPage();
    const confirm = await screen.findByTestId('itinerary-copick-hub-confirm');

    expect(confirm.props.accessibilityState?.disabled).not.toBe(true);
    fireEvent.press(confirm);
    // 죽은 버튼 아님 — 완성 화면으로 이동한다.
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  });

  it('C3 · 찬 슬롯 "변경" → 그 슬롯 픽 화면으로 이동', async () => {
    renderPage();
    const row = await screen.findByTestId(
      'itinerary-copick-hub-slot-2026-06-10#p1'
    );

    fireEvent.press(within(row).getByText(/변경/));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  });
});
