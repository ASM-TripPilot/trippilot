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
import type { Itinerary, VisitCheck } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-395 → TRIP-746 · LiveItineraryPage 배선을 실 HTTP로 태우는 심판(AC-6).
 *
 * 무엇을 보장하나:
 *  - I1 오늘 슬롯이 허브(`execution-live-screen`)에 뜨고, 시트 헤더 한 줄이
 *    trip.title + 일차 + `formatCoPickDayHeader(date)` + 슬롯 수로 조립된다.
 *  - I2~I4 구간 밖·5xx·404 얼굴(TRIP-395 그대로 — 판정은 이 사이클이 안 건드린다).
 *  - I5·I6 뒤로가기는 `canGoBack` 사다리 — 히스토리가 있으면 back, 없으면(딥링크·푸시 직행)
 *    조용히 멈추지 않고 `/(tabs)` 로 replace(INV-4 · ItineraryPlanPage 관례).
 *  - I7 연필 FAB 는 수동 재계획 진입(`/trips/{id}/planb`, BR-U4-10 · Seed Q2).
 *  - I8 실앱 done 카드는 사진·후기 칸이 없다 — `GET /visits/days` 계약에 photo/memo 가 없어서
 *    page 가 photos=[]·memo=null 로 넘긴다(맹점③ · G6). 시각은 계획값 "10:00" + "방문".
 *
 * 왜 통합 버킷인가: resolveLiveState 판정이 실 조회 상태(로딩·오류·데이터·404)와 오늘 날짜의
 * 조합에서 갈리므로, 훅을 목킹하면 그 조합이 테스트의 가정이 되어 버린다.
 *
 * ⚠️ expo-router 목에 `canGoBack`·`back` 이 있어야 한다 — 없으면 뒤로가기 press 가
 *   `canGoBack is not a function` 으로 거짓 red(02a ★10).
 * ⚠️ page 가 trip·visits 도 조회하므로 `onUnhandledRequest:'error'` 아래에서 **세 핸들러를 늘 등록**한다.
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

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    canGoBack: () => mockCanGoBack(),
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

/** p1 방문 완료 기록 — done 카드를 만든다(I8). */
const completedVisit = (): VisitCheck => ({
  visitCheckId: 'v1',
  poiId: 'p1',
  slotKey: `${TODAY}#p1`,
  arrivedAt: '2026-08-20T10:02:00',
  completedAt: '2026-08-20T10:55:00',
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  updatedAt: '2026-08-20T10:55:05Z',
});

/** trip 핸들러는 항상 등록(page 가 무조건 조회). itinerary 핸들러만 케이스별로 갈아끼운다. */
const tripHandler = () =>
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip()));
const itineraryOk = () =>
  http.get(`${BASE}/trips/:tripId/itinerary`, () =>
    HttpResponse.json(itinerary())
  );
const visitsHandler = (visits: VisitCheck[] = []) =>
  http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
    HttpResponse.json({ visits })
  );

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setAccessToken('a');
  mockCanGoBack.mockReturnValue(true);
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  mockReplace.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
  mockCanGoBack.mockClear();
});
afterAll(() => server.close());

async function renderActive(): Promise<void> {
  render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
  await waitFor(() =>
    expect(screen.getByTestId('execution-live-screen')).toBeTruthy()
  );
}

describe('LiveItineraryPage', () => {
  it('I1 오늘 슬롯이 허브에 뜨고 헤더는 "여행명 · N일차 · M월 D일(요일) · N곳" 한 줄이다 (AC-6)', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler());

    await renderActive();

    expect(screen.getByTestId(`execution-live-slot-${TODAY}#p1`)).toBeTruthy();
    // trip.title 은 별도 조회라 늦게 도착할 수 있다 — 완성 문장이 될 때까지 기다린다(완전 일치).
    await waitFor(() =>
      expect(
        screen.getByTestId('execution-live-sheet-header')
      ).toHaveTextContent('부산 여행 · 1일차 · 8월 20일(목) · 1곳')
    );
  });

  it('I2 오늘이 여행 구간 밖이면 안내를 준다', async () => {
    server.use(itineraryOk(), tripHandler());

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

  it('I5 뒤로가기 — 히스토리가 있으면 router.back() 한 번, replace 는 없다', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler());
    mockCanGoBack.mockReturnValue(true);

    await renderActive();
    fireEvent.press(screen.getByTestId('execution-live-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('I6 뒤로가기 — 히스토리가 없으면(딥링크 직행) /(tabs) 로 replace 한다 (INV-4 침묵 금지)', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler());
    mockCanGoBack.mockReturnValue(false);

    await renderActive();
    fireEvent.press(screen.getByTestId('execution-live-back'));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });

  it('I7 연필 FAB 는 수동 재계획 세션(/trips/{id}/planb)을 연다 (BR-U4-10 · Seed Q2)', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler());

    await renderActive();
    fireEvent.press(screen.getByTestId('execution-live-replan-fab'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/planb`);
  });

  it('I8 실앱 done 카드는 사진·후기 칸 없이 계획 시각 "10:00" + "방문" 만 그린다 (G6 · 맹점③)', async () => {
    server.use(itineraryOk(), tripHandler(), visitsHandler([completedVisit()]));

    await renderActive();

    const key = `${TODAY}#p1`;
    await waitFor(() =>
      expect(
        screen.getByTestId(`execution-live-slot-visit-time-${key}`)
      ).toHaveTextContent('10:00')
    );
    expect(
      screen.getByTestId(`execution-live-slot-visit-label-${key}`)
    ).toHaveTextContent('방문');
    expect(
      screen.queryByTestId(`execution-live-slot-photos-${key}`)
    ).toBeNull();
    expect(screen.queryByTestId(`execution-live-slot-memo-${key}`)).toBeNull();
  });
});
