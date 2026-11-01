import { useState } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useGetTripsTripIdItinerary } from '@/shared/api/index.hooks';
import { retryUnlessNotFound } from '@/shared/api';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryMethodPage } from './ItineraryMethodPage';
import { routerSpies } from '@/test-support/expoRouterMock';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';
import { createRequestLog, serveItinerary } from '@/test-support/mswItinerary';
import {
  itinerary as itineraryFixture,
  trip as tripFixture,
} from '@/test-support/itineraryFixtures';
import type { Itinerary, Trip } from '@/shared/api/index.schemas';

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
 * 테스트 관례(`retry:false`)나 훅 목(옛 `ItineraryMethodPage.hookMock.test.tsx`)은 404 를 즉시 오류로
 * 떨어뜨려 이 창을 원리적으로 못 만든다. 그래서 실 훅 + MSW + 운영과 같은 재시도 기본값을 쓴다.
 *
 * *(개념)* react-query 는 `retry` 를 안 주면 브라우저·앱 환경(`window` 있음)에서 3회, 서버 환경에서
 *   0회 재시도한다. jest-expo 에는 `window` 가 있어 운영과 같은 3회가 된다(02a §5 실측).
 *
 * (TRIP-1150) 옛 이름 `ItineraryMethodPage.retry404.integration.test.tsx` — 내용은 그대로, 이 page 의 실 훅 + MSW
 * 통합 파일 이름을 받았다(옛 훅 목 파일은 2026-11-01 아래 M 절로 MSW 이관·삭제).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));

const { push: mockPush } = routerSpies;
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'replace', 'back'],
  })
);

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
  const view = render(<ItineraryMethodPage tripId={TRIP_ID} />, {
    wrapper: createWrapper(queryClient),
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
  const view = render(<WithOtherObserver observerFirst={observerFirst} />, {
    wrapper: createWrapper(client),
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

// ── M · 방식별 이동·재생성 확인·거점 링크 (옛 `ItineraryMethodPage.hookMock.test.tsx`, 2026-11-01 MSW 이관) ──
//
// 무엇을 보장하나(TRIP-454·460·504·1032·1011 C·1219 c):
//  - 완전AI → h05(must-visits, CO_PLAN 없음) · 직접 짜기 → h19(manual, `manual/add` 아님) · copick → h05(CO_PLAN).
//  - 기존 일정이 있으면 copick 은 재생성 확인부터(계속 = h05 CO_PLAN, 취소 = 머묾). 확인 전 진행 0.
//  - 이 여행이 생성 중(PARTIAL 또는 COMPLETE + 세션 id)이면 완전AI 도 확인부터, 문구는 "생성 중"이다.
//  - h04 는 어느 갈래에서도 생성 POST 를 쏘지 않는다(h09·h19 소유).
//  - 거점 링크: 0박이면 없다 · 있으면 /trips/[tripId]/bases 로 push(replace 아님).
//
// 3동작: 준비 = MSW 응답(일정·여행) → 실행 = 카드·확인 버튼을 누른다 → 단언 = 확인 얼굴·문구·이동·나간 요청.

const log = createRequestLog(server);
beforeAll(() => log.attach());
beforeEach(() => {
  log.reset();
  routerSpies.replace.mockClear();
});

const IN_PROGRESS_TITLE = '지금 만들고 있는 일정이 있어요';
const OVERWRITE_TITLE = '기존 일정을 새로 만들어요';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';

/** 기존 일정(days 있음). */
function existing(over: Partial<Itinerary> = {}): Itinerary {
  return itineraryFixture({ tripId: TRIP_ID, ...over });
}

/** 일정·여행 응답을 걸고 그린 뒤 두 조회가 끝날 때까지 기다린다. `itinerary: null` = 404(일정 없음). */
async function renderSettled({
  itinerary,
  trip,
}: {
  itinerary: Itinerary | null;
  /** 안 주면 1박 이상 기본 여행. `Response` 면 그대로(실패 = 여행을 모름). */
  trip?: Trip | Response;
}): Promise<void> {
  serveItinerary(server, {
    itinerary: () => itinerary ?? new HttpResponse(null, { status: 404 }),
    trip: () => trip ?? tripFixture({ tripId: TRIP_ID }),
    post: () => new HttpResponse(null, { status: 201 }),
  });
  renderPage(newTestQueryClient({ gcTime: 0 }));
  await waitFor(() => {
    expect(log.hitsFor('GET', '/itinerary')).toBe(1);
    expect(client.isFetching()).toBe(0);
  });
}

/** push 목적지를 형태(문자열/객체)와 무관하게 글자로 편다. */
function pushedTo(index = 0): string {
  const destination = mockPush.mock.calls[index][0] as unknown;
  return typeof destination === 'string'
    ? destination
    : JSON.stringify(destination);
}

function press(testID: string): void {
  fireEvent.press(screen.getByTestId(testID));
}

const CONFIRM = 'itinerary-method-regenerate-confirm';

afterEach(() => {
  // ★ 어느 갈래에서도 h04 는 생성 POST 를 쏘지 않는다(생성은 h09·h19 소유).
  expect(log.hitsFor('POST', '/itinerary')).toBe(0);
});

describe('🔴 M1 · 방식별 목적지 — 일정 없음(404)', () => {
  it('완전AI 는 must-visits 로 1회, CO_PLAN 없음 (TRIP-454)', async () => {
    await renderSettled({ itinerary: null });
    press('itinerary-method-fullai');

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/must-visits',
      params: { tripId: TRIP_ID },
    });
  });

  it('직접 짜기는 h19(manual)로 1회 — manual/add 아님, 준비 중 없음 (TRIP-460)', async () => {
    await renderSettled({ itinerary: null });
    press('itinerary-method-manual');

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/manual',
      params: { tripId: TRIP_ID },
    });
    expect(screen.queryByTestId('itinerary-method-soon')).toBeNull();
  });
});

describe('🔴 M2 · 기존 일정이 있으면 copick 은 재생성 확인부터 (TRIP-504 AC-1·AC-3 · BR-U3-18)', () => {
  it('copick → 확인이 뜨고 진행 0 → 계속 → must-visits(CO_PLAN)', async () => {
    await renderSettled({ itinerary: existing() });
    press('itinerary-method-copick');

    expect(screen.getByTestId(CONFIRM)).toBeOnTheScreen();
    expect(screen.getByText(OVERWRITE_TITLE)).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();

    press(`${CONFIRM}-continue`);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/must-visits',
      params: { tripId: TRIP_ID, mode: 'CO_PLAN' },
    });
  });

  it('copick → 취소 → 이동 0, 확인 닫힘', async () => {
    await renderSettled({ itinerary: existing() });
    press('itinerary-method-copick');
    press(`${CONFIRM}-cancel`);

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByTestId(CONFIRM)).toBeNull();
  });
});

describe('🔴 M3 · 이 여행이 생성 중이면 완전AI 도 확인부터 (TRIP-1032 AC-6)', () => {
  it('PARTIAL + 세션 → 완전AI 확인("생성 중" 문구·소요시간 없음) → 계속 → must-visits(CO_PLAN 없음)', async () => {
    await renderSettled({
      itinerary: existing({
        generationState: 'PARTIAL',
        generationSessionId: SESSION_ID,
      }),
    });
    press('itinerary-method-fullai');

    expect(screen.getByTestId(CONFIRM)).toBeOnTheScreen();
    expect(screen.getByText(IN_PROGRESS_TITLE)).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();
    // INV-3 — 확인 문구에 소요시간·진행률이 없다.
    expect(screen.queryByText(/\d+\s*(분|초|시간)|소요|%/)).toBeNull();

    // ★ 확인 카드는 하나인데 여는 방식이 둘 — 누른 방식(완전AI)대로 간다.
    press(`${CONFIRM}-continue`);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(pushedTo()).toContain('must-visits');
    expect(pushedTo()).not.toContain('CO_PLAN');
  });

  it('PARTIAL + 세션 → 완전AI → 취소 → 이동 0, 확인 닫힘', async () => {
    await renderSettled({
      itinerary: existing({
        generationState: 'PARTIAL',
        generationSessionId: SESSION_ID,
      }),
    });
    press('itinerary-method-fullai');
    press(`${CONFIRM}-cancel`);

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByTestId(CONFIRM)).toBeNull();
  });

  it('PARTIAL + 세션 → copick 확인은 "생성 중" 문구(덮어쓰기 문구 아님) → 계속 → CO_PLAN', async () => {
    await renderSettled({
      itinerary: existing({
        generationState: 'PARTIAL',
        generationSessionId: SESSION_ID,
      }),
    });
    press('itinerary-method-copick');

    expect(screen.getByText(IN_PROGRESS_TITLE)).toBeOnTheScreen();
    expect(screen.queryByText(OVERWRITE_TITLE)).toBeNull();

    press(`${CONFIRM}-continue`);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(pushedTo()).toContain('CO_PLAN');
  });

  it('COMPLETE + 세션 id(재생성 1차 구간)도 생성 중 — 완전AI 확인, 이동 0 (5-b 경고-3)', async () => {
    await renderSettled({
      itinerary: existing({ generationSessionId: 'sess-regen' }),
    });
    press('itinerary-method-fullai');

    expect(screen.getByText(IN_PROGRESS_TITLE)).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('🟢 세션 없는 PARTIAL — 완전AI 는 확인 없이 가고, copick 확인은 덮어쓰기 문구 (01b Q3)', async () => {
    await renderSettled({
      itinerary: existing({
        generationState: 'PARTIAL',
        generationSessionId: null,
      }),
    });
    press('itinerary-method-copick');
    expect(screen.getByText(OVERWRITE_TITLE)).toBeOnTheScreen();
    expect(screen.queryByText(IN_PROGRESS_TITLE)).toBeNull();
    press(`${CONFIRM}-cancel`);

    press('itinerary-method-fullai');
    expect(screen.queryByTestId(CONFIRM)).toBeNull();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(pushedTo()).toContain('must-visits');
  });

  it('🟢 COMPLETE(세션 없음) — 완전AI 는 확인 없이 곧장 (브리프 맹점 7)', async () => {
    await renderSettled({ itinerary: existing() });
    press('itinerary-method-fullai');

    expect(screen.queryByTestId(CONFIRM)).toBeNull();
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 M4 · 일정 조회 로딩 중이면 완전AI 도 fail-safe 로 확인 (TRIP-1032 AC-6)', () => {
  it('첫 응답 전 완전AI → 확인이 뜨고 이동 0', async () => {
    respondItinerary('never');
    renderPage(newTestQueryClient({ gcTime: 0 }));
    await waitFor(() => expect(hits).toBe(1));

    press('itinerary-method-fullai');

    expect(screen.getByTestId(CONFIRM)).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 M5 · 거점 숙소 다시 고르기 링크 (TRIP-1011 C · TRIP-1219 c)', () => {
  it('누르면 /trips/[tripId]/bases 로 push 1회 — replace 없음 · 기존 일정이 있어도 보인다', async () => {
    await renderSettled({ itinerary: existing() });

    press('itinerary-method-rebase');

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/bases',
      params: { tripId: TRIP_ID },
    });
    expect(routerSpies.replace).not.toHaveBeenCalled();
  });

  it('박수 합이 0(당일치기)이면 링크가 없다 — 화면은 떠 있다', async () => {
    await renderSettled({
      itinerary: null,
      trip: tripFixture({
        tripId: TRIP_ID,
        destinations: [{ seq: 1, region: '제주', nights: 0 }],
      }),
    });

    expect(screen.queryByTestId('itinerary-method-rebase')).toBeNull();
    expect(screen.getByTestId('itinerary-method-fullai')).toBeOnTheScreen();
  });

  it('여행 조회가 실패해(박수를 몰라) 링크는 그대로 보인다', async () => {
    await renderSettled({
      itinerary: null,
      trip: new HttpResponse(null, { status: 500 }),
    });

    expect(screen.getByTestId('itinerary-method-rebase')).toBeOnTheScreen();
  });

  it('여러 목적지 중 하나라도 1박 이상이면 링크가 보인다', async () => {
    await renderSettled({
      itinerary: null,
      trip: tripFixture({
        tripId: TRIP_ID,
        destinations: [
          { seq: 1, region: '제주', nights: 0 },
          { seq: 2, region: '부산', nights: 1 },
        ],
      }),
    });

    expect(screen.getByTestId('itinerary-method-rebase')).toBeOnTheScreen();
  });
});
