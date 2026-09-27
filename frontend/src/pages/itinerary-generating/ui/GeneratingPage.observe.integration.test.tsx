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
import type {
  Itinerary,
  ItineraryGenerationState,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { GeneratingPage } from './GeneratingPage';

/**
 * TRIP-1006 · 생성 중 화면의 **관찰 모드** — `mode` 없이 열리면 생성을 새로 쏘지 않고 이미 도는 생성을
 * 일정 GET 으로 지켜보기만 한다(A3·A4 · INV-4). 일정 탭 카드·홈 CTA 가 완전 AI 생성 중(PARTIAL)
 * 여행을 다시 열 때 이 모드로 온다(D2).
 *
 * 무엇을 보장하나:
 *  - 🔴 O1·O2 첫 GET 이 PARTIAL·COMPLETE·FAILED 면 곧장 초안(draft)으로 **replace** 한다(Q1 — 나머지
 *    폴링은 초안 화면 몫). 생성 POST 는 0.
 *  - 🔴 O3 404(관찰할 생성이 없음)면 생성 방식(method)으로 replace 한다. POST 0.
 *  - 🔴 O4 GET 이 오기 전엔 진행 얼굴이 떠 있다(빈 화면·실패 얼굴 아님). 정착 뒤에도 POST 0.
 *  - 🔴 O5 조회가 실패하면 실패 얼굴을 띄우고(침묵 금지), [다시 시도]는 **GET 만** 다시 한다(A6).
 *
 * 왜 MSW 인가: 핵심 단언이 "생성 POST 가 네트워크로 한 번도 안 나갔다"다. 훅을 목하면 그건 목의
 * 가정이 된다 — 가짜 서버에서 실제로 나간 요청 수를 센다.
 *
 * 3동작: 준비 = 가짜 서버 응답 → 실행 = mode 없이 화면을 연다(필요하면 다시 시도) → 단언 = 이동·요청 수.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외.
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    navigate: jest.fn(),
  }),
}));

// 지도는 이 파일의 관심사가 아니다 — 관찰 마커로 바꾼다(꼭 갈 곳이 0개라 어차피 안 그려진다).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '44444444-4444-4444-4444-444444444444';

function itinerary(generationState: ItineraryGenerationState): Itinerary {
  return {
    itineraryId: 'itin-observe',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState,
    isFallback: false,
    days: [
      {
        date: '2026-06-10',
        slots: [
          {
            poiId: 'a',
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
    ],
  };
}

/** 케이스가 바꿔 끼우는 일정 GET 응답(핸들러가 요청 시점에 읽는다). */
let itineraryHandler: () => Response;
let getCalls = 0;
let postCalls = 0;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  getCalls = 0;
  postCalls = 0;
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  setAccessToken('valid-access');
  itineraryHandler = () => HttpResponse.json(itinerary('PARTIAL'));

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      getCalls += 1;
      return itineraryHandler();
    }),
    // 생성 POST — 나가면 안 된다. 핸들러를 두는 이유는 "나갔다"를 세기 위해서다(없으면 요청이
    // 미처리 오류로 사라져 수를 못 센다).
    http.post(`${BASE}/trips/:tripId/itinerary`, () => {
      postCalls += 1;
      return HttpResponse.json(itinerary('PARTIAL'), { status: 201 });
    }),
    http.get(`${BASE}/trips/:tripId/must-visits`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json([]))
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderObserver() {
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
  // mode 를 **주지 않는다** — 이것이 관찰 모드의 신호다.
  return render(<GeneratingPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

/** "안 나갔다"는 나갈 시간을 준 뒤에야 의미가 있다(02a ★4). */
function settle(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** replace 목적지를 형태(문자열/객체)와 무관하게 글자로 편다. */
function replacedTo(index = 0): string {
  const destination = mockReplace.mock.calls[index][0] as unknown;
  return typeof destination === 'string'
    ? destination
    : JSON.stringify(destination);
}

describe('🔴 O1 · A3 — 완전 AI 생성 중(PARTIAL)을 관찰하면 곧장 초안으로 넘긴다', () => {
  it('첫 GET 이 PARTIAL 이면 draft 로 replace 1회, push 0, 생성 POST 0', async () => {
    // 준비 — 기본 핸들러가 PARTIAL(1일차 도착) 을 준다.
    // 실행
    renderObserver();

    // 단언 ① 초안으로 넘어간다(뒤로가면 이 화면으로 안 돌아오게 replace).
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(replacedTo()).toContain('/itinerary/draft');
    expect(replacedTo()).toContain(TRIP_ID);
    expect(mockPush).not.toHaveBeenCalled();

    // 단언 ② 생성은 한 번도 쏘지 않았다(#083 — 재진입이 생성을 다시 돌리면 같이 짜기가 덮인다).
    await settle();
    expect(postCalls).toBe(0);
    expect(getCalls).toBeGreaterThanOrEqual(1);
  });
});

describe('🔴 O2 · A3 — 이미 끝났거나(COMPLETE) 2차가 실패(FAILED)해도 초안으로', () => {
  it.each<ItineraryGenerationState>(['COMPLETE', 'FAILED'])(
    '첫 GET 이 %s 면 draft 로 replace 1회, 생성 POST 0',
    async (state) => {
      itineraryHandler = () => HttpResponse.json(itinerary(state));

      renderObserver();

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(replacedTo()).toContain('/itinerary/draft');
      await settle();
      expect(postCalls).toBe(0);
    }
  );
});

describe('🔴 O3 · Q1 — 관찰할 일정이 없으면(404) 생성 방식 화면으로', () => {
  it('첫 GET 이 404 면 method 로 replace 1회, 생성 POST 0', async () => {
    itineraryHandler = () => HttpResponse.json({}, { status: 404 });

    renderObserver();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(replacedTo()).toContain('/itinerary/method');
    expect(replacedTo()).toContain(TRIP_ID);
    await settle();
    expect(postCalls).toBe(0);
  });
});

describe('🔴 O4 · A4 — mode 없이 열려도 생성 모드를 지어내지 않는다 (INV-4)', () => {
  it('GET 이 오기 전엔 진행 얼굴이 뜨고, 정착한 뒤에도 생성 POST 는 0', async () => {
    renderObserver();

    // 단언 ① 마운트 직후 — 진행 얼굴(빈 화면 아님), 실패 얼굴 아님.
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();

    // 단언 ② GET 이 정착(=이동)한 뒤까지 기다려도 POST 는 0.
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    await settle();
    expect(postCalls).toBe(0);
  });
});

describe('🔴 O5 · A6 — 조회 실패는 실패 얼굴로 말하고, 다시 시도는 GET 만 한다', () => {
  it('500 이면 실패 얼굴 · 이동 0 → [다시 시도] 가 GET 을 1회 더 하고 성공하면 draft 로, POST 는 끝까지 0', async () => {
    // 준비 — 첫 조회는 서버 오류.
    itineraryHandler = () => HttpResponse.json({}, { status: 500 });

    renderObserver();

    // 단언 ① 침묵하지 않는다 — 실패 얼굴이 뜨고, 모르는 상태로 아무 데도 가지 않는다.
    await screen.findByTestId('itinerary-generating-failed');
    expect(mockReplace).not.toHaveBeenCalled();
    const getsBeforeRetry = getCalls;

    // 실행 — 서버가 회복한 뒤 다시 시도.
    itineraryHandler = () => HttpResponse.json(itinerary('PARTIAL'));
    fireEvent.press(screen.getByTestId('itinerary-generating-retry'));

    // 단언 ② 다시 시도 = GET 재조회. 회복했으니 초안으로 간다.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(getCalls).toBe(getsBeforeRetry + 1);
    expect(replacedTo()).toContain('/itinerary/draft');

    // 단언 ③ 다시 시도가 생성을 쏘는 경로로 새지 않았다.
    await settle();
    expect(postCalls).toBe(0);
  });
});
