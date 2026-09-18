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
 * TRIP-395 · LiveItineraryPage 배선을 실 HTTP로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - GET /trips/{id}/itinerary 의 오늘 슬롯이 화면(`execution-live-screen`)에 뜨고, GET /trips/{id}
 *    의 title 이 헤더 제목에 실린다(I1).
 *  - 오늘이 여행 구간 밖이면 안내를(I2), 5xx/네트워크면 실패 얼굴을(I3, INV-4 침묵 금지),
 *    **404(일정 미생성)면 네트워크 오류가 아닌 별도 얼굴**(I4, `execution-live-notfound`)을 준다.
 *  - 하단 복제 탭바를 누르면 page 가 `router.replace`(home 만 '/')로 탭 라우트로 점프한다(I6, AC-3).
 *
 * 왜 통합 버킷인가: resolveLiveState 판정이 실 조회 상태(로딩·오류·데이터·404)와 오늘 날짜의
 * 조합에서 갈리므로, 훅을 목킹하면 그 조합이 테스트의 가정이 되어 버린다.
 *
 * ⚠️ page 가 이제 trip 도 조회하므로(헤더 제목) `onUnhandledRequest:'error'` 아래에서는
 * **모든 케이스에 trip 핸들러도 등록**해야 한다(미등록 시 unhandled 오류 — 테스트 결함처럼 보임).
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

// 하단 탭바 press → page 가 `router.replace` 로 탭 라우트에 점프한다(StaySearchPage 정적 싱글턴
// 선례). 목이 `router` 객체를 제공해야 한다(useRouter 훅 아님).
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
  },
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

// 헤더 제목용 trip. title 만 화면이 읽으므로 나머지는 최소만 채운다.
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

/** trip 핸들러는 항상 등록(page 가 무조건 조회). itinerary 핸들러만 케이스별로 갈아끼운다. */
const tripHandler = () =>
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip()));

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
  mockReplace.mockClear();
});
afterAll(() => server.close());

describe('LiveItineraryPage', () => {
  it('I1 오늘이 구간 안이면 오늘 슬롯 타임라인과 trip 제목 헤더를 그린다', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      tripHandler()
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
    );
    expect(screen.getByTestId(`execution-live-slot-${TODAY}#p1`)).toBeTruthy();
    // trip 조회 → 헤더 제목 배선(정규식=부분일치, "· N일차" 접미와 무관하게 title 만 확인).
    await waitFor(() =>
      expect(
        screen.getByTestId('execution-live-header-title')
      ).toHaveTextContent(/부산 여행/)
    );
  });

  it('I2 오늘이 여행 구간 밖이면 안내를 준다', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      tripHandler()
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today="2026-12-25" />, {
      wrapper,
    });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-outside')).toBeTruthy()
    );
    expect(screen.queryByTestId('execution-live-screen')).toBeNull();
  });

  it('I3 조회가 5xx로 실패하면 실패 얼굴을 준다 (INV-4)', async () => {
    server.use(
      http.get(
        `${BASE}/trips/:tripId/itinerary`,
        () => new HttpResponse(null, { status: 500 })
      ),
      tripHandler()
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-error')).toBeTruthy()
    );
  });

  it('I4 일정 미생성(404)이면 네트워크 오류가 아닌 별도 안내를 준다 (AC-4b)', async () => {
    server.use(
      http.get(
        `${BASE}/trips/:tripId/itinerary`,
        () => new HttpResponse(null, { status: 404 })
      ),
      tripHandler()
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-notfound')).toBeTruthy()
    );
    // 404 는 네트워크 오류 얼굴로 새지 않는다(가드 대상).
    expect(screen.queryByTestId('execution-live-error')).toBeNull();
  });

  it('I6 하단 탭바를 누르면 그 탭 라우트로 replace 한다 (home만 "/") (AC-3)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      tripHandler()
    );

    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
    );

    fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));
    expect(mockReplace).toHaveBeenCalledWith('/');

    fireEvent.press(screen.getByTestId('shell-tabbar-tab-explore'));
    expect(mockReplace).toHaveBeenCalledWith('/explore');
  });
});
