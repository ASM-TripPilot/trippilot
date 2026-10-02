import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { ReplanDiff } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { useReplanDiff } from './useReplanDiff';

/**
 * TRIP-1007 · AC-1 · US-PLANB-08 — 재계획안 초안 조회 seam 이 실제로 서버의 `GET …/diff` 를 부른다.
 *
 * 왜 따로 두나: 페이지 테스트(`PlanbDraftPage.integration`)는 이 seam 을 통째로 목으로 바꿔 끼운다.
 * 그래서 "seam 이 정말 그 주소를 부르는가"는 거기서 안 보인다 — 여기서 가짜 서버(MSW)를 세워
 * 요청 경로와 응답 전달만 확인한다.
 *
 * 3동작: 준비 = 가짜 서버가 /diff 에 초안을 돌려준다 → 실행 = 훅을 띄운다 → 단언 = 받은 초안 · 요청 1회.
 */

// authedClient(인증 계층)가 @/shared/storage 를 정적으로 문다(useVisitCheck.integration 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';
const DIFF_PATH = '/trips/t1/replan-sessions/s9/diff';

const DIFF: ReplanDiff = {
  ready: true,
  status: 'DRAFT',
  date: '2026-06-11',
  before: [],
  after: [
    {
      slotKey: '2026-06-11#p1',
      startAt: '09:30:00',
      endAt: '10:30:00',
      isFixed: false,
      endsNextDay: false,
    },
  ],
  entries: [
    {
      slotKey: '2026-06-11#p1',
      change: 'ADDED',
      beforeStart: null,
      afterStart: '09:30:00',
    },
  ],
  impact: null,
};

let hits: string[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    hits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  hits = [];
  setAccessToken('a');
  server.use(http.get(`${BASE}${DIFF_PATH}`, () => HttpResponse.json(DIFF)));
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

describe('🔴 H1 · TRIP-1007 AC-1 — useReplanDiff 는 GET …/replan-sessions/{id}/diff 를 부른다', () => {
  it('서버 초안이 data 로 오고, 그 경로로 GET 이 정확히 1번 나간다', async () => {
    const { result } = renderHook(() => useReplanDiff('t1', 's9'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.ready).toBe(true));
    expect(result.current.data?.after.map((slot) => slot.slotKey)).toEqual([
      '2026-06-11#p1',
    ]);
    expect(
      hits.filter((hit) => hit === `GET /api/v1${DIFF_PATH}`)
    ).toHaveLength(1);
  });
});
