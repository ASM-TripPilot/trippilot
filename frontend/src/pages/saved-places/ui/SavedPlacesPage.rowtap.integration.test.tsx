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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { SavedPlacesPage } from './SavedPlacesPage';

/**
 * TRIP-456 · AC-2 — d02 담은 장소 행 → d06 상세 배선(페이지 층).
 *
 * 무엇을 보장하나: 행을 누르면 push 세그먼트가 **place.poiId** 다 — 행 키인 savedPlaceId 가 아니다.
 * 둘을 일부러 다른 값으로 두었으므로, 세그먼트를 savedPlaceId 로 바꾸는 뮤테이션은 여기서 red 다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "조립된 push 문자열의 세그먼트"다 — 낙관 표식·정렬을 거친 뒤의
 * 최종 poiId 는 msw 목록에서 나온 실데이터라야 의미가 있다(`SavedPlacesPage.integration` 선례).
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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (href: string) => mockPush(href), back: () => {} },
  useRouter: () => ({ push: mockPush, back: () => {} }),
  useLocalSearchParams: () => ({}),
}));

const BASE = 'http://localhost:8080/api/v1';

function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1,
    lng: 129.1,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 3,
    dataStatus: 'ACTIVE',
  };
}

// ★ savedPlaceId('saved-x') ≠ place.poiId('p9') — push 는 place.poiId 여야 한다.
const ROWS: SavedPlace[] = [
  {
    savedPlaceId: 'saved-x',
    savedAt: '2026-08-01T00:00:00Z',
    place: makePlace('p9', '감천문화마을'),
  },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockPush.mockClear();
  clearAccessToken();
  setAccessToken('valid-access');
  // /saved-stays 는 handlers.ts 기본 목([])이 커버한다.
  server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json(ROWS)));
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

describe('AC-2 · d02 행 → d06 push', () => {
  it('행을 누르면 place.poiId 로 이동한다 — 행 키(savedPlaceId)가 아니다', async () => {
    // 준비 — 담은 장소 1건이 도착할 때까지.
    render(<SavedPlacesPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-item-saved-x')).toBeOnTheScreen()
    );

    // 실행 — 행 본문(savedPlaceId testID)을 누른다.
    fireEvent.press(screen.getByTestId('explore-saved-item-saved-x'));

    // 단언 — 세그먼트는 place.poiId. savedPlaceId 를 실으면 red(뮤테이션 잠금).
    expect(mockPush.mock.calls).toEqual([['/explore/places/p9']]);
  });
});
