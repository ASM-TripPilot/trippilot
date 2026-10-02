import * as Notifications from 'expo-notifications';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { server } from '@/mocks/server';
import {
  clearAccessToken,
  setAccessToken,
  getAccessToken,
  subscribeAccessToken,
} from '@/shared/api/tokenManager';
import { SettingsPage } from '..';
import {
  publishGateDestination,
  resetGateDestination,
} from '@/features/auth/model/gateDestination';
import { useGetMe } from '@/shared/api/index.hooks';
import { useGetMeLocationConsent } from '@/shared/api/index.hooks';
import { useGetMePreferences } from '@/shared/api/index.hooks';
import {
  useGetMeProfile,
  useGetMeSettings,
  usePatchMeSettings,
} from '@/shared/api/index.hooks';
import { useGetMePersonalization } from '@/shared/api/index.hooks';
import { clearTokens, getTokens, saveTokens } from '@/shared/storage';
import { registerPushToken } from '@/shared/push';
import { primeExpoToken, primeOsPermission } from '@/test-support/pushOsFake';

/**
 * l05 설정 — SettingsPage 배선 통합 테스트(msw 로 실제 나간 요청을 본다).
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `SettingsPage.{l05parity,logout,pushLogout}.integration.test.tsx` 3개를
 * 각자의 바깥 describe 하나로 옮겼다. 파일 전체에 걸리는 것만 여기 둔다:
 *  - **생성 훅 스위치(`realHooksOn`)** — 옛 `.logout`·`.pushLogout` 은 생성 훅 5모듈(account·profile·preferences·
 *    location·reflection)을 자동 목하고 `mockReturnValue` 로 값을 줬고, 옛 `.l05parity` 는 실 훅으로 msw 와 왕복했다.
 *    `jest.mock` 은 파일 전체에 걸리므로 5모듈을 자동 목으로 두고, 최상위 `beforeEach` 가 각 목 함수의 구현을
 *    "스위치가 켜져 있으면 실물에 위임, 아니면 undefined(자동 목과 같다)"로 다시 건다. 실 훅 관점만 스위치를 켠다.
 *    다시 거는 이유: `jest.clearAllMocks` 는 `mockReturnValue` 를 안 지워 앞 관점의 응답이 실 훅 관점으로 샌다.
 *  - 토큰 저장소는 `expo-secure-store` 를 Map 으로 바꾼 실 `@/shared/storage` 하나로 통일했다(옛 `.l05parity` 의
 *    배럴 목은 401 재발급을 안 타 값이 쓰이지 않았다).
 *  - msw listen/close 와 모듈 싱글턴 리셋(메모리 토큰·게이트 목적지·스위치)은 최상위 훅이 한다.
 *  - ⚠️ `@/shared/push` 의 보관 토큰(`storedToken`)은 리셋 수단이 없는 모듈 변수다. 옛 `.pushLogout` 의 각 테스트가
 *    등록한 토큰을 로그아웃으로 소비하는 지금 모양에 기댄다 — 그 관점 테스트가 중간에 실패하면 다음 로그아웃이
 *    예상 밖 `DELETE /me/push-tokens/…` 를 낸다(msw 미처리 요청은 단언을 안 깨므로 조용하다).
 */

jest.mock('@/shared/api/generated/account/account');
jest.mock('@/shared/api/generated/profile/profile');
jest.mock('@/shared/api/generated/preferences/preferences');
jest.mock('@/shared/api/generated/location/location');
jest.mock('@/shared/api/generated/reflection/reflection');

// 기기 저장소 대신 메모리 Map — 실 @/shared/storage(토큰 쌍 저장·삭제)가 그대로 돈다.
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

// SettingsPage 는 누르는 순간 require('expo-router').router 를 읽는다(loadRouter) — 싱글턴 형태 목.
// 옛 3개 목은 모두 push·replace·back 셋을 줬다(넓어지지 않음).
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: jest.fn(),
  },
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
}));

const SWITCHED_HOOK_MODULES = [
  '@/shared/api/generated/account/account',
  '@/shared/api/generated/profile/profile',
  '@/shared/api/generated/preferences/preferences',
  '@/shared/api/generated/location/location',
  '@/shared/api/generated/reflection/reflection',
];
/** 실 훅 관점(옛 .l05parity)만 켠다. 꺼져 있으면 목 함수는 자동 목처럼 undefined 를 돌려준다. */
let realHooksOn = false;

function installHookSwitch(): void {
  for (const modulePath of SWITCHED_HOOK_MODULES) {
    const mocked = jest.requireMock<Record<string, unknown>>(modulePath);
    const actual = jest.requireActual<Record<string, unknown>>(modulePath);
    for (const [name, fn] of Object.entries(mocked)) {
      if (!jest.isMockFunction(fn)) continue;
      const real = actual[name] as (...args: unknown[]) => unknown;
      fn.mockReset();
      fn.mockImplementation((...args: unknown[]) =>
        realHooksOn ? real(...args) : undefined
      );
    }
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  installHookSwitch();
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  resetGateDestination();
  realHooksOn = false;
});
afterAll(() => server.close());

// TRIP-778 · TRIP-1017 · TRIP-1051
describe('실 훅 · 서버 값 ↔ 행·토글 (옛 .l05parity)', () => {
  /**
   * TRIP-778 — l05 설정 페이지 배선(MSW 통합 · 실 훅 · 실 QueryClient).
   *
   * 무엇을 보장하나:
   *  - AC-4·5·6(배선): 서버 값(취향·위치 동의·개인화)이 페이지를 거쳐 화면의 행 값·칩으로 실제로 도착한다.
   *    화면 테스트는 props 를 직접 넣으므로, "페이지가 값을 안 넘긴다"는 이 층에서만 잡힌다.
   *    취향은 TRIP-1051 로 한 행 `N/7 설정됨` 이다(W1). 취향 GET 이 실패하면 값을 비운다(W3 — 0/7 금지).
   *  - AC-9: 제휴 토글 ↔ `/me/settings.affiliateNoticeDismissed` 서버 왕복. **토글 의미가 반대다** — 라벨이
   *    "다시 **보기**"라 ON = `dismissed:false` 다(01 맹점 ①). 그래서 누를 때 나가는 와이어 본문의 **값 방향을
   *    양쪽으로** 잠근다(T1 false→true, T2 true→false). 본문은 그 한 필드뿐이다("생략 = 변경 없음", 맹점 ③).
   *  - D7: 값을 받기 전·조회 실패면 토글을 못 누른다 / 누르면 바로 바뀐다(낙관) / PATCH 실패면 원래 값으로
   *    돌아가고 행 아래 안내가 뜬다.
   *  - AC-11(한 진실)은 두 페이지를 함께 띄워야 해서(pages 형제 import 금지 린트) 별 파일
   *    `src/__tests__/affiliateNoticeOneTruth.integration.test.tsx` 가 잠근다.
   *
   * 왜 MSW 통합인가(02a §2-5): 생성 훅(`useGetMeSettings`·`usePatchMeSettings`)은 D1 부분 codegen 전엔
   *  없다. 와이어(HTTP)로만 관찰하면 훅 이름과 무관하게 **단언으로** red/green 이 갈린다. 본문도 axios 가
   *  어댑터 안에서 직렬화하므로 최종 모양은 MSW 만 본다.
   *
   * 3동작 뼈대: 준비(서버 상태·핸들러) → 실행(렌더·토글·예약하기) → 단언(와이어 본문·토글 상태·시트 유무).
   *
   * ⚠️ jest 사각: 실제 백엔드 `/me/settings` 배포·실기 왕복은 6-b 몫(01 맹점 ⑨). 화면 전환 자체도 못 본다.
   *
   * (개념) `toEqual([{…}])` — 배열 전체 완전일치라 "몇 번 나갔나 + 어떤 필드가 + 어떤 값으로"를 한 번에 본다.
   * (개념) 상태형 핸들러 — PATCH 가 서버 변수를 바꾸고 GET 이 그 변수를 읽는다. 재진입 왕복을 흉내 낸다.
   */

  const BASE = `${
    process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
  }/api/v1`;

  const ERROR_COPY = '설정을 바꾸지 못했어요. 다시 시도해 주세요.';
  /** D5 픽스처 — 예산만 미설정(축 없음). */
  const PREFERENCES = {
    styles: { value: ['휴양', '자연'], isNeutralDefault: false },
    companion: {
      companionTypes: ['친구'],
      petFlag: false,
      isNeutralDefault: false,
    },
    activities: { value: ['맛집투어', '전시'], isNeutralDefault: false },
    transportModes: { value: ['대중교통'], isNeutralDefault: false },
    foodTastes: { value: ['일식'], isNeutralDefault: false },
    pace: { value: '느긋하게', isNeutralDefault: false },
  };

  // ── 서버 상태 ─────────────────────────────────────────────────────────────
  let serverDismissed = false;
  let patchBodies: unknown[] = [];
  let started = 0;
  let ended = 0;
  let settingsGets = 0;
  let queryClient: QueryClient;

  /** 설정 페이지가 읽는 조회 6종(+PATCH). 케이스마다 server.use 로 덮는다. */
  function installServer(opts: {
    legalConsent?: boolean;
    reason?: 'APPLIED' | 'CONSENT_MISSING' | 'NOT_ENOUGH_RECORDS';
  }): void {
    server.use(
      http.get(`${BASE}/me`, () =>
        HttpResponse.json({
          accountId: 'acc-1',
          status: 'ACTIVE',
          email: 'a@b.com',
          socialProviders: ['KAKAO'],
          onboardingCompleted: true,
        })
      ),
      http.get(`${BASE}/me/profile`, () =>
        HttpResponse.json({ nickname: '여행자123' })
      ),
      http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCES)),
      http.get(`${BASE}/me/location-consent`, () =>
        HttpResponse.json({
          osPermissionMirror: 'GRANTED',
          legalConsent: opts.legalConsent ?? true,
          gpsRecordingOptIn: opts.legalConsent ?? true,
        })
      ),
      http.get(`${BASE}/me/personalization`, () =>
        HttpResponse.json({
          applied: opts.reason === 'APPLIED',
          reason: opts.reason ?? 'APPLIED',
          sharedItems: [],
        })
      ),
      http.get(`${BASE}/me/settings`, () => {
        settingsGets += 1;
        return HttpResponse.json({ affiliateNoticeDismissed: serverDismissed });
      }),
      http.patch(`${BASE}/me/settings`, async ({ request }) => {
        const body = (await request.json()) as {
          affiliateNoticeDismissed?: boolean | null;
        };
        patchBodies.push(body);
        if (typeof body.affiliateNoticeDismissed === 'boolean') {
          serverDismissed = body.affiliateNoticeDismissed;
        }
        return HttpResponse.json({ affiliateNoticeDismissed: serverDismissed });
      })
    );
  }

  function newClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  }

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  function renderPage() {
    return render(<SettingsPage />, { wrapper });
  }

  /** 시작한 요청이 모두 끝나고 그 결과가 화면에 반영될 때까지 흘린다(★8 — 재조회 경주 종료). */
  async function settleNetwork(): Promise<void> {
    await waitFor(() => expect(ended).toBe(started));
    await act(async () => {});
  }

  const toggle = () => screen.getByTestId('settings-affiliate-toggle');

  /** 토글이 서버 값을 받아 누를 수 있게 될 때까지 기다린다. */
  async function waitToggleReady(): Promise<void> {
    await waitFor(() => expect(toggle()).not.toBeDisabled());
  }

  function onRequestStart(): void {
    started += 1;
  }
  function onRequestEnd(): void {
    ended += 1;
  }

  beforeAll(() => {
    server.events.on('request:start', onRequestStart);
    server.events.on('request:end', onRequestEnd);
  });
  afterAll(() => {
    server.events.removeListener('request:start', onRequestStart);
    server.events.removeListener('request:end', onRequestEnd);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    realHooksOn = true;
    serverDismissed = false;
    patchBodies = [];
    started = 0;
    ended = 0;
    settingsGets = 0;
    queryClient = newClient();
    setAccessToken('valid-access');
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
    queryClient.clear();
  });

  describe('TRIP-778 AC-4·5·6 · 서버 값이 행 값·칩으로 도착한다 (페이지 배선)', () => {
    it('W1 취향 한 행 "6/7 설정됨"·위치 동의 칩·개인화 사용 중', async () => {
      // 준비 — D5 픽스처(예산만 미설정 → 6/7).
      installServer({ legalConsent: true, reason: 'APPLIED' });

      // 실행
      renderPage();

      // 단언 — 값 도착 뒤의 행 표면(완전일치 · 행 안). 첫 렌더엔 취향이 아직 없어 값이 비어 있으므로
      // 도착할 때까지 기다린다(02a ★13).
      // 합친 뒤 이 테스트가 파일 첫 테스트라 냉시작(모듈 첫 로드)을 흡수한다 — CI 에서 기본 1000ms 를
      // 넘겨 첫 테스트만 red 가 나는 일이 합친 통합 파일마다 반복됐다(TRIP-1144 SavedPlacesPage 선례).
      await waitFor(
        () =>
          expect(
            within(screen.getByTestId('settings-nav-preferences')).getByText(
              '6/7 설정됨'
            )
          ).toBeOnTheScreen(),
        { timeout: 5000 }
      );
      // 옛 예산 칩은 없다(TRIP-1051 AC-5).
      expect(screen.queryByTestId('settings-chip-budget')).toBeNull();
      await waitFor(() =>
        expect(
          within(
            screen.getByTestId('settings-chip-location-consent')
          ).getByText('동의')
        ).toBeOnTheScreen()
      );
      await waitFor(() =>
        expect(
          within(screen.getByTestId('settings-nav-personalization')).getByText(
            '사용 중'
          )
        ).toBeOnTheScreen()
      );
    });

    it('W2 미동의·개인화 미동의면 "미동의" 칩이고 "사용 중"은 없다(행은 그대로)', async () => {
      installServer({ legalConsent: false, reason: 'CONSENT_MISSING' });

      renderPage();

      await waitFor(() =>
        expect(
          within(
            screen.getByTestId('settings-chip-location-consent')
          ).getByText('미동의')
        ).toBeOnTheScreen()
      );
      await settleNetwork();
      // 긍정 앵커 — 개인화 행은 있다.
      const personalization = screen.getByTestId(
        'settings-nav-personalization'
      );
      expect(within(personalization).queryByText('사용 중')).toBeNull();
    });
  });

  /**
   * TRIP-1051 AC-3(실패) — 취향 GET 이 500 이면 행은 남고 "N/7"을 지어내지 않는다.
   *
   * ★ 요청 카운터 앵커(02a ★7): "요청이 실제로 나갔고 실패했다"를 먼저 확인한다. 요청을 안 보내는 구현도
   *   "/7 없음"은 통과하므로, 카운터 없이 부재만 보면 무엇을 쟀는지 모호해진다.
   */
  describe('TRIP-1051 AC-3 · 취향 조회 실패면 요약을 비운다', () => {
    it('W3 /me/preferences 500 → 취향 행과 chevron 은 있고, 행 안에 "/7"이 없다', async () => {
      // 준비 — 나머지 조회는 정상, 취향만 실패(나중에 넣은 핸들러가 이긴다).
      let preferenceGets = 0;
      installServer({ legalConsent: true, reason: 'APPLIED' });
      server.use(
        http.get(`${BASE}/me/preferences`, () => {
          preferenceGets += 1;
          return HttpResponse.json({}, { status: 500 });
        })
      );

      // 실행
      renderPage();
      await waitFor(() => expect(preferenceGets).toBeGreaterThanOrEqual(1));
      await settleNetwork();

      // 긍정 앵커: 행과 chevron 은 있다.
      const row = screen.getByTestId('settings-nav-preferences');
      expect(
        within(row).getByTestId('settings-nav-preferences-chevron')
      ).toBeOnTheScreen();
      // 단언(부분포함): 어떤 숫자든 "/7" 이 없다 — 실패를 "0/7"로 위장하지 않는다.
      expect(within(row).queryByText(/\/7/)).toBeNull();
    });
  });

  describe('TRIP-778 AC-9 · 제휴 토글 ↔ /me/settings 서버 왕복 (값 방향 양쪽)', () => {
    it('T1 서버 dismissed:false → 토글 ON, 누르면 {affiliateNoticeDismissed:true} 한 번 · 토글 OFF', async () => {
      // 준비
      serverDismissed = false;
      installServer({});
      renderPage();
      await waitToggleReady();
      // 앵커 — ON("다시 보기") = dismissed:false.
      expect(toggle()).toBeChecked();

      // 실행
      fireEvent.press(toggle());

      // 단언(완전일치 · 배열): 한 번 · 한 필드 · 값 방향 true.
      await waitFor(() => expect(patchBodies).toHaveLength(1));
      expect(patchBodies).toEqual([{ affiliateNoticeDismissed: true }]);
      // 단언: 응답·재조회까지 끝난 뒤에도 OFF 로 남는다.
      await settleNetwork();
      expect(toggle()).not.toBeChecked();
    });

    it('T2 서버 dismissed:true → 토글 OFF, 누르면 {affiliateNoticeDismissed:false} 한 번 · 토글 ON', async () => {
      serverDismissed = true;
      installServer({});
      renderPage();
      await waitToggleReady();
      expect(toggle()).not.toBeChecked();

      fireEvent.press(toggle());

      await waitFor(() => expect(patchBodies).toHaveLength(1));
      expect(patchBodies).toEqual([{ affiliateNoticeDismissed: false }]);
      await settleNetwork();
      expect(toggle()).toBeChecked();
    });

    it('T3 끈 뒤 다시 들어오면(새 캐시) 서버 값대로 OFF 다 — 재진입 후 유지', async () => {
      serverDismissed = false;
      installServer({});
      const first = renderPage();
      await waitToggleReady();
      fireEvent.press(toggle());
      await waitFor(() => expect(patchBodies).toHaveLength(1));
      await settleNetwork();
      first.unmount();

      // 재진입 — 캐시를 새로 만든다(값은 서버에서만 온다).
      queryClient.clear();
      queryClient = newClient();
      renderPage();
      await waitToggleReady();

      expect(toggle()).not.toBeChecked();
      expect(patchBodies).toHaveLength(1);
    });
  });

  describe('TRIP-778 D7 · 모르면 못 누르고, 누르면 바로 바뀌고, 실패하면 되돌린다', () => {
    it('T4 서버 값을 받기 전에는 토글이 비활성이고 눌러도 PATCH 가 없다', async () => {
      installServer({});
      server.use(
        http.get(`${BASE}/me/settings`, () => {
          settingsGets += 1;
          return new Promise<never>(() => {});
        })
      );
      renderPage();
      await waitFor(() => expect(settingsGets).toBeGreaterThanOrEqual(1));

      expect(toggle()).toBeDisabled();
      fireEvent.press(toggle());
      await act(async () => {});
      expect(patchBodies).toEqual([]);
    });

    it('T5 서버 조회가 실패하면(500) 토글이 비활성이고 눌러도 PATCH 가 없다', async () => {
      installServer({});
      server.use(
        http.get(`${BASE}/me/settings`, () => {
          settingsGets += 1;
          return HttpResponse.json({}, { status: 500 });
        })
      );
      renderPage();
      await waitFor(() => expect(settingsGets).toBeGreaterThanOrEqual(1));
      await settleNetwork();

      expect(toggle()).toBeDisabled();
      fireEvent.press(toggle());
      await act(async () => {});
      expect(patchBodies).toEqual([]);
    });

    it('T6 누르면 응답 전에 이미 바뀐다(낙관 반영)', async () => {
      serverDismissed = false;
      installServer({});
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let responded = false;
      server.use(
        http.patch(`${BASE}/me/settings`, async ({ request }) => {
          patchBodies.push(await request.json());
          await gate;
          responded = true;
          return HttpResponse.json({ affiliateNoticeDismissed: true });
        })
      );
      renderPage();
      await waitToggleReady();
      expect(toggle()).toBeChecked();

      fireEvent.press(toggle());

      // 단언 — 서버가 답하기 전인데 이미 OFF 다.
      await waitFor(() => expect(toggle()).not.toBeChecked());
      expect(responded).toBe(false);

      // 정리 — 보류한 요청을 풀고 끝까지 흘린다(02a ★12).
      release();
      await settleNetwork();
      expect(responded).toBe(true);
    });

    it('T7 PATCH 가 실패하면 원래 값(ON)으로 돌아가고 행 아래 안내가 뜬다', async () => {
      serverDismissed = false;
      installServer({});
      server.use(
        http.patch(`${BASE}/me/settings`, async ({ request }) => {
          patchBodies.push(await request.json());
          return HttpResponse.json({}, { status: 500 });
        })
      );
      renderPage();
      await waitToggleReady();
      // 짝 — 실패 전에는 안내가 없다.
      expect(screen.queryByTestId('settings-affiliate-error')).toBeNull();

      fireEvent.press(toggle());
      await waitFor(() => expect(patchBodies).toHaveLength(1));
      await settleNetwork();

      // 단언 — 서버 값(dismissed:false = ON)으로 되돌아왔다.
      expect(toggle()).toBeChecked();
      // 단언(완전일치) — 행 아래 인라인 안내.
      expect(
        within(screen.getByTestId('settings-affiliate-error')).getByText(
          ERROR_COPY
        )
      ).toBeOnTheScreen();
    });

    it('T7b 실패 안내가 뜬 뒤 다시 눌러 성공하면 안내가 사라진다(5-b 참고-1)', async () => {
      // 준비: 첫 PATCH 만 500, 두 번째는 성공해 서버 값을 바꾼다.
      serverDismissed = false;
      installServer({});
      server.use(
        http.patch(`${BASE}/me/settings`, async ({ request }) => {
          const body = (await request.json()) as {
            affiliateNoticeDismissed?: boolean | null;
          };
          patchBodies.push(body);
          if (patchBodies.length === 1) {
            return HttpResponse.json({}, { status: 500 });
          }
          if (typeof body.affiliateNoticeDismissed === 'boolean') {
            serverDismissed = body.affiliateNoticeDismissed;
          }
          return HttpResponse.json({
            affiliateNoticeDismissed: serverDismissed,
          });
        })
      );
      renderPage();
      await waitToggleReady();
      fireEvent.press(toggle());
      await waitFor(() => expect(patchBodies).toHaveLength(1));
      await settleNetwork();
      // 앵커 — 실패 안내가 실제로 떠 있었다(없으면 아래 "사라졌다"가 공짜로 참이 된다).
      expect(screen.getByTestId('settings-affiliate-error')).toBeOnTheScreen();

      // 실행: 다시 누른다 → 이번엔 성공.
      fireEvent.press(toggle());
      await waitFor(() => expect(patchBodies).toHaveLength(2));
      await settleNetwork();

      // 단언: 두 번째 요청도 같은 방향(true)이고, 토글은 OFF 로 바뀌었고, 안내는 사라졌다.
      expect(patchBodies).toEqual([
        { affiliateNoticeDismissed: true },
        { affiliateNoticeDismissed: true },
      ]);
      expect(toggle()).not.toBeChecked();
      expect(screen.queryByTestId('settings-affiliate-error')).toBeNull();
    });
  });

  /**
   * TRIP-1017 (D) #092 — 위치정보 그룹 첫 행은 "GPS 이동경로 기록"(L3)을 가리키고, 칩도 L3 값을 읽는다.
   *
   * 왜 두 값을 갈라 주나(02a ★10): 위 W1·W2 는 서버가 `legalConsent`(L2)와 `gpsRecordingOptIn`(L3)을 **같은 값**으로
   *  준다 — 페이지가 어느 필드를 읽어도 green 이다. 온보딩 위치 약관(L2)은 동의했는데 GPS 기록(L3)은 안 한 계정이
   *  #092 의 실제 모양이라, 둘을 갈라 줘야 "라벨과 값이 같은 것을 가리킨다"(01b Q6)가 잰다. 방향도 양쪽을 다 둔다 —
   *  한쪽만 두면 "칩을 항상 미동의로" 같은 상수 구현이 통과한다.
   *
   * AC-D3 짝: 설정 화면은 위치 동의를 **읽기만** 한다 — 동의 저장소로 가는 GET 외 요청이 0건이다.
   */
  describe('TRIP-1017 AC-D1·D2·D3 · "GPS 이동경로 기록" 행은 gpsRecordingOptIn 을 읽는다', () => {
    let consentRequests: string[] = [];

    beforeAll(() => {
      server.events.on('request:start', ({ request }) => {
        const { pathname } = new URL(request.url);
        if (
          pathname.includes('/location-consent') ||
          pathname.includes('/consents')
        ) {
          consentRequests.push(`${request.method} ${pathname}`);
        }
      });
    });

    beforeEach(() => {
      consentRequests = [];
    });

    /** 위 installServer 로 나머지 조회를 깔고, 위치 동의 응답만 L2·L3 를 갈라 덮는다(server.use 는 뒤가 이긴다). */
    function installSplitConsent(
      legalConsent: boolean,
      gpsRecordingOptIn: boolean
    ): void {
      installServer({ legalConsent, reason: 'APPLIED' });
      server.use(
        http.get(`${BASE}/me/location-consent`, () =>
          HttpResponse.json({
            osPermissionMirror: 'GRANTED',
            legalConsent,
            gpsRecordingOptIn,
          })
        )
      );
    }

    const locationRow = () =>
      screen.getByTestId('settings-nav-location-consent');
    const locationChip = () =>
      within(locationRow()).getByTestId('settings-chip-location-consent');

    it('🔴 D2-a 법정 동의(L2)는 했지만 GPS 기록(L3)은 안 했으면 행은 "GPS 이동경로 기록" · 칩은 "미동의"다', async () => {
      // 준비 — #092 의 실제 계정 모양.
      installSplitConsent(true, false);

      // 실행
      renderPage();

      // 단언 — 행 이름이 GPS 기록을 가리키고, 온보딩 약관처럼 읽히는 옛 이름은 없다(AC-D1).
      await waitFor(() => expect(locationChip()).toBeOnTheScreen());
      await settleNetwork();
      expect(
        within(locationRow()).getByText('GPS 이동경로 기록')
      ).toBeOnTheScreen();
      expect(
        within(locationRow()).queryByText('위치정보 수집 동의')
      ).toBeNull();
      // 단언 — 칩이 L3 값을 읽는다(AC-D2).
      expect(within(locationChip()).getByText('미동의')).toBeOnTheScreen();
      expect(within(locationChip()).queryByText('동의')).toBeNull();
    });

    it('🔴 D2-b 반대로 L2 미동의 · L3 동의면 칩은 "동의"다(짝)', async () => {
      installSplitConsent(false, true);

      renderPage();

      await waitFor(() => expect(locationChip()).toBeOnTheScreen());
      await settleNetwork();
      expect(within(locationChip()).getByText('동의')).toBeOnTheScreen();
      expect(within(locationChip()).queryByText('미동의')).toBeNull();
    });

    it('🟢 D1 행을 누르면 여전히 위치 동의 화면(/settings/location)으로 1회 간다', async () => {
      installSplitConsent(true, false);
      renderPage();
      await waitFor(() => expect(locationChip()).toBeOnTheScreen());

      fireEvent.press(locationRow());

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/settings/location');
    });

    it('🟢 D3 설정 화면은 위치 동의를 읽기만 한다 — 동의 저장소로 가는 쓰기 요청 0', async () => {
      installSplitConsent(true, false);
      renderPage();
      await waitFor(() => expect(locationChip()).toBeOnTheScreen());
      await settleNetwork();

      // 긍정 앵커 — 동의 조회는 실제로 나갔다(아래 "쓰기 0"이 요청 자체가 없어서 공짜로 참인 것을 막는다).
      expect(consentRequests).toContain('GET /api/v1/me/location-consent');
      expect(
        consentRequests.filter((line) => !line.startsWith('GET '))
      ).toHaveLength(0);
    });
  });
});

// TRIP-938 · TRIP-1034
describe('로그아웃 순서 · 게이트 대기 (옛 .logout)', () => {
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

  function onRequestStart({ request }: { request: Request }): void {
    if (new URL(request.url).pathname === LOGOUT_PATH) started += 1;
  }
  function onRequestEnd({ request }: { request: Request }): void {
    if (new URL(request.url).pathname === LOGOUT_PATH) ended += 1;
  }

  beforeAll(() => {
    server.events.on('request:start', onRequestStart);
    server.events.on('request:end', onRequestEnd);
  });
  afterAll(() => {
    server.events.removeListener('request:start', onRequestStart);
    server.events.removeListener('request:end', onRequestEnd);
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
});

// TRIP-835
describe('로그아웃 → 이 기기 푸시 토큰 해제 (옛 .pushLogout)', () => {
  /**
   * TRIP-835 · AC-5 — 로그아웃하면 이 기기의 푸시 토큰을 해제한다(SEC-U6-02: 다음 사용자에게 이전 사용자의
   * 알림이 가지 않게).
   *
   * 무엇을 보장하나(사용자가 겪는 순서대로):
   *  - L1: 이번 세션에 등록한 토큰으로 `DELETE /me/push-tokens/{토큰}` 이 1번 나가고, 그 요청에 **아직 살아 있는
   *    로그인 헤더**(`Bearer access-A`)가 실린다 — 인증을 지우기 전에 출발했다는 뜻이다. 로그아웃은
   *    `replace('/login')` 로 끝난다(TRIP-1034 — 게이트가 LOGIN 을 공개한 뒤).
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
   * ★ 가짜 게이트(TRIP-1034): 토큰이 비면 한 턴 뒤 LOGIN 을 공개해 SplashGate 의 재조회를 흉내 낸다.
   *   이 파일의 관심사는 해제 순서라 타이밍 변주는 `SettingsPage.logout.integration.test.tsx` G5·G6 에 맡긴다.
   *
   * 3동작 뼈대: 준비=로그인 상태 + 이번 세션 등록 + MSW → 실행=[로그아웃] → 확인 → 단언=DELETE·헤더·이동.
   */

  const BASE = 'http://localhost:8080/api/v1';

  type DeleteSeen = {
    token: string;
    authorization: string | null;
    /** 요청이 MSW 에 도착한 순간의 메모리 access 토큰. */
    accessAtArrival: string | null;
  };

  let deletes: DeleteSeen[] = [];
  let releaseGate: () => void = () => {};
  let stopFakeGate: () => void = () => {};

  /** 게이트의 재조회를 흉내 낸다 — 메모리 토큰이 비면 한 턴 뒤 LOGIN 을 공개한다. */
  function startFakeGate() {
    stopFakeGate = subscribeAccessToken((token) => {
      if (token !== null) return;
      setTimeout(() => publishGateDestination('LOGIN'), 0);
    });
  }

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

    // 로그인 상태의 게이트는 HOME 이고, 토큰이 비면 LOGIN 을 공개한다.
    publishGateDestination('HOME');
    startFakeGate();
  });

  afterEach(() => {
    releaseGate();
    server.resetHandlers();
    // 모듈 싱글턴 두 개(토큰 구독·게이트 목적지)를 파일 최상위에서 비운다.
    stopFakeGate();
    resetGateDestination();
  });

  describe('TRIP-835 AC-5 · 로그아웃 → 이 기기 토큰 해제', () => {
    it('L1 등록한 토큰으로 DELETE 1번, 로그인 헤더가 살아 있는 채로 출발하고, 로그아웃은 replace("/login") 로 끝난다', async () => {
      // 준비
      servePushTokens(() => new HttpResponse(null, { status: 204 }));
      await registerThisSession('ExponentPushToken[L1]');
      renderPage();

      // 실행
      confirmLogout();

      // 단언: 로그아웃이 끝났다.
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(mockReplace).toHaveBeenCalledWith('/login');

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
      'L2 해제가 %i 로 실패해도 로그아웃은 끝난다(토큰 삭제 · replace("/login") · 화면 생존)',
      async (status, token) => {
        servePushTokens(() => new HttpResponse(null, { status }));
        await registerThisSession(token);
        renderPage();

        confirmLogout();

        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
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
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'), {
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
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
      expect(getAccessToken()).toBeNull();
    });
  });
});
