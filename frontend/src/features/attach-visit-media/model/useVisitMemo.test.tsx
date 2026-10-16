import type { ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { ActualVisit, TripRecord } from '@/shared/api/index.schemas';
import { createGate } from '@/test-support/mswHookHarness';
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
 * 네트워크는 생성 클라이언트가 전부 지나는 mutator(`customInstance`)를 목으로 바꿔 끊는다 — 이 파일은 네트워크 없는
 * 단위 버킷이다. TRIP-1415 부터 훅이 records GET 도 부르는데, 생성 훅은 같은 모듈 안 함수를 직접 불러서 진입점
 * (`index.hooks`) export 를 바꿔서는 못 가로챈다(02a ★1).
 * (개념) `renderHook` = 훅을 화면 없이 실행해 `result.current` 로 반환값을 읽는 도구 ·
 *   `flushNotifications()` = react-query 가 예약한 재렌더 알림이 끝날 때까지 기다리기(traps-record — act 직후
 *   곧바로 읽으면 옛 값을 볼 수 있다).
 * 3동작: 준비(QueryClient·요청 목) → 실행(saveMemo·id 목록 바꾸기) → 단언(id → 저장본 맵).
 */

const mockPut = jest.fn();
const mockGetRecords = jest.fn();
const mockRequest = jest.fn(
  (config: { url: string; method: string; data?: unknown }) => {
    if (config.method === 'PUT') return mockPut(config.url, config.data);
    if (config.method === 'GET' && config.url.endsWith('/records'))
      return mockGetRecords(config);
    return Promise.reject(
      new Error(`예상 밖 요청 ${config.method} ${config.url}`)
    );
  }
);
jest.mock('@/shared/api/mutator', () => ({
  customInstance: (config: { url: string; method: string; data?: unknown }) =>
    mockRequest(config),
}));

const MEMO_URL = '/trips/t1/visits/v1/memo';

/** records 실적 한 줄 — 읽는 것은 visitCheckId·memo 뿐이다(hasMemo 는 over 로 어긋나게 만든다). */
function visit(
  visitCheckId: string,
  memo: string | null,
  over: Partial<ActualVisit> = {}
): ActualVisit {
  return {
    visitCheckId,
    poiId: `poi-${visitCheckId}`,
    spontaneous: false,
    photoCount: 0,
    memo,
    hasMemo: memo !== null,
    updatedAt: '2026-08-20T05:00:00Z',
    ...over,
  };
}
function record(days: { date: string; actual: ActualVisit[] }[]): TripRecord {
  return {
    tripId: 't1',
    days: days.map(({ date, actual }) => ({
      date,
      planned: [],
      actual,
      unvisitedSlotKeys: [],
    })),
    changes: [],
  };
}
const recordsGetCount = () => mockGetRecords.mock.calls.length;

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  mockRequest.mockClear();
  mockPut.mockReset().mockResolvedValue({ text: 'ok' });
  mockGetRecords.mockReset().mockResolvedValue(record([]));
});
// 모듈 싱글턴 — 오프라인 케이스가 실패로 끝나도 다음 테스트가 온라인으로 시작한다(02a ★10).
afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
});

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
    expect(mockPut).toHaveBeenCalledWith(MEMO_URL, { text: '바다' });
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

// TRIP-1415 · AC-1·3·7·8·9·10 · D2·D4·D5 — 서버 메모(GET /trips/{id}/records 의 memo)를 세션 저장본 다음 순위로 읽는다.
describe('서버 메모 시드 — 세션 저장본 → records memo → null', () => {
  it('S1 records 의 다른 날 묶음에 있어도 방문 id 로 찾고, memo 가 null 이면(hasMemo 가 true 여도) null 이다', async () => {
    // 준비 — v1 은 전날 묶음, v2 는 "있다고는 하는데 본문 없음", v3 은 records 에 없다.
    mockGetRecords.mockResolvedValue(
      record([
        {
          date: '2026-08-19',
          actual: [visit('v1', '대구탕 국물이 시원했다')],
        },
        {
          date: '2026-08-20',
          actual: [visit('v2', null, { hasMemo: true })],
        },
      ])
    );

    // 실행
    const { result } = renderHook(
      () => ({
        single: useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
        saved: useSavedVisitMemos({
          tripId: 't1',
          visitCheckIds: ['v1', 'v2', 'v3'],
        }),
      }),
      { wrapper }
    );

    // 단언
    await waitFor(() =>
      expect(result.current.single.savedMemo).toBe('대구탕 국물이 시원했다')
    );
    expect(result.current.saved).toEqual({
      v1: '대구탕 국물이 시원했다',
      v2: null,
      v3: null,
    });
  });

  it('S2 이 세션에 저장한 값이 서버 memo 를 이긴다', async () => {
    // 준비 — v1 은 세션 '새 글' · 서버 '옛 글', v2 는 서버에만 있다.
    client.setQueryData(['visit-memo', 't1', 'v1'], '새 글');
    mockGetRecords.mockResolvedValue(
      record([
        {
          date: '2026-08-20',
          actual: [visit('v1', '옛 글'), visit('v2', '서버만')],
        },
      ])
    );

    // 실행
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
    // 앵커 — records 가 도착했다(v2 가 서버 값으로 보인다).
    await waitFor(() => expect(result.current.saved.v2).toBe('서버만'));

    // 단언
    expect(result.current.single.savedMemo).toBe('새 글');
    expect(result.current.saved.v1).toBe('새 글');
  });

  it('S3 서버 memo 와 같은 글(앞뒤 공백만 다른 것 포함)은 PUT 0회, 다른 글은 나간다', async () => {
    // 준비
    mockGetRecords.mockResolvedValue(
      record([{ date: '2026-08-20', actual: [visit('v1', '서버 글')] }])
    );
    const { result } = renderHook(
      () => useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.savedMemo).toBe('서버 글'));

    // 실행 — 같은 saveMemo 참조로 한 act 안에서 연달아(렌더값 비교면 두 번째가 샌다).
    await act(async () => {
      const save = result.current.saveMemo;
      await save('서버 글');
      await save('  서버 글  ');
      await save('다른 글');
    });

    // 단언
    expect(mockPut.mock.calls).toEqual([[MEMO_URL, { text: '다른 글' }]]);
  });

  it('S4 세션 저장본이 있으면 같은 값 비교 기준은 세션이다 — 서버의 옛 글로 되돌리는 것은 바뀐 값이다', async () => {
    // 준비 — 세션 '새 글' · 서버 '옛 글'.
    client.setQueryData(['visit-memo', 't1', 'v1'], '새 글');
    mockGetRecords.mockResolvedValue(
      record([{ date: '2026-08-20', actual: [visit('v1', '옛 글')] }])
    );
    const { result } = renderHook(
      () => useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
      { wrapper }
    );
    await waitFor(() => expect(recordsGetCount()).toBe(1));
    await flushNotifications();

    // 실행
    await act(async () => {
      const save = result.current.saveMemo;
      await save('새 글');
      await save('옛 글');
    });

    // 단언 — '새 글' 은 0회, '옛 글' 은 1회.
    expect(mockPut.mock.calls).toEqual([[MEMO_URL, { text: '옛 글' }]]);
  });

  it('S5 방문 훅 여러 개가 한 여행을 보면 records GET 은 1회이고, changeLimit=1 로 간다', async () => {
    // 실행 — 카드 둘 + 박스 묶음이 같은 여행을 동시에 본다.
    renderHook(
      () => ({
        a: useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
        b: useVisitMemo({ tripId: 't1', visitCheckId: 'v2' }),
        saved: useSavedVisitMemos({
          tripId: 't1',
          visitCheckIds: ['v1', 'v2'],
        }),
      }),
      { wrapper }
    );
    await waitFor(() => expect(recordsGetCount()).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // 단언
    expect(recordsGetCount()).toBe(1);
    expect(mockGetRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/trips/t1/records',
        method: 'GET',
        params: { changeLimit: 1 },
      })
    );
  });

  it('S6 방문 id 가 비어 있거나(허브 시트 닫힘) 목록이 비면 아무 요청도 없다', async () => {
    // 실행
    renderHook(
      () => ({
        sheet: useVisitMemo({ tripId: 't1', visitCheckId: '' }),
        saved: useSavedVisitMemos({ tripId: 't1', visitCheckIds: [] }),
      }),
      { wrapper }
    );
    await flushNotifications();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // 단언
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// TRIP-1415 · AC-4·5·6·12 · D1·D3 — 첫 조회가 끝나기 전에만 잠그고, 한 번 열리면 다시 잠그지 않는다(래치).
describe('memoReady — 첫 records 조회 동안만 false', () => {
  it('R1 세션 저장본 없이 첫 조회가 진행 중이면 false, 도착하면 true 이고 서버 memo 가 보인다', async () => {
    // 준비 — 응답을 문 뒤에 붙잡는다.
    const gate = createGate();
    mockGetRecords.mockImplementation(async () => {
      await gate.opened;
      return record([{ date: '2026-08-20', actual: [visit('v1', '서버 글')] }]);
    });

    // 실행
    const { result } = renderHook(
      () => useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
      { wrapper }
    );
    // 앵커 — 요청이 실제로 나가 있다.
    await waitFor(() => expect(recordsGetCount()).toBe(1));
    await flushNotifications();

    // 단언 ① — 조회 중엔 잠금.
    expect(result.current.memoReady).toBe(false);

    // 실행 — 응답이 온다.
    await act(async () => {
      gate.release();
    });

    // 단언 ②
    await waitFor(() => expect(result.current.memoReady).toBe(true));
    expect(result.current.savedMemo).toBe('서버 글');
  });

  it('R2 세션 저장본이 있으면 조회가 진행 중이어도 true 다', async () => {
    // 준비
    client.setQueryData(['visit-memo', 't1', 'v1'], '새 글');
    const gate = createGate();
    mockGetRecords.mockImplementation(async () => {
      await gate.opened;
      return record([]);
    });

    // 실행
    const { result } = renderHook(
      () => useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
      { wrapper }
    );
    await waitFor(() => expect(recordsGetCount()).toBe(1));
    await flushNotifications();

    // 단언
    expect(result.current.memoReady).toBe(true);
    expect(result.current.savedMemo).toBe('새 글');
    await act(async () => {
      gate.release();
    });
  });

  it('R3 한 번 열린 뒤 배경 재조회가 진행 중이어도 다시 잠그지 않는다', async () => {
    // 준비 — 1차는 바로, 2차는 문 뒤에.
    const gate = createGate();
    mockGetRecords
      .mockResolvedValueOnce(
        record([{ date: '2026-08-20', actual: [visit('v1', '서버 글')] }])
      )
      .mockImplementation(async () => {
        await gate.opened;
        return record([
          { date: '2026-08-20', actual: [visit('v1', '다른 기기 글')] },
        ]);
      });
    const { result } = renderHook(
      () => useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.memoReady).toBe(true));

    // 실행 — 다시 조회(앱 복귀·staleTime 만료와 같은 배경 재조회).
    await act(async () => {
      void client.invalidateQueries();
    });
    await waitFor(() => expect(recordsGetCount()).toBe(2));
    await flushNotifications();

    // 단언 — 재조회가 진행 중인데도 열려 있다.
    expect(result.current.memoReady).toBe(true);
    await act(async () => {
      gate.release();
    });
  });

  it('R4 조회가 500 이면 정확히 1회 재시도한 뒤 열리고, 서버 메모는 없는 것으로 본다', async () => {
    // 준비 — axios 오류 모양으로 늘 실패.
    mockGetRecords.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('boom'), {
          isAxiosError: true,
          response: { status: 500 },
        })
      )
    );

    // 실행
    const { result } = renderHook(
      () => useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
      { wrapper }
    );

    // 단언 — 막히지 않는다(INV-4 · AC-12).
    await waitFor(() => expect(result.current.memoReady).toBe(true), {
      timeout: 3000,
    });
    expect(result.current.savedMemo).toBeNull();
    // D3 — 재시도 1회(합 2회). 틈을 더 줘도 3회째가 없다.
    await waitFor(() => expect(recordsGetCount()).toBe(2), { timeout: 3000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(recordsGetCount()).toBe(2);
  });

  it('R5 오프라인 보류면 열리고, 다시 온라인이 돼 조회가 진행되는 동안에도 잠기지 않는다', async () => {
    // 준비 — 지금은 온라인이다(앵커) → 오프라인으로.
    expect(onlineManager.isOnline()).toBe(true);
    onlineManager.setOnline(false);
    const gate = createGate();
    mockGetRecords.mockImplementation(async () => {
      await gate.opened;
      return record([{ date: '2026-08-20', actual: [visit('v1', '서버 글')] }]);
    });

    // 실행
    const { result } = renderHook(
      () => useVisitMemo({ tripId: 't1', visitCheckId: 'v1' }),
      { wrapper }
    );
    // 앵커 — 조회가 보류(paused)에 들어갔고 요청은 아직 0회.
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .findAll()
          .some((query) => query.state.fetchStatus === 'paused')
      ).toBe(true)
    );
    expect(recordsGetCount()).toBe(0);

    // 단언 ① — 보류는 잠금이 아니다(영구 잠금 금지).
    expect(result.current.memoReady).toBe(true);

    // 실행 — 다시 온라인. 조회가 나가 진행 중이다.
    act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(recordsGetCount()).toBe(1));
    await flushNotifications();

    // 단언 ② — 진행 중에도 다시 잠그지 않는다(보류 중 쓴 초안을 지키는 조건).
    expect(result.current.memoReady).toBe(true);

    // 실행 — 응답이 온다.
    await act(async () => {
      gate.release();
    });

    // 단언 ③ — 표시값(허브 박스용)은 서버 memo 를 따라온다.
    await waitFor(() => expect(result.current.savedMemo).toBe('서버 글'));
    expect(result.current.memoReady).toBe(true);
  });
});
