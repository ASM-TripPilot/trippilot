import type { ReactNode } from 'react';
import * as Linking from 'expo-linking';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { SettingsPage } from '@/pages/settings';
import { StayDetailPage } from '@/pages/stay-detail';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { StayItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-778 AC-11 — "제휴 안내 다시 보지 않기"의 진실은 하나다(서버 `/me/settings`).
 *
 * 무엇을 보장하나: 설정(l05)에서 "외부 이동 시 제휴 안내 다시 보기"를 끄면, **이미 떠 있는** 숙소
 *  상세(e03)의 [외부에서 예약하기]가 고지 시트 없이 바로 이동한다 — 두 화면이 같은 값을 본다.
 *  781 까지는 숙소 상세가 기기(SecureStore)에, 설정은 아무 데도 없었다. 01b 사용자 결정으로 둘 다
 *  서버 한 곳을 본다.
 *
 * ★ 왜 "동시 마운트"인가(02a ★8): 이미 마운트된 쿼리는 스스로 다시 조회하지 않는다. 그래서 숙소 상세를
 *   토글 **전부터** 같은 캐시(QueryClient)에 띄워 두면, 설정 쪽이 같은 쿼리를 갱신(setQueryData)하거나
 *   무효화해야만 숙소 쪽 값이 바뀐다. 서로 다른 캐시 키·로컬 state 로 따로 들고 있으면 시트가 떠서 red.
 *   서버 핸들러는 상태형(PATCH 가 GET 값을 바꾼다)이라 무효화 방식도 통과한다 — 방식은 강요하지 않는다.
 *
 * 왜 `src/__tests__` 인가: 두 페이지를 한 트리에 올려야 하는데, pages 슬라이스끼리의 직접 import 는
 *  층 린트가 막는다(테스트 파일도 적용). 이 폴더는 층 밖이다.
 *
 * 3동작 뼈대: 준비(두 페이지·서버 dismissed:false) → 실행(설정 토글 OFF → 숙소 [예약하기]) →
 *  단언(시트 없음 · 웹검색 이동 1회).
 *
 * ⚠️ jest 사각: 실제 화면 전환(설정→뒤로→숙소 상세)과 실서버 반영은 6-b 몫.
 */

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockSearchParams: { stayId?: string; item?: string } = {};

// SettingsPage 는 press 시점에 require('expo-router').router 를, StayDetailPage 는 useRouter·
// useLocalSearchParams 를 쓴다 — 두 모양을 함께 준다.
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: jest.fn(),
  },
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
  canOpenURL: jest.fn().mockResolvedValue(true),
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

const mockOpenURL = Linking.openURL as jest.Mock;

const BASE = `${
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
}/api/v1`;

// l07 본문(가운뎃점 U+00B7) — 시트가 떴다는 증거.
const SHEET_BODY =
  '외부 OTA 사이트로 이동하며, 실제 예약·결제는 해당 사이트에서 진행됩니다.';

const ITEM: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 오션 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
};

let serverDismissed = false;
let patchBodies: unknown[] = [];
let started = 0;
let ended = 0;
let queryClient: QueryClient;

function installServer(): void {
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
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json({})),
    http.get(`${BASE}/me/location-consent`, () =>
      HttpResponse.json({ osPermissionMirror: 'GRANTED', legalConsent: true })
    ),
    http.get(`${BASE}/me/personalization`, () =>
      HttpResponse.json({
        applied: true,
        reason: 'APPLIED',
        sharedItems: [],
      })
    ),
    http.get(`${BASE}/me/settings`, () =>
      HttpResponse.json({ affiliateNoticeDismissed: serverDismissed })
    ),
    http.patch(`${BASE}/me/settings`, async ({ request }) => {
      const body = (await request.json()) as {
        affiliateNoticeDismissed?: boolean | null;
      };
      patchBodies.push(body);
      if (typeof body.affiliateNoticeDismissed === 'boolean') {
        serverDismissed = body.affiliateNoticeDismissed;
      }
      return HttpResponse.json({ affiliateNoticeDismissed: serverDismissed });
    }),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
  );
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderBoth() {
  return render(
    <>
      <SettingsPage />
      <StayDetailPage />
    </>,
    { wrapper }
  );
}

/** 시작한 요청이 모두 끝나고 결과가 화면에 반영될 때까지 흘린다(재조회 경주 종료). */
async function settleNetwork(): Promise<void> {
  await waitFor(() => expect(ended).toBe(started));
  await act(async () => {});
}

const toggle = () => screen.getByTestId('settings-affiliate-toggle');

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
  mockOpenURL.mockResolvedValue(true);
  mockSearchParams = { stayId: 'NAVER:s1', item: JSON.stringify(ITEM) };
  serverDismissed = false;
  patchBodies = [];
  started = 0;
  ended = 0;
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  setAccessToken('valid-access');
  installServer();
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  queryClient.clear();
});

afterAll(() => server.close());

describe('TRIP-778 AC-11 · 한 진실 — 설정과 숙소 상세가 같은 서버 값을 본다', () => {
  it('O1 숙소 상세가 떠 있는 채로 설정에서 토글을 끄면, [예약하기]가 시트 없이 바로 이동한다', async () => {
    // 준비 — 두 페이지를 같은 캐시에 동시에 띄우고, 서버 값(dismissed:false = ON)이 도착할 때까지.
    renderBoth();
    await waitFor(() => expect(toggle()).not.toBeDisabled());
    await settleNetwork();
    expect(toggle()).toBeChecked();

    // 실행 — 설정에서 "다시 보기"를 끈다 → 숙소 상세 [예약하기].
    fireEvent.press(toggle());
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    await settleNetwork();
    fireEvent.press(screen.getByTestId('stay-detail-book'));

    // 단언 — 시트 없이 웹검색으로 바로 이동했다.
    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(`${ITEM.name} 예약`))
      )
    );
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
  });

  it('짝: 토글을 건드리지 않으면(서버 dismissed:false) 같은 [예약하기]에 고지 시트가 뜬다', async () => {
    renderBoth();
    await waitFor(() => expect(toggle()).not.toBeDisabled());
    await settleNetwork();

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByText(SHEET_BODY)).toBeOnTheScreen();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });
});
