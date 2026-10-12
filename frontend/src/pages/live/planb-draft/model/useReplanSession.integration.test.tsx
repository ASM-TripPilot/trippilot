import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { ReplanSession } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { useReplanSession } from './useReplanSession';

/**
 * TRIP-1348 · INV-4 — 재계획 세션 조회 폴링(오류 1회는 한 번 더, 연속 2회면 정지).
 *
 * 페이지 테스트(`PlanbSolvingPage`·`PlanbDraftPage`)는 이 seam 을 통째로 목으로 바꿔 끼워 폴링이
 * 실제로 도는지·언제 서는지 안 보인다 — 여기서 가짜 서버(MSW)와 실타이머로 요청 수를 잰다.
 *
 * 3동작: 준비 = 서버가 SOLVING 을 주다가 두 번째부터 500 → 실행 = 훅을 띄우고 폴링 간격보다 길게 기다린다
 * → 단언 = 오류로 떨어진 뒤(옛 data.status 는 아직 SOLVING) 다음 폴링이 나가지 않는다.
 */

// authedClient(인증 계층)가 @/shared/storage 를 정적으로 문다(useReplanDiff.integration 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';
const PATH = '/trips/t1/replan-sessions/s9';
/** useReplanSession 의 POLL_INTERVAL_MS(2000) 보다 길게 — 오류 뒤 다음 폴링이 있었다면 잡힐 시간. */
const LONGER_THAN_POLL_MS = 2600;

function makeSession(status: ReplanSession['status']): ReplanSession {
  return {
    sessionId: 's9',
    tripId: 't1',
    itineraryId: 'i1',
    scope: 'FULL_DAY',
    targetDate: '2026-06-11',
    fromInstant: '2026-06-11T10:00:00+09:00',
    originKind: 'GPS',
    originEstimated: false,
    status,
    createdAt: '2026-06-11T10:00:00+09:00',
  };
}

let hits = 0;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  hits = 0;
  setAccessToken('a');
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('useReplanSession · 폴링', () => {
  it('SOLVING 이면 간격마다 다시 묻는다 (앵커 — 폴링이 실제로 돈다)', async () => {
    server.use(
      http.get(`${BASE}${PATH}`, () => {
        hits += 1;
        return HttpResponse.json(makeSession('SOLVING'));
      })
    );
    renderHook(() => useReplanSession('t1', 's9'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(hits).toBeGreaterThanOrEqual(2), {
      timeout: 4000,
    });
  });

  it('오류 1회면 정확히 한 번 더 요청하고, 그게 성공하면 오류 없이 폴링을 이어 간다 (일시 오류 복구)', async () => {
    server.use(
      http.get(`${BASE}${PATH}`, () => {
        hits += 1;
        return hits === 2
          ? HttpResponse.json({ code: 'INTERNAL' }, { status: 500 })
          : HttpResponse.json(makeSession('SOLVING'));
      })
    );
    const { result } = renderHook(() => useReplanSession('t1', 's9'), {
      wrapper: createWrapper(),
    });
    // 1번 SOLVING → 2번 500 → 3번(재시도) SOLVING → 그다음 폴링(4번)까지 이어진다.
    await waitFor(() => expect(hits).toBeGreaterThanOrEqual(4), {
      timeout: 9000,
    });
    expect(result.current.isError).toBe(false);
    expect(result.current.data?.status).toBe('SOLVING');
  }, 14000);

  it('연속 2회 실패하면 폴링을 멈춘다 — 옛 data.status 가 SOLVING 이어도 더 묻지 않고 오류가 선다', async () => {
    server.use(
      http.get(`${BASE}${PATH}`, () => {
        hits += 1;
        return hits === 1
          ? HttpResponse.json(makeSession('SOLVING'))
          : HttpResponse.json({ code: 'INTERNAL' }, { status: 500 });
      })
    );
    const { result } = renderHook(() => useReplanSession('t1', 's9'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 9000,
    });
    // 앵커 — 옛 SOLVING 데이터가 남은 채 오류다. 이게 아니면 아래 단언이 공허하다.
    expect(result.current.data?.status).toBe('SOLVING');
    // 1(SOLVING) + 2(실패) + 3(재시도 1건, 실패) — 재시도는 한 번뿐이다.
    expect(hits).toBe(3);

    await sleep(LONGER_THAN_POLL_MS);

    expect(hits).toBe(3);
  }, 16000);
});
