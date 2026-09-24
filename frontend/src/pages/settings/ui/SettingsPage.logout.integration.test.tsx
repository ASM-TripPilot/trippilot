jest.mock('@/shared/api/generated/account/account');
jest.mock('@/shared/api/generated/profile/profile');

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';

import { server } from '@/mocks/server';
import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';
import { getAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { clearTokens, getTokens, saveTokens } from '@/shared/storage';

import { SettingsPage } from '..';

/**
 * TRIP-938 — 설정 로그아웃 흐름(페이지 배선, MSW 통합).
 *
 * 무엇을 보장하나(사용자가 겪는 순서대로):
 *  - AC-1·AC-4·AC-5: [로그아웃] 행 → 확인 다이얼로그 [로그아웃] 을 누르면 서버에 refresh 토큰을 실은
 *    폐기 요청이 1번 나가고, 기기·메모리 토큰과 이전 계정의 서버 데이터 캐시가 지워진 **뒤에**
 *    `router.replace('/')` 로 게이트에 넘긴다(`push` 아님 — 뒤로가기로 설정에 못 돌아온다).
 *  - AC-2: 서버가 실패해도 똑같이 지우고 이동한다. 화면은 죽지 않는다.
 *  - AC-3: [취소] 를 누르면 요청 0번, 토큰·캐시 그대로, 이동 없음.
 *  - 01 Q4: 서버가 느려도 기다리지 않고 바로 이동한다.
 *
 * 왜 페이지 층인가: "지우고 → 캐시 비우고 → 이동" 은 logout() 함수·QueryClient·라우터의 **합작**이다.
 *  함수 계약(바디·헤더·실패 삼킴)은 `shared/api/logout.integration.test.ts` 가 따로 잠근다.
 *
 * ★ 순서는 replace 목 안에서 본다(02a ★4): replace 가 불린 **그 순간**의 메모리 토큰·캐시 크기·
 *   저장소 조회를 잡아 둔다. 끝난 뒤에만 보면 "먼저 이동하고 나중에 지우는" 구현도 통과한다.
 *
 * ⚠️ jest 사각(6-b 실기 전용): 로그인 화면이 실제로 뜨는지(Stack.Protected 전환), 뒤로가기 제스처,
 *   다이얼로그 딤이 화면을 실제로 덮는지. 여기선 replace 인자·횟수와 호출 결과까지만 본다.
 *
 * 3동작 뼈대: 준비=로그인 상태(토큰·캐시)·MSW → 실행=행 press → 다이얼로그 버튼 press → 단언.
 *
 * *(개념)* `router.replace(경로)`: 지금 화면을 새 화면으로 **바꿔 끼운다**. `push` 는 위에 쌓아
 *  뒤로가기로 돌아올 수 있지만, replace 는 지금 화면이 기록에서 사라진다.
 * *(개념)* `queryClient.clear()`: 앱 전역의 서버 데이터 캐시를 통째로 비운다 — 다음 계정 첫 화면에
 *  이전 계정 닉네임이 잠깐 보이는 것을 막는다(01 Q5).
 */

// secure-store 만 메모리 Map — 실제 shared/storage 를 태운다(02a ★6). Map 은 팩토리 안에서 만든다.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      store.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      store.delete(key);
    },
  };
});

const mockPush = jest.fn();
const mockReplace = jest.fn();

// SettingsPage 는 press 시점에 require('expo-router').router 를 읽는다(loadRouter) — 싱글턴 형태 목.
jest.mock('expo-router', () => ({
  router: { push: mockPush, replace: mockReplace, back: jest.fn() },
}));

const mockUseGetMe = useGetMe as jest.Mock;
const mockUseGetMeProfile = useGetMeProfile as jest.Mock;

const BASE = 'http://localhost:8080/api/v1';
const LOGOUT_PATH = '/api/v1/auth/logout';
/** 이전 계정의 캐시 1건 — 로그아웃 뒤 남으면 다음 계정 화면에 샌다. */
const CACHED_KEY = ['/api/v1/me/profile'];

let received: { authorization: string | null; body: unknown }[] = [];
/** 나간 로그아웃 요청 수(핸들러 도달 전에 센다 — 취소 시 0 판정용, 02a ★7). */
let started = 0;
/** 끝난 로그아웃 요청 수(응답·네트워크 실패 모두 — 02a ★2). */
let ended = 0;
let releaseGate: () => void = () => {};
let queryClient: QueryClient;

/** replace 가 불린 순간의 상태(02a ★4). */
let atReplace: {
  accessToken: string | null;
  cacheSize: number;
  stored: Promise<unknown>;
} | null = null;

function captureLogout(respond: () => Response | Promise<Response>) {
  server.use(
    http.post(`${BASE}/auth/logout`, async ({ request }) => {
      received.push({
        authorization: request.headers.get('authorization'),
        body: await request.json().catch(() => null),
      });
      return respond();
    })
  );
}

async function settle() {
  await waitFor(() => expect(ended).toBe(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

/** 설정 → [로그아웃] 행 → 확인 다이얼로그의 [로그아웃]. */
function confirmLogout() {
  fireEvent.press(screen.getByTestId('settings-row-logout'));
  fireEvent.press(screen.getByTestId('logout-confirm-button'));
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    if (new URL(request.url).pathname === LOGOUT_PATH) started += 1;
  });
  server.events.on('request:end', ({ request }) => {
    if (new URL(request.url).pathname === LOGOUT_PATH) ended += 1;
  });
});

beforeEach(async () => {
  jest.clearAllMocks();
  received = [];
  started = 0;
  ended = 0;
  atReplace = null;

  // 준비(공통): 로그인 상태 — 기기 저장소 토큰 쌍 + 메모리 access + 이전 계정 캐시 1건.
  await clearTokens();
  await saveTokens({ accessToken: 'access-A', refreshToken: 'refresh-A' });
  setAccessToken('access-A');
  queryClient = new QueryClient();
  queryClient.setQueryData(CACHED_KEY, { nickname: '이전계정' });

  // 렌더가 역참조하는 조회 2훅만 프라임한다(nav.test 선례).
  mockUseGetMe.mockReturnValue({
    data: { accountId: 'acc-1', status: 'ACTIVE', email: 'a@b.com' },
  });
  mockUseGetMeProfile.mockReturnValue({ data: { nickname: '여행자123' } });

  mockReplace.mockImplementation(() => {
    atReplace = {
      accessToken: getAccessToken(),
      cacheSize: queryClient.getQueryCache().getAll().length,
      stored: getTokens(),
    };
  });
});

afterEach(() => {
  releaseGate();
  server.resetHandlers();
  queryClient.clear();
});

afterAll(() => server.close());

describe('TRIP-938 · 로그아웃 확인 (AC-1 · AC-4 · AC-5)', () => {
  it('G1 확인하면 refresh 토큰을 실은 폐기 요청 1번 → 토큰·캐시 삭제 → replace("/") 1번, push 0번', async () => {
    captureLogout(() => new HttpResponse(null, { status: 204 }));
    renderPage();

    // 실행
    confirmLogout();

    // 단언: 게이트로 넘기는 이동이 정확히 1번, 인자는 '/'(02a ★3). 쌓는 이동은 없다(AC-4).
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockPush).not.toHaveBeenCalled();

    // 단언(순서 · 02a ★4): 이동하는 순간 이미 메모리 토큰·캐시·저장소가 비어 있었다.
    expect(atReplace?.accessToken).toBeNull();
    expect(atReplace?.cacheSize).toBe(0);
    await expect(atReplace?.stored).resolves.toBeNull();

    // 단언(서버): 요청 1번, 바디 = 저장돼 있던 refresh, 헤더 없음(02a ★1·★12).
    await settle();
    expect(started).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0].body).toEqual({ refreshToken: 'refresh-A' });
    expect(received[0].authorization).toBeNull();

    // 단언(최종 상태): 토큰·캐시 모두 비었다.
    await expect(getTokens()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(queryClient.getQueryData(CACHED_KEY)).toBeUndefined();
  });
});

describe('TRIP-938 · 서버가 실패해도 로그아웃 (AC-2)', () => {
  it('G2 서버 500 이어도 토큰을 지우고 replace("/") 로 이동하며, 화면이 죽지 않는다', async () => {
    captureLogout(() => new HttpResponse(null, { status: 500 }));
    renderPage();

    confirmLogout();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/');
    // 요청이 끝날 때까지 기다린다 — 처리 안 된 실패가 있으면 jest 가 여기서 FAIL 시킨다(02a ★2).
    await settle();

    // 단언: 사용자 의도 우선 — 토큰은 지워졌다.
    await expect(getTokens()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
    // 단언: 에러가 화면을 죽이지 않았다(설정 화면 헤더가 그대로 있다).
    expect(screen.getByTestId('settings-back')).toBeOnTheScreen();
  });
});

describe('TRIP-938 · 취소하면 아무 일도 없다 (AC-3)', () => {
  it('G3 [취소] 면 요청 0번 · 토큰·캐시 유지 · 이동 0번 · 다이얼로그 닫힘', async () => {
    captureLogout(() => new HttpResponse(null, { status: 204 }));
    renderPage();

    // 실행: 행 → 다이얼로그 → [취소].
    fireEvent.press(screen.getByTestId('settings-row-logout'));
    fireEvent.press(screen.getByTestId('logout-cancel'));
    // 저장소 await 뒤에야 나가는 요청이 있다면 드러나도록 흘린다(02a ★7).
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 단언(급소): 서버에 아무것도 안 나갔다(같은 카운터가 G1 에서 1 을 센다).
    expect(started).toBe(0);
    // 단언: 로그인 상태 그대로.
    await expect(getTokens()).resolves.toEqual({
      accessToken: 'access-A',
      refreshToken: 'refresh-A',
    });
    expect(getAccessToken()).toBe('access-A');
    expect(queryClient.getQueryData(CACHED_KEY)).toEqual({
      nickname: '이전계정',
    });
    // 단언: 이동 없음 + 다이얼로그 닫힘.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByTestId('logout-confirm')).toBeNull();
  });
});

describe('TRIP-938 · 느린 서버를 기다리지 않는다 (01 Q4)', () => {
  it('G4 서버가 응답하기 전에 토큰을 지우고 replace("/") 로 이동한다', async () => {
    // 준비: 게이트를 풀기 전까지 응답을 보류하는 서버.
    let responded = false;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    captureLogout(async () => {
      await gate;
      responded = true;
      return new HttpResponse(null, { status: 204 });
    });
    renderPage();

    confirmLogout();

    // 단언(급소): 응답을 기다리는 구현이면 replace 가 안 불려 waitFor 가 타임아웃한다.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(responded).toBe(false);
    expect(getAccessToken()).toBeNull();
    await expect(getTokens()).resolves.toBeNull();

    // 정리: 게이트를 풀고 요청이 끝날 때까지 기다린다(02a ★13).
    releaseGate();
    await settle();
    expect(responded).toBe(true);
  });
});
