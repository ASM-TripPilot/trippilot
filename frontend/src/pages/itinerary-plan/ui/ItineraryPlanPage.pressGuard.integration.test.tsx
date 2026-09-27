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

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/press/pressGuard';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * TRIP-1013 #057 — '일정 저장하기' 연타의 두 번째 탭이, 확정 성공으로 같은 CTA 자리에 새로 뜬
 * '일정 수정'을 누르지 않는다(실기에서는 확정 직후 편집 화면으로 들어갔다).
 *
 * 가드는 이 페이지가 만드는 cta 배열의 콜백에 건다 — `CtaBar` 는 소비처가 여럿이라 건드리지 않는다
 * (01b 결정 1). "창 밖"은 `resetPressGuard()`로 만든다(=400ms 이상 흐른 것과 같다).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

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
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';

const EDIT_ROUTE = {
  pathname: '/trips/[tripId]/itinerary/edit',
  params: { tripId: TRIP_ID },
};

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 여행',
    startDate: DAY1,
    endDate: '2026-06-11',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 1 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

function itinerary(status: 'PLANNED' | 'CONFIRMED'): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        {
          poiId: 'poi-a',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          alternatives: [],
          tags: [],
        },
      ],
    },
  ];
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

let confirmPostCalls = 0;
/** POST /confirm 응답을 붙잡아 두는 문 — null 이면 즉시 응답한다. */
let confirmGate: Promise<void> | null = null;
let releaseConfirm: (() => void) | null = null;

function holdConfirm(): void {
  confirmGate = new Promise<void>((resolve) => {
    releaseConfirm = resolve;
  });
}

let activeClient: QueryClient | null = null;

/** 가드 판정용으로 멈춰 둘 시각(값 자체는 의미 없다 — 흐르지 않는 것이 요점). */
const FROZEN_NOW = 1_790_000_000_000;

// 이 파일은 전부 가드 판정 테스트다 — 시계를 멈춘다(화면을 그리고 응답을 기다리는 동안 실제 시간이
// 흘러 "창 안"이 400ms 를 넘기면 판정이 흔들린다, 02a ★2). "창 밖"은 resetPressGuard() 로만 만든다.
let clock: jest.SpyInstance;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  resetPressGuard();
  mockPush.mockClear();
  confirmPostCalls = 0;
  confirmGate = null;
  releaseConfirm = null;
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary('PLANNED'))
    ),
    http.post(`${BASE}/trips/:tripId/itinerary/confirm`, async () => {
      confirmPostCalls += 1;
      if (confirmGate !== null) await confirmGate;
      return HttpResponse.json(itinerary('CONFIRMED'));
    })
  );
});

afterEach(async () => {
  clock.mockRestore();
  releaseConfirm?.();
  await activeClient?.cancelQueries();
  activeClient?.clear();
  activeClient = null;
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage() {
  activeClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const client = activeClient;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

/** PLANNED 로 열려 '일정 저장하기' 1버튼이 뜰 때까지 기다린다. */
async function openPlanned(): Promise<void> {
  renderPage();
  const cta = await screen.findByTestId('sheet-cta-button-0');
  expect(cta).toHaveTextContent('일정 저장하기');
}

/** 확정 성공으로 같은 자리가 '일정 수정'으로 바뀔 때까지 기다린다. */
async function waitForEditCta(): Promise<void> {
  // 착지 앵커 = 확정 전용 meta 접두(TRIP-1047 — 상주 배너가 사라져 옮김).
  await waitFor(() =>
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      /^확정됨 · /
    )
  );
  expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
    '일정 수정'
  );
}

/** 창이 닫힌 뒤(=사람이 다시 누름) "일정 수정"이 편집으로 정확히 1회 간다 — 앞의 "0회"가 공짜
 * 통과가 아니라는 긍정 앵커를 겸한다. */
function expectEditWorksAfterWindow(): void {
  resetPressGuard();
  fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith(EDIT_ROUTE);
}

describe('AC-057 · 확정 성공으로 CTA 가 바뀐 직후, 창 안의 "일정 수정"은 무시된다', () => {
  it('창 안의 "일정 수정"은 편집 push 가 0회이고, 창이 지난 뒤 한 번 누르면 정확히 1회다', async () => {
    await openPlanned();

    // 실행 ① — 첫 탭(일정 저장하기).
    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
    await waitForEditCta();
    // 앵커 — 첫 탭은 제 할 일을 했다(확정 POST 1건).
    expect(confirmPostCalls).toBe(1);

    // 실행 ② — 같은 자리에 새로 뜬 '일정 수정'에 떨어진 두 번째 탭.
    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

    // 단언 — 무시된다.
    expect(mockPush).toHaveBeenCalledTimes(0);
    // 무회귀 — 창이 지난 뒤의 한 번은 정상 동작한다.
    expectEditWorksAfterWindow();
  });

  it('01b Q2 · 확정 응답이 창(400ms)보다 늦어도, CTA 가 바뀌는 순간 창이 다시 열려 무시된다', async () => {
    await openPlanned();
    holdConfirm();

    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
    // 첫 탭의 창이 닫힐 만큼 응답이 늦었다(=400ms 이상 흐름).
    resetPressGuard();
    releaseConfirm?.();
    await waitForEditCta();

    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

    expect(mockPush).toHaveBeenCalledTimes(0);
    expectEditWorksAfterWindow();
  });
});

describe('01b Q3 · 창 안에서 "일정 저장하기"를 다시 눌러도 확정 요청은 1건이다', () => {
  it('응답을 기다리는 동안 연타해도 POST /confirm 이 한 번만 나간다', async () => {
    await openPlanned();
    holdConfirm();

    // 실행 — 응답 전 같은 버튼 연타(이 버튼엔 in-flight 잠금이 없다 — 브리프 맹점 ④).
    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
    releaseConfirm?.();
    await waitForEditCta();
    // 두 번째 요청이 나갔다면 도착할 틈을 준다 — "1건"이 "아직 안 왔을 뿐"으로 공짜 통과하지 않게.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(confirmPostCalls).toBe(1);
  });
});
