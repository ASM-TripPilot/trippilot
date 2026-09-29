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
import { MyPage } from '@/pages/my-page';
import { SettingsPage } from '@/pages/settings';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';

/**
 * TRIP-1017 (A) #093 — 설정에서 바꾼 닉네임이 **떠 있는** 마이 탭에 바로 보인다.
 *
 * 무엇을 보장하나:
 *  - AC-A1: `PATCH /me/profile/nickname` 200 뒤, 같은 QueryClient 를 쓰는 마이페이지의 프로필 카드 닉네임과
 *    아바타 첫 글자가 새 닉네임이다 — 마이페이지를 다시 그리지 않아도(당겨서 새로고침 없이).
 *  - AC-A2: PATCH 가 409·503·네트워크 실패면 마이페이지는 옛 닉네임 그대로다(실패를 성공처럼 캐시에 쓰지 않는다).
 *  - AC-A3(짝): 성공 토스트는 그대로 뜬다 — 이 파일에선 "PATCH 가 성공했다"는 앵커로 쓴다.
 *
 * ★ 왜 "동시 마운트"인가(02a ★1): 결함은 **이미 떠 있는** 탭에서만 보인다. 저장 뒤 마이페이지를 새로 그리면
 *   staleTime 0 이라 스스로 다시 조회해서, 캐시를 안 고쳐도 새 닉네임이 뜬다(거짓 green). 그래서 두 페이지를
 *   저장 **전부터** 한 트리에 띄우고, 마이페이지는 끝까지 다시 그리지 않는다(`affiliateNoticeOneTruth` 선례).
 *
 * ★ 왜 상태형 서버인가(02a ★2): PATCH 가 서버 닉네임을 바꾸고 GET 이 그 값을 읽는다. 그래서 캐시를 직접
 *   덮는(setQueryData) 구현도, 낡았다고 표시해 다시 묻는(invalidateQueries) 구현도 green 이다 — 방식은 강요하지 않는다.
 *
 * ★ 왜 MSW 인가(02a ★3): 훅 목(`primeMutation`)은 onSuccess 에 테스트가 고른 값을 넣을 뿐 캐시를 거치지 않는다.
 *   "캐시가 갱신됐다"는 실제 react-query + 실제 HTTP 에서만 관찰된다.
 *
 * 왜 `src/__tests__` 인가: 두 pages 슬라이스를 한 트리에 올려야 하는데, pages 형제 import 는 층 린트가 막는다.
 *
 * 3동작 뼈대: 준비(서버 닉네임 `여행자123` · 두 페이지 렌더 · 옛 닉네임 도착 확인) → 실행(설정에서 편집·입력·저장) →
 *  단언(토스트 앵커 → 프로필 카드의 닉네임·아바타 글자).
 *
 * ⚠️ jest 사각: 실제 탭 전환(설정 → 뒤로 → 마이 탭)은 못 본다 — 6-b 몫.
 */

const mockPush = jest.fn();

// SettingsPage 는 press 시점에 require('expo-router').router 를, MyPage 는 useRouter 를 쓴다 — 두 모양을 함께 준다.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
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

const OLD_NICKNAME = '여행자123';
const NEW_NICKNAME = '바다고래';

// ── 서버 상태 ─────────────────────────────────────────────────────────────
let serverNickname = OLD_NICKNAME;
let patchBodies: unknown[] = [];
let started = 0;
let ended = 0;
let queryClient: QueryClient;

type PatchOutcome = 'ok' | 409 | 503 | 'network';

/** 두 페이지가 읽는 조회 전부 + 닉네임 PATCH. PATCH 결과만 케이스마다 바꾼다. */
function installServer(patch: PatchOutcome): void {
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
    // 상태형 — PATCH 가 바꾼 서버 닉네임을 읽는다(★2).
    http.get(`${BASE}/me/profile`, () =>
      HttpResponse.json({
        nickname: serverNickname,
        nicknameUpdatedAt: '2026-01-01T00:00:00Z',
        onboardingCompletedAt: '2026-01-01T00:00:00Z',
      })
    ),
    http.patch(`${BASE}/me/profile/nickname`, async ({ request }) => {
      const body = (await request.json()) as { nickname?: string };
      patchBodies.push(body);
      if (patch === 'network') return HttpResponse.error();
      if (patch === 409)
        return HttpResponse.json(
          { error: { code: 'NICKNAME_TAKEN' } },
          { status: 409 }
        );
      if (patch === 503)
        return HttpResponse.json(
          { error: { code: 'MODERATION_UNAVAILABLE' } },
          { status: 503 }
        );
      serverNickname = body.nickname ?? serverNickname;
      // openapi `PATCH /me/profile/nickname` 200 = Profile 전체.
      return HttpResponse.json({
        nickname: serverNickname,
        nicknameUpdatedAt: '2026-09-27T00:00:00Z',
        onboardingCompletedAt: '2026-01-01T00:00:00Z',
      });
    }),
    // 설정 페이지의 나머지 조회 — 이 파일의 관심사 밖이라 가장 작은 모양으로 준다.
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json({})),
    http.get(`${BASE}/me/location-consent`, () =>
      HttpResponse.json({
        osPermissionMirror: 'GRANTED',
        legalConsent: true,
        gpsRecordingOptIn: true,
      })
    ),
    http.get(`${BASE}/me/personalization`, () =>
      HttpResponse.json({ applied: true, reason: 'APPLIED', sharedItems: [] })
    ),
    http.get(`${BASE}/me/settings`, () =>
      HttpResponse.json({ affiliateNoticeDismissed: false })
    ),
    // 마이페이지의 나머지 조회 — 여행 0건(카드 N+1 조회 없음), 기록 0건, 스타일 정식 분석.
    http.get(`${BASE}/trips`, () => HttpResponse.json([])),
    http.get(`${BASE}/me/records`, () =>
      HttpResponse.json({ items: [], emptyState: 'NO_TRIPS' })
    ),
    http.get(`${BASE}/me/style`, () =>
      HttpResponse.json({
        official: true,
        progress: { current: 14, required: 10 },
        analysis: {
          descriptors: ['#바다'],
          traitGauges: { easygoing: 4, foodAffinity: 4, activeness: 3 },
          categoryBreakdown: [],
          avgPlacesPerDay: 3.2,
          avgRadiusKm: 5.1,
          sampleTripCount: 6,
          updatedAt: '2026-08-28T09:00:00Z',
        },
        preview: null,
      })
    )
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

/** 마이 탭(떠 있음)과 설정 화면을 **한 캐시** 아래 동시에 띄운다(★1). */
function renderBoth() {
  return render(
    <QueryClientProvider client={queryClient}>
      <WithToastHost>
        <MyPage />
        <SettingsPage />
      </WithToastHost>
    </QueryClientProvider>
  );
}

/** 시작한 요청이 모두 끝나고 그 결과가 화면에 반영될 때까지 흘린다. */
async function settleNetwork(): Promise<void> {
  await waitFor(() => expect(ended).toBe(started));
  await act(async () => {});
}

const profileCard = () => screen.getByTestId('my-profile-card');

/** 마이 탭 프로필 카드에 옛 닉네임이 도착할 때까지 기다린다 — 캐시가 옛 값으로 차 있는 상태를 만든다. */
async function waitOldNicknameOnMyTab(): Promise<void> {
  await waitFor(() =>
    expect(within(profileCard()).getByText(OLD_NICKNAME)).toBeOnTheScreen()
  );
  await settleNetwork();
}

function submitNickname(value: string): void {
  fireEvent.press(screen.getByTestId('settings-nickname-edit'));
  fireEvent.changeText(screen.getByTestId('settings-nickname-input'), value);
  fireEvent.press(screen.getByTestId('settings-nickname-save'));
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
  serverNickname = OLD_NICKNAME;
  patchBodies = [];
  started = 0;
  ended = 0;
  queryClient = newClient();
  setAccessToken('valid-access');
});

// 토스트 스토어는 모듈 싱글턴이라 테스트 사이로 샌다 — 파일 최상위에서 비운다(02a ★4).
afterEach(() => {
  resetToast();
  server.resetHandlers();
  clearAccessToken();
  queryClient.clear();
});

afterAll(() => server.close());

describe('🔴 TRIP-1017 AC-A1 · 저장 200 → 떠 있는 마이 탭이 새 닉네임을 그린다', () => {
  it('설정에서 닉네임을 바꾸면 마이 탭 프로필 카드의 닉네임과 아바타 첫 글자가 새 닉네임이다', async () => {
    // 준비: 두 페이지를 띄우고, 마이 탭이 옛 닉네임으로 채워진 것을 확인한다.
    installServer('ok');
    renderBoth();
    await waitOldNicknameOnMyTab();
    expect(within(profileCard()).getByText('여')).toBeOnTheScreen();
    // 앵커: 저장 전엔 성공 토스트가 없다 — 뒤의 토스트가 이번 저장이 띄운 것임을 가른다.
    expect(screen.queryByTestId('settings-nickname-saved')).toBeNull();

    // 실행: 설정 화면에서 닉네임을 바꿔 저장한다(마이 탭은 다시 그리지 않는다).
    submitNickname(NEW_NICKNAME);

    // 앵커: PATCH 가 성공했다(토스트) — 아래 실패가 "저장이 안 됐다"가 아니라 "캐시가 안 바뀌었다"임을 가른다.
    await waitFor(() =>
      expect(screen.getByTestId('settings-nickname-saved')).toBeOnTheScreen()
    );

    // 단언(급소): 떠 있는 마이 탭 프로필 카드가 새 닉네임·새 첫 글자다.
    await waitFor(() =>
      expect(within(profileCard()).getByText(NEW_NICKNAME)).toBeOnTheScreen()
    );
    expect(within(profileCard()).getByText('바')).toBeOnTheScreen();
    expect(within(profileCard()).queryByText(OLD_NICKNAME)).toBeNull();
  });

  it('짝: 와이어 PATCH 본문은 새 닉네임 한 필드로 정확히 1회다', async () => {
    installServer('ok');
    renderBoth();
    await waitOldNicknameOnMyTab();

    submitNickname(NEW_NICKNAME);

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies).toEqual([{ nickname: NEW_NICKNAME }]);
  });
});

describe('🟢 TRIP-1017 AC-A2 · 저장 실패 → 마이 탭은 옛 닉네임 그대로 (실패를 캐시에 쓰지 않는다)', () => {
  it.each([
    ['409 중복', 409 as const],
    ['503 모더레이션 불가', 503 as const],
    ['네트워크 실패', 'network' as const],
  ])(
    '%s 이면 인라인 오류만 뜨고 프로필 카드는 옛 닉네임이다',
    async (_title, outcome) => {
      // 준비
      installServer(outcome);
      renderBoth();
      await waitOldNicknameOnMyTab();

      // 실행
      submitNickname(NEW_NICKNAME);

      // 앵커: 요청이 실제로 나갔고 실패가 설정 화면에 드러났다.
      await waitFor(() =>
        expect(screen.getByTestId('settings-nickname-error')).toBeOnTheScreen()
      );
      expect(patchBodies).toHaveLength(1);
      await settleNetwork();

      // 단언: 마이 탭은 옛 닉네임·옛 첫 글자 그대로, 새 닉네임은 어디에도 없다(낙관 갱신 후 롤백 누락 차단).
      expect(within(profileCard()).getByText(OLD_NICKNAME)).toBeOnTheScreen();
      expect(within(profileCard()).getByText('여')).toBeOnTheScreen();
      expect(within(profileCard()).queryByText(NEW_NICKNAME)).toBeNull();
      expect(screen.queryByTestId('settings-nickname-saved')).toBeNull();
    }
  );
});
