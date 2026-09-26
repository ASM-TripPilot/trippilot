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
import type { ReactTestInstance } from 'react-test-renderer';

import { server } from '@/mocks/server';
import type {
  TripSummary,
  TripSummaryEnvelope,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { TripSummaryPage } from './TripSummaryPage';

/**
 * TRIP-987 B · j04 여행 요약에서 방문 기록(j01)·일차 회고(j03)로 가는 진입 + 여행 이름 + 빈 상태.
 *
 * 무엇을 보장하나:
 *  - B-1 '방문 기록 보기'(`reflection-summary-records`) → `/trips/{id}/records`.
 *  - B-2 여행 기간 전체 일자마다 '{N}일차 회고'(`reflection-summary-day-reflection-{N}`, 1-기반) →
 *    `/trips/{id}/records/reflection/{YYYY-MM-DD}`. 지도·방문 목록 두 얼굴 모두, 방문 0곳이어도.
 *  - B-3 여행 이름(`reflection-summary-trip-title`) = `Trip.title` 원문.
 *  - B-4 위치 전무 + 방문 0곳 → "대신…" 문장 대신 빈 문구(QA #025 실화면 모양).
 *  - B-6 공유 진입은 되살아나지 않는다(TRIP-939 Q2 — 캡처 미장전).
 *  - B-7 여행 조회 실패 → 이름·일차 회고는 숨기고 요약 본문·'방문 기록 보기'는 남는다(Seed Q3).
 *  - B-8 요약 대기(ready:false) 얼굴에도 '방문 기록 보기'(`reflection-summary-pending-records`, Q4).
 *  - B-9 요약 날짜 카드는 여전히 누를 수 없다(카드 일차 번호 ≠ 여행 일차 — Seed Q2).
 *
 * 왜 통합 버킷인가: 요약(`GET /trips/{id}/summary`)과 여행(`GET /trips/{id}`) 두 조회가 따로 도착하는
 * 조합에서 얼굴이 갈린다 — 훅을 목킹하면 그 조합이 테스트의 가정이 된다(LiveItineraryPage 선례).
 * 화면 prop 이름은 여기서 정하지 않는다 — testID·문구·push 문자열만 본다.
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: jest.fn(),
    canGoBack: () => true,
  },
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const DURATION = /(\d+\s*분|\d+\s*시간|소요)/;

const trip = () => ({
  tripId: TRIP_ID,
  title: '강남구 여행',
  startDate: '2026-09-24',
  endDate: '2026-09-25',
  party: 1,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '강남구', nights: 1 }],
  status: 'ENDED',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-25T00:00:00Z',
  baseCount: 0,
  itineraryDayCount: 2,
});

const summary = (hasLocationData: boolean, visits: string[]): TripSummary => ({
  narrative: '좋은 여행이었어요',
  highlights:
    visits.length === 0
      ? []
      : [
          {
            date: '2026-09-24',
            dayOrder: 1,
            visitCount: visits.length,
            places: visits,
          },
        ],
  stats: {
    totalVisits: visits.length,
    totalDistanceKm: 0,
    distanceSource: 'VISIT_LINE',
    totalPhotos: 0,
    hasLocationData,
  },
  source: 'RULE',
  generatedAt: '2026-09-26T10:00:00Z',
});

const summaryHandler = (envelope: TripSummaryEnvelope) =>
  http.get(`${BASE}/trips/:tripId/summary`, () => HttpResponse.json(envelope));
const tripOk = () =>
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip()));
const tripFails = () =>
  http.get(
    `${BASE}/trips/:tripId`,
    () => new HttpResponse(null, { status: 500 })
  );

function renderPage(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(<TripSummaryPage tripId={TRIP_ID} />, { wrapper });
  return client;
}

async function waitSummary(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('reflection-summary-stats')).toBeOnTheScreen()
  );
}

function isTouchable(node: ReactTestInstance): boolean {
  return (
    typeof node.props.onStartShouldSetResponder === 'function' ||
    typeof node.props.onClick === 'function'
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => setAccessToken('a'));
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  mockPush.mockClear();
  mockReplace.mockClear();
});
afterAll(() => server.close());

const FACES: [string, TripSummary][] = [
  ['지도 얼굴(MAP)', summary(true, ['코엑스', '봉은사'])],
  ['방문 목록 얼굴(VISIT_LIST)', summary(false, ['코엑스', '봉은사'])],
];

describe('🔴 TRIP-987 B-1·B-2·B-3 · 요약에서 기록·회고로 간다', () => {
  it.each(FACES)(
    '%s — 여행 이름 · 방문 기록 보기 · 1일차·2일차 회고가 있고 각각 제 라우트로 간다',
    async (_face, data) => {
      server.use(summaryHandler({ ready: true, summary: data }), tripOk());

      renderPage();
      await waitSummary();

      // B-3 여행 이름(별도 조회라 늦게 올 수 있다).
      await waitFor(() =>
        expect(
          screen.getByTestId('reflection-summary-trip-title')
        ).toHaveTextContent('강남구 여행')
      );

      // B-2 기간 9/24~9/25 → 정확히 2개, 1-기반 번호.
      expect(
        screen.getAllByTestId(/^reflection-summary-day-reflection-\d+$/)
      ).toHaveLength(2);
      expect(
        screen.getByTestId('reflection-summary-day-reflection-1')
      ).toHaveTextContent('1일차 회고');
      expect(
        screen.getByTestId('reflection-summary-day-reflection-2')
      ).toHaveTextContent('2일차 회고');

      // B-1 방문 기록 보기.
      const records = screen.getByTestId('reflection-summary-records');
      expect(records).toHaveTextContent('방문 기록 보기');

      fireEvent.press(records);
      fireEvent.press(
        screen.getByTestId('reflection-summary-day-reflection-1')
      );
      fireEvent.press(
        screen.getByTestId('reflection-summary-day-reflection-2')
      );

      expect(mockPush.mock.calls).toEqual([
        [`/trips/${TRIP_ID}/records`],
        [`/trips/${TRIP_ID}/records/reflection/2026-09-24`],
        [`/trips/${TRIP_ID}/records/reflection/2026-09-25`],
      ]);
      expect(mockReplace).not.toHaveBeenCalled();

      // INV-3 — 새 문구 어디에도 소요시간이 없다.
      expect(DURATION.test(JSON.stringify(screen.toJSON()))).toBe(false);
    }
  );
});

describe('🔴 TRIP-987 B-4 · 위치 전무 + 방문 0곳 (QA #025)', () => {
  it('빈 문구가 뜨고 "대신…" 문장은 없으며, 회고·방문 기록 진입은 그대로 있다', async () => {
    server.use(
      summaryHandler({ ready: true, summary: summary(false, []) }),
      tripOk()
    );

    renderPage();
    await waitSummary();

    expect(
      screen.getByText('위치 기록이 없어 지도를 표시할 수 없어요')
    ).toBeOnTheScreen();
    expect(
      screen.queryByText('대신 방문 장소를 순서대로 보여드릴게요')
    ).toBeNull();
    expect(
      screen.getByTestId('reflection-summary-visit-empty')
    ).toHaveTextContent('기록된 방문 장소가 없어요');

    // 방문이 0곳이어도 회고는 쓸 수 있다(US-REC-07 예외 · BR-U5-36) — 막다른 화면이 아니다.
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^reflection-summary-day-reflection-\d+$/)
      ).toHaveLength(2)
    );
    expect(screen.getByTestId('reflection-summary-records')).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-987 B-7 · 여행 조회가 실패하면 이름·회고만 숨긴다 (Seed Q3)', () => {
  it('요약 본문과 방문 기록 보기는 남고, 여행 이름·일차 회고는 없다', async () => {
    server.use(
      summaryHandler({ ready: true, summary: summary(false, ['코엑스']) }),
      tripFails()
    );

    const client = renderPage();
    await waitSummary();
    // 여행 조회가 실패로 정착할 때까지 — 로딩 중 부재로 공허 통과하지 않게.
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .some((query) => query.state.status === 'error')
      ).toBe(true)
    );

    expect(screen.getByTestId('reflection-summary-stats')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-summary-records')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-summary-trip-title')).toBeNull();
    expect(
      screen.queryAllByTestId(/^reflection-summary-day-reflection-/)
    ).toHaveLength(0);

    fireEvent.press(screen.getByTestId('reflection-summary-records'));
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/records`);
  });
});

describe('🔴 TRIP-987 B-8 · 요약 대기 얼굴에도 방문 기록 진입 (Seed Q4)', () => {
  it('ready:false → 대기 안내 + "방문 기록 보기" 액션 → /trips/{id}/records', async () => {
    server.use(summaryHandler({ ready: false }), tripOk());

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('reflection-summary-pending')).toBeOnTheScreen()
    );

    const action = screen.getByTestId('reflection-summary-pending-records');
    expect(action).toHaveTextContent('방문 기록 보기');
    fireEvent.press(action);

    expect(mockPush.mock.calls).toEqual([[`/trips/${TRIP_ID}/records`]]);
  });
});

describe('🟢 TRIP-987 B-6·B-9 · 되살리지 않는 것(회귀 앵커)', () => {
  it('공유 진입이 없고(TRIP-939 Q2), 날짜 카드는 누를 수 없으며 "›" 가 없다(Seed Q2)', async () => {
    server.use(
      summaryHandler({ ready: true, summary: summary(true, ['코엑스']) }),
      tripOk()
    );

    renderPage();
    await waitSummary();

    expect(screen.queryByTestId('reflection-summary-share')).toBeNull();
    const card = screen.getByTestId('reflection-summary-day-card');
    expect(isTouchable(card)).toBe(false);
    expect(within(card).queryByText('›')).toBeNull();
  });
});
