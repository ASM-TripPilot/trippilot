import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { StayItem } from '@/shared/api/generated/schemas';
import { regionPickerHref } from '@/features/explore/model/regionPickerPurpose';
import {
  PRICE_BUCKETS,
  type PriceBucketId,
} from '@/features/stay/model/priceRangeFilter';
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

let mockSearchParams: { region?: string; amenity?: string } = {};
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

    // 철자는 공유 헬퍼 출력으로 잠근다(TRIP-989 F — 985 철자 사슬의 stay 고리).
    expect(mockPush).toHaveBeenCalledWith(regionPickerHref('stay'));
  });
});

// ── TRIP-989 E · Q4 ─────────────────────────────────────────────────────────────────────
// 가격대는 서버 파라미터가 없어 클라이언트에서만 거른다(BR-U1-15, priceRangeFilter). 그래서 가격 때문에
// 0곳이 되면 서버 filterZeroReasons 가 비어 **empty** 얼굴이 된다 — 사용자가 보는 탈출구는 "필터 완화"다
// (02a ★4). 표본 버킷은 5만·25만 두 장을 다 빼는 100k-200k 다(★5).

/** 0건 + 필터 사유 있음 → filter-zero(가격이 아니라 amenity 가 원인). */
const FILTER_ZERO_RESPONSE = {
  items: [],
  degraded: false,
  filterZeroReasons: ['amenity:오션뷰'],
};

function priceChip() {
  return screen.getByTestId('stay-search-filter-price');
}

function bucketLabel(id: PriceBucketId): string {
  const label = PRICE_BUCKETS.find((bucket) => bucket.id === id)?.label;
  if (!label) throw new Error(`PRICE_BUCKETS 에 ${id} 가 없다`);
  return label;
}

/** 가격대 칩 → 시트 → 버킷 선택. 시트는 고른 뒤에도 열려 있어 같은 라벨이 두 곳에 뜬다(★6). */
function applyPrice(id: PriceBucketId): void {
  fireEvent.press(priceChip());
  fireEvent.press(screen.getByTestId(`stay-price-option-${id}`));
}

/** 가격대 칩이 "안 걸린" 얼굴인가 — 선택 아님 + 라벨 "가격대". */
function expectPriceCleared(): void {
  expect(priceChip()).not.toBeSelected();
  expect(within(priceChip()).getByText('가격대')).toBeOnTheScreen();
}

describe('E-2 · 가격대도 적용 필터로 센다 (TRIP-989 · 01b Q1 · BR-U1-16)', () => {
  it('가격대만 걸어도 "필터" 배지가 1이 되고, 0곳 카드의 "필터 완화"가 켜진다', async () => {
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
    );
    // 준비 확인: 아무 필터도 없으면 배지 숫자가 없다.
    expect(screen.getByTestId('stay-search-filter-more')).not.toHaveTextContent(
      /\d/
    );

    applyPrice('100k-200k');

    expect(screen.getByTestId('stay-search-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-search-filter-more')).toHaveTextContent(
      /1/
    );
    expect(screen.getByTestId('stay-search-empty-filter')).not.toBeDisabled();
    expect(priceChip()).toBeSelected();
  });
});

describe('E-3 · 가격 때문에 0곳 → "필터 완화"로 빠져나온다 (TRIP-989 · 01b E · INV-4)', () => {
  it('empty "필터 완화"를 누르면 가격대가 풀리고 두 카드가 다시 보인다', async () => {
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
    );
    applyPrice('100k-200k');
    expect(screen.getByTestId('stay-search-empty')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('stay-search-empty-filter'));

    expect(screen.getByTestId(`stay-card-${KEY_CHEAP}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen();
    expectPriceCleared();
  });

  it('filter-zero "필터 초기화"도 가격대까지 푼다', async () => {
    mockSearchParams = { region: '부산', amenity: '오션뷰' };
    server.use(
      http.get(`${BASE}/stays/search`, () =>
        HttpResponse.json(FILTER_ZERO_RESPONSE)
      )
    );
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('stay-search-filterzero')).toBeOnTheScreen()
    );
    applyPrice('over-200k');
    expect(priceChip()).toBeSelected();

    fireEvent.press(screen.getByTestId('stay-search-filterzero-reset'));

    expectPriceCleared();
  });
});

// Q4 — 지역 선택이 dismissTo 로 **같은 결과 화면 인스턴스**에 돌아오므로(F), 로컬 state 인 가격대·
// 검색어가 남는다. params 목을 바꿔 rerender 해 그 순간을 흉내 낸다(02a ★7).
describe('Q4 · 지역이 바뀌면 가격대·검색어를 비운다 (TRIP-989 F · 01b Q4)', () => {
  it('다른 지역으로 돌아오면 가격대 칩이 풀리고 검색창이 빈다', async () => {
    const { rerender } = render(<StaySearchPage />, {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
    );
    applyPrice('over-200k');
    fireEvent.changeText(screen.getByTestId('stay-search-name-input'), '오션');
    expect(priceChip()).toBeSelected();

    mockSearchParams = { region: '무주' };
    rerender(<StaySearchPage />);

    expectPriceCleared();
    expect(screen.getByTestId('stay-search-name-input')).toHaveDisplayValue('');
  });

  it('짝: 지역은 그대로이고 다른 조건만 바뀌면 가격대·검색어가 남는다', async () => {
    const { rerender } = render(<StaySearchPage />, {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(screen.getByTestId(`stay-card-${KEY_LUX}`)).toBeOnTheScreen()
    );
    applyPrice('over-200k');
    fireEvent.changeText(screen.getByTestId('stay-search-name-input'), '오션');
    expect(priceChip()).toBeSelected();

    mockSearchParams = { region: '부산', amenity: '오션뷰' };
    rerender(<StaySearchPage />);

    expect(priceChip()).toBeSelected();
    expect(
      within(priceChip()).getByText(bucketLabel('over-200k'))
    ).toBeOnTheScreen();
    expect(screen.getByTestId('stay-search-name-input')).toHaveDisplayValue(
      '오션'
    );
  });
});
