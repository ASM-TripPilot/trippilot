import type { ReactNode } from 'react';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useReflectionPhotos } from './useReflectionPhotos';
import { resolvePhotoUri } from '@/shared/photo';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';

const mockVisits = jest.fn();
const mockPhotos = jest.fn();
jest.mock('@/shared/api/index.hooks', () => ({
  useGetTripsTripIdVisitsDaysDay: () => mockVisits(),
  getGetTripsTripIdVisitsVisitCheckIdPhotosQueryOptions: (
    _t: string,
    id: string
  ) => ({ queryKey: ['photos', id], queryFn: () => mockPhotos(id) }),
}));
jest.mock('@/shared/storage', () => ({
  getInstallId: jest.fn().mockResolvedValue('me'),
}));
let mockGoneResolves = false; // TRIP-1803 — 설정에서 넓힌 뒤 복귀 흉내.
jest.mock('@/shared/photo', () => ({
  resolvePhotoUri: jest.fn(async (id: string) =>
    id === 'gone' && !mockGoneResolves ? null : `file://${id}`
  ),
}));

const photo = (localAssetId: string, deviceId: string) => ({
  visitPhotoMetaId: localAssetId,
  localAssetId,
  deviceId,
  sortOrder: 0,
});

const tree = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={newTestQueryClient()}>
    {children}
  </QueryClientProvider>
);
// 훅이 렌더마다 부르는 방문 GET 목 — 상태 칸(`isError` 등)은 이 훅의 소관이 아니라 `{data}` 만 준다.
const VISITS = {
  data: {
    visits: [
      { visitCheckId: 'v1', poiId: 'p1' },
      { visitCheckId: 'v2', poiId: 'p2' },
    ],
  },
};
const notFoundError = () =>
  Object.assign(new Error('404'), {
    isAxiosError: true,
    response: { status: 404 },
  });

it('그 날 방문의 내 기기 사진만, 앨범에서 찾은 것만 주소로 돌려준다', async () => {
  mockVisits.mockReturnValue({
    data: {
      visits: [
        { visitCheckId: 'v1', poiId: 'p1' },
        { visitCheckId: 'v2', poiId: 'p2' },
      ],
    },
  });
  mockPhotos.mockImplementation(async (id: string) => ({
    count: 2,
    items:
      id === 'v1'
        ? [photo('a', 'me'), photo('x', 'other')]
        : [photo('gone', 'me')],
  }));
  const client = newTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useReflectionPhotos('t', '2026-09-24'), {
    wrapper,
  });
  await waitFor(() =>
    expect(result.current.photos).toEqual([{ uri: 'file://a', poiId: 'p1' }])
  );
  expect(result.current.photoLoadFailed).toBe(false);
  expect(result.current.photoLoadRetrying).toBe(false);
});

/**
 * 🔴 TRIP-1757 · 방문별 사진 GET 실패 신호 — 반환이 배열에서 `{photos, photoLoadFailed, photoLoadRetrying, retryPhotoLoad}` 로 바뀐다.
 * 무엇을 보장하나(3동작 = 준비: 한 방문의 사진 GET 만 reject → 실행: 렌더·retryPhotoLoad → 단언: 신호·요청 수·남은 사진):
 *  - 404 아닌 실패(재시도 끝) = `photoLoadFailed` true, 성공한 방문의 사진은 그대로 나온다.
 *  - `retryPhotoLoad()` = 실패한 방문의 사진 GET 만 다시(성공한 방문은 안 부른다). 붙잡는 동안 failed·retrying 둘 다 true.
 *  - 404(방문 기록 없음)는 실패가 아니다.
 *  방문 GET 자체의 실패는 이 훅이 아니라 `useMagazineSources`(같은 키) 소관이다 — 여기서는 `{data}` 만 받는다.
 */
describe('TRIP-1757 · 방문별 사진 GET 실패', () => {
  beforeEach(() => {
    mockVisits.mockReset().mockReturnValue(VISITS);
    mockPhotos.mockReset();
  });
  const calls = (id: string) =>
    mockPhotos.mock.calls.filter(([arg]) => arg === id).length;

  it('F1 한 방문 사진 GET reject → photoLoadFailed true, 성공한 방문 사진은 그대로, 재시도는 실패한 방문만 다시 부르고 성공하면 둘 다 나온다', async () => {
    let v2Fails = true;
    mockPhotos.mockImplementation(async (id: string) => {
      if (id === 'v2' && v2Fails) throw new Error('boom');
      return { count: 1, items: [photo(id === 'v1' ? 'a' : 'b', 'me')] };
    });
    const { result } = renderHook(
      () => useReflectionPhotos('t', '2026-09-24'),
      { wrapper: tree }
    );
    await waitFor(() => expect(result.current.photoLoadFailed).toBe(true));
    expect(result.current.photos).toEqual([{ uri: 'file://a', poiId: 'p1' }]);
    expect([calls('v1'), calls('v2')]).toEqual([1, 1]);

    v2Fails = false;
    act(() => result.current.retryPhotoLoad());

    await waitFor(() => expect(result.current.photoLoadFailed).toBe(false));
    expect(result.current.photos).toEqual([
      { uri: 'file://a', poiId: 'p1' },
      { uri: 'file://b', poiId: 'p2' },
    ]);
    expect([calls('v1'), calls('v2')]).toEqual([1, 2]);
  });

  it('F2 재시도 응답을 붙잡는 동안 photoLoadFailed 는 true 로 남고 photoLoadRetrying 이 true 다', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let n = 0;
    mockPhotos.mockImplementation(async (id: string) => {
      if (id === 'v2') {
        n += 1;
        if (n === 1) throw new Error('boom');
        await gate;
      }
      return { count: 0, items: [] };
    });
    const { result } = renderHook(
      () => useReflectionPhotos('t', '2026-09-24'),
      { wrapper: tree }
    );
    await waitFor(() => expect(result.current.photoLoadFailed).toBe(true));

    act(() => result.current.retryPhotoLoad());
    await waitFor(() => expect(calls('v2')).toBe(2));

    await waitFor(() => expect(result.current.photoLoadRetrying).toBe(true));
    expect(result.current.photoLoadFailed).toBe(true);

    await act(async () => release());
    await waitFor(() => expect(result.current.photoLoadFailed).toBe(false));
    expect(result.current.photoLoadRetrying).toBe(false);
  });

  it('F3 사진 GET 404 → 실패가 아니다', async () => {
    mockPhotos.mockImplementation(async (id: string) => {
      if (id === 'v2') throw notFoundError();
      return { count: 0, items: [] };
    });
    const { result } = renderHook(
      () => useReflectionPhotos('t', '2026-09-24'),
      { wrapper: tree }
    );
    await waitFor(() => expect(calls('v2')).toBe(1));
    await act(async () => {});
    expect(result.current.photoLoadFailed).toBe(false);
  });
});

/**
 * TRIP-1803 · 못 푼 사진을 조용히 빼지 않는다 — 칸은 계속 빼고 장수를 돌려줘 화면이 한 줄로 알린다(D6 · BR-U5-14·34).
 * 무엇을 보장하나: `unresolvedCount` 는 내 기기 사진 중 앨범이 `null` 이라 답한 것만 센다(다른 기기·아직 모름 제외) ·
 *   앱 복귀에 못 푼 사진만 다시 묻는다(AC-2 · E-3).
 * (개념) `staleTime: 30_000` = 앱 기본값. 기본 0 이면 공허 통과한다(02a ★1).
 */
describe('🔴 TRIP-1803 · 못 푼 사진 장수와 복귀', () => {
  const uriCalls = (id: string) =>
    (resolvePhotoUri as jest.Mock).mock.calls.filter(([arg]) => arg === id)
      .length;
  const servePhotos = (items: ReturnType<typeof photo>[]) => {
    mockVisits.mockReset().mockReturnValue({
      data: { visits: [{ visitCheckId: 'v1', poiId: 'p1' }] },
    });
    mockPhotos.mockReset().mockResolvedValue({ items });
  };
  const wrapper = createWrapper(newTestQueryClient({ staleTime: 30_000 }));

  beforeEach(() => (resolvePhotoUri as jest.Mock).mockClear());
  afterEach(() => {
    mockGoneResolves = false;
    focusManager.setFocused(undefined); // 모듈 싱글턴.
  });

  it('H1 내 기기 사진 중 앨범이 못 찾은 것만 센다 — 다른 기기 사진은 세지 않는다', async () => {
    servePhotos([
      photo('a', 'me'),
      photo('gone', 'me'),
      photo('other', 'not-me'),
    ]);

    const { result } = renderHook(() => useReflectionPhotos('t1', 'd1'), {
      wrapper: tree,
    });

    await waitFor(() => expect(result.current.unresolvedCount).toBe(1));
    expect(result.current.photos.map((p) => p.uri)).toEqual(['file://a']);
  });

  it('H2 앨범 조회가 끝나기 전에는 세지 않는다 — 로딩 중 한 줄이 깜빡이지 않게', async () => {
    let finish: (uri: null) => void = () => {};
    (resolvePhotoUri as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    servePhotos([photo('gone', 'me')]);

    const { result } = renderHook(() => useReflectionPhotos('t1', 'd2'), {
      wrapper: tree,
    });
    await waitFor(() =>
      expect(resolvePhotoUri as jest.Mock).toHaveBeenCalledTimes(1)
    );
    expect(result.current.unresolvedCount).toBe(0);

    await act(async () => finish(null));

    await waitFor(() => expect(result.current.unresolvedCount).toBe(1));
  });

  it('H3 (AC-2 · E-3) 넓히고 복귀하면 못 푼 사진만 다시 물어 칸이 나오고 장수가 0이 되며, 풀린 사진은 다시 안 묻는다', async () => {
    servePhotos([photo('a', 'me'), photo('gone', 'me')]);
    const { result } = renderHook(() => useReflectionPhotos('t1', 'd3'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.unresolvedCount).toBe(1));

    mockGoneResolves = true;
    expect(uriCalls('gone')).toBe(1); // 복귀 전에는 다시 묻지 않는다.

    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));

    await waitFor(() => expect(result.current.unresolvedCount).toBe(0));
    expect(result.current.photos.map((p) => p.uri)).toEqual([
      'file://a',
      'file://gone',
    ]);
    expect(uriCalls('gone')).toBe(2);
    expect(uriCalls('a')).toBe(1);
  });
});
