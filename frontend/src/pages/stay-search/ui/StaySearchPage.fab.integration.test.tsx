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
import { clearAccessToken } from '@/shared/api/tokenManager';
import type { StayItem } from '@/shared/api/generated/schemas';
import { StaySearchPage } from './StaySearchPage';

/**
 * TRIP-725 AC-8 (배선) — e02 우하단 2단 원형 FAB 이 실제로 목적지 라우트로 push 되는 증거.
 * 화면은 라우터를 모르므로(FSD 경계), FAB press 가 흰 하트→`/stays/saved`·＋→`/stays/register`로
 * 이어지는지는 이 배선 층(페이지)에서만 확인할 수 있다(현재 e02 FAB 목적지 통합 심판이 0 —
 * traps-stay). 알약 "여행 만들기"→`/trips/new/step1` 배선은 폐기된다.
 *
 * 인프라: `StaySearchPage.save.integration.test.tsx` 의 expo-router 목(mockPush)·MSW·
 * QueryClientProvider 래퍼를 복제한다(공용화 안 함 — 리포 관례). FAB press 는 인증과 무관하므로
 * 게스트(토큰 미설정)로 돌린다(담은 목록 GET 은 안 나간다).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue(null),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(false),
}));

// 호이스팅 예외를 받으려면 이름이 mock으로 시작해야 한다(기존 통합테스트 관례).
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

const ITEM: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 그랜드 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean'],
  stayType: 'HOTEL',
  price: { amount: 120000, currency: 'KRW' },
};

const SEARCH_RESPONSE = {
  items: [ITEM],
  degraded: false,
  filterZeroReasons: [],
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockSearchParams = { region: '부산' };
  mockPush.mockClear();
  clearAccessToken();
  server.use(
    http.get(`${BASE}/stays/search`, () => HttpResponse.json(SEARCH_RESPONSE)),
    // 게스트라 담은 목록 조회는 안 나가지만, onUnhandledRequest:'error' 방어로 등록해 둔다.
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

describe('AC-8 · e02 2단 FAB 목적지 배선 (TRIP-725)', () => {
  it('흰 하트 FAB press → router.push("/stays/saved")', async () => {
    render(<StaySearchPage />, { wrapper: createWrapper() });

    // FAB 은 데이터와 무관한 absolute 오버레이라 즉시 뜬다.
    const saved = await screen.findByTestId('stay-search-fab-saved');
    fireEvent.press(saved);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/stays/saved'));
  });

  it('분홍 ＋ FAB press → router.push("/stays/register")', async () => {
    render(<StaySearchPage />, { wrapper: createWrapper() });

    const register = await screen.findByTestId('stay-search-fab-register');
    fireEvent.press(register);

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/stays/register')
    );
  });
});
