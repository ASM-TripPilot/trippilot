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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SettingsPage } from '..';

/**
 * TRIP-778 — l05 설정 페이지 배선(MSW 통합 · 실 훅 · 실 QueryClient).
 *
 * 무엇을 보장하나:
 *  - AC-4·5·6(배선): 서버 값(취향·위치 동의·개인화)이 페이지를 거쳐 화면의 행 값·칩으로 실제로 도착한다.
 *    화면 테스트는 props 를 직접 넣으므로, "페이지가 값을 안 넘긴다"는 이 층에서만 잡힌다.
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

// 호이스팅 예외 — 이름이 mock 으로 시작해야 팩토리 안에서 쓸 수 있다.
const mockPush = jest.fn();

// SettingsPage 는 press 시점에 require('expo-router').router 를 읽는다(loadRouter) — 싱글턴 형태 목.
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
}));

// 토큰 저장소 — 기기 저장소를 건드리지 않게 배럴만 바꾼다(StayDetailPage 통합 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = `${
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
}/api/v1`;

const DOT = '·';
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

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', () => {
    started += 1;
  });
  server.events.on('request:end', () => {
    ended += 1;
  });
});

beforeEach(() => {
  jest.clearAllMocks();
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

afterAll(() => server.close());

describe('TRIP-778 AC-4·5·6 · 서버 값이 행 값·칩으로 도착한다 (페이지 배선)', () => {
  it('W1 취향 값·예산 미설정 칩·위치 동의 칩·개인화 사용 중', async () => {
    // 준비
    installServer({ legalConsent: true, reason: 'APPLIED' });

    // 실행
    renderPage();

    // 단언 — 값 도착 뒤의 행 표면(완전일치 · 행 안).
    await waitFor(() =>
      expect(
        within(screen.getByTestId('settings-nav-style')).getByText(
          `휴양${DOT}자연`
        )
      ).toBeOnTheScreen()
    );
    expect(
      within(screen.getByTestId('settings-nav-pace')).getByText('느긋하게')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('settings-chip-budget')).getByText('미설정')
    ).toBeOnTheScreen();
    await waitFor(() =>
      expect(
        within(screen.getByTestId('settings-chip-location-consent')).getByText(
          '동의'
        )
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
        within(screen.getByTestId('settings-chip-location-consent')).getByText(
          '미동의'
        )
      ).toBeOnTheScreen()
    );
    await settleNetwork();
    // 긍정 앵커 — 개인화 행은 있다.
    const personalization = screen.getByTestId('settings-nav-personalization');
    expect(within(personalization).queryByText('사용 중')).toBeNull();
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
        return HttpResponse.json({ affiliateNoticeDismissed: serverDismissed });
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
