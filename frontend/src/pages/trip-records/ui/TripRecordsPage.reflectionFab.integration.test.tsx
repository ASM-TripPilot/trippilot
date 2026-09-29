import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { router } from 'expo-router';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/press/pressGuard';
import { tripRecordsTrip } from '@/test-support/tripRecordsTrip';

import { TripRecordsPage } from './TripRecordsPage';

/**
 * 🔴 TRIP-1088 · P1~P7 — j01 「오늘의 회고」 FAB 페이지 배선(US-REC-06 · 지라 결정 2·3).
 *
 * 무엇을 보장하나:
 *  - 누르면 **지금 선택된 일차**의 j03(`/trips/{tripId}/records/reflection/{YYYY-MM-DD}`)으로 1회 간다(P1·P2·P4).
 *  - 미래 일차엔 없고 오늘·지난 일차엔 있다(P3·P4). 끝난 여행도 모든 일차에 있다(P5 — 여행 상태로 안 가른다).
 *  - 일정이 오기 전(활성 일자 '')엔 없다 — `'' <= today` 가 참이라 가드가 없으면 날짜 없는 경로로 간다(P6).
 *  - 연타해도 이동은 1회(P7, guardPress).
 *
 * 방문은 전부 0건 — 그날 계획 행 이름이 "그날 로드 완료" 앵커다(부재 단언이 로딩 중에 공짜로 통과하지 않게).
 * (개념) `findByTestId` = 나타날 때까지 기다렸다 찾는다 · `queryByTestId` = 없으면 null(부재 단언용).
 */

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 't1';
const FAB = 'record-trip-reflection-fab';

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

function daySlot(poiId: string, nameKo: string) {
  return {
    poiId,
    nameKo,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [] as string[],
  };
}

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
      { date: '2026-08-20', slots: [daySlot('p1', '광안리 해변')] },
      { date: '2026-08-21', slots: [daySlot('p2', '부산시립미술관')] },
      { date: '2026-08-22', slots: [daySlot('p3', '○○ 카페')] },
    ],
  };
}

/** 일차 번호(0부터) → 그날 계획 행 이름(로드 앵커). */
const DAY_ANCHOR = ['광안리 해변', '부산시립미술관', '○○ 카페'];

function reflectionPath(date: string): string {
  return `/trips/${TRIP_ID}/records/reflection/${date}`;
}

/** 칩을 눌러 그날로 옮기고, 그날 계획 행이 그려질 때까지 기다린다. */
async function selectDay(index: number): Promise<void> {
  fireEvent.press(screen.getByTestId(`sheet-daychip-${index}`));
  await screen.findByText(DAY_ANCHOR[index] ?? '');
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setAccessToken('a');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () =>
      HttpResponse.json(tripRecordsTrip())
    ),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [] })
    ),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
  );
});
// 파일 최상위 — guardPress 창·push 기록은 모듈 전역이라 describe 안에만 걸면 앞 테스트가 샌다.
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  resetPressGuard();
  jest.mocked(router.push).mockClear();
});
afterAll(() => server.close());

describe('🔴 TRIP-1088 P1·P2 · 누르면 선택된 일차의 j03 으로 간다', () => {
  it('P1·P2 오늘(2일차)에서 누르면 2일차 경로, 1일차로 옮겨 누르면 1일차 경로로 간다 — 오늘로 고정하지 않는다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-21" />, {
      wrapper,
    });
    await screen.findByText(DAY_ANCHOR[0] ?? '');
    expect(jest.mocked(router.push).mock.calls).toEqual([]);

    // 실행 ① — 오늘 탭(2일차)에서 누른다.
    await selectDay(1);
    fireEvent.press(screen.getByTestId(FAB));

    // 실행 ② — 400ms 가 흐른 것으로 치고(guardPress 창 닫기) 1일차로 옮겨 누른다.
    resetPressGuard();
    await selectDay(0);
    fireEvent.press(screen.getByTestId(FAB));

    expect(jest.mocked(router.push).mock.calls).toEqual([
      [reflectionPath('2026-08-21')],
      [reflectionPath('2026-08-20')],
    ]);
  });
});

describe('🔴 TRIP-1088 P3·P4·P5 · 미래 일차에선 숨고, 오늘·지난 일차·끝난 여행에선 보인다', () => {
  it('P3 오늘이 1일차면 1일차엔 있고 2일차·3일차(미래)엔 없다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-20" />, {
      wrapper,
    });
    await screen.findByText(DAY_ANCHOR[0] ?? '');
    expect(screen.getByTestId(FAB)).toBeOnTheScreen();

    await selectDay(1);
    expect(screen.queryByTestId(FAB)).toBeNull();

    await selectDay(2);
    expect(screen.queryByTestId(FAB)).toBeNull();
  });

  it('P4 오늘이 3일차면 지난 1일차에도 있고, 누르면 1일차 경로로 간다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-22" />, {
      wrapper,
    });
    await screen.findByText(DAY_ANCHOR[0] ?? '');

    fireEvent.press(screen.getByTestId(FAB));

    expect(jest.mocked(router.push).mock.calls).toEqual([
      [reflectionPath('2026-08-20')],
    ]);
  });

  it('P5 여행이 끝난 뒤(오늘 08-30, 여행 상태 ENDED)엔 모든 일차에 있다', async () => {
    // 준비 — 여행 응답을 끝난 여행(ENDED)으로 덮는다. 상태로 FAB 를 가르는 퇴행을 잡으려면 픽스처가
    // 실제로 ENDED 여야 한다(ACTIVE 그대로면 그 퇴행이 green 으로 통과 — 03b 경고-1).
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json({ ...tripRecordsTrip(), status: 'ENDED' })
      )
    );
    render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-30" />, {
      wrapper,
    });
    await screen.findByText(DAY_ANCHOR[0] ?? '');
    // 여행 응답이 도착했는지(헤더에 여행명) 먼저 확인 — 로딩 중이라 FAB 가 보이는 경우와 가른다.
    await waitFor(() =>
      expect(screen.getByTestId('record-trip-sheet-header')).toHaveTextContent(
        /^부산 여행 · /
      )
    );
    expect(screen.getByTestId(FAB)).toBeOnTheScreen();

    await selectDay(1);
    expect(screen.getByTestId(FAB)).toBeOnTheScreen();

    await selectDay(2);
    expect(screen.getByTestId(FAB)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1088 P6 · 일정이 오기 전(활성 일자 없음)엔 없다', () => {
  it('P6 itinerary 응답을 붙잡은 동안엔 뷰만 있고 FAB 는 없다 — 응답이 오면 선다', async () => {
    // 준비 — itinerary GET 을 게이트로 붙잡는다(바로 주면 로딩 창이 한 번에 지나간다, 02a ★8).
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        await gate;
        return HttpResponse.json(itinerary());
      })
    );

    render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-20" />, {
      wrapper,
    });

    // 단언 ① — 화면은 그려졌지만(앵커) 날짜가 없어 FAB 가 없다.
    expect(screen.getByTestId('record-trip-view')).toBeOnTheScreen();
    expect(screen.queryByTestId(FAB)).toBeNull();

    // 실행 — 응답을 보낸다.
    release();

    // 단언 ② — 1일차(= 오늘)가 활성이 되면 선다.
    expect(await screen.findByTestId(FAB)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1088 P7 · 연타해도 j03 은 한 번만 쌓인다', () => {
  it('P7 같은 순간 두 번 눌러도 push 는 1회다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-20" />, {
      wrapper,
    });
    await screen.findByText(DAY_ANCHOR[0] ?? '');

    const fab = screen.getByTestId(FAB);
    fireEvent.press(fab);
    fireEvent.press(fab);

    expect(jest.mocked(router.push).mock.calls).toEqual([
      [reflectionPath('2026-08-20')],
    ]);
  });
});
