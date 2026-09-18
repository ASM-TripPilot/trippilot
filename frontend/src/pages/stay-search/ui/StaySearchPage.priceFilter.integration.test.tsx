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
 * TRIP-457 AC-12·AC-13 — e02 가격대 칩 "복구"(01b Q4 (a) 클라이언트 가격대 필터).
 *
 * 무엇을 보장하나: 현재 `handlePressFilter` 에 `axis==='price'` 분기가 **아예 없어** 가격대 칩이
 * 무동작이다(이 티켓이 고치는 결함). 복구 후 가격대 칩 → 가격대 시트 열림 → 버킷 선택 → 페이지가
 * `priceRangeFilter` 로 `items` 를 파생 필터해 화면 목록이 좁혀진다. 지역 칩·필터 시트 기존 배선은
 * 무회귀(AC-13).
 *
 * *(개념·★F-11)* gorhom 목이 통과 컴포넌트라 실제 시트 열림은 무심판 — "페이지가 시트를
 * 마운트했나(testID present)"·"목록이 실제로 좁혀졌나"만 잰다. 실 슬라이드/딤은 6-b 실기.
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

const CHEAP: StayItem = {
  externalSource: 'NAVER',
  externalId: 'cheap',
  name: '게스트하우스 알뜰',
  lat: 35.1,
  lng: 129.1,
  region: '부산',
  amenities: [],
  stayType: 'GUESTHOUSE',
  price: { amount: 50000, currency: 'KRW' },
};
const LUX: StayItem = {
  externalSource: 'NAVER',
  externalId: 'lux',
  name: '오션 스위트',
  lat: 35.2,
  lng: 129.2,
  region: '부산',
  amenities: ['ocean'],
  stayType: 'HOTEL',
  price: { amount: 250000, currency: 'KRW' },
};
const KEY_CHEAP = `${CHEAP.externalSource}:${CHEAP.externalId}`;
const KEY_LUX = `${LUX.externalSource}:${LUX.externalId}`;

const SEARCH_RESPONSE = {
  items: [CHEAP, LUX],
  degraded: false,
  filterZeroReasons: [],
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockSearchParams = { region: '부산' };
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

describe('PF1·PF2 · 가격대 칩 복구 (AC-12)', () => {
  it('가격대 칩 → 시트 열림 → over-200k 선택 → 저가 카드가 사라진다', async () => {
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId(`stay-card-${KEY_CHEAP}`)).toBeOnTheScreen();
      expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen();
    });

    // 무동작 아님 — 가격대 시트가 열린다(이 티켓이 고치는 결함).
    fireEvent.press(screen.getByTestId('stay-search-filter-price'));
    expect(screen.getByTestId('stay-price-sheet')).toBeOnTheScreen();

    // over-200k 선택 → 목록이 파생 필터된다(50k 게스트하우스가 빠지고 250k 만 남는다).
    fireEvent.press(screen.getByTestId('stay-price-option-over-200k'));

    expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`stay-card-${KEY_CHEAP}`)).toBeNull();
  });
});

describe('PF3 · 지역 칩 무회귀 (TRIP-499 · AC-3)', () => {
  it('지역 칩은 여행지 선택 /explore/region?purpose=stay 로 간다', async () => {
    // AC-3 본체(filter.integration)와 같은 소스 push 사이트(StaySearchPage.tsx:109)를 누른다 —
    // 그 사이트가 하나뿐이라, 여기 목적지를 갱신하지 않으면 구현이 이 파일을 영구 red 로 만든다.
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('stay-search-filter-region'));

    expect(mockPush).toHaveBeenCalledWith('/explore/region?purpose=stay');
  });
});
