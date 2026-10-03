import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  MustVisit,
  Place,
  SavedPlace,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/press/pressGuard';
import {
  MustVisitListPage,
  MustVisitTimePage,
} from '@/pages/itinerary/itinerary-mustvisit';

/**
 * TRIP-1013 #042 — 시각 지정 '저장' 연타의 두 번째 탭이, 저장 성공으로 되돌아간 필수 방문지
 * 목록의 같은 자리 행을 누르지 않는다(실기에서는 다른 장소의 시각 지정 화면으로 들어갔다).
 *
 * 스택 pop 은 목록 화면을 **새로 그리지 않는다**(아래에 이미 있던 화면이 드러날 뿐) — 그래서
 * 두 페이지를 **한 트리에 동시에** 그려 둔다(목록 = 아래 화면, 시각 지정 = 위 화면).
 *
 * "창 밖"은 `resetPressGuard()`로 만든다(=400ms 이상 흐른 것과 같다).
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
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';

const TRIP: Trip = {
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-12',
  party: 1,
  companionType: null,
  budgetTotal: 800000,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'PLANNED',
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
  baseCount: 0,
  itineraryDayCount: 0,
};

function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '부산진구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

const SAVED: SavedPlace[] = [
  {
    savedPlaceId: 'sp-poi-a',
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace('poi-a', '부산시립미술관'),
  },
  {
    savedPlaceId: 'sp-poi-b',
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace('poi-b', '해운대 블루라인파크'),
  },
];

/** 둘 다 `ANYTIME` 으로 등록돼 있다. 시각 지정 화면은 poi-a 를 다룬다. */
const REGISTERED: MustVisit[] = [
  {
    mustVisitId: 'mv-poi-a',
    poiSnapshotId: 'snap-poi-a',
    sourcePoiId: 'poi-a',
    type: 'ANYTIME',
  },
  {
    mustVisitId: 'mv-poi-b',
    poiSnapshotId: 'snap-poi-b',
    sourcePoiId: 'poi-b',
    type: 'ANYTIME',
  },
];

/** POST 응답을 붙잡아 두는 문 — null 이면 즉시 응답한다. */
let postGate: Promise<void> | null = null;
let releasePost: (() => void) | null = null;

function holdPost(): void {
  postGate = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  resetPressGuard();
  mockPush.mockClear();
  mockBack.mockClear();
  postGate = null;
  releasePost = null;
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(TRIP)),
    http.get(`${BASE}/trips/:tripId/must-visits`, () =>
      HttpResponse.json(REGISTERED)
    ),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(SAVED)),
    http.delete(
      `${BASE}/trips/:tripId/must-visits/:mustVisitId`,
      () => new HttpResponse(null, { status: 204 })
    ),
    http.post(`${BASE}/trips/:tripId/must-visits`, async () => {
      if (postGate !== null) await postGate;
      return HttpResponse.json(
        {
          mustVisitId: 'mv-new',
          poiSnapshotId: 'snap-poi-a',
          sourcePoiId: 'poi-a',
          type: 'ANYTIME',
        },
        { status: 201 }
      );
    })
  );
});

afterEach(() => {
  // 붙잡힌 응답은 테스트가 도중에 실패해도 반드시 푼다(가짜 서버가 프로세스를 붙든다).
  releasePost?.();
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
}

/**
 * 목록(아래 화면)과 시각 지정(위 화면)을 **한 번의 render 로** 함께 그린다. RNTL 의 `fireEvent` 는
 * 가장 최근 `render` 의 트리에 없는 요소를 누르면 **아무 일도 안 하고 조용히 넘어간다**(02a ★1 —
 * `render` 를 두 번 부르면 앞 트리의 행 누름이 막힌 척 초록이 된다). 화면마다 캐시는 따로 둔다.
 */
async function openListThenTime(): Promise<void> {
  render(
    <>
      <QueryClientProvider client={newClient()}>
        <MustVisitListPage tripId={TRIP_ID} />
      </QueryClientProvider>
      <QueryClientProvider client={newClient()}>
        <MustVisitTimePage tripId={TRIP_ID} sourcePoiId="poi-a" />
      </QueryClientProvider>
    </>
  );
  await screen.findByTestId('itinerary-mustvisit-poi-b');
  await screen.findByTestId('itinerary-mustvisit-time-date-2026-06-11');
  // 토글을 끄면 ANYTIME 최소본이라 날짜·시각 입력 없이 저장된다.
  const toggle = screen.getByTestId('itinerary-mustvisit-time-toggle');
  if (toggle.props.accessibilityState?.checked) fireEvent.press(toggle);
}

/** push 인자 중 시각 지정(must-visits/[poiId]) 라우트로 가는 것만 센다. */
function timeScreenPushes(): unknown[] {
  return mockPush.mock.calls
    .map((call) => JSON.stringify(call[0]))
    .filter((flat) => flat.includes('must-visits'));
}

/** 창이 닫힌 뒤(=사람이 다시 누름) 같은 행이 그 장소의 시각 지정으로 정확히 1회 간다 — 누름이 실제로
 * 전달되는 요소였다는 긍정 앵커를 겸한다(앞의 "0회"가 공짜 통과가 아니다). */
function expectRowWorksAfterWindow(): void {
  resetPressGuard();
  fireEvent.press(screen.getByTestId('itinerary-mustvisit-poi-b'));

  expect(timeScreenPushes()).toHaveLength(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/trips/[tripId]/itinerary/must-visits/[poiId]',
    params: { tripId: TRIP_ID, poiId: 'poi-b' },
  });
}

/** 가드 판정용으로 멈춰 둘 시각(값 자체는 의미 없다 — 흐르지 않는 것이 요점). */
const FROZEN_NOW = 1_790_000_000_000;

describe('AC-042 · 저장 성공으로 돌아간 직후, 창 안의 목록 행은 무시된다', () => {
  // 시계를 멈춘다 — 화면을 그리고 응답을 기다리는 동안 실제 시간이 흘러 "창 안"이 400ms 를 넘기면
  // 판정이 흔들린다(02a ★2). "창 밖"은 resetPressGuard() 로만 만든다.
  let clock: jest.SpyInstance;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  });
  afterEach(() => clock.mockRestore());

  it('창 안에서 행을 누르면 시각 지정 push 가 0회이고, 창이 지난 뒤 한 번 누르면 정확히 1회다', async () => {
    await openListThenTime();

    // 실행 ① — 첫 탭(저장). DELETE → POST 성공 → back().
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-submit'));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

    // 실행 ② — 드러난 목록의 같은 자리 행에 떨어진 두 번째 탭.
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-poi-b'));

    // 단언 — 무시된다.
    expect(timeScreenPushes()).toHaveLength(0);
    // 무회귀·인자 전달 — 창이 지난 뒤의 한 번은 정상 동작한다.
    expectRowWorksAfterWindow();
  });

  it('01b Q2 · 응답이 창(400ms)보다 늦어도, 돌아가는 순간 창이 다시 열려 행이 무시된다', async () => {
    await openListThenTime();
    holdPost();

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-submit'));
    // 첫 탭의 창이 닫힐 만큼 응답이 늦었다(=400ms 이상 흐름).
    resetPressGuard();
    releasePost?.();
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-poi-b'));

    expect(timeScreenPushes()).toHaveLength(0);
    expectRowWorksAfterWindow();
  });
});
