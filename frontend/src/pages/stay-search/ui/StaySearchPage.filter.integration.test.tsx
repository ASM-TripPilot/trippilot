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
import { StaySearchPage } from './StaySearchPage';

/**
 * TRIP-415 — 지역·필터 칩 배선(page 몫). 화면은 라우터·시트를 모르므로, 칩 press 가 실제로
 * 라우팅·시트 열기·필터 적용으로 이어지는지는 이 배선 층에서만 확인할 수 있다.
 *
 * 무엇을 보장하나:
 *  - 지역 칩 press → `/explore/region?purpose=stay` 진입(여행지 선택 정본, TRIP-499 재배선 —
 *    통합검색 대신 지역 선택 화면 재사용).
 *  - 필터 칩 press → 시트 열림(`stay-filter-sheet`), 옵션 토글 → [적용] → 고른 조건이
 *    `router.setParams`로 나간다(그 params 가 재조회 URL 에 실리는 것은 기존 AC-8/12 가 담보).
 *
 * 인프라(msw·mock·wrapper)는 기존 `StaySearchPage.integration.test.tsx`와 동형.
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

// 호이스팅 예외를 받으려면 이름이 mock 으로 시작해야 한다(기존 통합테스트 ★10 관례).
let mockSearchParams: {
  region?: string;
  amenity?: string | string[];
  stayType?: string | string[];
} = {};
const mockPush = jest.fn();
const mockSetParams = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    setParams: (...args: unknown[]) => mockSetParams(...args),
  },
}));

const BASE = 'http://localhost:8080/api/v1';

const FIXTURE = {
  items: [
    {
      externalSource: 'NAVER',
      externalId: 'jeju-1',
      name: '테스트 스테이',
      lat: 33.45,
      lng: 126.57,
      region: 'jeju',
      amenities: ['ocean'],
      stayType: 'HOTEL',
      price: { amount: 50000, currency: 'KRW' },
    },
  ],
  degraded: false,
  filterZeroReasons: [],
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockSearchParams = { region: 'jeju' };
  mockPush.mockClear();
  mockSetParams.mockClear();
  server.use(
    http.get(`${BASE}/stays/search`, () => HttpResponse.json(FIXTURE))
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

describe('StaySearchPage — 지역 칩 (TRIP-499 · AC-3)', () => {
  it('지역 칩을 누르면 여행지 선택 /explore/region?purpose=stay 로 간다', async () => {
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByText('테스트 스테이')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('stay-search-filter-region'));

    // 지금 소스는 옛 목적지(/explore/search)로 push → red. stay↔trip 오타는 완전 일치가 잡는다.
    expect(mockPush).toHaveBeenCalledWith('/explore/region?purpose=stay');
  });
});

describe('StaySearchPage — 필터 시트 (TRIP-415)', () => {
  it('필터 칩 → 시트 열림 → 옵션 토글 → 적용 시 그 조건이 setParams 로 나간다', async () => {
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByText('테스트 스테이')).toBeOnTheScreen()
    );

    // 필터 칩 → 시트 열림(gorhom 목이 children 을 무조건 렌더하므로, 시트 컴포넌트가
    // 마운트됐는지=페이지가 열었는지로 관찰한다).
    fireEvent.press(screen.getByTestId('stay-search-filter-more'));
    expect(screen.getByTestId('stay-filter-sheet')).toBeOnTheScreen();

    // 결과 facet 두 축(편의시설 ocean·숙소유형 HOTEL)을 골라 적용 → 두 축 모두 setParams 로
    // 나간다. amenity 만 보면 stayType 배선을 지우거나 오배선해도 통과한다(code-critic W-1).
    fireEvent.press(screen.getByTestId('stay-filter-amenity-ocean'));
    fireEvent.press(screen.getByTestId('stay-filter-staytype-HOTEL'));
    fireEvent.press(screen.getByTestId('stay-filter-apply'));

    expect(mockSetParams).toHaveBeenCalledTimes(1);
    expect(mockSetParams.mock.calls[0][0]).toEqual(
      expect.objectContaining({ amenity: ['ocean'], stayType: ['HOTEL'] })
    );

    // 적용하면 시트가 닫힌다(setSheetOpen(false) — 안 닫으면 이 단언이 red, code-critic N-1).
    expect(screen.queryByTestId('stay-filter-sheet')).toBeNull();
  });

  it('URL 에 이미 필터가 걸려 있으면 "필터" 칩 배지가 적용값 개수를 보인다', async () => {
    // 이미 amenity=ocean 이 적용된 상태로 진입 — 배지는 초안(마운트 시 [])이 아니라
    // 적용값(params)에서 나와야 "1"이다(code-critic W-2 — 초안에서 뽑으면 0으로 거짓말).
    mockSearchParams = { region: 'jeju', amenity: 'ocean' };

    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByText('테스트 스테이')).toBeOnTheScreen()
    );

    expect(screen.getByTestId('stay-search-filter-more')).toHaveTextContent(
      /1/
    );
  });
});
