import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';

import { server } from '@/mocks/server';
import { BASE } from '@/test-support/apiBase';
import { createGate } from '@/test-support/mswHookHarness';
import { createGcZeroWrapper, createWrapper } from '@/test-support/queryRender';
import { clearAccessToken } from '@/shared/api/tokenManager';
import * as placesApi from '@/shared/api/generated/places/places';
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

/**
 * TRIP-1617 · `useMultiRegionPlaces` 의 취소 계약 (같은 integration 파일에 붙였다 — 이 폴더의 유일한 통합 버킷).
 *
 * 무엇을 보장하나: ① 지역별 `getPlaces` 호출이 두 번째 인자로 `AbortSignal` 을 받는다(M2). ② 검색어(키)가 바뀌면
 * 옛 키의 호출 전부가 `aborted` 가 되고 새 키의 호출은 아니다(M1). ③ 그 취소가 오류 얼굴(`isError`)로 새지 않고,
 * 늦게 풀린 옛 응답이 새 결과를 덮지도 않는다(M3 — INV-4: 이 훅은 "전부 실패면 throw"라 취소가 새면 오류 얼굴이 뜬다).
 *
 * 개념: **AbortSignal** 은 "그만해" 깃발이다. 요청에 달아 두면 깃발이 올라갈 때(`aborted === true`) 요청이 끊긴다.
 * TanStack Query 는 `queryFn({ signal })` 로 깃발을 주고, 그 깃발을 **읽은** 쿼리만 키가 바뀔 때 실제로 끊는다 —
 * 읽지 않으면(`queryFn: async () =>`) 요청은 끝까지 가므로 타입도 린트도 못 잡는다. 이 describe 가 유일한 그물이다.
 *
 * 스파이 대상은 원 모듈(`generated/places/places`)이다 — 훅은 `index.hooks` 배럴의 `export *` 로 가져오지만,
 * 배럴은 원 모듈의 속성을 getter 로 다시 내보내 호출 때마다 원 모듈에서 읽으므로 원 모듈 스파이가 잡힌다(1회 실행으로 확인).
 */
describe('useMultiRegionPlaces · 키가 바뀌면 이전 요청을 끊는다 (TRIP-1617)', () => {
  const PAIR = ['서울', '부산'];

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

  // 호출을 그대로 통과시키는 스파이 — 실제 요청도 나가고, 넘긴 인자(params, signal)를 기록한다.
  let getPlacesSpy: jest.SpyInstance;
  // 느린 서버의 문 — 실패한 케이스도 끝에 반드시 연다(붙잡힌 응답이 남으면 jest 가 안 끝난다).
  let gate = createGate();
  beforeEach(() => {
    getPlacesSpy = jest.spyOn(placesApi, 'getPlaces');
    gate = createGate();
  });
  afterEach(() => {
    gate.release();
    getPlacesSpy.mockRestore();
  });

  /** 그 검색어(q)로 나간 호출의 두 번째 인자(신호)들. */
  const signalsOf = (q: string): (AbortSignal | undefined)[] =>
    getPlacesSpy.mock.calls
      .filter(([params]) => params?.q === q)
      .map(([, signal]) => signal);

  /** q='a' 만 문 뒤에서 붙잡는 서버 — 나머지 q 는 즉시 답한다. 응답은 `{q}-{지역}` 한 곳씩. */
  function holdSlowQuery() {
    server.use(
      http.get(`${BASE}/places`, async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const q = params.get('q');
        const region = params.get('region') ?? '';
        if (q === 'a') await gate.opened;
        return HttpResponse.json({
          items: [place(`${q}-${region}`, region)],
          nextCursor: null,
        });
      })
    );
  }

  /** 'a' 를 느린 서버에 던져 두 건이 출발한 걸 확인한 뒤 'ab' 로 바꾸고, 'ab' 결과가 도착할 때까지 기다린다. */
  async function switchWhileSlow() {
    holdSlowQuery();
    const isErrorFrames: boolean[] = [];
    const hook = renderHook(
      ({ q }: { q: string }) => {
        const out = useMultiRegionPlaces(PAIR, { q });
        isErrorFrames.push(out.isError);
        return out;
      },
      { wrapper: createGcZeroWrapper(), initialProps: { q: 'a' } }
    );
    // 앵커 — 'a' 가 지역마다 한 건씩 출발했고, 아직 아무도 끊지 않았다(없으면 아래 aborted 단언이 공허하다).
    await waitFor(() => expect(signalsOf('a')).toHaveLength(PAIR.length));

    hook.rerender({ q: 'ab' });
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));
    return { ...hook, isErrorFrames };
  }

  it('M2 · 지역마다 나간 호출이 모두 신호(AbortSignal)를 달고 나간다', async () => {
    holdSlowQuery(); // q='x' 는 문과 무관하게 즉시 답한다

    const { result } = renderHook(
      () => useMultiRegionPlaces(PAIR, { q: 'x' }),
      {
        wrapper: createGcZeroWrapper(),
      }
    );
    await waitFor(() => expect(result.current.isPending).toBe(false));

    // 앵커 — 호출이 실제로 지역 수만큼 있었다(스파이가 안 걸렸으면 0건이라 아래 every 가 공허하다).
    expect(getPlacesSpy).toHaveBeenCalledTimes(PAIR.length);
    getPlacesSpy.mock.calls.forEach(([, signal]) => {
      expect(signal).toBeInstanceOf(AbortSignal);
    });
  });

  it('M1 · 검색어가 바뀌면 옛 검색어의 호출 둘이 모두 aborted 이고 새 검색어의 호출은 아니다', async () => {
    const { result } = await switchWhileSlow();

    const oldSignals = signalsOf('a');
    const newSignals = signalsOf('ab');
    // 호출 수 정확값 — 지역당 정확히 한 건씩(옛 2 + 새 2). 재시도·중복 호출이 끼면 red.
    expect(oldSignals).toHaveLength(PAIR.length);
    expect(newSignals).toHaveLength(PAIR.length);
    oldSignals.forEach((signal) => expect(signal?.aborted).toBe(true));
    newSignals.forEach((signal) => expect(signal?.aborted).toBe(false));
    // 새 결과가 실제로 화면용 목록에 닿았다 — "끊기만 하고 새로 안 묻는" 구현이 아니다.
    expect(result.current.items.map((item) => item.poiId).sort()).toEqual([
      'ab-부산',
      'ab-서울',
    ]);
  });

  it('M3 · 취소 구간 내내 isError 는 한 번도 true 가 아니고, 늦게 풀린 옛 응답이 새 결과를 덮지 않는다', async () => {
    const { result, isErrorFrames } = await switchWhileSlow();

    // 붙잡혀 있던 옛 응답을 이제 푼다 — 끊긴 요청의 뒤늦은 결과가 새 키 결과를 건드리면 안 된다.
    gate.release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    // 앵커 — 프레임이 실제로 여럿 쌓였다(렌더가 없었다면 every 가 공허하다).
    expect(isErrorFrames.length).toBeGreaterThan(1);
    expect(isErrorFrames).not.toContain(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.degraded).toBe(false);
    expect(result.current.items.map((item) => item.poiId).sort()).toEqual([
      'ab-부산',
      'ab-서울',
    ]);
  });
});
