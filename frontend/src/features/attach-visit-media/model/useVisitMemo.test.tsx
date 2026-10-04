import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { flushNotifications } from '@/test-support/flushNotifications';

import { useSavedVisitMemos, useVisitMemo } from './useVisitMemo';

/**
 * TRIP-1203 · 방문 여러 개의 메모 세션 저장본을 한 번에 읽는 훅(`useSavedVisitMemos`).
 *
 * 무엇을 보장하나:
 *  - 받은 방문 id 마다 키가 있고, 저장본이 없으면 null 이다(빈 목록이면 빈 객체).
 *  - `useVisitMemo` 가 저장한 값과 **같은 캐시 키**를 읽는다 — j01·허브 관람 중 시트·허브 완료 카드가 한 벌의
 *    세션 저장본을 본다(키를 두 곳에 적지 않는다).
 *  - 구독이다 — 렌더 뒤에 저장돼도 다시 그려진다(렌더 중 한 번 읽기면 낡은 값이 남는다, 02a ★4).
 *  - 방문 수가 렌더마다 바뀌어도 동작한다 — 완료 카드 수는 렌더마다 달라서 반복문 안 훅 호출은 못 쓴다.
 *
 * 서버 메모 PUT 은 목(가짜 함수)으로 바꾼다 — 이 파일은 네트워크 없는 단위 버킷이다.
 * (개념) `renderHook` = 훅을 화면 없이 실행해 `result.current` 로 반환값을 읽는 도구 ·
 *   `flushNotifications()` = react-query 가 예약한 재렌더 알림이 끝날 때까지 기다리기(traps-record — act 직후
 *   곧바로 읽으면 옛 값을 볼 수 있다).
 * 3동작: 준비(QueryClient·PUT 목) → 실행(saveMemo·id 목록 바꾸기) → 단언(id → 저장본 맵).
 */

const mockPut = jest.fn();
jest.mock('@/shared/api/index.hooks', () => ({
  putTripsTripIdVisitsVisitCheckIdMemo: (...args: unknown[]) =>
    mockPut(...args),
}));

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockPut.mockReset().mockResolvedValue({ text: 'ok' });
});
afterEach(() => client.clear());

describe('useSavedVisitMemos (TRIP-1203)', () => {
  it('U1 방문 id 가 없으면 빈 객체다', () => {
    const { result } = renderHook(
      () => useSavedVisitMemos({ tripId: 't1', visitCheckIds: [] }),
      { wrapper }
    );

    expect(result.current).toEqual({});
  });

  it('U2 useVisitMemo 로 저장한 본문이 같은 키로 보이고(구독), 저장 안 한 방문은 null 이다', async () => {
    // 준비 — 한 방문의 저장 훅과 두 방문의 읽기 훅을 함께 돌린다.
    const { result } = renderHook(
      () => ({
        single: useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
        saved: useSavedVisitMemos({
          tripId: 't1',
          visitCheckIds: ['v1', 'v2'],
        }),
      }),
      { wrapper }
    );
    // 앵커 — 저장 전엔 둘 다 null.
    expect(result.current.saved).toEqual({ v1: null, v2: null });

    // 실행 — 앞뒤 공백 있는 본문을 저장한다.
    await act(async () => {
      await result.current.single.saveMemo('  바다  ');
    });
    await flushNotifications();

    // 단언 — 서버엔 v1 로 1회, 읽기 훅은 다시 마운트 없이 새 값을 본다.
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith('t1', 'v1', { text: '바다' });
    expect(result.current.saved).toEqual({ v1: '바다', v2: null });
  });

  it('U3 방문 id 목록이 늘어도(2 → 3개) 같은 훅이 새 id 까지 담는다', async () => {
    // 준비 — v1 에 저장본을 만들어 둔 상태.
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => ({
        single: useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
        saved: useSavedVisitMemos({ tripId: 't1', visitCheckIds: ids }),
      }),
      { wrapper, initialProps: { ids: ['v1', 'v2'] } }
    );
    await act(async () => {
      await result.current.single.saveMemo('바다');
    });
    await flushNotifications();

    // 실행 — 완료 카드가 하나 늘었다.
    rerender({ ids: ['v1', 'v2', 'v3'] });
    await flushNotifications();

    // 단언
    expect(result.current.saved).toEqual({ v1: '바다', v2: null, v3: null });
  });
});
