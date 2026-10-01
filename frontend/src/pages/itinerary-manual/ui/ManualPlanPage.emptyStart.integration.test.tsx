import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import type {
  BaseAssignment,
  Itinerary,
  SavedStay,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ManualPlanPage } from './ManualPlanPage';

/**
 * TRIP-1022 #075 — 새 여행에서 직접 짜기를 열면, 장소를 하나도 안 담아도 곧바로 헤더 날짜와 2일차
 * 칩이 보여야 한다.
 *
 * 무엇이 틀렸나: 진입 순간 일정 조회(GET)는 404 로 정착하고(재시도 안 함), 페이지는 MANUAL 생성
 * POST 를 쏜다. 서버는 전 일자를 빈 슬롯으로 깔아 **즉시** 돌려주는데, POST 성공 콜백이 조회 캐시를
 * 건드리지 않아 GET 의 404 가 그대로 남는다 → 날짜 0개 → 헤더 공백·칩 0개.
 *
 * 무엇을 보장하나(01 AC-A1~A3):
 *  - 🔴 E1 (A1·A2) POST 가 성공하면 조회 캐시가 갱신돼 `10월 20일(화)` 헤더와 1·2일차 칩이 뜬다.
 *    1박 2일 픽스처 — 칩이 뜨는 조건은 "2일 이상"(티켓의 "2박 이상"은 오기, 01 드리프트).
 *  - 🔴 E2 (A3) 캐시 갱신 뒤 기존 초안으로 보이게 돼도 POST 는 **총 1회**다(TRIP-601 가드 · BR-U3-06).
 *  - 🟢 E3 (A4 · 5-c 보강, 03b 경고-1) 페이지가 **이 여행의** 거점과 등록 숙소를 실제로 요청해,
 *    늦게 도착해도 지도가 서울 → 강릉으로 옮겨 간다. 동기 목 파일(C 묶음)은 목이 인자를 버려
 *    "무엇을 요청하는가"를 못 본다 — 그 사각을 실 HTTP 로 메운다.
 *
 * ★ 수단이 아니라 결과로 잰다(02a ★4): 캐시에 POST 응답을 직접 쓰든(setQueryData) 다시 조회하게
 *   하든(invalidateQueries) 둘 다 통과해야 한다. 그래서 가짜 서버를 "POST 전엔 404, 후엔 200" 으로
 *   두고 화면에 날짜가 뜨는지만 본다 — 아무것도 안 하면 404 가 남아 실패한다.
 *
 * 3동작 뼈대: 준비=가짜 서버(404→POST→200) → 실행=페이지 렌더 → 단언=헤더·칩·POST 건수.
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

// POST 성공 콜백이 알림 권한 루틴을 부른다(TRIP-835) — 실물을 안 태운다(`.push` 형제 파일 선례).
jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '33333333-3333-3333-3333-333333333333';

/** 1박 2일 MANUAL — 서버가 POST 에 즉시 돌려주는 모양(전 일자 빈 슬롯 · COMPLETE). */
const MANUAL_TWO_DAYS: Itinerary = {
  itineraryId: 'itin-new',
  tripId: TRIP_ID,
  status: 'PLANNED',
  solveMode: 'MINIMAL',
  generationMode: 'MANUAL',
  generationState: 'COMPLETE',
  isFallback: false,
  days: [
    { date: '2026-10-20', slots: [] },
    { date: '2026-10-21', slots: [] },
  ],
};

let posted = false;
let postCalls = 0;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// 편집 스토어는 모듈 싱글턴이다 — describe 밖 최상위에서 비워 앞 케이스의 시드가 새지 않게 한다(02a ★16).
beforeEach(() => {
  posted = false;
  postCalls = 0;
  setAccessToken('valid-access');
  useItineraryEditStore.getState().reset();

  // 통합 버킷은 핸들러가 없으면 준비 단계에서 죽는다 — 페이지가 부르는 네 경로를 전부 건다(02a ★17).
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      posted
        ? HttpResponse.json(MANUAL_TWO_DAYS)
        : HttpResponse.json({}, { status: 404 })
    ),
    http.post(`${BASE}/trips/:tripId/itinerary`, () => {
      postCalls += 1;
      posted = true;
      return HttpResponse.json(MANUAL_TWO_DAYS, { status: 201 });
    }),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  useItineraryEditStore.getState().reset();
});

afterAll(() => server.close());

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
  return render(<ManualPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

describe('🔴 E1 · AC-A1·A2 — POST 가 성공하면 장소 없이도 헤더 날짜와 2일차 칩이 뜬다', () => {
  it('404 로 시작해도 MANUAL 생성 뒤 "10월 20일(화)" 헤더와 1·2일차 칩이 보인다', async () => {
    // 준비·실행 — 새 여행(일정 없음)에서 직접 짜기 진입.
    renderPage();

    // 앵커 — 생성 전엔 칩이 없다(앞 케이스 시드가 새면 여기서 먼저 죽는다).
    expect(screen.queryAllByTestId('itinerary-edit-day-2').length).toBe(0);

    // POST 가 실제로 나갔다(GET 404 정착 → 생성).
    await waitFor(() => expect(postCalls).toBe(1));

    // 단언 — 캐시가 갱신돼 날짜가 생겼다.
    expect(await screen.findByTestId('itinerary-edit-day-2')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-edit-day-1')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '10월 20일(화)'
    );
  });
});

describe('🔴 E2 · AC-A3 — 캐시 갱신 뒤에도 생성 POST 는 총 1회다 (TRIP-601 가드)', () => {
  it('칩이 뜬 뒤 한 번 더 흘려 보내도 POST 는 1건이다', async () => {
    renderPage();

    // 캐시 갱신이 끝났다(재조회를 택했으면 그 GET 도 도착했다).
    await screen.findByTestId('itinerary-edit-day-2');

    // 이제 "기존 초안 있음"으로 보이는 재렌더가 돈다 — 여기서 두 번째 POST 가 나가면 빈 MANUAL 로
    // 방금 만든 일정을 덮어쓴다. 한 번 흘려 보낸 뒤 센다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(postCalls).toBe(1);
  });
});

describe('🟢 E3 · AC-A4 — 이 여행의 거점·숙소를 실제로 요청해 지도가 거점으로 옮겨 간다 (5-c 보강)', () => {
  const GANGNEUNG = '37.7519,128.8761';
  const SEOUL_CITY_HALL = '37.5665,126.978';

  const GN_BASE: BaseAssignment = {
    baseAssignmentId: 'ba-gn',
    savedStayId: 's-gn',
    dateFrom: '2026-10-20',
    dateTo: '2026-10-21',
  };

  const GN_STAY: SavedStay = {
    savedStayId: 's-gn',
    name: '강릉 바다 스테이',
    lat: 37.7519,
    lng: 128.8761,
    coordConfirmed: true,
    linkedTripIds: [TRIP_ID],
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  it('첫 화면은 서울시청이다가, 거점·숙소가 도착하면 강릉 숙소를 비춘다', async () => {
    // 준비 — 거점은 **이 여행 id 경로**에서만 강릉을 준다(다른 id 로 물으면 beforeEach 의 빈 목록).
    server.use(
      http.get(`${BASE}/trips/${TRIP_ID}/bases`, () =>
        HttpResponse.json([GN_BASE])
      ),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([GN_STAY]))
    );

    // 실행
    renderPage();

    // 앵커 — 응답은 비동기라 첫 렌더엔 아직 거점이 없다. 여기가 강릉이면 아래 단언이 공허해진다.
    expect(screen.getByTestId('map-root')).toHaveTextContent(SEOUL_CITY_HALL);

    // 단언 — 서울에서 강릉으로 **바뀌어야** 통과한다. 조회를 꺼 버리면(요청 0건) 영원히 서울이라 red.
    await waitFor(() =>
      expect(screen.getByTestId('map-root')).toHaveTextContent(GANGNEUNG)
    );
  });
});
