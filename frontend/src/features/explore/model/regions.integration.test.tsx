import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken } from '@/shared/api/tokenManager';

import { useRegions } from './regions';

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
