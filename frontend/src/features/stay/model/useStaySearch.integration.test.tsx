import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { getStaysSearch } from '@/shared/api/generated/stays/stays';
import { useStaySearch } from './useStaySearch';

/**
 * TRIP-179 AC-4 · AC-5 — 생성 클라이언트가 나가는 실제 요청(인증·baseURL·배열 직렬화) +
 * `useStaySearch`가 그 경로를 경유한다.
 *
 * 무엇을 보장하나: 생성된 `getStaysSearch`가 인증·baseURL·배열 직렬화를 갖춘 진짜 요청을
 * 내보내고(AC-4, `describe` D-1 — React 없이 생성 함수를 직접 부른다), 도메인 훅
 * `useStaySearch`가 그 경로를 경유해 응답을 그대로 돌려준다(AC-5, `describe` D-2 —
 * `renderHook`으로 훅을 부른다). 층이 다르다는 것을 `describe` 두 개로 가른다.
 *
 * 왜 통합 버킷인가: axios 는 `params` 객체를 **어댑터 안에서** 직렬화하므로, 커스텀 어댑터가
 * 받는 것은 아직 객체다 — 직렬화가 끝난 최종 URL(`amenity=A&amenity=B`)은 msw 만 관찰할
 * 수 있다(`authWiring.integration.test.ts:63`과 같은 `request:start` 관찰 방식).
 *
 * 왜 두 AC가 한 파일인가: 같은 요청 경로를 깊이만 달리해서 본다 — msw 서버 기동·요청
 * 관찰기·목 응답 본문이 전부 공유되므로 파일을 가르면 그 배선이 두 벌이 된다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 응답 shape(`items`·`degraded`·`filterZeroReasons`)이 바뀌지
 * 않는 한 유효하다.
 */

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 @/shared/storage 를 정적으로
// 물고 있다. 이 시나리오는 401 이 없어 실제로 호출되지는 않지만, expo-secure-store 실물
// 로드를 피하려면 authWiring.integration.test.ts:45 와 같은 형태로 목킹해야 한다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

/** authWiring.integration.test.ts:59 와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';

/** price: null 을 일부러 넣어 BR-U1-14(가격 부재는 카드 제외 사유 아님) 모양을 픽스처에도
 * 남긴다. */
const FIXTURE = {
  items: [
    {
      externalSource: 'NAVER',
      externalId: 'stay-1',
      name: '테스트 스테이',
      lat: 33.45,
      lng: 126.57,
      region: 'jeju',
      amenities: ['ocean', 'breakfast'],
      stayType: 'HOTEL',
      price: null,
    },
  ],
  degraded: false,
  filterZeroReasons: [],
};

/** 나가는 요청의 최종 URL 전부(직렬화가 끝난 뒤 값 — msw 만 이걸 관찰할 수 있다). */
let observedUrls: string[] = [];
/** 경로별 Authorization 헤더. */
const observedAuth: Record<string, string | null> = {};

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedUrls.push(request.url);
    observedAuth[new URL(request.url).pathname] =
      request.headers.get('authorization');
  });
});

beforeEach(() => {
  observedUrls = [];
  for (const key of Object.keys(observedAuth)) {
    delete observedAuth[key];
  }
  clearAccessToken();
  // 기본 handlers.ts 에 숙소 핸들러가 없으므로 매 테스트마다 덮어쓴다 — afterEach 의
  // resetHandlers() 가 이전 테스트의 오버라이드를 지우므로 beforeEach 에서 다시 건다.
  server.use(
    http.get(`${BASE}/stays/search`, () => HttpResponse.json(FIXTURE))
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

describe('AC-4 · 생성 클라이언트가 나가는 경로 — 인증·baseURL·배열 직렬화 (D-1, React 없음)', () => {
  it('getStaysSearch가 인증·baseURL·브래킷 없는 배열 쿼리로 요청을 내보내고 응답을 그대로 돌려준다', async () => {
    // 준비
    setAccessToken('valid-access');

    // 실행 — ASCII 값을 쓴다(한글은 퍼센트 인코딩되어 실패 메시지가 안 읽힌다).
    const result = await getStaysSearch({
      region: 'jeju',
      amenity: ['ocean', 'breakfast'],
    });

    // 단언(긍정 짝) — 요청이 실제로 나갔다. 이게 없으면 아래 부정 단언들이 "요청이 아예
    // 안 나가서" 공허하게 통과한다.
    expect(observedUrls).toHaveLength(1);

    const url = new URL(observedUrls[0]);

    // baseURL 이 붙었다.
    expect(url.origin + url.pathname).toBe(`${BASE}/stays/search`);

    // 인증이 붙었다.
    expect(observedAuth[url.pathname]).toBe('Bearer valid-access');

    // amenity 가 브래킷 없이 나갔다(axios 기본 직렬화는 amenity[]=A 형태로 나가 서버가
    // 조용히 무시한다 — 이 둘은 한 쌍으로만 의미가 있다).
    expect(url.searchParams.getAll('amenity')).toEqual(['ocean', 'breakfast']);
    expect(url.searchParams.getAll('amenity[]')).toEqual([]);

    expect(url.searchParams.get('region')).toBe('jeju');

    // mutator 가 AxiosResponse 를 벗겨 body 를 돌려준다는 계약.
    expect(result).toEqual(FIXTURE);
  });
});

describe('AC-5 · useStaySearch가 생성 클라이언트 경로를 경유한다 (D-2)', () => {
  /** useBootstrapGate.test.tsx:53 의 것을 복제한다(그 함수는 그 파일 로컬이고 공용 헬퍼가
   * 아니다) — 사용처가 둘뿐이라 이번 칸에서 공용 헬퍼로 승격시키지 않는다(선행 투자 회피). */
  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: {
        // gcTime: 0 — 기본값(5분)이 만드는 타이머가 테스트 종료 후에도 살아남아 Node
        // 프로세스를 300초 붙잡는다(게이트①-2 보정 W-2, 03b 실측). 검증력·테스트 의미
        // 변화는 없는 위생 수정이다.
        queries: { retry: false, gcTime: 0 },
      },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return Wrapper;
  }

  it('useStaySearch를 호출하면 /stays/search가 호출되고 응답이 그대로 반환된다', async () => {
    // 준비
    setAccessToken('valid-access');

    // 실행 — 가짜 타이머는 쓰지 않는다(waitFor 가 진행하지 않게 된다).
    const { result } = renderHook(() => useStaySearch({ region: 'jeju' }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 단언 — items·degraded·filterZeroReasons 가 그대로 돌아온다.
    expect(result.current.data).toEqual(FIXTURE);

    // 가짜 통과 방지 짝 — 훅이 진짜로 그 경로를 탔다(캐시에서 꺼내 오거나 아무것도 안
    // 부르고 목 데이터를 반환하는 구현을 차단).
    const hitCount = observedUrls.filter(
      (raw) => new URL(raw).pathname === '/api/v1/stays/search'
    ).length;
    expect(hitCount).toBe(1);

    // 단언(게이트①-2 보정 W-1) — 훅이 받은 params 를 실제로 실어 보냈다. hitCount 만으로는
    // params 를 버리거나(구현이 useGetStaysSearch() 로 퇴화) 몰래 다른 값을 덧붙여도 msw
    // 핸들러가 쿼리스트링과 무관하게 매칭해 초록이 나온다(03b 실측) — region 값 자체를
    // 확인해야 그 구멍이 막힌다.
    expect(new URL(observedUrls[0]).searchParams.get('region')).toBe('jeju');
  });

  it('2번째 인자 { enabled: false } 면 요청을 아예 안 보낸다 (TRIP-450 — enabled 매핑의 실효)', async () => {
    // 준비 — 인증은 있어도, enabled:false 면 쿼리가 애초에 안 뜬다.
    setAccessToken('valid-access');

    // 실행 — 통합 검색이 지역을 못 특정했을 때 숙소 쿼리를 끄는 그 경로.
    const { result } = renderHook(
      () => useStaySearch({ region: 'jeju' }, { enabled: false }),
      { wrapper: createWrapper() }
    );

    // enabled:false → react-query 는 fetch 를 시작하지 않는다(fetchStatus 는 'idle').
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

    // 핵심 단언 — /stays/search 로 나간 요청이 0건이다. 도메인 훅이 `{ enabled }` 를 생성 훅의
    // `{ query: { enabled } }` 로 제대로 매핑하지 않으면(예: `{ query: {} }` 로 키가 빠지면)
    // 쿼리가 기본 활성이 돼 이 단언이 red 가 된다 — TRIP-450 AC-4·금지의 "지역 못 찾으면
    // region= 헛호출 0"이 바로 이 실효에 걸려 있다(page 통합 테스트는 훅을 목해 의도만 잠근다).
    const hitCount = observedUrls.filter(
      (raw) => new URL(raw).pathname === '/api/v1/stays/search'
    ).length;
    expect(hitCount).toBe(0);
  });
});
