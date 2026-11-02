import { QueryClient } from '@tanstack/react-query';

import { getGetTripsQueryOptions } from '@/shared/api/index.hooks';

import { prefetchTrips } from './prefetchTrips';
import { newTestQueryClient } from '@/test-support/queryRender';

// 생성 API 계층(axios)을 안 타도록 옵션 팩토리만 목으로 — 키는 실물과 같은 모양(['/trips'])으로 둔다.
jest.mock('@/shared/api/index.hooks', () => ({
  getGetTripsQueryOptions: jest.fn(),
}));

const mockOptions = getGetTripsQueryOptions as jest.Mock;

describe('prefetchTrips — 홈 GET /trips 미리 받기 (TRIP-1362)', () => {
  it('홈 useGetTrips() 와 같은 옵션(키·queryFn)으로 캐시를 채운다', async () => {
    const queryFn = jest.fn().mockResolvedValue([{ id: 't1' }]);
    mockOptions.mockReturnValue({ queryKey: ['/trips'], queryFn });
    const client = newTestQueryClient();

    prefetchTrips(client);
    await client.getQueryCache().find({ queryKey: ['/trips'] })?.promise;

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['/trips'])).toEqual([{ id: 't1' }]);
  });

  it('실패해도 던지지 않고 재시도하지 않는다 — 홈의 일반 조회가 다시 묻는다', async () => {
    const queryFn = jest.fn().mockRejectedValue(new Error('offline'));
    mockOptions.mockReturnValue({ queryKey: ['/trips'], queryFn });
    // 전역 기본값처럼 재시도가 켜져 있어도 prefetch 는 끈다.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 1 } },
    });

    expect(() => prefetchTrips(client)).not.toThrow();
    await client
      .getQueryCache()
      .find({ queryKey: ['/trips'] })
      ?.promise?.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
