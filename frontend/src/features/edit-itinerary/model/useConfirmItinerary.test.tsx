import type { ReactNode } from 'react';
import { AxiosError } from 'axios';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';

import { useConfirmItinerary } from './useConfirmItinerary';

/**
 * TRIP-1357 · 확정 POST 의 공통 부수효과(응답 → 조회 캐시 쓰기 · 409 만 재조회)를 한 곳에 둔 훅.
 *
 * 무엇을 보장하나:
 *  - 성공하면 응답을 일정 조회 캐시에 그대로 써넣고(재조회 0), 그 뒤에 호출부가 넘긴 `onConfirmed` 를 1회 부른다.
 *  - 409 만 조회 캐시를 무효화한다(서버 진실이 이미 확정일 수 있다). 500 등은 재조회하지 않는다.
 * 성공 뒤 이동·press 가드 창·위저드 비우기는 훅이 모른다 — 페이지가 콜백으로 쥔다.
 *
 * 네트워크 없는 단위 버킷 — 생성 훅을 가짜로 바꿔 훅이 넘긴 옵션을 직접 불러 본다.
 * 3동작: 준비(옵션 캡처) → 실행(onSuccess/onError 호출) → 단언(캐시·콜백).
 */

type Options = {
  mutation: {
    onSuccess: (data: unknown) => void;
    onError: (error: unknown) => void;
  };
};
let captured: Options | undefined;
jest.mock('@/shared/api/index.hooks', () => ({
  getGetTripsTripIdItineraryQueryKey: (tripId: string) => ['itinerary', tripId],
  usePostTripsTripIdItineraryConfirm: (options: Options) => {
    captured = options;
    return { mutate: jest.fn() };
  },
}));

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const httpError = (status: number) => {
  const error = new AxiosError('failed');
  error.response = { status } as AxiosError['response'];
  return error;
};

beforeEach(() => {
  client = new QueryClient();
  captured = undefined;
});
afterEach(() => client.clear());

describe('useConfirmItinerary (TRIP-1357)', () => {
  it('성공: 응답을 조회 캐시에 쓰고 onConfirmed 를 1회 부른다', () => {
    const onConfirmed = jest.fn();
    renderHook(() => useConfirmItinerary('t1', onConfirmed), { wrapper });

    captured?.mutation.onSuccess({ status: 'CONFIRMED' });

    expect(client.getQueryData(['itinerary', 't1'])).toEqual({
      status: 'CONFIRMED',
    });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('onConfirmed 는 생략할 수 있다', () => {
    renderHook(() => useConfirmItinerary('t1'), { wrapper });

    expect(() => captured?.mutation.onSuccess({ days: [] })).not.toThrow();
    expect(client.getQueryData(['itinerary', 't1'])).toEqual({ days: [] });
  });

  it('409 만 조회를 무효화한다', () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    renderHook(() => useConfirmItinerary('t1'), { wrapper });

    captured?.mutation.onError(httpError(500));
    expect(spy).not.toHaveBeenCalled();

    captured?.mutation.onError(httpError(409));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['itinerary', 't1'] });
  });
});
