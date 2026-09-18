import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { StaySearchPage } from './StaySearchPage';

/**
 * AC-8 — `StaySearchPage` 배선: `useLocalSearchParams`의 `region`(없으면 `'부산'` 폴백)으로
 * `useStaySearch({ region })`을 호출하고, 그 region이 실제 요청 URL에 실린다.
 *
 * 왜 통합 버킷인가: axios는 params 객체를 어댑터 **안에서** 직렬화하므로, 커스텀 어댑터가
 * 받는 시점엔 아직 객체다 — 직렬화가 끝난 최종 URL은 msw만 관찰할 수 있다
 * (`useStaySearch.integration.test.tsx:20-22` 계승).
 */

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 @/shared/storage를 정적으로
// 물고 있다 — expo-secure-store 실물 로드를 피하려면 목킹해야 한다
// (useStaySearch.integration.test.tsx:35-43과 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// 케이스마다 정해진 쿼리 파라미터를 돌려주는 최소 목(devPreviewHome.test.tsx:22-26과 동형).
let mockSearchParams: { region?: string } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

/** authWiring.integration.test.ts:59와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';

/** msw가 돌려줄 1건 응답 — 화면까지 실제로 데이터가 흘렀는지 이름으로 확인한다. */
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
  degraded: false,
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
  // 기본 handlers.ts에 stays 핸들러가 0건이므로 매 테스트마다 건다 — afterEach의
  // resetHandlers()가 이전 테스트의 오버라이드를 지우므로 beforeEach에서 다시 건다
  // (useStaySearch.integration.test.tsx:88 사유 동일).
  server.use(
    http.get(`${BASE}/stays/search`, () => HttpResponse.json(FIXTURE))
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

/** useBootstrapGate.test.tsx:53 · useStaySearch.integration.test.tsx:139의 것과 동형. */
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime: 0 — 기본값(5분)이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를
      // 300초 붙잡는다(useStaySearch.integration.test.tsx:141-145 실측).
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

describe('StaySearchPage — region이 요청 URL에 그대로 실린다 (AC-8)', () => {
  it('쿼리 파라미터의 region이 /stays/search 요청 URL에 실리고 응답이 화면까지 흐른다', async () => {
    // 준비 — ASCII 값을 쓴다(한글은 퍼센트 인코딩되어 실패 메시지를 읽을 수 없다,
    // useStaySearch.integration.test.tsx:106 관례).
    mockSearchParams = { region: 'jeju' };

    // 실행
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByText('테스트 스테이')).toBeOnTheScreen()
    );

    // 단언 — 호출이 정확히 1건 없으면 아래 URL 단언이 "요청이 아예 안 나가서" 공허해진다.
    const hits = observedUrls.filter(
      (raw) => new URL(raw).pathname === '/api/v1/stays/search'
    );
    expect(hits).toHaveLength(1);
    expect(new URL(hits[0]).searchParams.get('region')).toBe('jeju');
  });
});

describe('StaySearchPage — region이 없으면 부산으로 떨어진다 (AC-8 폴백)', () => {
  it('useLocalSearchParams가 빈 객체를 주면 region=부산으로 요청이 나간다', async () => {
    mockSearchParams = {};

    render(<StaySearchPage />, { wrapper: createWrapper() });

    // useQuery는 첫 렌더에 data가 undefined다 — 페이지가 data.items로 접근하면 여기서
    // TypeError로 죽는다. `data?.items ?? []` 방어의 유일한 심판이 이 렌더다(Seed §3).
    // 빈 결과 화면 자체(헤더 '부산 · 날짜 미정 · 0곳')는 TRIP-182 범위라 여기서 보지 않는다.
    await waitFor(() => expect(observedUrls.length).toBeGreaterThan(0));

    const hits = observedUrls.filter(
      (raw) => new URL(raw).pathname === '/api/v1/stays/search'
    );
    expect(hits).toHaveLength(1);
    // URL.searchParams.get()이 퍼센트 인코딩을 자동으로 되돌리므로 한글 비교가 성립한다.
    // '부산'은 폴백 계약값 자체라 ASCII로 바꿀 수 없다.
    expect(new URL(hits[0]).searchParams.get('region')).toBe('부산');
  });
});
