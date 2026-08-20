import type { ReactNode } from 'react';
import * as Linking from 'expo-linking';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { StayItem } from '@/shared/api/generated/schemas';
import { formatPrice } from '@/features/stay/model/formatPrice';
import { StayDetailPage } from './StayDetailPage';

/**
 * TRIP-457 AC-2·8·9·10·11 (배선) — e03 상세 페이지가 params 데이터·제휴 시트·이동·저장에
 * 실제로 이어진다는 증거. 화면·시트는 라우터·훅·Linking 을 모르므로(FSD 경계), params 파싱·
 * 저장 요청·웹검색 이동·로그인 유도는 이 배선 층에서만 확인된다.
 *
 * 무엇을 보장하나:
 *  - I1/I2/I3 (AC-2) 데이터는 손에 든 `item`(JSON param)에서 온다. 파싱 실패·부재 → notFound(INV-4).
 *  - I4 (AC-8) `stay-detail-book` → 제휴 고지 시트(BR-U1-30 정확 문구) 마운트.
 *  - I5 (AC-9) 시트 [이동] → 웹검색 URL 로 Linking.openURL(01b Q2 웹검색 폴백).
 *  - I6 (AC-10) 로그인 사용자 `stay-detail-addtotrip` → POST /saved-stays + 거점 편입 안내.
 *  - I7 (AC-10) 게스트 addtotrip → 요청 0 + /(auth)/login push(죽은 버튼 아님, BR-U1-03·55).
 *  - I8 (AC-11) 게스트 하트 → 요청 0 + /(auth)/login push.
 *
 * 인프라: `StaySearchPage.save.integration.test.tsx` 의 msw·tokenManager·expo-router 목을 복제
 * (리포 관례 — 공용화 안 함). expo-linking 은 nextNav.test 패턴으로 목.
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

// 호이스팅 예외 — 이름이 mock 으로 시작해야 한다(기존 통합테스트 관례).
let mockSearchParams: { stayId?: string; item?: string } = {};
const mockPush = jest.fn();
const mockBack = jest.fn();

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

const mockOpenURL = Linking.openURL as jest.Mock;

const BASE = 'http://localhost:8080/api/v1';

const BR_U1_30 =
  '예약 · 결제는 외부 OTA에서 진행되며, TripPilot은 제휴(어필리에이트) 수수료를 받을 수 있어요.';

const ITEM_A: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 오션 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean', 'wifi'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
};
const KEY_A = `${ITEM_A.externalSource}:${ITEM_A.externalId}`;

/** 유효 진입 params — 카드가 넘긴 형태(01b Q1). */
function validParams() {
  return { stayId: KEY_A, item: JSON.stringify(ITEM_A) };
}

let observedHits: string[] = [];

function hitCount(needle: string): number {
  return observedHits.filter((hit) => hit === needle).length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  mockSearchParams = validParams();
  mockPush.mockClear();
  mockBack.mockClear();
  mockOpenURL.mockClear();
  mockOpenURL.mockResolvedValue(true);
  clearAccessToken();
  // GET /saved-stays 는 항상 등록(게스트에서 잘못 나가도 throw 아니라 hitCount 로 잡히게).
  server.use(http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])));
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe('I1·I2·I3 · 데이터는 손에 든 item 에서 (AC-2)', () => {
  it('I1 · 유효 item param → 이름·가격을 그린다', () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });

    expect(screen.getByText(ITEM_A.name)).toBeOnTheScreen();
    expect(screen.getByText(formatPrice(ITEM_A.price))).toBeOnTheScreen();
  });

  it('I2 · item 이 망가진 JSON 이면 notFound (INV-4)', () => {
    mockSearchParams = { stayId: KEY_A, item: '{망가진' };
    render(<StayDetailPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('stay-detail-notfound')).toBeOnTheScreen();
    expect(screen.queryByText(ITEM_A.name)).toBeNull();
  });

  it('I3 · item param 부재 → notFound', () => {
    mockSearchParams = { stayId: KEY_A };
    render(<StayDetailPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('stay-detail-notfound')).toBeOnTheScreen();
  });

  // I3b (5-b 경고-1) · `JSON.parse` 는 문법상 유효하지만 StayItem 이 아닌 값(`123`·`{}`·`[]`·`"x"`)도
  // 성공시킨다 — 그대로 통과하면 화면이 `item.amenities.length` 에서 크래시한다(미인증 딥링크로 도달).
  // 형태 검문이 이 클래스도 notFound 로 접는지, 즉 렌더가 **던지지 않고** notFound 를 그리는지 잰다.
  it.each(['123', '{}', '[]', '"x"'])(
    'I3b · 형태가 StayItem 이 아닌 유효 JSON(%s) → 크래시 없이 notFound (INV-4)',
    (bad) => {
      mockSearchParams = { stayId: KEY_A, item: bad };
      render(<StayDetailPage />, { wrapper: createWrapper() });

      expect(screen.getByTestId('stay-detail-notfound')).toBeOnTheScreen();
      expect(screen.queryByText(ITEM_A.name)).toBeNull();
    }
  );
});

describe('I4·I5 · 예약하기 → 제휴 시트 → 이동 (AC-8 · AC-9)', () => {
  it('I4 · book press → 시트 마운트 + BR-U1-30 정확 문구', () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-book'));

    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    expect(screen.getByText(BR_U1_30)).toBeOnTheScreen();
  });

  it('I5 · 시트 [이동] → 웹검색 URL 로 openURL (01b Q2)', async () => {
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-book'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));

    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(`${ITEM_A.name} 예약`))
      )
    );
  });
});

describe('I6·I7 · 일정에 추가 (AC-10)', () => {
  it('I6 · 로그인 사용자 → POST /saved-stays + 거점 편입 안내', async () => {
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/saved-stays`, () =>
        HttpResponse.json(
          {
            savedStayId: 'new-1',
            name: ITEM_A.name,
            coordConfirmed: false,
            registerRoute: 'MAP_SEARCH',
            externalSource: ITEM_A.externalSource,
            externalId: ITEM_A.externalId,
            lat: ITEM_A.lat,
            lng: ITEM_A.lng,
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
          },
          { status: 201 }
        )
      )
    );
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-addtotrip'));

    await waitFor(() => expect(hitCount('POST /api/v1/saved-stays')).toBe(1));
    await waitFor(() =>
      expect(screen.getByTestId('stay-detail-add-notice')).toBeOnTheScreen()
    );
  });

  it('I7 · 게스트 → 요청 0 + /(auth)/login push (죽은 버튼 아님)', async () => {
    clearAccessToken();
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-addtotrip'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(auth)/login'));
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
  });
});

describe('I8 · 저장 하트 게스트 (AC-11)', () => {
  it('게스트 하트 press → 요청 0 + /(auth)/login push', async () => {
    clearAccessToken();
    render(<StayDetailPage />, { wrapper: createWrapper() });

    fireEvent.press(screen.getByTestId('stay-detail-save'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(auth)/login'));
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
  });
});
