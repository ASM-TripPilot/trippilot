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
 * AC-11(재시도 실배선) · AC-12(딥링크 파라미터) — `StaySearchPage`가 `resolveStaySearchState`가
 * 만든 상태를 실제 서버 응답·재요청과 함께 배선한다는 증거.
 *
 * 무엇을 보장하나: partial-failure·error 화면의 재시도 버튼을 누르면 `/stays/search`로 진짜
 * 요청이 한 번 더 나가고(AC-11, `onRetry`=`refetch` 실배선), `useLocalSearchParams`의
 * `amenity`·`stayType`이 나가는 URL 쿼리에 그대로 실린다(AC-12). 인프라(msw·mock·wrapper)는
 * `StaySearchPage.integration.test.tsx`에서 그대로 복사한다(공용화하지 않는 것이 리포 관례).
 */

// authedClient가 타는 mutator의 인증 계층이 @/shared/storage를 정적으로 물고 있다 —
// expo-secure-store 실물 로드를 피하려면 목킹해야 한다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 최상단으로 끌어올려진다 — 팩토리가 참조하는 바깥 변수는 이름이
// `mock`으로 시작해야 호이스팅 예외를 받는다(§5 ★10). 이 이름을 바꾸지 마라.
let mockSearchParams: {
  region?: string;
  amenity?: string;
  stayType?: string;
} = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

const BASE = 'http://localhost:8080/api/v1';

/** partial-failure 모양 1건 응답 — degraded:true라 F5-1의 배너가 뜬다. */
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
  degraded: true,
  filterZeroReasons: [],
};

/** 나가는 요청의 최종 URL 전부(직렬화가 끝난 뒤 값 — msw만 이걸 관찰할 수 있다). */
let observedUrls: string[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedUrls.push(request.url);
  });
});

beforeEach(() => {
  observedUrls = [];
  mockSearchParams = {};
  // handlers.ts에 /stays/search 핸들러가 없다 — afterEach의 resetHandlers()가 지우므로
  // 매 테스트마다 다시 건다(§5 ★11).
  server.use(
    http.get(`${BASE}/stays/search`, () => HttpResponse.json(FIXTURE))
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      // retry:false가 없으면 TanStack Query가 스스로 재시도해 누르기 전에 이미 2건이
      // 된다(F5-2 필수 조건). gcTime:0 — 기본값(5분) 타이머가 테스트 종료 후에도 살아남아
      // Node 프로세스를 붙잡는다(useStaySearch.integration.test.tsx:141-145 실측).
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

function staysHits(): string[] {
  return observedUrls.filter(
    (raw) => new URL(raw).pathname === '/api/v1/stays/search'
  );
}

describe('StaySearchPage — partial-failure 재시도가 실제로 재요청한다 (AC-11)', () => {
  it('재시도 버튼을 누르면 /stays/search로 요청이 한 번 더 나간다', async () => {
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('stay-search-partialfailure')).toBeOnTheScreen()
    );
    // 누르기 전 짝 — 이게 없으면 아래 "2건"이 재요청인지 최초 요청 2번인지 구분이 안 된다.
    expect(staysHits()).toHaveLength(1);

    fireEvent.press(screen.getByTestId('stay-search-partialfailure-retry'));

    await waitFor(() => expect(staysHits()).toHaveLength(2));
  });
});

describe('StaySearchPage — error 재시도가 실제로 재요청한다 (AC-11)', () => {
  it('500 응답 후 재시도 버튼을 누르면 요청이 한 번 더 나간다', async () => {
    // beforeEach가 건 200 핸들러 위에 이 it 안에서 500을 덮어쓴다 — 뒤에 건 것이
    // 이긴다(§5 ★11).
    server.use(
      http.get(
        `${BASE}/stays/search`,
        () => new HttpResponse(null, { status: 500 })
      )
    );

    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('stay-search-error')).toBeOnTheScreen()
    );
    expect(staysHits()).toHaveLength(1);

    fireEvent.press(screen.getByTestId('stay-search-error-retry'));

    await waitFor(() => expect(staysHits()).toHaveLength(2));
  });
});

describe('StaySearchPage — 딥링크 파라미터가 요청 URL에 실린다 (AC-12)', () => {
  const CASES: {
    name: string;
    params: { region?: string; amenity?: string; stayType?: string };
    expectedRegion: string;
    expectedAmenity: string[];
    expectedStayType: string[];
  }[] = [
    {
      name: '파라미터 없음 — region 폴백만',
      params: {},
      expectedRegion: '부산',
      expectedAmenity: [],
      expectedStayType: [],
    },
    {
      name: 'amenity 하나',
      params: { region: '부산', amenity: '조식' },
      expectedRegion: '부산',
      expectedAmenity: ['조식'],
      expectedStayType: [],
    },
    {
      name: 'stayType 하나',
      params: { region: '부산', stayType: 'HOTEL' },
      expectedRegion: '부산',
      expectedAmenity: [],
      expectedStayType: ['HOTEL'],
    },
  ];

  it.each(CASES)(
    '$name',
    async ({ params, expectedRegion, expectedAmenity, expectedStayType }) => {
      mockSearchParams = params;

      render(<StaySearchPage />, { wrapper: createWrapper() });
      await waitFor(() => expect(staysHits().length).toBeGreaterThan(0));

      // 짝 — 호출이 정확히 1건 없으면 아래 URL 단언이 공허해진다.
      expect(staysHits()).toHaveLength(1);
      const url = new URL(staysHits()[0]);
      expect(url.searchParams.get('region')).toBe(expectedRegion);
      expect(url.searchParams.getAll('amenity')).toEqual(expectedAmenity);
      expect(url.searchParams.getAll('stayType')).toEqual(expectedStayType);
      // 브래킷 없음(선례 계승) — axios가 amenity=A&amenity=B로 직렬화한다.
      expect(url.searchParams.getAll('amenity[]')).toEqual([]);
    }
  );
});
