import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-1040 · AC-10 — h07 부분 결과 진행 카드의 **칸 상한 4**를 실 HTTP 로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - 🔴 5일 여행·day1 도착이면 칸이 4개다 — 일차 칸 3개 + 맨 끝 `…` 접기 칸(뒤 접기).
 *  - 🔴 7일 여행·day1~4 도착이면 `…` 가 맨 앞이고, 지금 만드는 5일차가 창 끝에 보인다(앞 접기 · 결정 2 = b).
 *  - 상한 4는 소비처(DraftPage)가 정한다 — 위젯은 받은 칸을 그대로 그린다. 상한이 없거나 5면 5일 여행이
 *    5칸이 되어 red.
 *  - 3일 이하 무회귀는 형제 `DraftPage.partial.integration.test.tsx` A8-1b 가 그대로 잰다.
 *
 * ★ 칸 testID 의 n 은 일차가 아니라 **칸 위치**다 — 앞 접기면 `cell-2-done` 이 3일차다. 그래서 일차는
 *   칸 안 글자(`toHaveTextContent` = 완전 일치)로 읽는다(02a ★1·★3).
 *
 * 3동작 뼈대: 준비=여행 기간·도착 일자를 가짜 서버에 지정 → 실행=화면을 연다 → 단언=칸 순서·칸 글자.
 * 목킹 규약은 형제 `DraftPage.partial.integration.test.tsx` 를 그대로 따른다.
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';

/** 6월 10일부터 `count` 일의 날짜. */
function datesFrom10(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `2026-06-${String(10 + index).padStart(2, '0')}`
  );
}

/** 여행 기간 — 게이지 칸의 출처는 `days.length` 가 아니라 이 두 날짜다. */
function trip(dayCount: number): Trip {
  const dates = datesFrom10(dayCount);
  return {
    tripId: TRIP_ID,
    title: `제주 ${dayCount}일`,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: dayCount - 1 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

/** 하루치 슬롯 1개 — 이 파일은 게이지만 본다(시각·거리 심판은 형제 파일 몫). 좌표는 지도 center 용. */
function daySlots(date: string): ItineraryDaysItemSlotsItem[] {
  return [
    {
      poiId: `poi-${date}`,
      startAt: '09:30:00',
      endAt: '11:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: ['바다'],
      nameKo: '광안리 해변',
      category: '자연',
      imageUrl: null,
      distanceRange: null,
      lat: 33.458,
      lng: 126.942,
    },
  ];
}

/** 생성 중(PARTIAL) — 앞에서부터 `arrivedCount` 일만 도착했다. */
function partialItinerary(tripDays: number, arrivedCount: number): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'PARTIAL',
    isFallback: false,
    days: datesFrom10(tripDays)
      .slice(0, arrivedCount)
      .map((date) => ({ date, slots: daySlots(date) })),
  };
}

function serve(tripDays: number, arrivedCount: number) {
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip(tripDays))),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(partialItinerary(tripDays, arrivedCount))
    )
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  setAccessToken('valid-access');
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false`·`gcTime:0` — 형제 파일과 같다. PARTIAL 은 폴링을 부르지만 같은 값이라 첫 렌더만 본다. */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

/** 게이지 칸 testID 를 화면 순서대로(트랙 testID 는 접두가 달라 안 잡힌다). */
function cellOrder(): string[] {
  return screen
    .getAllByTestId(/^generation-gauge-cell-/)
    .map((node) => String(node.props.testID));
}

describe('🔴 G-1 · TRIP-1040 AC-10 — 칸 상한 4가 실제 화면에 걸린다', () => {
  it('I-5d · 5일 여행·day1 도착 → [1일차 완성, 2일차 생성 중, 3일차 대기, …] (뒤 접기)', async () => {
    // 준비 — 5일 여행, day1 만 도착.
    serve(5, 1);

    // 실행
    renderPage();
    await screen.findByTestId('generation-progress-card');

    // 단언 — 칸 4개, `…` 는 맨 끝.
    expect(cellOrder()).toEqual([
      'generation-gauge-cell-1-done',
      'generation-gauge-cell-2-active',
      'generation-gauge-cell-3-waiting',
      'generation-gauge-cell-more',
    ]);
    expect(
      screen.getByTestId('generation-gauge-cell-1-done')
    ).toHaveTextContent('1일차 완성');
    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toHaveTextContent('2일차 생성 중');
    expect(
      screen.getByTestId('generation-gauge-cell-3-waiting')
    ).toHaveTextContent('3일차 대기');
    expect(screen.getByTestId('generation-gauge-cell-more')).toHaveTextContent(
      '…'
    );
    // 일차 칸은 3개뿐 — 4·5일차는 `…` 뒤로 숨는다.
    expect(screen.getAllByTestId(/^generation-gauge-cell-\d+-/)).toHaveLength(
      3
    );
  });

  it('I-7d · 7일 여행·day1~4 도착 → […, 3일차 완성, 4일차 완성, 5일차 생성 중] (앞 접기 · 결정 2 = b)', async () => {
    // 준비 — 7일 여행, day1~4 도착(지금 만드는 중 = 5일차).
    serve(7, 4);

    // 실행
    renderPage();
    await screen.findByTestId('generation-progress-card');

    // 단언 — `…` 가 맨 앞, 활성 5일차가 창 끝. 일차 칸 testID 는 칸 위치(2부터)다.
    expect(cellOrder()).toEqual([
      'generation-gauge-cell-more',
      'generation-gauge-cell-2-done',
      'generation-gauge-cell-3-done',
      'generation-gauge-cell-4-active',
    ]);
    expect(screen.getByTestId('generation-gauge-cell-more')).toHaveTextContent(
      '…'
    );
    expect(
      screen.getByTestId('generation-gauge-cell-2-done')
    ).toHaveTextContent('3일차 완성');
    expect(
      screen.getByTestId('generation-gauge-cell-3-done')
    ).toHaveTextContent('4일차 완성');
    expect(
      screen.getByTestId('generation-gauge-cell-4-active')
    ).toHaveTextContent('5일차 생성 중');
  });
});
