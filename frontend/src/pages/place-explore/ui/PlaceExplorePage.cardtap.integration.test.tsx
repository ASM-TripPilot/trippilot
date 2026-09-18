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
import type { Place } from '@/shared/api/generated/schemas';

import { PlaceExplorePage } from './PlaceExplorePage';

/**
 * TRIP-456 · AC-1 — d04 장소 카드 → d06 상세 배선(페이지 층).
 *
 * 무엇을 보장하나: 카드를 누르면 페이지가 **그 카드의 poiId로** `router.push('/explore/places/{poiId}')`
 * 를 부른다. 첫·둘째 카드가 서로 다른 세그먼트를 만드므로 poiId를 하드코딩하면 여기서 갈린다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 조립된 push 문자열"이다 — 화면이 올린 place에서 페이지가
 * URL을 만드는 마지막 조립을 라우터 목으로만 관찰할 수 있다(`PlaceExplorePage.integration.test.tsx` 선례).
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
// push를 화살표로 한 겹 감싸 지연 참조(hoist 함정 회피, PlaceExplorePage.integration 선례).
jest.mock('expo-router', () => ({
  router: { push: (href: string) => mockPush(href) },
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({}),
}));

const BASE = 'http://localhost:8080/api/v1';

function makePlace(poiId: string, nameKo: string, savedCount: number): Place {
  return {
    poiId,
    nameKo,
    category: '문화',
    lat: 35.1,
    lng: 129.1,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

// savedCount 내림차순(visiblePlaces)으로 카드 순서가 p1, p2 로 고정된다.
const PLACES: Place[] = [
  makePlace('p1', '감천문화마을', 30),
  makePlace('p2', '광안리 해변', 10),
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mockPush.mockClear();
  clearAccessToken();
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/places`, () =>
      HttpResponse.json({ items: PLACES, nextCursor: null })
    ),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json([]))
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('AC-1 · d04 카드 → d06 push', () => {
  it('카드를 누르면 그 카드의 poiId로 /explore/places/{poiId} 로 이동한다 (첫·둘째 각자)', async () => {
    // 준비 — 카드가 도착할 때까지.
    render(<PlaceExplorePage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-card-p2')).toBeOnTheScreen()
    );

    // 실행·단언 — 둘째 카드.
    fireEvent.press(screen.getByTestId('explore-places-card-p2'));
    expect(mockPush.mock.calls).toEqual([['/explore/places/p2']]);

    // 첫 카드 — poiId를 하드코딩하면 여기서 갈린다.
    fireEvent.press(screen.getByTestId('explore-places-card-p1'));
    expect(mockPush.mock.calls).toEqual([
      ['/explore/places/p2'],
      ['/explore/places/p1'],
    ]);
  });
});
