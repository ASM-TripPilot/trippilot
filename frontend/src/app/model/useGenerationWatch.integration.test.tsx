import type { ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query';
import {
  act,
  fireEvent,
  renderHook,
  screen,
  within,
} from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';
import { router } from 'expo-router';

import type { BootstrapDestination } from '@/features/auth/index.view';
import { DRAFT_POLL_INTERVAL_MS } from '@/features/itinerary/index.view';
import { server } from '@/mocks/server';
import {
  getGetTripsQueryKey,
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import type { Itinerary } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import * as ToastModule from '@/shared/ui/Toast';
import { itinerary } from '@/test-support/itineraryFixtures';
import { BASE, createRequestLog } from '@/test-support/mswItinerary';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';

import {
  GENERATION_COMPLETE_MESSAGE,
  GENERATION_COMPLETE_TOAST_ID,
  GENERATION_FAILED_MESSAGE,
  GENERATION_FAILED_TOAST_ID,
} from './generationWatch';
import { useGenerationWatch } from './useGenerationWatch';

/**
 * TRIP-1618 · 앱 셸 "생성 완료 감지" 훅 `useGenerationWatch(drawn, destination)` — 캐시에 "생성 중"으로 적힌 일정만 2초마다 다시 묻고,
 * `PARTIAL → COMPLETE|FAILED` 로 바뀐 순간 앱 안 토스트("보기" 버튼 포함)를 한 번만 띄운다.
 *
 * *(개념)* 이 훅은 쿼리 캐시(서버 응답을 담아 둔 저장소)의 변경 알림을 듣는다. 감시 대상은 여행 목록이 아니라 "캐시에 생성 중으로 적힌 일정 칸"이다 —
 * 그래서 생성 중인 칸이 없으면 서버에 아무것도 묻지 않는다. 같은 칸을 읽는 홈 카드·일정 탭 카드는 캐시가 바뀌면 저절로 따라 바뀐다.
 *
 * 무엇을 보장하나:
 *  - K1 홈에 머무는 동안 생성이 끝나면 같은 칸을 읽는 카드(대역)가 갱신된다 · K17 관찰자가 둘이어도 한 간격에 요청은 1건.
 *  - K2·K3 홈에서 `PARTIAL→COMPLETE|FAILED` 전이마다 토스트 한 번(성공/실패 문구·오류 톤·"보기"). 이후 더 묻지 않는다.
 *  - K4·K5 그 여행의 진행 화면이나 일정 탭이면 토스트 생략(캐시는 갱신), 다른 여행의 진행 화면이면 띄운다.
 *  - K6~K9 같은 값 반복·처음부터 완료·재생성 흐름의 전이 규칙.
 *  - K10~K13 생성 중 칸 0개면 요청 0 · 여러 개면 각각 · 백그라운드면 0 · 오류면 정지.
 *  - K14 "보기" 는 누른 시점의 캐시 값으로 목적지를 정해 `router.push` 1번, 캐시가 비면 이동 0.
 *  - K15 HOME 이 아니거나 그려지기 전엔 감시도 토스트도 없다 · K16 그 여행의 진행 화면이면 셸은 묻지 않고 떠나면 이어받는다.
 *
 * 어떻게: 실 `QueryClient`(운영 전역과 같은 staleTime 30초) + msw 서버 대본 + 가짜 시계 + 실 토스트 호스트. 경로는 `usePathname` 목 변수로 바꾼다.
 * 진행 화면 경로에서는 셸이 폴링을 양보하므로(K16) 그 화면 자체 폴링이 캐시에 쓴 상황은 `setQueryData` 로 대신한다(02a ★5).
 * jest 가 못 보는 것: 실제 AppState→focusManager 연결(K12 는 TanStack 계약까지만), 토스트의 실제 터치·위치(6-b).
 *
 * 3동작 뼈대: 준비 = 캐시 시드·서버 대본·경로·훅 렌더 → 실행 = 가짜 시계 흘리기 / 캐시 쓰기 / 경로 바꾸기 → 단언 = 요청 수·토스트·이동.
 */

let mockPathname = '/';
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  usePathname: () => mockPathname,
}));

// 생성 클라이언트의 인증 계층이 @/shared/storage 를 정적으로 문다(MyTripsListPage.integration 과 같은 목).
jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const POLL = DRAFT_POLL_INTERVAL_MS;
const A = 'trip-aaaa';
const B = 'trip-bbbb';
const PUSH = router.push as jest.Mock;

type Reply = Itinerary | 500;
/** 여행별 서버 응답 대본 — 요청마다 여기서 읽는다. */
let script: Record<string, Reply> = {};
const log = createRequestLog(server);
const keyOf = (id: string) => getGetTripsTripIdItineraryQueryKey(id);
const count = (id: string) => log.hitsFor('GET', `/trips/${id}/itinerary`);

const running = (id: string) =>
  itinerary({
    tripId: id,
    status: 'PLANNED',
    generationState: 'PARTIAL',
    generationMode: 'FULLY_AI',
    generationSessionId: 'sess-1',
  });
const complete = (
  id: string,
  generationMode: Itinerary['generationMode'] = 'FULLY_AI'
) =>
  itinerary({
    tripId: id,
    status: 'PLANNED',
    generationState: 'COMPLETE',
    generationMode,
    generationSessionId: null,
  });
const failed = (id: string) =>
  itinerary({
    tripId: id,
    status: 'PLANNED',
    generationState: 'FAILED',
    generationSessionId: null,
  });
const confirmed = (id: string) =>
  itinerary({
    tripId: id,
    status: 'CONFIRMED',
    generationState: 'COMPLETE',
    generationSessionId: null,
  });

type Gate = { drawn: boolean; destination: BootstrapDestination | null };
const HOME: Gate = { drawn: true, destination: 'HOME' };

let showSpy: jest.SpyInstance;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  log.attach();
});

beforeEach(() => {
  script = {};
  log.reset();
  mockPathname = '/';
  PUSH.mockClear();
  clearAccessToken();
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, ({ params }) => {
      const reply = script[String(params.tripId)];
      if (reply === undefined) {
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: '일정이 없어요' } },
          { status: 404 }
        );
      }
      if (reply === 500) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL', message: '서버 오류' } },
          { status: 500 }
        );
      }
      return HttpResponse.json(reply);
    })
  );
  jest.useFakeTimers();
  showSpy = jest.spyOn(ToastModule, 'showToast');
});

// 토스트·포커스 매니저는 모듈 싱글턴이다 — 최상위(describe 밖)에서 되돌려야 앞 케이스의 상태가 새지 않는다(02a ★6).
afterEach(() => {
  showSpy.mockRestore();
  resetToast();
  act(() => focusManager.setFocused(undefined));
  server.resetHandlers();
  jest.useRealTimers();
});

afterAll(() => server.close());

/** 운영 전역과 같은 staleTime 30초 — 0 이면 관찰자가 붙는 순간 낡은 칸을 즉시 한 번 더 받아 요청 수가 흔들린다(02a ★2). */
function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 30_000 },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

interface MountOptions {
  /** 훅을 띄우기 전에 캐시에 심는 일정 — 다른 화면이 이미 받아 둔 칸. */
  seed?: Record<string, Itinerary>;
  path?: string;
  gate?: Gate;
  /** 같은 칸을 읽기만 하는 카드 대역(홈 계획 카드·일정 탭 카드 — 자체 간격 없음). */
  cardOf?: string;
}

function mount({
  seed = {},
  path = '/',
  gate = HOME,
  cardOf,
}: MountOptions = {}) {
  mockPathname = path;
  const client = newClient();
  Object.entries(seed).forEach(([id, data]) =>
    client.setQueryData(keyOf(id), data)
  );
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <WithToastHost>{children}</WithToastHost>
      </QueryClientProvider>
    );
  }
  let current: Gate = gate;
  const view = renderHook(
    (props: Gate) => {
      useGenerationWatch(props.drawn, props.destination);
      return useGetTripsTripIdItinerary(cardOf ?? 'no-card', {
        query: { enabled: cardOf !== undefined },
      });
    },
    { initialProps: gate, wrapper: Wrapper }
  );
  return {
    client,
    card: () => view.result.current.data,
    /** 경로가 바뀐 것을 흉내 낸다 — 목 변수를 바꾸고 다시 그린다(실물은 내비게이션이 리렌더를 일으킨다). */
    setPath(next: string) {
      mockPathname = next;
      act(() => view.rerender(current));
    },
    setGate(next: Gate) {
      current = next;
      act(() => view.rerender(next));
    },
    write(id: string, data: Itinerary) {
      act(() => {
        client.setQueryData(keyOf(id), data);
      });
    },
  };
}

type Harness = ReturnType<typeof mount>;

/** 앵커 짝 — 같은 전이가 홈에서는 토스트를 띄운다는 것(하네스가 귀먹은 게 아님)을 같은 테스트 안에서 보인다. */
function expectToastAtHomeAfterRegeneration(h: Harness): void {
  expect(screen.queryByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeNull();
  h.write(A, running(A));
  h.setPath('/');
  h.write(A, complete(A));
  expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
}

describe('K1 · 홈에 머무는 동안 생성이 끝나면 같은 칸을 읽는 카드가 바뀐다 (AC1)', () => {
  it('자체 간격이 없는 카드 대역이 PARTIAL 에서 COMPLETE 로 바뀐다', async () => {
    script = { [A]: complete(A) };
    const h = mount({ seed: { [A]: running(A) }, cardOf: A });
    // 앵커 — 처음엔 생성 중으로 읽는다.
    expect(h.card()?.generationState).toBe('PARTIAL');

    await advance(POLL + 100);

    expect(h.card()?.generationState).toBe('COMPLETE');
  });
});

describe('K2 · 홈에서 PARTIAL → COMPLETE 이면 토스트가 정확히 한 번 뜬다 (AC2a · AC5)', () => {
  it('문구와 "보기" 버튼이 보이고, 이후 간격이 지나도 더 묻지 않고 토스트도 더 늘지 않는다', async () => {
    script = { [A]: running(A) };
    mount({ seed: { [A]: running(A) }, path: '/' });
    // 앵커 — 전이 전엔 토스트가 없다.
    expect(screen.queryByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeNull();

    script[A] = complete(A);
    await advance(POLL + 100);

    const toast = screen.getByTestId(GENERATION_COMPLETE_TOAST_ID);
    expect(
      within(toast).getByText(GENERATION_COMPLETE_MESSAGE)
    ).toBeOnTheScreen();
    expect(
      within(
        screen.getByTestId(`${GENERATION_COMPLETE_TOAST_ID}-action`)
      ).getByText('보기')
    ).toBeOnTheScreen();
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(count(A)).toBe(1);

    await advance(POLL * 3);

    // 끝난 여행은 더 묻지 않는다.
    expect(count(A)).toBe(1);
    expect(showSpy).toHaveBeenCalledTimes(1);
  });
});

describe('K3 · PARTIAL → FAILED 도 침묵하지 않는다 (AC2′ · INV-4)', () => {
  it('실패 문구·오류 톤·"보기" 가 뜬다', async () => {
    script = { [A]: failed(A) };
    mount({ seed: { [A]: running(A) }, path: '/' });
    expect(screen.queryByTestId(GENERATION_FAILED_TOAST_ID)).toBeNull();

    await advance(POLL + 100);

    const toast = screen.getByTestId(GENERATION_FAILED_TOAST_ID);
    expect(
      within(toast).getByText(GENERATION_FAILED_MESSAGE)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`${GENERATION_FAILED_TOAST_ID}-error-icon`)
    ).toBeOnTheScreen();
    expect(
      within(
        screen.getByTestId(`${GENERATION_FAILED_TOAST_ID}-action`)
      ).getByText('보기')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeNull();
    expect(showSpy).toHaveBeenCalledTimes(1);
  });
});

describe('K4 · 보고 있는 화면이면 토스트를 생략한다 (AC2b·c · 결정 1)', () => {
  it.each<[string, string]>([
    ['그 여행의 생성 중 화면', `/trips/${A}/itinerary/generating`],
    ['그 여행의 초안 화면', `/trips/${A}/itinerary/draft`],
    [
      '그 여행의 같이 짜기 슬롯 채우기',
      `/trips/${A}/itinerary/copick/${encodeURIComponent('2099-06-10#poi-1')}`,
    ],
  ])(
    '%s — 그 화면이 캐시에 쓴 완료·실패는 토스트가 안 뜬다',
    async (_label, path) => {
      // 준비 — 진행 화면은 셸이 폴링을 양보하므로 화면 자체 폴링이 캐시에 쓴 상황을 직접 쓴다.
      const h = mount({ seed: { [A]: running(A) }, path });

      // 실행 ① — 완료가 캐시에 들어온다.
      h.write(A, complete(A));
      await advance(100);

      // 단언 ① — 토스트 0, 값은 캐시에 있다(카드 갱신은 토스트와 무관).
      expect(showSpy).not.toHaveBeenCalled();
      expect(h.client.getQueryData<Itinerary>(keyOf(A))?.generationState).toBe(
        'COMPLETE'
      );

      // 실행 ② — 실패도 같다.
      h.write(A, running(A));
      h.write(A, failed(A));
      await advance(100);

      // 단언 ②
      expect(showSpy).not.toHaveBeenCalled();
      expect(h.client.getQueryData<Itinerary>(keyOf(A))?.generationState).toBe(
        'FAILED'
      );

      // 짝 — 같은 전이가 홈에서는 뜬다.
      expectToastAtHomeAfterRegeneration(h);
    }
  );

  it.each<[string, Itinerary]>([
    ['완료', complete(A)],
    ['실패', failed(A)],
  ])(
    '일정 탭(/itinerary)에서 셸이 직접 받은 %s 는 토스트가 없고 카드(캐시)는 갱신된다',
    async (_label, terminal) => {
      script = { [A]: terminal };
      const h = mount({ seed: { [A]: running(A) }, path: '/itinerary' });

      await advance(POLL + 100);

      expect(count(A)).toBe(1);
      expect(h.client.getQueryData<Itinerary>(keyOf(A))?.generationState).toBe(
        terminal.generationState
      );
      expect(showSpy).not.toHaveBeenCalled();

      // 짝 — 같은 전이가 홈에서는 뜬다(완료 케이스로).
      expectToastAtHomeAfterRegeneration(h);
    }
  );
});

describe('K5 · 다른 여행의 진행 화면에 있으면 띄운다 (AC2d)', () => {
  it('B 의 초안 화면에서 A 의 완료는 토스트가 뜬다', async () => {
    script = { [A]: complete(A) };
    mount({ seed: { [A]: running(A) }, path: `/trips/${B}/itinerary/draft` });
    expect(screen.queryByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeNull();

    await advance(POLL + 100);

    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });
});

describe('K6 · 같은 값이 반복돼도, 관찰자가 둘이어도 한 번만 (AC2e)', () => {
  it('완료 뒤 같은 완료가 캐시에 다시 써져도 토스트 호출은 1번이다', async () => {
    script = { [A]: complete(A) };
    const h = mount({ seed: { [A]: running(A) }, cardOf: A });
    await advance(POLL + 100);
    expect(showSpy).toHaveBeenCalledTimes(1);

    h.write(A, complete(A));
    h.write(A, complete(A));
    await advance(100);

    expect(showSpy).toHaveBeenCalledTimes(1);
  });
});

describe('K7·K8·K9 · 전이가 아닌 것은 알리지 않고, 재생성은 다시 알린다 (AC2f·g · Q1)', () => {
  it('K7 처음 본 값이 이미 완료·실패면 토스트가 없다', async () => {
    const h = mount({ path: '/' });

    h.write(A, complete(A));
    h.write(B, failed(B));
    await advance(100);

    expect(showSpy).not.toHaveBeenCalled();
    // 짝 — 전이는 뜬다.
    h.write(A, running(A));
    h.write(A, complete(A));
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });

  it('K8 완료 → 재생성(PARTIAL) → 완료 면 다시 한 번 뜬다', async () => {
    script = { [A]: complete(A) };
    const h = mount({ seed: { [A]: complete(A) }, path: '/' });
    expect(showSpy).not.toHaveBeenCalled();

    h.write(A, running(A));
    expect(showSpy).not.toHaveBeenCalled();
    await advance(POLL + 100);

    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });

  it('K9 재생성 1차 동안 옛 완료 + 세션이 세션만 지우고 끝나면(COMPLETE → COMPLETE) 토스트는 없다', async () => {
    const regenerating = itinerary({
      tripId: A,
      status: 'PLANNED',
      generationState: 'COMPLETE',
      generationSessionId: 'sess-2',
    });
    script = { [A]: complete(A) };
    mount({ seed: { [A]: regenerating }, path: '/' });

    await advance(POLL + 100);

    // 세션이 있으니 물었고(앵커), 전이가 아니니 알리지 않는다.
    expect(count(A)).toBe(1);
    expect(showSpy).not.toHaveBeenCalled();
  });
});

describe('K10 · 생성 중인 칸이 없으면 서버에 아무것도 묻지 않는다 (AC3)', () => {
  it.each<[string, MountOptions]>([
    ['캐시가 비어 있다', {}],
    ['완료된 칸만 있다', { seed: { [A]: complete(A) } }],
    ['실패한 칸만 있다', { seed: { [A]: failed(A) } }],
    ['확정된 칸만 있다', { seed: { [A]: confirmed(A) } }],
  ])('%s → 간격 세 번이 지나도 요청 0건', async (_label, options) => {
    mount({ ...options, path: '/' });

    await advance(POLL * 3);

    expect(log.all()).toEqual([]);
    expect(showSpy).not.toHaveBeenCalled();
  });

  it('여행 목록 칸만 있어도 일정은 묻지 않는다(목록으로 N건을 문다는 설계가 아니다)', async () => {
    const h = mount({ path: '/' });
    act(() => {
      h.client.setQueryData(getGetTripsQueryKey(), []);
    });

    await advance(POLL * 3);

    expect(log.all()).toEqual([]);
  });
});

describe('K11 · 여행 둘이 생성 중이면 각각 간격마다 1건 (N 가정)', () => {
  it('A·B 모두 간격마다 한 번씩 묻는다', async () => {
    script = { [A]: running(A), [B]: running(B) };
    mount({ seed: { [A]: running(A), [B]: running(B) }, path: '/' });

    await advance(POLL + 100);
    expect([count(A), count(B)]).toEqual([1, 1]);

    await advance(POLL);
    expect([count(A), count(B)]).toEqual([2, 2]);
  });
});

describe('K11b · 오래 안 끝나면 간격이 2초에서 5초로 늘어난다 (요청량 브레이크 · pollIntervalMs)', () => {
  it('빠른 구간 14회(2초씩) 뒤에는 2.1초가 지나도 더 묻지 않고, 5초가 차면 묻는다', async () => {
    // 준비 — 서버가 계속 "생성 중"으로 답한다(멈춘 생성). 시드가 응답 1회로 세어져 14번째 응답에서 빠른 구간(15회 미만)이 끝난다.
    script = { [A]: running(A) };
    mount({ seed: { [A]: running(A) }, path: '/' });

    // 실행 1 — 2초 간격 14번이 지나도록 시계를 흘린다
    await advance(14 * POLL + 100);

    // 단언 1 — 앵커: 빠른 구간에서는 정확히 2초마다 한 번이었다
    expect(count(A)).toBe(14);

    // 실행 2 — 2초 간격이었다면 다음 요청이 나갔을 만큼 더 흘린다
    await advance(POLL + 100);

    // 단언 2 — 5초 간격으로 늘었으므로 아직 그대로
    expect(count(A)).toBe(14);

    // 실행 3 — 5초가 찰 때까지
    await advance(3_000);

    // 단언 3
    expect(count(A)).toBe(15);
  });
});

describe('K12 · 앱이 백그라운드면 묻지 않고, 돌아오면 낡은 칸을 따라잡는다 (AC3)', () => {
  it('포커스가 없는 동안 요청 0건 → 복귀하면 정확히 1건', async () => {
    script = { [A]: running(A) };
    mount({ seed: { [A]: running(A) }, path: '/' });

    // 실행 ① — 백그라운드로 가서 간격이 한참 지난다(데이터가 30초를 넘겨 낡는 길이).
    act(() => focusManager.setFocused(false));
    await advance(119_000);

    // 단언 ①
    expect(count(A)).toBe(0);

    // 실행 ② — 앱으로 돌아온다.
    act(() => focusManager.setFocused(true));
    await advance(100);

    // 단언 ② — 낡은 칸을 정확히 한 번 따라잡았다.
    expect(count(A)).toBe(1);
  });
});

describe('K13 · 조회가 실패하면 멈춘다 — 조용한 무한 재시도 금지 (AC3 · INV-4)', () => {
  it('500 한 번 뒤 간격 세 번이 지나도 더 묻지 않고 토스트도 없다', async () => {
    script = { [A]: 500 };
    const h = mount({ seed: { [A]: running(A) }, path: '/' });

    await advance(POLL + 100);
    expect(count(A)).toBe(1);
    expect(h.client.getQueryState(keyOf(A))?.status).toBe('error');

    await advance(POLL * 3);

    expect(count(A)).toBe(1);
    expect(showSpy).not.toHaveBeenCalled();
  });
});

describe('K14 · "보기" 는 누른 시점의 캐시 값으로 목적지를 정한다 (AC7)', () => {
  /** [이름, 전이 때 캐시에 들어오는 값, 토스트 id, 누르기 전에 캐시가 바뀐 값(없으면 null), 기대 href] */
  const rows: [string, Itinerary, string, Itinerary | null, string][] = [
    [
      '완료 + 완전 AI → 초안',
      complete(A),
      GENERATION_COMPLETE_TOAST_ID,
      null,
      `/trips/${A}/itinerary/draft`,
    ],
    [
      '완료 + 직접 짜기 → 초안',
      complete(A, 'MANUAL'),
      GENERATION_COMPLETE_TOAST_ID,
      null,
      `/trips/${A}/itinerary/draft`,
    ],
    [
      '완료 + 같이 짜기 → 완성 확인',
      complete(A, 'CO_PLAN'),
      GENERATION_COMPLETE_TOAST_ID,
      null,
      `/trips/${A}/itinerary/copick/complete`,
    ],
    [
      '실패 → 초안',
      failed(A),
      GENERATION_FAILED_TOAST_ID,
      null,
      `/trips/${A}/itinerary/draft`,
    ],
    [
      '토스트가 뜬 뒤 누르기 전에 확정됐다 → 여행 중 허브',
      complete(A),
      GENERATION_COMPLETE_TOAST_ID,
      confirmed(A),
      `/trips/${A}/live`,
    ],
  ];

  it.each(rows)(
    '%s',
    (_label, arrived, toastId, changedBeforePress, expectedHref) => {
      const h = mount({ seed: { [A]: running(A) }, path: '/' });
      h.write(A, arrived);
      expect(screen.getByTestId(toastId)).toBeOnTheScreen();
      if (changedBeforePress !== null) h.write(A, changedBeforePress);
      expect(PUSH).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId(`${toastId}-action`));

      expect(PUSH).toHaveBeenCalledTimes(1);
      expect(PUSH).toHaveBeenCalledWith(expectedHref);
      expect(screen.queryByTestId(toastId)).toBeNull();
    }
  );

  it('누르는 순간 캐시에 그 일정이 없으면(밀려남) 어디로도 이동하지 않는다 (INV-4)', () => {
    const h = mount({ seed: { [A]: running(A) }, path: '/' });
    h.write(A, complete(A));
    act(() => {
      h.client.removeQueries({ queryKey: keyOf(A) });
    });

    fireEvent.press(
      screen.getByTestId(`${GENERATION_COMPLETE_TOAST_ID}-action`)
    );

    expect(PUSH).not.toHaveBeenCalled();
  });
});

describe('K15 · 로그인 전·미결·그려지기 전에는 감시도 토스트도 없다 (AC8)', () => {
  it.each<[string, Gate]>([
    ['아직 그려지지 않았다(HOME)', { drawn: false, destination: 'HOME' }],
    ['로그인 화면', { drawn: true, destination: 'LOGIN' }],
    ['온보딩', { drawn: true, destination: 'ONBOARDING' }],
    ['목적지 미결', { drawn: true, destination: null }],
  ])(
    '%s → 간격 세 번이 지나도 요청 0건, 캐시에 완료가 써져도 토스트 0',
    async (_label, gate) => {
      script = { [A]: complete(A) };
      const h = mount({ seed: { [A]: running(A) }, gate, path: '/' });

      await advance(POLL * 3);
      h.write(A, complete(A));
      await advance(100);

      expect(log.all()).toEqual([]);
      expect(showSpy).not.toHaveBeenCalled();
      expect(PUSH).not.toHaveBeenCalled();
    }
  );

  it('그려진 HOME 이 되면 그때부터 묻고 알린다', async () => {
    script = { [A]: complete(A) };
    const h = mount({
      seed: { [A]: running(A) },
      gate: { drawn: false, destination: 'HOME' },
      path: '/',
    });
    await advance(POLL * 2);
    expect(log.all()).toEqual([]);

    h.setGate(HOME);
    await advance(POLL + 100);

    expect(count(A)).toBe(1);
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });

  it('그려지기 전에 새로 생성 중이 된 칸도, 그려진 HOME 이 되는 순간 따라잡아 묻는다', async () => {
    // 준비 — 다른 관찰자(`mount` 의 카드 대역 등)가 없는 훅 단독 렌더. 관찰자가 하나라도 있으면 다시 그릴 때마다 캐시 알림이 와서
    // 이 따라잡기 없이도 감시 목록이 갱신된다 — 그러면 아래 단언이 따라잡기 줄을 가르지 못한다(02c ★2).
    script = { [A]: complete(A) };
    mockPathname = '/';
    const client = newClient();
    const view = renderHook(
      (props: Gate) => useGenerationWatch(props.drawn, props.destination),
      {
        initialProps: { drawn: false, destination: 'HOME' } as Gate,
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            <WithToastHost>{children}</WithToastHost>
          </QueryClientProvider>
        ),
      }
    );
    // 그려지기 전(감시 귀가 꺼진 동안)에 캐시에 생성 중인 칸이 생긴다 — 시드가 아니라 마운트 뒤 쓰기다.
    act(() => {
      client.setQueryData(keyOf(A), running(A));
    });
    await advance(POLL * 2);
    expect(log.all()).toEqual([]);

    // 실행 — 그려진 HOME 이 된다
    act(() => view.rerender(HOME));
    await advance(POLL + 100);

    // 단언 — 활성화 시점의 캐시를 읽어 감시 목록에 올렸으므로 묻고, 전이도 알린다
    expect(count(A)).toBe(1);
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });

  it('HOME → LOGIN(로그아웃) 으로 바뀌면 이후 간격에 더 묻지 않고, 그 뒤 쓰인 완료도 알리지 않는다', async () => {
    script = { [A]: running(A) };
    const h = mount({ seed: { [A]: running(A) }, path: '/' });
    await advance(POLL + 100);
    expect(count(A)).toBe(1);

    h.setGate({ drawn: true, destination: 'LOGIN' });
    await advance(POLL * 3);
    h.write(A, complete(A));
    await advance(100);

    expect(count(A)).toBe(1);
    expect(showSpy).not.toHaveBeenCalled();
  });
});

describe('K16 · 그 여행의 진행 화면이 최상단이면 셸은 묻지 않고, 떠나면 이어받는다 (AC4′)', () => {
  it.each<[string, string]>([
    ['생성 중 화면', `/trips/${A}/itinerary/generating`],
    ['초안 화면', `/trips/${A}/itinerary/draft`],
    [
      '같이 짜기 슬롯 채우기',
      `/trips/${A}/itinerary/copick/${encodeURIComponent('2099-06-10#poi-1')}`,
    ],
  ])(
    '%s 에서는 간격 세 번 0건 → 홈으로 나오면 다음 간격에 1건',
    async (_label, path) => {
      script = { [A]: running(A) };
      const h = mount({ seed: { [A]: running(A) }, path });

      await advance(POLL * 3);
      expect(count(A)).toBe(0);

      h.setPath('/');
      await advance(POLL + 100);

      expect(count(A)).toBe(1);
    }
  );

  it.each<[string, string]>([
    ['일정 탭', '/itinerary'],
    ['같이 짜기 완성 확인', `/trips/${A}/itinerary/copick/complete`],
    ['다른 여행의 초안 화면', `/trips/${B}/itinerary/draft`],
    ['홈', '/'],
  ])('%s 에서는 양보하지 않고 간격마다 1건씩 묻는다', async (_label, path) => {
    script = { [A]: running(A) };
    mount({ seed: { [A]: running(A) }, path });

    await advance(POLL + 100);
    expect(count(A)).toBe(1);

    await advance(POLL);
    expect(count(A)).toBe(2);
  });
});

describe('K17 · 같은 칸을 읽는 관찰자가 둘이어도 한 간격에 요청은 1건 (AC4②)', () => {
  it('카드 대역 + 셸이 함께 있어도 간격당 GET 1', async () => {
    script = { [A]: running(A) };
    mount({ seed: { [A]: running(A) }, cardOf: A, path: '/' });

    await advance(POLL + 100);
    expect(count(A)).toBe(1);

    await advance(POLL);
    expect(count(A)).toBe(2);
  });
});
