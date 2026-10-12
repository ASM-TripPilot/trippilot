import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';

/**
 * 실 `QueryClient` 아래에서 그리는 공용 헬퍼(TRIP-1350 — 옛 `myPageItineraries` 의 `newTestQueryClient`·
 * `renderWithQueryClient`·`settle` 을 일반화해 옮겼다). 테스트 파일마다 `createWrapper`·`newClient` 를 복사해 쓰던 자리를 대신한다.
 *
 * 모듈 스코프 파일이라 NativeWind babel 이 주입하는 `_ReactNativeCSSInterop` 참조가 `jest.mock` 팩토리 스코프로 걸리지
 * 않는다(`expoRouterStackMock`·`queryClientProbe` 와 같은 이유) — JSX 를 쓰는 헬퍼는 이 형태로만 공유한다.
 */

/** 재시도 0 · 캐시 유지(기본 `Infinity`) 테스트용 클라이언트. 언마운트 직후 캐시를 비워야 하면 `gcTime: 0`. */
export function newTestQueryClient({
  gcTime = Infinity,
}: { gcTime?: number } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime },
      mutations: { retry: false },
    },
  });
}

/** `render(ui, { wrapper })` / `renderHook(fn, { wrapper })` 에 넘기는 Provider 래퍼. */
export function createWrapper(
  client: QueryClient = newTestQueryClient()
): ({ children }: { children: ReactNode }) => ReactElement {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

/** 실 `QueryClient` 아래에서 그린다 — `useQueries` 는 Provider 가 없으면 여행 0건이어도 던진다. */
export function renderWithQueryClient(
  ui: ReactElement,
  client: QueryClient = newTestQueryClient()
) {
  return { client, ...render(ui, { wrapper: createWrapper(client) }) };
}

/** 비동기 전부 흘려보내기 — react-query 알림은 setTimeout(0)(h06 doneBar·ongoing 선례). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
