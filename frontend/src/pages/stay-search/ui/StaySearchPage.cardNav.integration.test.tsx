import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { StayItem } from '@/shared/api/generated/schemas';
import { StaySearchPage } from './StaySearchPage';

/**
 * TRIP-457 AC-5(배선) — e02 카드 탭이 실제로 상세 라우트 push 로 이어진다는 증거.
 * 화면은 `onPressCard?(item)` 콜백만 올린다(cardPress.test) — 그 콜백이 진짜 `/stays/[stayId]`
 * push(객체형·item JSON param)로 이어지는지는 이 배선 층에서만 확인된다.
 *
 * *(개념·★F-3)* push 는 리포 idiom 인 **객체형**: `router.push({ pathname:'/stays/[stayId]',
 * params:{ stayId, item } })`(CoPick·MustVisit 선례). `stayId` 는 raw `stayKey`(콜론 포함) —
 * expo-router 가 세그먼트를 자동 인코딩하고 수신측이 자동 디코딩하므로 수동 encodeURIComponent 를
 * 걸지 않는다(이중 인코딩 회피). load-bearing 은 `item`(JSON) — 상세는 그것만 파싱한다(GET 계약 부재).
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

let mockSearchParams: { region?: string } = {};
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    setParams: jest.fn(),
  },
}));

const BASE = 'http://localhost:8080/api/v1';

const ITEM_A: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 그랜드 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
};
const KEY_A = `${ITEM_A.externalSource}:${ITEM_A.externalId}`;

const SEARCH_RESPONSE = {
  items: [ITEM_A],
  degraded: false,
  filterZeroReasons: [],
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockSearchParams = { region: '해운대' };
  mockPush.mockClear();
  server.use(
    http.get(`${BASE}/stays/search`, () => HttpResponse.json(SEARCH_RESPONSE)),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

/** push 호출 인자 중 상세 라우트로 가는 객체형 push 만 골라낸다. */
function detailPushes() {
  return mockPush.mock.calls
    .map((call) => call[0])
    .filter(
      (arg): arg is { pathname: string; params: Record<string, unknown> } =>
        typeof arg === 'object' &&
        arg !== null &&
        (arg as { pathname?: string }).pathname === '/stays/[stayId]'
    );
}

describe('N1 · 카드 press → 상세 push (AC-5)', () => {
  it('카드를 누르면 stayKey·item(JSON) 을 실어 /stays/[stayId] 로 push 한다', async () => {
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByText(ITEM_A.name)).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/stays/[stayId]',
      params: { stayId: KEY_A, item: JSON.stringify(ITEM_A) },
    });
  });
});

describe('N2 · 하트 press 는 상세 push 를 삼키지 않는다 (AC-7 배선)', () => {
  it('게스트 하트 press 는 상세 라우트 push 를 0건으로 둔다', async () => {
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
      ).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

    // 상세 라우트로 가는 push 는 없다(로그인 유도 push 는 별개 문자열 인자라 제외된다).
    expect(detailPushes()).toHaveLength(0);
  });
});
