import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';

import { server } from '@/mocks/server';
import { BASE } from '@/test-support/apiBase';
import { createWrapper } from '@/test-support/queryRender';
import { clearAccessToken } from '@/shared/api/tokenManager';
import type { Place } from '@/shared/api/index.schemas';

import { useRegions } from './regions';
import { useMultiRegionPlaces } from './useMultiRegionPlaces';

/**
 * TRIP-1348 · 보존 — 지역 카탈로그는 1시간 안에 화면을 오가도 GET /regions 가 1건이다.
 * 피커·랜딩·d02 가 각자 마운트되며 같은 키를 다시 부르던 것을 staleTime 으로 막는다. 요청 수는
 * msw 로만 보인다(기본 handlers 의 /regions 목을 그대로 쓴다).
 */

// authedClient 가 @/shared/storage 를 정적으로 문다(다른 통합 버킷 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue(null),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(false),
}));

let regionHits = 0;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    if (new URL(request.url).pathname === '/api/v1/regions') regionHits += 1;
  });
});
beforeEach(() => {
  regionHits = 0;
  clearAccessToken();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useRegions · staleTime', () => {
  it('피커·랜딩·d02 가 차례로 마운트돼도 GET /regions 는 1건이다', async () => {
    // gcTime 은 기본(5분) 그대로 — 언마운트 뒤에도 캐시가 남는 실제 앱과 같다. staleTime 은 기본 0.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    try {
      for (let screen = 0; screen < 3; screen += 1) {
        const { result, unmount } = renderHook(() => useRegions(), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        unmount();
      }

      expect(regionHits).toBe(1);
    } finally {
      client.clear(); // 실패해도 gc 타이머가 jest 프로세스를 붙잡지 않게
    }
  });
});

/**
 * TRIP-1563 · `useMultiRegionPlaces` 의 시드 계약 (같은 integration 파일에 붙였다 — 이 폴더의 유일한 통합 버킷).
 *
 * 무엇을 보장하나: ① `filters.seed` 가 있으면 지역별 요청 전부가 같은 `order=random&seed` 를 싣고 결과가
 * 지역을 번갈아 놓인다(AC-2·8). ② 없으면 요청에 `order`·`seed` 키 자체가 없고 지역 블록 순서다 — 홈·d01·기록
 * 방문추가가 이 경로다(AC-9). ③ seed 는 캐시 키에 들어가 진입(seed)마다 새로 조회하고, seed 없는 호출부끼리는
 * 계속 캐시를 나눠 쓴다(AC-7).
 *
 * 개념: **캐시 키**는 TanStack Query 가 "이 요청은 저 요청과 같은 물음인가"를 가르는 이름표다. 키가 같으면 이미
 * 받은 답을 재사용하고 서버에 다시 안 묻는다 — seed 를 키에서 빼면 지난 진입의 순서가 조용히 되살아난다.
 */
describe('useMultiRegionPlaces · seed (TRIP-1563)', () => {
  function place(poiId: string, region: string): Place {
    return {
      poiId,
      nameKo: poiId,
      category: '명소',
      lat: 35.1587,
      lng: 129.1604,
      region,
      openingHours: null,
      imageUrl: null,
      tags: [],
      savedCount: 0,
      dataStatus: 'ACTIVE',
    };
  }
  const BY_REGION: Record<string, Place[]> = {
    서울: ['s1', 's2', 's3'].map((id) => place(id, '서울')),
    부산: [place('b1', '부산')],
    제주: ['j1', 'j2'].map((id) => place(id, '제주')),
  };
  const REGIONS = ['서울', '부산', '제주'];

  let placeUrls: URL[] = [];
  beforeAll(() => {
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/places') placeUrls.push(url);
    });
  });
  beforeEach(() => {
    placeUrls = [];
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region') ?? '';
        return HttpResponse.json({
          items: BY_REGION[region] ?? [],
          nextCursor: null,
        });
      })
    );
  });

  /** 캐시를 오래 들고 stale 도 되지 않는 클라이언트 — 재마운트가 캐시를 읽었는지 서버에 다시 물었는지 가른다. */
  function keepAliveClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      },
    });
  }
  const idsOf = (items: Place[]) => items.map((item) => item.poiId);

  it('seed 가 있으면 지역 요청 전부가 같은 order=random&seed 를 싣고 결과가 지역을 번갈아 놓인다', async () => {
    const client = keepAliveClient();
    const { result } = renderHook(
      () => useMultiRegionPlaces(REGIONS, { seed: 'seed-A_1' }),
      { wrapper: createWrapper(client) }
    );
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(placeUrls).toHaveLength(3);
    expect(
      placeUrls.map((url) => url.searchParams.get('region')).sort()
    ).toEqual([...REGIONS].sort());
    placeUrls.forEach((url) => {
      expect(url.searchParams.get('order')).toBe('random');
      expect(url.searchParams.get('seed')).toBe('seed-A_1');
    });
    expect(idsOf(result.current.items)).toEqual([
      's1',
      'b1',
      'j1',
      's2',
      'j2',
      's3',
    ]);
    client.clear();
  });

  it('seed 가 없으면 order·seed 키 자체가 나가지 않고 지역 블록 순서 그대로다', async () => {
    const client = keepAliveClient();
    const { result } = renderHook(() => useMultiRegionPlaces(REGIONS), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(placeUrls).toHaveLength(3);
    placeUrls.forEach((url) => {
      expect(url.searchParams.has('order')).toBe(false);
      expect(url.searchParams.has('seed')).toBe(false);
    });
    expect(idsOf(result.current.items)).toEqual([
      's1',
      's2',
      's3',
      'b1',
      'j1',
      'j2',
    ]);
    client.clear();
  });

  it('seed 없는 호출부끼리는 캐시를 나눠 쓰고, seed 가 다른 호출은 서로 캐시를 안 나눈다', async () => {
    const client = keepAliveClient();
    const wrapper = createWrapper(client);
    const mount = async (filters?: { seed?: string }) => {
      const hook = renderHook(() => useMultiRegionPlaces(REGIONS, filters), {
        wrapper,
      });
      await waitFor(() => expect(hook.result.current.isPending).toBe(false));
      return hook;
    };

    await mount(); // 홈
    expect(placeUrls).toHaveLength(3);
    await mount(); // d01 — 같은 키라 서버에 다시 안 묻는다
    expect(placeUrls).toHaveLength(3);

    await mount({ seed: 'A' }); // d04 진입 1 — 홈이 만든 이름순 캐시를 읽으면 안 된다
    expect(placeUrls).toHaveLength(6);
    await mount({ seed: 'B' }); // d04 진입 2 — 진입 1 의 순서를 읽으면 안 된다
    expect(placeUrls).toHaveLength(9);
    client.clear();
  });
});
