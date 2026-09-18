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
 * TRIP-416 AC-1·2·4·5(배선) — e02 빈 상태 카드 CTA 4종이 실제로 라우터를 부른다는 증거.
 * 화면은 라우터·params 를 모르므로(FSD 경계), 카드 버튼 press 가 진짜로 `/explore/region` 진입·
 * 필터 URL 갱신으로 이어지는지는 이 배선 층에서만 확인할 수 있다.
 *
 * 무엇을 보장하나:
 *  - empty "지역 바꾸기" press → `router.push('/explore/region?purpose=stay')`(상단 지역 칩과
 *    같은 목적지, TRIP-499 재배선 — 여행지 선택 정본).
 *  - empty "필터 완화"(적용필터 있음) press → `router.setParams({amenity:[], stayType:[]})`.
 *  - filter-zero "필터 초기화" press → 전체 해제(위와 동일 동작).
 *  - filter-zero "'{원인}' 필터 해제" press → 원인만 뺀 값으로 `setParams`(조식은 남고 오션뷰만 빠짐).
 *  - 나간 params 가 재조회 URL 에 실리는 것은 기존 AC-8/12(.states.integration.test.tsx)가 담보.
 *
 * 인프라(msw·mock·wrapper)는 `StaySearchPage.filter.integration.test.tsx`를 그대로 복제한다
 * (공용화하지 않는 것이 리포 관례). `StaySearchPage.tsx`는 `import { router } from 'expo-router'`
 * 정적 싱글턴을 쓰므로 목이 `router` 객체를 제공해야 한다(useRouter 훅 아님).
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

// 호이스팅 예외를 받으려면 이름이 mock 으로 시작해야 한다(기존 통합테스트 관례).
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

/** 0건 + 필터 사유 없음 → empty 상태로 접힌다. */
const EMPTY_RESPONSE = { items: [], degraded: false, filterZeroReasons: [] };
/** 0건 + 필터 사유 있음 → filter-zero 상태로 접힌다. */
const FILTER_ZERO_RESPONSE = {
  items: [],
  degraded: false,
  filterZeroReasons: ['amenity:오션뷰'],
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockSearchParams = { region: 'jeju' };
  mockPush.mockClear();
  mockSetParams.mockClear();
  // handlers.ts 에 /stays/search 핸들러가 없다 — it 안에서 상태별 응답을 덮어쓴다.
  server.use(
    http.get(`${BASE}/stays/search`, () => HttpResponse.json(EMPTY_RESPONSE))
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

describe('StaySearchPage — empty 지역 바꾸기 (TRIP-499 · AC-4)', () => {
  it('지역 바꾸기 버튼을 누르면 여행지 선택 /explore/region?purpose=stay 로 push 한다', async () => {
    // 준비: 필터 없는 빈 상태.
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('stay-search-empty')).toBeOnTheScreen()
    );

    // 실행
    fireEvent.press(screen.getByTestId('stay-search-empty-region'));

    // 단언 — 지금 소스는 옛 목적지(/explore/search)로 push → red.
    expect(mockPush).toHaveBeenCalledWith('/explore/region?purpose=stay');
  });
});

describe('StaySearchPage — empty 필터 완화 (AC-2)', () => {
  it('적용필터가 있을 때 필터 완화 버튼을 누르면 전체 해제로 setParams 한다', async () => {
    // 준비: amenity 가 걸린 빈 상태(→ activeFilterCount 1, 버튼 노출).
    mockSearchParams = { region: 'jeju', amenity: '조식' };
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('stay-search-empty')).toBeOnTheScreen()
    );

    // 실행
    fireEvent.press(screen.getByTestId('stay-search-empty-filter'));

    // 단언: amenity/stayType 두 키만 비운다(region 은 merge 로 유지 — 넣지 않는다).
    expect(mockSetParams).toHaveBeenCalledWith({ amenity: [], stayType: [] });
  });
});

describe('StaySearchPage — filter-zero 필터 초기화 (AC-4)', () => {
  it('필터 초기화 버튼을 누르면 전체 해제로 setParams 한다', async () => {
    // 준비: 원인이 있는 filter-zero 상태.
    mockSearchParams = { region: 'jeju', amenity: '오션뷰' };
    server.use(
      http.get(`${BASE}/stays/search`, () =>
        HttpResponse.json(FILTER_ZERO_RESPONSE)
      )
    );
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('stay-search-filterzero')).toBeOnTheScreen()
    );

    // 실행
    fireEvent.press(screen.getByTestId('stay-search-filterzero-reset'));

    // 단언
    expect(mockSetParams).toHaveBeenCalledWith({ amenity: [], stayType: [] });
  });
});

describe('StaySearchPage — filter-zero 원인 필터만 해제 (AC-5)', () => {
  it('원인 필터 해제 버튼을 누르면 원인(오션뷰)만 빠지고 나머지(조식)는 남는다', async () => {
    // 준비: 원인(오션뷰)과 무관한 조식이 함께 걸린 filter-zero 상태.
    mockSearchParams = { region: 'jeju', amenity: ['오션뷰', '조식'] };
    server.use(
      http.get(`${BASE}/stays/search`, () =>
        HttpResponse.json(FILTER_ZERO_RESPONSE)
      )
    );
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('stay-search-filterzero')).toBeOnTheScreen()
    );

    // 실행
    fireEvent.press(screen.getByTestId('stay-search-filterzero-clear'));

    // 단언: filterZeroReasons[0]='amenity:오션뷰' → amenity 에서 오션뷰만 제거, 조식 유지.
    expect(mockSetParams).toHaveBeenCalledWith({
      amenity: ['조식'],
      stayType: [],
    });
  });
});
