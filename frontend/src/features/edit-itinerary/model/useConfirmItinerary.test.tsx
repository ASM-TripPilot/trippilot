import type { ReactNode } from 'react';
import { AxiosError } from 'axios';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { readIdSet, writeIdSet } from '@/shared/storage';
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

// TRIP-1428 — 완료 배너 seen 저장소. 모듈 경로를 목으로 바꾸면 배럴(`@/shared/storage`)도 이 목을 재수출하므로
// 구현이 어느 경로로 import 하든 같은 가짜를 본다. 한 칸짜리 메모리(`mockSeen`)라 쓰면 값이 바뀐다.
let mockSeen: string[] = [];
jest.mock('@/shared/storage/idSet', () => ({
  readIdSet: jest.fn(),
  writeIdSet: jest.fn(),
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
  mockSeen = [];
  (readIdSet as jest.Mock)
    .mockReset()
    .mockImplementation(async () => [...mockSeen]);
  (writeIdSet as jest.Mock)
    .mockReset()
    .mockImplementation(async (_key: string, ids: readonly string[]) => {
      mockSeen = [...ids];
    });
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

// TRIP-1428 — 앱에서 확정에 성공한 여행은 일정 탭 완료 배너("…일정이 완성됐어요")로 다시 알리지 않는다(결정 2=A).
describe('TRIP-1428 · 확정 성공 → 완료 배너 seen 에 그 여행을 더한다', () => {
  /**
   * 무엇을 보장하나:
   *  - 확정 성공 콜백이 그 여행 id 를 seen(키 `itinerary.doneBar.seen` — 값 그대로)에 더하고, 이미 있던 id 는 지우지 않는다.
   *  - 실패(409·500)면 seen 을 건드리지 않는다.
   *  - seen 읽기·쓰기가 실패해도(비동기 거절이든 동기 throw 든) 캐시 쓰기·onConfirmed 는 그대로다 — 확정은 이미 성공했다.
   *
   * 왜 훅 옵션 콜백(`captured.mutation.onSuccess`)을 직접 부르나: 이 자리가 "화면을 떠나도 불리는" 콜백이다.
   * 페이지의 호출별 콜백(`mutate(vars, { onSuccess })`)에 두면 이 테스트가 red 다(02a ★6).
   *
   * 3동작: 준비(저장소 메모리 seen) → 실행(성공/실패 콜백) → 단언(저장소에 남은 값·콜백).
   */
  const SEEN_KEY = 'itinerary.doneBar.seen';

  /** 콜백이 띄운 비동기 저장(읽기 → 쓰기)이 끝날 때까지 흘려보낸다. */
  async function flush(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('성공하면 그 여행 id 를 seen 에 더하고, 이미 있던 id 는 남긴다 (읽은 키 = 쓴 키 = itinerary.doneBar.seen)', async () => {
    // 준비 — 다른 여행 하나를 이미 알렸다.
    mockSeen = ['trip-old'];
    renderHook(() => useConfirmItinerary('t1'), { wrapper });

    // 실행
    captured?.mutation.onSuccess({ status: 'CONFIRMED' });
    await flush();

    // 단언 — 저장소에 남은 값(순서 무관)과 키.
    expect([...mockSeen].sort()).toEqual(['t1', 'trip-old']);
    expect(writeIdSet).toHaveBeenCalled();
    (writeIdSet as jest.Mock).mock.calls.forEach(([key]: [string]) =>
      expect(key).toBe(SEEN_KEY)
    );
    expect((readIdSet as jest.Mock).mock.calls[0]?.[0]).toBe(SEEN_KEY);
  });

  it('이미 seen 에 있는 여행이면 두 번 넣지 않는다', async () => {
    mockSeen = ['t1'];
    renderHook(() => useConfirmItinerary('t1'), { wrapper });

    captured?.mutation.onSuccess({ status: 'CONFIRMED' });
    await flush();

    expect(mockSeen).toEqual(['t1']);
  });

  it.each([409, 500])('실패(%i)면 seen 을 쓰지 않는다', async (status) => {
    mockSeen = ['trip-old'];
    renderHook(() => useConfirmItinerary('t1'), { wrapper });

    captured?.mutation.onError(httpError(status));
    await flush();

    expect(writeIdSet).not.toHaveBeenCalled();
    expect(mockSeen).toEqual(['trip-old']);
  });

  it.each<[string, () => void]>([
    [
      '읽기가 거절되면',
      () =>
        (readIdSet as jest.Mock).mockImplementation(() =>
          Promise.reject(new Error('keychain'))
        ),
    ],
    [
      '읽기가 동기로 던지면',
      () =>
        (readIdSet as jest.Mock).mockImplementation(() => {
          throw new Error('keychain');
        }),
    ],
    [
      '쓰기가 거절되면',
      () =>
        (writeIdSet as jest.Mock).mockImplementation(() =>
          Promise.reject(new Error('keychain'))
        ),
    ],
  ])(
    'seen %s 도 캐시 쓰기·onConfirmed 는 그대로고, 콜백이 던지지 않는다',
    async (_label, breakStorage) => {
      // 준비 — 저장소를 망가뜨린다. 아무도 받지 않은 거절이 남으면 jest 가 이 테스트를 실패시킨다(02a §5 V2) —
      // 그래서 흘려보내기(flush)를 단언 앞에 두 번 둔다.
      breakStorage();
      const onConfirmed = jest.fn();
      renderHook(() => useConfirmItinerary('t1', onConfirmed), { wrapper });

      // 실행
      expect(() =>
        captured?.mutation.onSuccess({ status: 'CONFIRMED' })
      ).not.toThrow();
      await flush();
      await flush();

      // 단언 — 확정 쪽 결과는 그대로다.
      expect(client.getQueryData(['itinerary', 't1'])).toEqual({
        status: 'CONFIRMED',
      });
      expect(onConfirmed).toHaveBeenCalledTimes(1);
    }
  );

  it('읽기가 실패하면 seen 을 덮어쓰지 않는다 (이미 알린 여행들을 잃지 않는다)', async () => {
    mockSeen = ['trip-old'];
    (readIdSet as jest.Mock).mockImplementation(() =>
      Promise.reject(new Error('keychain'))
    );
    renderHook(() => useConfirmItinerary('t1'), { wrapper });

    captured?.mutation.onSuccess({ status: 'CONFIRMED' });
    await flush();

    expect(writeIdSet).not.toHaveBeenCalled();
    expect(mockSeen).toEqual(['trip-old']);
  });
});
