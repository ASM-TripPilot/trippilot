import { useState, type ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { retryUnlessNotFound } from '@/shared/api/isNotFound';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryMethodPage } from './ItineraryMethodPage';

/**
 * TRIP-986 #063 · BR-U3-18 — 일정이 없는 새 여행(GET itinerary 404)에서 "AI와 같이 짜기"를 눌러도
 * 교체 경고("기존 일정을 새로 만들어요")가 뜨지 않는다.
 *
 * 무엇을 보장하나:
 *  - 🔴 D1a 첫 404 응답이 온 직후 copick 를 누르면 확인 없이 필수 방문지(CO_PLAN)로 간다.
 *  - 🔴 D1b 404 는 다시 묻지 않는다 — 요청은 1회로 끝난다(재시도 동안의 '모름' 창이 없다).
 *  - 🟢 D2a 첫 응답 전(요청 진행 중)엔 여전히 확인이 뜬다(TRIP-504 경고-2 fail-safe 유지).
 *  - 🟢 D2b 404 가 아닌 오류(500)는 기본 재시도 3회를 그대로 한다("404 만" 끈다).
 *
 * 왜 이렇게 테스트하나: 이 결함은 react-query 의 **기본 재시도** 위에서만 생긴다. 404 를 재시도하는
 * 동안(1초·2초·4초 대기) `isPending` 이 true 로 남아 "아직 모르니 경고"가 7초간 켜진다. 리포 통합
 * 테스트 관례(`retry:false`)나 훅 목(`ItineraryMethodPage.integration.test.tsx`)은 404 를 즉시 오류로
 * 떨어뜨려 이 창을 원리적으로 못 만든다. 그래서 실 훅 + MSW + 운영과 같은 재시도 기본값을 쓴다.
 *
 * *(개념)* react-query 는 `retry` 를 안 주면 브라우저·앱 환경(`window` 있음)에서 3회, 서버 환경에서
 *   0회 재시도한다. jest-expo 에는 `window` 가 있어 운영과 같은 3회가 된다(02a §5 실측).
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
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';

/** GET itinerary 요청 횟수 — 재시도 여부를 요청 수로 본다. */
let hits = 0;

let client: QueryClient;
let unmount: (() => void) | undefined;

/**
 * 라이브러리 기본 재시도(3회) 클라이언트. `retry` 를 적지 않는다(★D-1) — D1·D2 는 **페이지 자신의**
 * 404 무재시도를 잰다(전역 기본값이 없어도 페이지 혼자 막는가). 앱 전역 기본값은 D3 의 `appLikeClient`.
 * `gcTime: 0` — 기본 5분 타이머가 테스트 뒤에도 프로세스를 붙잡지 않게(쿼리·뮤테이션 둘 다, ★D-5).
 */
function productionLikeClient(extra: { retryDelay?: number } = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, ...extra },
      mutations: { gcTime: 0 },
    },
  });
}

function renderPage(queryClient: QueryClient) {
  client = queryClient;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  const view = render(<ItineraryMethodPage tripId={TRIP_ID} />, {
    wrapper: Wrapper,
  });
  unmount = view.unmount;
}

function respondItinerary(status: 404 | 500 | 'never') {
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
      hits += 1;
      if (status === 'never') await delay('infinite');
      return new HttpResponse(null, {
        status: status === 'never' ? 200 : status,
      });
    })
  );
}

/** 실시계로 ms 만큼 흘린다 — 그 사이 react-query 알림(setTimeout 0)이 커밋된다(★D-3). */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  hits = 0;
  mockPush.mockClear();
  setAccessToken('valid-access');
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  client.clear();
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

describe('🔴 D1 · 새 여행(GET itinerary 404) — 교체 경고가 뜨지 않는다 (#063 · BR-U3-18)', () => {
  it('D1a 첫 404 응답 직후 "AI와 같이 짜기"를 누르면 확인 없이 필수 방문지(CO_PLAN)로 1회 간다', async () => {
    // 준비 — 일정 조회는 404(일정 없음), 재시도 기본값 그대로.
    respondItinerary(404);
    renderPage(productionLikeClient());
    await waitFor(() => expect(hits).toBe(1));
    // 첫 재시도 대기(1초)보다 한참 짧게 흘린다 — 재시도 중이면 아직 '모름' 창 안이다.
    await elapse(200);

    // 실행
    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    // 단언 — 확인 없음 + 짝: 실제로 다음 화면으로 갔다(버튼이 안 눌린 공허 통과 차단, ★D-4).
    expect(
      screen.queryByTestId('itinerary-method-regenerate-confirm')
    ).toBeNull();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/must-visits',
      params: { tripId: TRIP_ID, mode: 'CO_PLAN' },
    });
  });

  it('D1b 404 는 다시 묻지 않는다 — 첫 재시도 시각(1초)이 지나도 요청은 1회', async () => {
    respondItinerary(404);
    renderPage(productionLikeClient());
    await waitFor(() => expect(hits).toBe(1));

    await elapse(1300);

    expect(hits).toBe(1);
  });
});

describe('🟢 D2 · fail-safe 와 "404 만" 경계 (회귀 앵커)', () => {
  it('D2a 첫 응답이 오기 전(요청 진행 중)에 누르면 확인이 뜨고 이동하지 않는다 (TRIP-504 경고-2)', async () => {
    respondItinerary('never');
    renderPage(productionLikeClient());
    await waitFor(() => expect(hits).toBe(1));

    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    expect(
      screen.getByTestId('itinerary-method-regenerate-confirm')
    ).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('D2b 404 가 아닌 오류(500)는 기본 재시도 3회를 그대로 한다 — 요청 4회 (★D-6)', async () => {
    // 대기만 20ms 로 줄인다 — 여기선 "몇 번 묻는가"만 본다(★D-2: D1 에선 대기를 줄이면 안 된다).
    respondItinerary(500);
    renderPage(productionLikeClient({ retryDelay: 20 }));

    await waitFor(() => expect(hits).toBe(4));
    await elapse(100);

    expect(hits).toBe(4);
  });
});

// ── D3 · 같은 일정을 기본 옵션으로 조회하는 다른 화면이 함께 있을 때 (TRIP-986 5-c · 03b 경고-1) ──
//
// *(개념)* 관찰자(observer) — `useQuery` 를 부르는 컴포넌트 하나하나. 같은 키의 관찰자들은 요청 하나를
//   공유하고, 재시도 규칙은 **그 요청을 시작한 관찰자**의 것이 박힌다. 그래서 방식 선택에만 404 무재시도를
//   걸면, 홈·카드(기본 옵션)가 먼저 요청을 시작하거나(R1) 나중에 붙어 다시 요청하면(R2) 404 를 3번 다시
//   물어 약 7초 동안 교체 경고가 뜬다. 처방은 앱 전역 기본값 — 아래 클라이언트가 그 앱 설정을 흉내 낸다.

/** 앱(`app/_layout.tsx`)과 같은 전역 기본값 — 404 무재시도(`retryUnlessNotFound`). 대기는 기본(★D-2). */
function appLikeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, retry: retryUnlessNotFound },
      mutations: { gcTime: 0 },
    },
  });
}

/** 홈 `PlanningHome`·일정 탭 `TripCardContainer` 와 같은 모양의 관찰자 — 옵션 없이 같은 키를 조회한다. */
function DefaultObserver() {
  useGetTripsTripIdItinerary(TRIP_ID);
  return null;
}

let mountObserver: () => void = () => {};

function WithOtherObserver({ observerFirst }: { observerFirst: boolean }) {
  const [shown, setShown] = useState(observerFirst);
  mountObserver = () => setShown(true);
  return (
    <>
      {shown ? <DefaultObserver /> : null}
      <ItineraryMethodPage tripId={TRIP_ID} />
    </>
  );
}

function renderWithOtherObserver(observerFirst: boolean): void {
  client = appLikeClient();
  const queryClient = client;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  const view = render(<WithOtherObserver observerFirst={observerFirst} />, {
    wrapper: Wrapper,
  });
  unmount = view.unmount;
}

function expectCoPickWentThrough(): void {
  expect(
    screen.queryByTestId('itinerary-method-regenerate-confirm')
  ).toBeNull();
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/trips/[tripId]/itinerary/must-visits',
    params: { tripId: TRIP_ID, mode: 'CO_PLAN' },
  });
}

describe('🔴 D3 · 앱 기본값 클라이언트 — 다른 화면이 같은 일정을 조회해도 404 뒤 교체 경고 없음 (03b 경고-1)', () => {
  it('D3a (R1) 기본 옵션 관찰자가 먼저 요청을 시작해도, 첫 404 직후 copick 은 확인 없이 간다 · 404 재요청 없음', async () => {
    // 준비 — 홈처럼 기본 옵션 관찰자를 방식 선택보다 먼저 둔다(요청을 시작하는 쪽이 그 관찰자).
    respondItinerary(404);
    renderWithOtherObserver(true);
    await waitFor(() => expect(hits).toBe(1));
    await elapse(200);

    // 실행
    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    // 단언 — 확인 없음 + 실제 이동(★D-4 짝).
    expectCoPickWentThrough();
    // 단언 — 첫 재시도 시각(1초)이 지나도 404 를 다시 묻지 않았다.
    await elapse(1300);
    expect(hits).toBe(1);
  });

  it('D3b (R2) 404 로 정착한 뒤 기본 옵션 관찰자가 새로 붙어 다시 조회해도, 그 직후 copick 은 확인 없이 간다', async () => {
    // 준비 — 방식 선택 혼자 404 로 정착 → 다른 화면(기본 옵션) 마운트 → 그 화면이 다시 조회(2회째).
    respondItinerary(404);
    renderWithOtherObserver(false);
    await waitFor(() => expect(hits).toBe(1));
    await elapse(200);
    act(() => mountObserver());
    await waitFor(() => expect(hits).toBe(2));
    await elapse(200);

    // 실행
    fireEvent.press(screen.getByTestId('itinerary-method-copick'));

    // 단언
    expectCoPickWentThrough();
  });
});
