import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { router } from 'expo-router';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/press/pressGuard';
import { isInsideSheet } from '@/test-support/sheetTree';
import { tripRecordsTrip } from '@/test-support/tripRecordsTrip';

import { TripRecordsPage } from './TripRecordsPage';

/**
 * 🔴 TRIP-1085 · j01 방문 기록 **페이지**가 셸(전면 지도 + 바텀시트)로 조립된다 — 실 쿼리(MSW) 렌더.
 *
 * 무엇을 보장하나:
 *  - MS1 (AC-1)   페이지가 새 뷰(`record-trip-view`)를 그리고, 지도는 셸 것 하나 · 탭바 없음 · 카드는 시트 안.
 *  - MS2·3 (AC-12) 시트 헤더 = "여행명 · N일차 · M월 D일(요일) · N곳". 여행명은 GET /trips/{tripId} 에서 온다.
 *                  그 조회가 실패하면 여행명 조각만 빠지고 오류 표면은 없다(INV-4).
 *  - MS4~6 (AC-10·11 · 결정 3(c)) 핀 = 그날 계획 슬롯 순서. slotKey 로 맞춘 방문이 **도착했고 건너뛰지
 *                  않았으면** 체크 핀(`done`), 아니면 번호 핀(`upcoming`). 즉석 방문은 핀이 없다. 같은 장소의
 *                  즉석 방문이 계획 핀을 체크하지 않는다(poiId 가 아니라 slotKey). 핀 전부 맞추기·지도 잠금.
 *  - MS7 (AC-2)   셸 일차 칩을 누르면 그날 기록을 조회하고 카드·핀이 그날 것으로 바뀐다.
 *  - MS8 (AC-3)   ‹(`sheet-daychip-back`)는 뒤로 갈 곳이 있을 때만 back 한다.
 *
 * ★핀은 `toEqual` 정확 일치 — `kind` 가 붙으면 지도가 기록 마커족(사진·점선)으로 그려 Figma 체크/번호 핀이
 *   아니게 된다. `objectContaining` 이면 그 회귀가 통과한다.
 * ⚠️ 지도 목은 prop 전달까지만 본다 — 핀 모양·경로선·fitPins 실제 카메라는 6-b.
 *
 * (개념) `getByTestId('map-root').props.pins` = 목이 지도에 넘어간 핀 배열을 그대로 보여 준다 ·
 *   `waitFor(() => 단언)` = 단언이 통과할 때까지 잠깐씩 다시 시도(쿼리 도착 대기).
 * 3동작: 준비(2일 일정 + 날짜별 방문 + 여행) → 실행(렌더·칩·뒤로) → 단언(헤더 글자·핀 배열·요청·콜백).
 */

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 't1';
const DAY1 = '2026-08-20';
const DAY2 = '2026-08-21';

// OS 권한 seam — granted 로 고정(수동 체크인 표면은 manualCheckin 통합이 본다).
const mockGetForeground = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
}));

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => {
  const router = {
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
    replace: jest.fn(),
    push: jest.fn(),
  };
  return { router, useRouter: () => router };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** 좌표가 있는 계획 슬롯(스키마 필수 최소값 + lat/lng). */
function slot(poiId: string, nameKo: string, lat: number, lng: number) {
  return {
    poiId,
    nameKo,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [] as string[],
    lat,
    lng,
  };
}

const P1 = { lat: 35.1532, lng: 129.1187 };
const P2 = { lat: 35.1555, lng: 129.1216 };
const P3 = { lat: 35.156, lng: 129.1174 };
const P5 = { lat: 35.1, lng: 129.03 };
const P6 = { lat: 35.101, lng: 129.032 };

function itinerary() {
  return {
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'CONFIRMED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: DAY1,
        slots: [
          slot('p1', '광안리 해변', P1.lat, P1.lng),
          slot('p2', '부산시립미술관', P2.lat, P2.lng),
          slot('p3', '○○ 카페', P3.lat, P3.lng),
        ],
      },
      {
        date: DAY2,
        slots: [
          slot('p5', '◇◇ 시장', P5.lat, P5.lng),
          slot('p6', '△△ 공원', P6.lat, P6.lng),
        ],
      },
    ],
  };
}

interface VisitSpec {
  id: string;
  day: string;
  poiId: string;
  /** 계획 방문이면 `${day}#${poiId}`, 즉석 방문이면 null. */
  planned: boolean;
  arrived?: boolean;
  completed?: boolean;
  skipped?: boolean;
}

function visit({
  id,
  day,
  poiId,
  planned,
  arrived,
  completed,
  skipped,
}: VisitSpec) {
  return {
    visitCheckId: id,
    slotKey: planned ? `${day}#${poiId}` : null,
    poiId,
    arrivedAt: arrived ? `${day}T05:20:00Z` : null,
    completedAt: completed ? `${day}T06:20:00Z` : null,
    skippedAt: skipped ? `${day}T07:00:00Z` : null,
    source: 'MANUAL',
    spontaneous: !planned,
    updatedAt: `${day}T07:00:00Z`,
  };
}

/** 기본 1일차 — p1 도착 · p2 완료 · p3 기록 없음 · 계획에 없던 p9 즉석 도착. */
function defaultDay1() {
  return [
    visit({ id: 'v1', day: DAY1, poiId: 'p1', planned: true, arrived: true }),
    visit({
      id: 'v2',
      day: DAY1,
      poiId: 'p2',
      planned: true,
      arrived: true,
      completed: true,
    }),
    visit({
      id: 'v-sp',
      day: DAY1,
      poiId: 'p9',
      planned: false,
      arrived: true,
    }),
  ];
}

let visitsByDay: Record<string, ReturnType<typeof visit>[]> = {};
let dayHits: string[] = [];
let tripHits = 0;

const pinsOnMap = () => screen.getByTestId('map-root').props.pins;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setAccessToken('a');
  mockGetForeground.mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: true,
  });
  visitsByDay = {
    [DAY1]: defaultDay1(),
    [DAY2]: [
      visit({
        id: 'v5',
        day: DAY2,
        poiId: 'p5',
        planned: true,
        arrived: true,
        completed: true,
      }),
    ],
  };
  dayHits = [];
  tripHits = 0;
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => {
      tripHits += 1;
      return HttpResponse.json(tripRecordsTrip('부산 여행', TRIP_ID));
    }),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, ({ params }) => {
      const day = params.day as string;
      dayHits.push(day);
      return HttpResponse.json({ visits: visitsByDay[day] ?? [] });
    }),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
    http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
      HttpResponse.json({ items: [], count: 0 })
    )
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  resetPressGuard();
  // 호출 기록까지 지운다 — MS8b 의 "canGoBack 을 물었다" 단언이 앞 테스트 호출로 공허해지지 않게.
  jest.mocked(router.canGoBack).mockReset().mockReturnValue(false);
  jest.mocked(router.back).mockClear();
});
afterAll(() => server.close());

describe('🔴 TRIP-1085 AC-1 · 페이지가 전면 지도 + 바텀시트로 열린다', () => {
  it('MS1 새 뷰가 서고, 지도는 셸 것 하나 · 하단 탭바 없음 · 카드는 시트 안이다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

    const card = await screen.findByTestId('record-trip-visit-card-v1');
    expect(screen.getByTestId('record-trip-view')).toBeOnTheScreen();
    expect(screen.getAllByTestId('map-root')).toHaveLength(1);
    expect(screen.queryByTestId('shell-tabbar-root')).toBeNull();
    expect(isInsideSheet(card)).toBe(true);
  });
});

describe('🔴 TRIP-1085 AC-12 · 시트 헤더 한 줄', () => {
  it('MS2 여행명이 오면 "부산 여행 · 1일차 · 8월 20일(목) · 4곳"(카드 3 + 계획 행 1)', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

    await screen.findByTestId('record-trip-visit-card-v1');
    await waitFor(() =>
      expect(screen.getByTestId('record-trip-sheet-header')).toHaveTextContent(
        '부산 여행 · 1일차 · 8월 20일(목) · 4곳'
      )
    );
  });

  it('MS3 여행 조회가 실패하면 여행명 조각만 빠지고 오류 표면은 없다 (INV-4)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => {
        tripHits += 1;
        return HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'boom' } },
          { status: 500 }
        );
      })
    );

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

    // 앵커 — 여행 요청이 실제로 나가 실패했고 카드도 그려졌다(로딩 중의 공허 통과 차단).
    await screen.findByTestId('record-trip-visit-card-v1');
    await waitFor(() => expect(tripHits).toBeGreaterThanOrEqual(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(screen.getByTestId('record-trip-sheet-header')).toHaveTextContent(
      '1일차 · 8월 20일(목) · 4곳'
    );
    expect(screen.queryByTestId('record-trip-error')).toBeNull();
  });
});

describe('🔴 TRIP-1085 AC-10·AC-11 · 방문 기준 핀 (결정 3(c))', () => {
  it('MS4 도착 2곳은 체크 핀, 미방문은 번호 핀(제자리 번호), 즉석 방문은 핀 없음 · fitPins · 잠금', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

    await screen.findByTestId('record-trip-visit-card-v-sp');
    await waitFor(() =>
      expect(pinsOnMap()).toEqual([
        { number: 1, ...P1, state: 'done' },
        { number: 2, ...P2, state: 'done' },
        { number: 3, ...P3, state: 'upcoming' },
      ])
    );
    const map = screen.getByTestId('map-root');
    expect(map.props.fitPins).toBe(true);
    expect(map.props.viewOnly).toBe(true);
  });

  it.each([
    ['도착 전에 건너뜀', false],
    ['도착한 뒤 건너뜀', true],
  ])('MS5 %s 계획 방문은 번호 핀(upcoming)이다', async (_label, arrived) => {
    visitsByDay[DAY1] = [
      visit({ id: 'v1', day: DAY1, poiId: 'p1', planned: true, arrived: true }),
      visit({
        id: 'v2',
        day: DAY1,
        poiId: 'p2',
        planned: true,
        arrived,
        skipped: true,
      }),
    ];

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

    await screen.findByTestId('record-trip-visit-card-v2');
    await waitFor(() =>
      expect(pinsOnMap()).toEqual([
        { number: 1, ...P1, state: 'done' },
        { number: 2, ...P2, state: 'upcoming' },
        { number: 3, ...P3, state: 'upcoming' },
      ])
    );
  });

  it('MS6 같은 장소(p3)의 즉석 도착은 계획 핀을 체크하지 않는다 — slotKey 로 맞춘다', async () => {
    visitsByDay[DAY1] = [
      visit({ id: 'v1', day: DAY1, poiId: 'p1', planned: true, arrived: true }),
      visit({
        id: 'v-sp3',
        day: DAY1,
        poiId: 'p3',
        planned: false,
        arrived: true,
      }),
    ];

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });

    await screen.findByTestId('record-trip-visit-card-v-sp3');
    await waitFor(() =>
      expect(pinsOnMap()).toEqual([
        { number: 1, ...P1, state: 'done' },
        { number: 2, ...P2, state: 'upcoming' },
        { number: 3, ...P3, state: 'upcoming' },
      ])
    );
  });
});

describe('🔴 TRIP-1085 AC-2 · 셸 일차 칩으로 날을 바꾼다', () => {
  it('MS7 2일차 칩을 누르면 그날 기록을 조회하고 카드·핀이 2일차 것으로 바뀐다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });
    await screen.findByTestId('record-trip-visit-card-v1');

    fireEvent.press(screen.getByTestId('sheet-daychip-1'));

    expect(
      await screen.findByTestId('record-trip-visit-card-v5')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('record-trip-visit-card-v1')).toBeNull();
    expect(dayHits).toContain(DAY2);
    await waitFor(() =>
      expect(pinsOnMap()).toEqual([
        { number: 1, ...P5, state: 'done' },
        { number: 2, ...P6, state: 'upcoming' },
      ])
    );
    expect(screen.getByTestId('sheet-daychip-1')).toBeSelected();
  });
});

describe('🔴 TRIP-1085 AC-3 · ‹ 는 뒤로 갈 곳이 있을 때만 back', () => {
  it('MS8a canGoBack 이 true 면 sheet-daychip-back 을 누를 때 back 이 1회 불린다', async () => {
    jest.mocked(router.canGoBack).mockReturnValue(true);
    render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });
    await screen.findByTestId('record-trip-visit-card-v1');

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('MS8b canGoBack 이 false 면 back 을 부르지 않는다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today={DAY1} />, { wrapper });
    await screen.findByTestId('record-trip-visit-card-v1');

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    expect(router.canGoBack).toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });
});
