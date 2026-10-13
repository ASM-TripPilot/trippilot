import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useQueryDataUpdateCount } from './useQueryDataUpdateCount';

/**
 * `useQueryDataUpdateCount` — 캐시 속 쿼리의 `dataUpdateCount` 를 **구독으로** 읽는다(TRIP-1364).
 * 렌더 중 `queryClient.getQueryState()` 직접 읽기는 React Compiler 가 "순수"로 보고 memo 해 첫 값에 굳는다.
 */

const KEY = ['itinerary', 't1'] as const;

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('useQueryDataUpdateCount', () => {
  it('캐시에 쿼리가 없으면 0', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useQueryDataUpdateCount(KEY), {
      wrapper,
    });
    expect(result.current).toBe(0);
  });

  it('마운트 때 이미 쌓인 값을 처음부터 보여 준다', () => {
    const { client, wrapper } = setup();
    for (let i = 0; i < 3; i += 1) client.setQueryData(KEY, { n: i });
    const { result } = renderHook(() => useQueryDataUpdateCount(KEY), {
      wrapper,
    });
    expect(result.current).toBe(3);
  });

  it('호스트가 따로 다시 그려지지 않아도 캐시가 갱신되면 값이 따라온다 (30회째까지)', () => {
    const { client, wrapper } = setup();
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useQueryDataUpdateCount(KEY);
      },
      { wrapper }
    );
    expect(result.current).toBe(0);
    for (let i = 1; i <= 30; i += 1) {
      act(() => {
        client.setQueryData(KEY, { n: i });
      });
      expect(result.current).toBe(i);
    }
    expect(renders).toBeLessThanOrEqual(32);
  });

  it('다른 키의 갱신에는 반응하지 않는다(값 그대로·재그림 없음)', () => {
    const { client, wrapper } = setup();
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        return useQueryDataUpdateCount(KEY);
      },
      { wrapper }
    );
    const before = renders;
    act(() => {
      client.setQueryData(['other'], 1);
    });
    expect(renders).toBe(before);
  });

  it('렌더마다 새 배열 키를 넘겨도 구독이 흔들리지 않고 값이 맞다', () => {
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(
      () => useQueryDataUpdateCount([...KEY]),
      { wrapper }
    );
    rerender({});
    act(() => {
      client.setQueryData(KEY, 1);
    });
    expect(result.current).toBe(1);
  });
});
