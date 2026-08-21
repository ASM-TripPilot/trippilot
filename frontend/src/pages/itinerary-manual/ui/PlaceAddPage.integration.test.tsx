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
import { setAccessToken, clearAccessToken } from '@/shared/api/tokenManager';
import type { Place } from '@/shared/api/generated/schemas';

import { PlaceAddPage } from './PlaceAddPage';

/**
 * TRIP-338 · AC-5 (U1 F-3) — h20 장소 검색 배선. `PlaceExplorePage.integration.test.tsx` 대칭.
 *
 * 무엇을 보장하나(심판 대상 = **실제로 나간 요청**이라 msw 로 관찰):
 *  - 🔴 **P1 (★)** 첫 조회의 나간 `/places` URL 쿼리 키가 {region,category} **부분집합**이다 —
 *    **검색어 파라미터가 없다**(계약에 검색어 키가 없음, 클라가 이름으로 거른다).
 *  - 🔴 **P2 (★)** 검색어를 넣어도 **서버를 다시 안 부르고**(히트 수 그대로) 이름(nameKo) 부분일치로
 *    카드가 좁혀진다(`visiblePlaces` 재사용).
 *  - 🔴 **P3** 카테고리 칩은 `category` 파라미터로 **서버를 다시 부른다**.
 *
 * 왜 통합 버킷인가: 최종 직렬화된 URL·재요청 횟수는 msw 만 본다(place-explore 계승). "getPlaces
 * 호출 인자에 검색어 키 부재"(01b ★)의 더 강한 판본 — hook 인자가 아니라 **나간 URL** 을 잰다.
 *
 * 3동작 뼈대: 준비=핸들러/래퍼 → 실행=렌더/입력/칩 → 단언=나간 URL·재요청 수·보이는 카드.
 */

// authedClient(생성 클라이언트가 타는 mutator 의 인증 계층)가 @/shared/storage 를 정적으로 물어
// expo-secure-store 실물을 끌어온다 — 목킹해 격리(place-explore 관례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  router: { back: mockBack, push: mockPush },
  useLocalSearchParams: () => ({ tripId: 't1' }),
}));

const BASE = 'http://localhost:8080/api/v1';

function makePlace(
  poiId: string,
  nameKo: string,
  category: Place['category'],
  savedCount: number
): Place {
  return {
    poiId,
    nameKo,
    category,
    lat: 35.1587,
    lng: 129.1604,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

/** p2 만 이름에 '해' 가 든다 — 검색 '해' → p2 만 남는 걸 재는 급소. */
const PLACES: Place[] = [
  makePlace('p1', '감천문화마을', '명소', 12),
  makePlace('p2', '해운대 해수욕장', '야경', 30),
  makePlace('p3', '전포 카페거리', '카페', 7),
  makePlace('p5', '자갈치 시장', '맛집', 21),
];

let observed: { method: string; url: string }[] = [];

function hitsOf(method: string, pathname: string) {
  return observed.filter(
    (hit) => hit.method === method && new URL(hit.url).pathname === pathname
  );
}

beforeAll(() => {
  // warn: 배선이 검색 외에 부르는 요청(itinerary GET 등)이 있어도 이 검색 심판을 깨지 않는다.
  server.listen({ onUnhandledRequest: 'warn' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

beforeEach(() => {
  observed = [];
  mockBack.mockClear();
  mockPush.mockClear();
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/places`, ({ request }) => {
      const category = new URL(request.url).searchParams.get('category');
      // 응답이 `{items, nextCursor}` 객체다(TRIP-503) — 배열이 아니다.
      return HttpResponse.json({
        items:
          category === null
            ? PLACES
            : PLACES.filter((place) => place.category === category),
        nextCursor: null,
      });
    }),
    // 방어 핸들러 — 배선이 현재 일정을 읽거나 저장해도 검색 심판이 안 깨지게(응답 형태만 최소).
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json({
        itineraryId: 'it1',
        tripId: 't1',
        status: 'PLANNED',
        solveMode: 'MINIMAL',
        generationMode: 'MANUAL',
        isFallback: false,
        generationState: 'COMPLETE',
        days: [{ date: '2026-06-10', slots: [] }],
      })
    ),
    http.get(`${BASE}/trips/:tripId`, () =>
      HttpResponse.json({
        tripId: 't1',
        title: '부산',
        startDate: '2026-06-10',
        endDate: '2026-06-12',
        party: 2,
        preferenceSnapshot: {},
        destinations: [{ seq: 1, region: '부산', nights: 2 }],
        status: 'PLANNED',
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-01T00:00:00Z',
      })
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json({
        itineraryId: 'it1',
        tripId: 't1',
        status: 'PLANNED',
        solveMode: 'MINIMAL',
        generationMode: 'MANUAL',
        isFallback: false,
        generationState: 'COMPLETE',
        days: [{ date: '2026-06-10', slots: [] }],
      })
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    // gcTime 0 — 기본 타이머가 테스트 종료 후에도 Node 프로세스를 붙잡는다(리포 실측).
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

/** 카드가 그려질 때까지 만든다 — 이후 증가분/좁혀짐이 이 칸의 사정거리다. */
async function renderPage() {
  render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
  await waitFor(() =>
    expect(
      screen.getAllByTestId(/^itinerary-place-card-/).length
    ).toBeGreaterThan(0)
  );
}

describe('🔴 P1 · AC-5 (★) — 첫 조회 URL 에 검색어 파라미터가 없다', () => {
  it('나간 /places 쿼리 키가 {region,category} 부분집합이다 (검색어 키 부재)', async () => {
    await renderPage();

    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits.length).toBeGreaterThanOrEqual(1);

    // ★ 나간 URL 쿼리 키가 계약이 허용한 둘(region·category) 밖으로 안 나간다 —
    //   search·q·query·keyword·nameKo 같은 검색어 키가 애초에 안 실린다(클라가 이름으로 거른다).
    const keys = [...new URL(hits[0].url).searchParams.keys()];
    expect(keys.every((k) => k === 'region' || k === 'category')).toBe(true);
  });
});

describe('🔴 P2 · AC-5 (★) — 검색어는 서버를 다시 안 부르고 이름 부분일치로 좁힌다', () => {
  it('검색 "해" → 재요청 0 + 이름에 "해" 든 카드만 남는다', async () => {
    await renderPage();

    const before = hitsOf('GET', '/api/v1/places').length;

    fireEvent.changeText(screen.getByTestId('itinerary-place-search'), '해');

    // 서버를 다시 안 부른다 — 클라 필터(visiblePlaces)라 히트 수가 그대로다.
    await waitFor(() =>
      expect(screen.queryByTestId('itinerary-place-card-p1')).toBeNull()
    );
    expect(hitsOf('GET', '/api/v1/places').length).toBe(before);

    // 이름에 '해' 든 p2 만 남고, 안 든 p1·p3 는 사라진다.
    expect(screen.getByTestId('itinerary-place-card-p2')).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-place-card-p3')).toBeNull();
  });
});

describe('🔴 P3 · AC-5 — 카테고리 칩은 category 파라미터로 서버를 다시 부른다', () => {
  it('맛집 칩 → 두 번째 /places 요청에 category=맛집 이 실린다', async () => {
    await renderPage();

    fireEvent.press(screen.getByTestId('itinerary-place-category-맛집'));

    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(2)
    );
    // URL.searchParams.get 이 퍼센트 인코딩을 자동 디코드 — 한글 enum 비교가 성립한다.
    const second = hitsOf('GET', '/api/v1/places')[1];
    expect(new URL(second.url).searchParams.get('category')).toBe('맛집');
  });
});
