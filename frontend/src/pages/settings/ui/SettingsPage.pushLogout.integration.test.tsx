jest.mock('@/shared/api/generated/account/account');
jest.mock('@/shared/api/generated/profile/profile', () => ({
  ...jest.createMockFromModule<Record<string, unknown>>(
    '@/shared/api/generated/profile/profile'
  ),
  useGetMeSettings: jest.fn(),
  usePatchMeSettings: jest.fn(),
}));
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
import * as Notifications from 'expo-notifications';
import { http, HttpResponse } from 'msw';

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
import { getAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { registerPushToken } from '@/shared/push';
import { clearTokens, getTokens, saveTokens } from '@/shared/storage';
import { primeExpoToken, primeOsPermission } from '@/test-support/pushOsFake';

import { SettingsPage } from '..';

/**
 * TRIP-835 · AC-5 — 로그아웃하면 이 기기의 푸시 토큰을 해제한다(SEC-U6-02: 다음 사용자에게 이전 사용자의
 * 알림이 가지 않게).
 *
 * 무엇을 보장하나(사용자가 겪는 순서대로):
 *  - L1: 이번 세션에 등록한 토큰으로 `DELETE /me/push-tokens/{토큰}` 이 1번 나가고, 그 요청에 **아직 살아 있는
 *    로그인 헤더**(`Bearer access-A`)가 실린다 — 인증을 지우기 전에 출발했다는 뜻이다. 로그아웃은 종전대로
 *    `replace('/')` 로 끝난다.
 *  - L2: 해제가 500·404 로 실패해도 로그아웃은 똑같이 끝난다(토큰 삭제·이동·화면 생존).
 *  - L3: 해제 요청에 서버가 끝내 답하지 않아도 3초 상한 뒤 로그아웃이 끝난다(TRIP-938 "기다리지 않고 이동"과의
 *    절충, 01b Q3).
 *  - L4: 해제 응답이 오기 전에는 로그아웃(인증 삭제·이동)을 진행하지 않는다 — 기다린 뒤 끝낸다.
 *
 * 왜 실모듈+MSW 인가(02a ★14): "헤더가 실렸나"는 axios 인터셉터·tokenManager·logout 의 합작이다.
 *  `@/shared/push` 를 목하면 원리적으로 안 보인다. OS 권한·Expo 토큰만 가짜(`pushOsFake`)다.
 *
 * ★ 테스트마다 **다른 토큰**으로 등록한다(02a ★11) — 보관 토큰은 모듈 메모리라 파일 안에서 테스트끼리
 *   이어진다. DELETE 경로의 토큰이 이번 테스트 것인지 봐서 앞 테스트의 잔여 토큰이 나가면 걸리게 한다.
 * ★ 경로 토큰은 `decodeURIComponent` 로 비교한다(02a ★10) — 구현이 인코딩해도 틀린 게 아니다.
 *
 * ⚠️ jest 사각(6-b 실기): 실제 기기에서 토큰이 발급되는지(EAS projectId 선행), 서버 행이 실제로 지워지는지.
 *
 * 3동작 뼈대: 준비=로그인 상태 + 이번 세션 등록 + MSW → 실행=[로그아웃] → 확인 → 단언=DELETE·헤더·이동.
 */

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

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: mockReplace, back: jest.fn() },
}));

const BASE = 'http://localhost:8080/api/v1';

type DeleteSeen = {
  token: string;
  authorization: string | null;
  /** 요청이 MSW 에 도착한 순간의 메모리 access 토큰. */
  accessAtArrival: string | null;
};

let deletes: DeleteSeen[] = [];
let releaseGate: () => void = () => {};

/** POST(등록)는 늘 200, DELETE(해제)는 테스트가 정한 응답. */
function servePushTokens(respondDelete: () => Response | Promise<Response>) {
  server.use(
    http.post(`${BASE}/me/push-tokens`, () =>
      HttpResponse.json({
        platform: 'IOS',
        osPermission: 'GRANTED',
        deliverable: true,
      })
    ),
    http.delete(`${BASE}/me/push-tokens/:token`, ({ request, params }) => {
      deletes.push({
        token: decodeURIComponent(String(params.token)),
        authorization: request.headers.get('authorization'),
        accessAtArrival: getAccessToken(),
      });
      return respondDelete();
    }),
    http.post(
      `${BASE}/auth/logout`,
      () => new HttpResponse(null, { status: 204 })
    )
  );
}

/** 이번 세션에 이 토큰을 등록해 둔다(실 등록 경로 — 보관은 등록 성공이 만든다). */
async function registerThisSession(token: string): Promise<void> {
  primeOsPermission(Notifications, 'granted');
  primeExpoToken(Notifications, token);
  await registerPushToken();
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

function confirmLogout() {
  fireEvent.press(screen.getByTestId('settings-row-logout'));
  fireEvent.press(screen.getByTestId('logout-confirm-button'));
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(async () => {
  jest.clearAllMocks();
  deletes = [];

  // 준비(공통): 로그인 상태.
  await clearTokens();
  await saveTokens({ accessToken: 'access-A', refreshToken: 'refresh-A' });
  setAccessToken('access-A');

  (useGetMe as jest.Mock).mockReturnValue({
    data: { accountId: 'acc-1', status: 'ACTIVE', email: 'a@b.com' },
  });
  (useGetMeProfile as jest.Mock).mockReturnValue({
    data: { nickname: '여행자123' },
  });
  (useGetMePreferences as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMeLocationConsent as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMePersonalization as jest.Mock).mockReturnValue({ data: undefined });
  (useGetMeSettings as jest.Mock).mockReturnValue({ data: undefined });
  (usePatchMeSettings as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  });
});

afterEach(() => {
  releaseGate();
  server.resetHandlers();
});

afterAll(() => server.close());

describe('TRIP-835 AC-5 · 로그아웃 → 이 기기 토큰 해제', () => {
  it('L1 등록한 토큰으로 DELETE 1번, 로그인 헤더가 살아 있는 채로 출발하고, 로그아웃은 replace("/") 로 끝난다', async () => {
    // 준비
    servePushTokens(() => new HttpResponse(null, { status: 204 }));
    await registerThisSession('ExponentPushToken[L1]');
    renderPage();

    // 실행
    confirmLogout();

    // 단언: 로그아웃이 끝났다.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/');

    // 단언(급소): 해제 요청 1번, 이번 세션 토큰, 인증을 지우기 전에 출발.
    expect(deletes).toHaveLength(1);
    expect(deletes[0].token).toBe('ExponentPushToken[L1]');
    expect(deletes[0].authorization).toBe('Bearer access-A');
    expect(deletes[0].accessAtArrival).toBe('access-A');

    // 단언(최종 상태): 로그아웃은 종전대로 토큰을 비웠다.
    await expect(getTokens()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it.each([
    [500, 'ExponentPushToken[L2-500]'],
    [404, 'ExponentPushToken[L2-404]'],
  ])(
    'L2 해제가 %i 로 실패해도 로그아웃은 끝난다(토큰 삭제 · replace("/") · 화면 생존)',
    async (status, token) => {
      servePushTokens(() => new HttpResponse(null, { status }));
      await registerThisSession(token);
      renderPage();

      confirmLogout();

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
      expect(mockReplace).toHaveBeenCalledTimes(1);
      await expect(getTokens()).resolves.toBeNull();
      expect(getAccessToken()).toBeNull();
      expect(screen.getByTestId('settings-back')).toBeOnTheScreen();
    }
  );

  it('L3 해제 요청에 서버가 끝내 답하지 않아도 3초 상한 뒤 로그아웃이 끝난다', async () => {
    // 준비: 게이트를 풀기 전까지 DELETE 응답을 붙잡는 서버(02a ★12 — 실시간 3초).
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    servePushTokens(async () => {
      await gate;
      return new HttpResponse(null, { status: 204 });
    });
    await registerThisSession('ExponentPushToken[L3]');
    renderPage();

    // 실행
    confirmLogout();

    // 단언: 상한 안에서 로그아웃이 끝난다.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'), {
      timeout: 5000,
    });
    expect(getAccessToken()).toBeNull();
    // 단언: 해제 요청은 인증이 살아 있을 때 출발했다.
    expect(deletes).toHaveLength(1);
    expect(deletes[0].authorization).toBe('Bearer access-A');
  }, 10000);

  it('L4 해제 응답이 오기 전에는 로그아웃을 진행하지 않는다 — 응답이 오면 그때 끝난다', async () => {
    // 준비: 응답을 붙잡아 두는 서버. (jest 에선 기다리지 않고 쏴도 헤더는 실린다 — 02a ★6. 그래서
    // "기다리는가"는 헤더가 아니라 "응답 전엔 인증이 그대로인가"로 본다.)
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    servePushTokens(async () => {
      await gate;
      return new HttpResponse(null, { status: 204 });
    });
    await registerThisSession('ExponentPushToken[L4]');
    renderPage();

    // 실행
    confirmLogout();
    await waitFor(() => expect(deletes).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 단언: 해제가 아직 안 끝났으니 인증도 이동도 그대로다.
    expect(getAccessToken()).toBe('access-A');
    expect(mockReplace).not.toHaveBeenCalled();

    // 실행: 서버가 답한다.
    releaseGate();

    // 단언: 그제야 로그아웃이 끝난다.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(getAccessToken()).toBeNull();
  });
});
