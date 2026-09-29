jest.mock('@/shared/api/generated/account/account');
// TRIP-778: profile 은 팩토리 목 — codegen(D1) 전엔 `useGetMeSettings`·`usePatchMeSettings` 가 생성물에
// 없어 자동 목이 이름을 모른다. 기존 export 는 자동 목 그대로 두고 두 이름만 목 함수로 채운다(02a ★2).
jest.mock('@/shared/api/generated/profile/profile', () => ({
  ...jest.createMockFromModule<Record<string, unknown>>(
    '@/shared/api/generated/profile/profile'
  ),
  useGetMeSettings: jest.fn(),
  usePatchMeSettings: jest.fn(),
}));
// TRIP-778: 페이지가 새로 읽는 조회 3종(취향·위치 동의·개인화) — 실 훅이 네트워크로 나가지 않게 자동 목.
jest.mock('@/shared/api/generated/preferences/preferences');
jest.mock('@/shared/api/generated/location/location');
jest.mock('@/shared/api/generated/reflection/reflection');

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';

import {
  publishGateDestination,
  resetGateDestination,
} from '@/features/auth/model/gateDestination';
import { server } from '@/mocks/server';
import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeLocationConsent } from '@/shared/api/generated/location/location';
import { useGetMePreferences } from '@/shared/api/generated/preferences/preferences';
import {
  useGetMeProfile,
  useGetMeSettings,
  usePatchMeSettings,
} from '@/shared/api/generated/profile/profile';
import { useGetMePersonalization } from '@/shared/api/generated/reflection/reflection';
import {
  getAccessToken,
  setAccessToken,
  subscribeAccessToken,
} from '@/shared/api/tokenManager';
import { clearTokens, getTokens, saveTokens } from '@/shared/storage';

import { SettingsPage } from '..';

/**
 * TRIP-938 — 설정 로그아웃 흐름(페이지 배선, MSW 통합). TRIP-1034 로 이동 계약이 바뀌었다.
 *
 * 무엇을 보장하나(사용자가 겪는 순서대로):
 *  - AC-1·AC-4·AC-5: [로그아웃] 행 → 확인 다이얼로그 [로그아웃] 을 누르면 서버에 refresh 토큰을 실은
 *    폐기 요청이 1번 나가고, 기기·메모리 토큰과 이전 계정의 서버 데이터 캐시가 지워진 **뒤에**
 *    `router.replace('/login')` 로 간다(`push` 아님 — 뒤로가기로 설정에 못 돌아온다).
 *  - TRIP-1034 AC-4: 그 이동은 게이트가 LOGIN 을 공개한 **뒤에만** 일어난다. 설정은 어느 가드에도 속하지
 *    않아서, 게이트가 `(auth)` 를 열기 전에 이동하면 무시되고 설정에 갇힌다(옛 `replace('/')` 결함).
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
 * ★ 가짜 게이트(TRIP-1034): 이 파일엔 SplashGate 가 없다. 토큰이 비면 LOGIN 을 공개하는 구독으로 게이트의
 *   재조회를 흉내 낸다 — 기본은 '나중에'(실제 재조회처럼), G6 은 '대기 전에 이미'. 게이트가 **실제로**
 *   공개하는지는 `useBootstrapGate.test.tsx` B1·B2 가 잠근다(02a ★1).
 *
 * 3동작 뼈대: 준비=로그인 상태(토큰·캐시·게이트 HOME)·MSW → 실행=행 press → 다이얼로그 버튼 press → 단언.
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
let stopFakeGate: () => void = () => {};

/**
 * 게이트의 재조회를 흉내 낸다 — 메모리 토큰이 비면 LOGIN 을 공개한다.
 * 'after-wait': 한 턴 뒤(실제 재조회처럼 대기가 먼저 시작된다). 'before-wait': 즉시(대기 전에 이미 LOGIN).
 */
function startFakeGate(timing: 'after-wait' | 'before-wait' = 'after-wait') {
  stopFakeGate = subscribeAccessToken((token) => {
    if (token !== null) return;
    if (timing === 'before-wait') publishGateDestination('LOGIN');
    else setTimeout(() => publishGateDestination('LOGIN'), 0);
  });
}

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

/**
 * TRIP-778 — 페이지가 새로 부르는 조회 4종·변경 1종을 "응답 전" 모양으로 채운다. 자동 목은 `undefined` 를
 * 돌려줘 페이지가 `.data` 에서 죽으므로 이 파일의 관심사와 무관해도 채워야 한다(02a ★2).
 */
function primeL05Hooks(): void {
  (useGetMePreferences as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMeLocationConsent as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMePersonalization as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMeSettings as jest.Mock).mockReturnValue({ data: undefined });
  (usePatchMeSettings as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  });
}

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
  primeL05Hooks();
  // 로그인 상태의 게이트는 HOME 이다(출발점 고정 — 02a ★5).
  publishGateDestination('HOME');

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
  // 모듈 싱글턴 두 개(토큰 구독·게이트 목적지)를 파일 최상위에서 비운다(02a ★5·★6).
  stopFakeGate();
  resetGateDestination();
});

afterAll(() => server.close());

describe('TRIP-938 · 로그아웃 확인 (AC-1 · AC-4 · AC-5)', () => {
  it('G1 확인하면 refresh 토큰을 실은 폐기 요청 1번 → 토큰·캐시 삭제 → 게이트가 LOGIN 이 되면 replace("/login") 1번, push 0번', async () => {
    captureLogout(() => new HttpResponse(null, { status: 204 }));
    startFakeGate();
    renderPage();

    // 실행
    confirmLogout();

    // 단언: 로그인 화면으로 바꿔 끼우는 이동이 정확히 1번(TRIP-1034). 닫힌 탭('/')으로는 안 간다.
    // 쌓는 이동은 없다(AC-4).
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/login');
    expect(mockReplace).not.toHaveBeenCalledWith('/');
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
  it('G2 서버 500 이어도 토큰을 지우고 replace("/login") 로 이동하며, 화면이 죽지 않는다', async () => {
    captureLogout(() => new HttpResponse(null, { status: 500 }));
    startFakeGate();
    renderPage();

    confirmLogout();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/login');
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
    startFakeGate();
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
  it('G4 서버가 응답하기 전에 토큰을 지우고 replace("/login") 로 이동한다', async () => {
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
    startFakeGate();
    renderPage();

    confirmLogout();

    // 단언(급소): 응답을 기다리는 구현이면 replace 가 안 불려 waitFor 가 타임아웃한다.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(responded).toBe(false);
    expect(getAccessToken()).toBeNull();
    await expect(getTokens()).resolves.toBeNull();

    // 정리: 게이트를 풀고 요청이 끝날 때까지 기다린다(02a ★13).
    releaseGate();
    await settle();
    expect(responded).toBe(true);
  });
});

describe('TRIP-1034 · 게이트가 LOGIN 을 공개한 뒤에만 이동한다 (AC-4 · AC-3)', () => {
  it('G5 로그아웃이 끝나도 게이트가 아직 HOME 이면 이동하지 않고, LOGIN 이 공개되면 그때 replace("/login") 1번', async () => {
    // 준비: 가짜 게이트 없음 — 게이트 목적지는 HOME 에 머문다.
    captureLogout(() => new HttpResponse(null, { status: 204 }));
    renderPage();

    // 실행 ①: 확인 → 로그아웃 요청이 끝나고 줄 선 처리를 흘려 보낸다(02a ★7).
    confirmLogout();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 단언 ①(급소): 토큰은 이미 지워졌지만 게이트가 LOGIN 이 아니니 아무 데로도 가지 않았다.
    expect(getAccessToken()).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
    // 단언 ①(01b Q3): 캐시는 대기가 끝난 뒤에 비운다 — 아직 이전 계정 캐시가 있다.
    expect(queryClient.getQueryData(CACHED_KEY)).toEqual({
      nickname: '이전계정',
    });

    // 실행 ②: 게이트가 재조회를 마치고 LOGIN 을 공개한다.
    publishGateDestination('LOGIN');

    // 단언 ②: 그제야 로그인 화면으로 1번 이동하고, 그 순간 캐시는 비어 있다.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/login');
    expect(mockReplace).not.toHaveBeenCalledWith('/');
    expect(atReplace?.cacheSize).toBe(0);
  });

  it('G6 대기를 시작하기 전에 게이트가 이미 LOGIN 을 공개했어도 replace("/login") 1번', async () => {
    // 준비: 토큰이 비는 즉시 LOGIN 을 공개하는 게이트(재조회가 먼저 끝난 경우 — 02a ★2).
    captureLogout(() => new HttpResponse(null, { status: 204 }));
    startFakeGate('before-wait');
    renderPage();

    // 실행
    confirmLogout();

    // 단언: 이미 LOGIN 이라도 놓치지 않고 이동한다.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/login');
    await settle();
  });
});
