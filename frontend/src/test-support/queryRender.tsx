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

/** 재시도 0 · 캐시 유지(기본 `Infinity`) 테스트용 클라이언트. 언마운트 직후 캐시를 비워야 하면 `gcTime: 0` —
 * mutations 에도 같이 걸린다(mutation 기본 gcTime 5분 타이머가 테스트 종료 뒤 Node 를 붙잡는다, TRIP-1355).
 * `staleTime` 은 조회에만 걸리고 안 주면 키 자체를 넣지 않는다(라이브러리 기본 0). */
export function newTestQueryClient({
  gcTime = Infinity,
  staleTime,
}: { gcTime?: number; staleTime?: number } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime,
        ...(staleTime !== undefined ? { staleTime } : {}),
      },
      mutations: { retry: false, gcTime },
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

/** `gcTime: 0` 클라이언트를 새로 만든 래퍼 — 언마운트 직후 캐시가 비는 통합 테스트용(`createWrapper(newTestQueryClient({ gcTime: 0 }))` 의 줄임). */
export function createGcZeroWrapper(): ({
  children,
}: {
  children: ReactNode;
}) => ReactElement {
  return createWrapper(newTestQueryClient({ gcTime: 0 }));
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
