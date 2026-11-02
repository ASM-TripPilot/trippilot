import type { ReactNode } from 'react';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';
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
import {
  DRAFT_POLL_INTERVAL_MS,
  ITINERARY_OPEN_FAILED_TOAST_ID,
} from '@/features/itinerary';
import { DRAFT_POLL_SLOW_INTERVAL_MS } from '@/features/itinerary/model/draftView';
import { server } from '@/mocks/server';
import { getGetTripsQueryKey, useGetTrips } from '@/shared/api/index.hooks';
import type { Itinerary, Trip } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import * as ToastModule from '@/shared/ui/Toast';
import { DAY1, itinerary } from '@/test-support/itineraryFixtures';
import { BASE, createRequestLog } from '@/test-support/mswItinerary';
import { newTestQueryClient } from '@/test-support/queryRender';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import {
  NO_ITINERARY,
  itineraryCols,
  itineraryHits,
  listHits,
} from '@/test-support/tripItineraryCols';

import {
  GENERATION_COMPLETE_MESSAGE,
  GENERATION_COMPLETE_TOAST_ID,
  GENERATION_FAILED_MESSAGE,
  GENERATION_FAILED_TOAST_ID,
} from './generationWatch';
import { useGenerationWatch } from './useGenerationWatch';

/**
 * TRIP-1618 · TRIP-1677 — 앱 셸 "생성 완료 감지" 훅 `useGenerationWatch(drawn, destination)`.
 *
 * TRIP-1677 로 감시 대상이 바뀌었다: 여행마다 일정(`GET /trips/{id}/itinerary`)을 묻던 것을 접고, 목록(`GET /trips`) **한 칸**만 폴링한다.
 * 서버가 목록의 각 여행에 일정 상태 네 칸(`itineraryStatus·itineraryGenerationState·itineraryGenerationMode·itineraryGenerating`)을
 * 싣기 때문이다. 목록에 "생성 중"(generating 이거나 state PARTIAL)인 여행이 있을 때만 간격 폴링하고, 없으면 요청 0 이다.
 *
 * *(개념)* 쿼리 캐시(서버 응답을 담아 둔 저장소)의 변경 알림을 듣다가, 여행 하나의 `itineraryGenerationState` 가
 * `PARTIAL → COMPLETE|FAILED` 로 바뀐 순간 토스트("보기" 포함)를 한 번만 띄운다. 같은 목록 칸을 읽는 홈 카드·일정 탭 카드는 캐시가 바뀌면 저절로 따라 바뀐다.
 *
 * 무엇을 보장하나(번호는 02a 의 K 표):
 *  - K1·K2·K3 생성 중이던 여행이 끝나면 카드(대역)가 바뀌고 토스트가 한 번 뜬다(성공/실패 문구·"보기"). 이후 더 묻지 않는다.
 *  - K4·K5 그 여행의 진행 화면·일정 탭이면 토스트만 생략(폴링은 양보하지 않는다 — K16), 다른 여행 화면이면 띄운다.
 *  - K6~K9·K19 같은 값 반복·처음부터 완료·재생성·로그아웃 뒤 첫 값의 전이 규칙.
 *  - K10~K13 생성 중 0개면 요청 0 · 여러 개여도 목록 1건 · 간격 확대 · 백그라운드 0 · 오류 틱에도 멈추지 않는다.
 *  - K14 "보기" 는 누른 시점의 목록 캐시로 목적지를 정한다(copick 갈래만 일정 GET 1번).
 *  - K15 HOME 이 아니거나 그려지기 전엔 감시도 토스트도 없다 · K17 관찰자가 둘이어도 간격당 1건 · K18 첫 생성은 목록 무효화가 폴링을 시작시킨다.
 *
 * 어떻게: 실 `QueryClient`(운영 전역과 같은 staleTime 30초) + msw 서버 대본(`serverTrips`) + 가짜 시계 + 실 토스트 호스트. **목록 캐시를 시드해 시작**한다 —
 * 캐시가 비어 있으면 셸 관찰자가 첫 목록 조회를 거는데 그건 이 파일의 대상이 아니다. 경로는 `usePathname` 목 변수로 바꾼다.
 * jest 가 못 보는 것: 실제 AppState→focusManager 연결(K12 는 TanStack 계약까지), 토스트의 실제 터치·위치, 429 재시도 실동작(통합 클라이언트는 retry:false) — 6-b.
 *
 * 3동작 뼈대: 준비 = 목록 시드·서버 대본·경로·훅 렌더 → 실행 = 가짜 시계 흘리기 / 캐시 쓰기 / 경로 바꾸기 → 단언 = 요청 수·토스트·이동.
 */

let mockPathname = '/';
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  usePathname: () => mockPathname,
}));

// 생성 클라이언트의 인증 계층이 @/shared/storage 를 정적으로 문다(MyTripsListPage.integration 과 같은 목).
jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/storageMock'),
}));

const POLL = DRAFT_POLL_INTERVAL_MS;
const SLOW = DRAFT_POLL_SLOW_INTERVAL_MS;
const A = 'trip-aaaa';
const B = 'trip-bbbb';
const PUSH = router.push as jest.Mock;
const LIST_KEY = getGetTripsQueryKey();

// ── 여행(목록 한 줄) 만들기 — 네 칸은 서버가 일정 조회 응답에서 옮겨 담는 규칙(itineraryCols) 그대로 ──────────

function tripRow(tripId: string, cols = NO_ITINERARY): Trip {
  return {
    tripId,
    title: `${tripId} 여행`,
    startDate: '2099-06-10',
    endDate: '2099-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...cols,
  };
}

const none = (id: string) => tripRow(id);
const running = (
  id: string,
  generationMode: Itinerary['generationMode'] = 'FULLY_AI'
) =>
  tripRow(
    id,
    itineraryCols(
      itinerary({
        tripId: id,
        status: 'PLANNED',
        generationState: 'PARTIAL',
        generationMode,
        generationSessionId: 'sess-1',
      })
    )
  );
const complete = (
  id: string,
  generationMode: Itinerary['generationMode'] = 'FULLY_AI'
) =>
  tripRow(
    id,
    itineraryCols(
      itinerary({
        tripId: id,
        status: 'PLANNED',
        generationState: 'COMPLETE',
        generationMode,
        generationSessionId: null,
      })
    )
  );
const failed = (id: string) =>
  tripRow(
    id,
    itineraryCols(
      itinerary({
        tripId: id,
        status: 'PLANNED',
        generationState: 'FAILED',
        generationSessionId: null,
      })
    )
  );
const confirmed = (id: string) =>
  tripRow(
    id,
    itineraryCols(
      itinerary({
        tripId: id,
        status: 'CONFIRMED',
        generationState: 'COMPLETE',
        generationSessionId: null,
      })
    )
  );
/** 재생성 1차 — 옛 COMPLETE 인 채 세션만 돈다(목록 칸: state COMPLETE + generating true). */
const regenerating = (id: string) =>
  tripRow(
    id,
    itineraryCols(
      itinerary({
        tripId: id,
        status: 'PLANNED',
        generationState: 'COMPLETE',
        generationSessionId: 'sess-2',
      })
    )
  );

// ── 서버 대본 ────────────────────────────────────────────────────────────────

/** `GET /trips` 가 돌려줄 목록 — 요청마다 여기서 읽으므로 테스트 중간에 바꾸면 "서버가 바뀌었다"가 된다. */
let serverTrips: Trip[] = [];
/** true 면 `GET /trips` 가 500 — "폴링 틱이 실패했다". */
let listFails = false;
/** `GET /trips/{id}/itinerary`(copick [보기] 갈래 전용) 응답. */
let itineraryReply: Itinerary | 500 | 404 = 404;
/** 값이 있으면 일정 GET 응답을 이 약속이 풀릴 때까지 붙잡는다("응답 대기 중"을 만든다). */
let itineraryGate: Promise<void> | null = null;
let openItineraryGate: () => void = () => {};

const log = createRequestLog(server);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  log.attach();
});

let showSpy: jest.SpyInstance;

beforeEach(() => {
  serverTrips = [];
  listFails = false;
  itineraryReply = 404;
  itineraryGate = null;
  openItineraryGate = () => {};
  log.reset();
  mockPathname = '/';
  PUSH.mockClear();
  clearAccessToken();
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips`, () =>
      listFails
        ? HttpResponse.json(
            { error: { code: 'INTERNAL', message: '서버 오류' } },
            { status: 500 }
          )
        : HttpResponse.json(serverTrips)
    ),
    http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
      if (itineraryGate) await itineraryGate;
      if (itineraryReply === 404) {
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: '일정이 없어요' } },
          { status: 404 }
        );
      }
      if (itineraryReply === 500) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL', message: '서버 오류' } },
          { status: 500 }
        );
      }
      return HttpResponse.json(itineraryReply);
    })
  );
  jest.useFakeTimers();
  showSpy = jest.spyOn(ToastModule, 'showToast');
});

// 토스트·포커스 매니저는 모듈 싱글턴이다 — 최상위(describe 밖)에서 되돌려야 앞 케이스의 상태가 새지 않는다(02a ★2).
afterEach(() => {
  openItineraryGate(); // 붙잡힌 응답을 남기지 않는다.
  showSpy.mockRestore();
  resetToast();
  act(() => focusManager.setFocused(undefined));
  server.resetHandlers();
  jest.useRealTimers();
});

afterAll(() => server.close());

/** 운영 전역과 같은 staleTime 30초 — 0 이면 관찰자가 붙는 순간 낡은 칸을 즉시 한 번 더 받아 요청 수가 흔들린다. */
const newClient = () => newTestQueryClient({ staleTime: 30_000 });

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

type Gate = { drawn: boolean; destination: BootstrapDestination | null };
const HOME: Gate = { drawn: true, destination: 'HOME' };

interface MountOptions {
  /** 훅을 띄우기 전에 목록 캐시에 심는 여행들 — 다른 화면이 이미 받아 둔 목록. 서버 대본도 같은 값으로 시작한다. */
  seed?: Trip[];
  path?: string;
  gate?: Gate;
  /** 같은 목록 칸을 읽기만 하는 카드 대역(홈 계획 카드·일정 탭 카드 — 자체 간격 없음). */
  withCard?: boolean;
}

function mount({
  seed = [],
  path = '/',
  gate = HOME,
  withCard = false,
}: MountOptions = {}) {
  mockPathname = path;
  serverTrips = seed;
  const client = newClient();
  client.setQueryData(LIST_KEY, seed);
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
      return useGetTrips({ query: { enabled: withCard } });
    },
    { initialProps: gate, wrapper: Wrapper }
  );
  return {
    client,
    /** 카드 대역이 읽는 여행 한 줄의 `itineraryGenerationState`. */
    cardState: (id: string) =>
      view.result.current.data?.find((t) => t.tripId === id)
        ?.itineraryGenerationState,
    /** 경로가 바뀐 것을 흉내 낸다 — 목 변수를 바꾸고 다시 그린다(실물은 내비게이션이 리렌더를 일으킨다). */
    setPath(next: string) {
      mockPathname = next;
      act(() => view.rerender(current));
    },
    setGate(next: Gate) {
      current = next;
      act(() => view.rerender(next));
    },
    /** 다른 곳(진행 화면·확정·무효화 등)이 목록 캐시에 새 값을 쓴 것을 흉내 낸다. */
    write(trips: Trip[]) {
      act(() => {
        client.setQueryData(LIST_KEY, trips);
      });
    },
  };
}

type Harness = ReturnType<typeof mount>;

/** 앵커 짝 — 같은 전이가 홈에서는 토스트를 띄운다는 것(하네스가 귀먹은 게 아님)을 같은 테스트 안에서 보인다. */
function expectToastAtHomeAfterRegeneration(h: Harness): void {
  expect(screen.queryByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeNull();
  h.write([running(A)]);
  h.setPath('/');
  h.write([complete(A)]);
  expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
}

describe('K1 · 홈에 머무는 동안 생성이 끝나면 같은 목록 칸을 읽는 카드가 바뀐다 (AC-6)', () => {
  it('자체 간격이 없는 카드 대역이 PARTIAL 에서 COMPLETE 로 바뀌고, 물은 것은 목록 1건뿐이다', async () => {
    // 준비 — A 는 생성 중으로 시드, 서버는 이미 완료.
    const h = mount({ seed: [running(A)], withCard: true });
    serverTrips = [complete(A)];
    // 앵커 — 처음엔 생성 중으로 읽고 아직 아무것도 안 물었다.
    expect(h.cardState(A)).toBe('PARTIAL');
    expect(log.all()).toEqual([]);

    // 실행 — 폴링 간격 하나.
    await advance(POLL + 100);

    // 단언 — 카드가 바뀌었고, 일정 GET 은 한 건도 없다.
    expect(h.cardState(A)).toBe('COMPLETE');
    expect(listHits(log.all())).toBe(1);
    expect(itineraryHits(log.all())).toBe(0);
  });
});

describe('K2 · 이미 PARTIAL 인 채 시작해도(재시작) 완료되면 토스트가 정확히 한 번 뜬다 (AC-6)', () => {
  it('문구와 "보기" 버튼이 보이고, 이후 간격이 지나도 더 묻지 않고 토스트도 더 늘지 않는다', async () => {
    mount({ seed: [running(A)], path: '/' });
    // 앵커 — 전이 전엔 토스트가 없다.
    expect(screen.queryByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeNull();

    serverTrips = [complete(A)];
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
    expect(listHits(log.all())).toBe(1);

    await advance(POLL * 3);

    // 끝난 여행만 남았으니 더 묻지 않는다.
    expect(listHits(log.all())).toBe(1);
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(itineraryHits(log.all())).toBe(0);
  });
});

describe('K3 · PARTIAL → FAILED 도 침묵하지 않는다 (INV-4)', () => {
  it('실패 문구·오류 톤·"보기" 가 뜬다', async () => {
    mount({ seed: [running(A)], path: '/' });
    expect(screen.queryByTestId(GENERATION_FAILED_TOAST_ID)).toBeNull();

    serverTrips = [failed(A)];
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

describe('K4 · 보고 있는 화면이면 토스트를 생략한다 — 폴링은 그대로 돈다 (결정 1 · D3)', () => {
  it.each<[string, string]>([
    ['그 여행의 생성 중 화면', `/trips/${A}/itinerary/generating`],
    ['그 여행의 초안 화면', `/trips/${A}/itinerary/draft`],
    [
      '그 여행의 같이 짜기 슬롯 채우기',
      `/trips/${A}/itinerary/copick/${encodeURIComponent('2099-06-10#poi-1')}`,
    ],
    ['일정 탭(어느 여행이든)', '/itinerary'],
  ])(
    '%s — 폴링이 받아 온 완료·실패는 토스트가 안 뜨고 카드(목록 캐시)는 바뀐다',
    async (_label, path) => {
      // 준비 — A 는 생성 중, 서버도 아직 생성 중.
      const h = mount({ seed: [running(A)], path, withCard: true });

      // 실행 ① — 진행 화면에 있어도 셸의 목록 폴링은 양보하지 않는다(간격 둘 → 목록 2건, 일정 GET 0).
      await advance(POLL * 2 + 100);

      // 단언 ①
      expect(listHits(log.all())).toBe(2);
      expect(itineraryHits(log.all())).toBe(0);
      expect(showSpy).not.toHaveBeenCalled();

      // 실행 ② — 서버에서 완료가 되고 다음 간격이 온다.
      serverTrips = [complete(A)];
      await advance(POLL + 100);

      // 단언 ② — 토스트 0, 값은 캐시에 있다(카드 갱신은 토스트와 무관).
      expect(showSpy).not.toHaveBeenCalled();
      expect(h.cardState(A)).toBe('COMPLETE');

      // 실행 ③ — 실패도 같다(캐시에 직접 쓴다: 이미 끝난 여행은 더 안 묻는다).
      h.write([running(A)]);
      h.write([failed(A)]);
      await advance(100);

      // 단언 ③
      expect(showSpy).not.toHaveBeenCalled();
      expect(h.cardState(A)).toBe('FAILED');

      // 짝 — 같은 전이가 홈에서는 뜬다.
      expectToastAtHomeAfterRegeneration(h);
    }
  );
});

describe('K5 · 다른 여행의 진행 화면에 있으면 띄운다 (AC2d)', () => {
  it('B 의 초안 화면에서 A 의 완료는 토스트가 뜬다', async () => {
    mount({ seed: [running(A)], path: `/trips/${B}/itinerary/draft` });
    expect(screen.queryByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeNull();

    serverTrips = [complete(A)];
    await advance(POLL + 100);

    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });
});

describe('K6 · 같은 값이 반복돼도, 관찰자가 둘이어도 한 번만', () => {
  it('완료 뒤 같은 완료가 목록에 다시 써져도 토스트 호출은 1번이다', async () => {
    const h = mount({ seed: [running(A)], withCard: true });
    serverTrips = [complete(A)];
    await advance(POLL + 100);
    expect(showSpy).toHaveBeenCalledTimes(1);

    h.write([complete(A)]);
    h.write([complete(A)]);
    await advance(100);

    expect(showSpy).toHaveBeenCalledTimes(1);
  });
});

describe('K7·K8·K9 · 전이가 아닌 것은 알리지 않고, 재생성은 다시 알린다', () => {
  it('K7 마운트 때 이미 완료·실패인 여행과, 나중에 목록에 새로 나타난 완료 여행은 토스트가 없다', async () => {
    const h = mount({ seed: [complete(A), failed(B)], path: '/' });
    await advance(100);
    expect(showSpy).not.toHaveBeenCalled();

    // 실행 — 목록에 처음 보는 여행 C 가 이미 완료 상태로 나타난다(직전 값이 없다).
    h.write([complete(A), failed(B), complete('trip-cccc')]);
    await advance(100);

    expect(showSpy).not.toHaveBeenCalled();
    // 짝 — 진짜 전이는 뜬다.
    h.write([running(A), failed(B)]);
    h.write([complete(A), failed(B)]);
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });

  it('K8 완료 → 재생성(PARTIAL) → 완료 면 다시 한 번 뜬다', () => {
    const h = mount({ seed: [complete(A)], path: '/' });
    expect(showSpy).not.toHaveBeenCalled();

    h.write([running(A)]);
    expect(showSpy).not.toHaveBeenCalled();
    h.write([complete(A)]);

    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });

  it('K9 재생성 1차(COMPLETE + generating)는 폴링 대상이고, 세션만 지우고 끝나면(COMPLETE → COMPLETE) 토스트는 없다', async () => {
    mount({ seed: [regenerating(A)], path: '/' });
    serverTrips = [complete(A)];

    await advance(POLL + 100);

    // generating 이 참이라 물었고(앵커), 전이가 아니니 알리지 않는다.
    expect(listHits(log.all())).toBe(1);
    expect(showSpy).not.toHaveBeenCalled();

    // 세션이 풀렸으니 더 묻지 않는다.
    await advance(POLL * 3);
    expect(listHits(log.all())).toBe(1);
  });
});

describe('K10 · 생성 중인 여행이 목록에 없으면 서버에 아무것도 묻지 않는다 (AC-6)', () => {
  it.each<[string, Trip[]]>([
    ['목록이 비어 있다', []],
    ['일정 없는 여행만 있다', [none(A)]],
    ['완료된 여행만 있다', [complete(A)]],
    ['실패한 여행만 있다', [failed(A)]],
    ['확정된 여행만 있다', [confirmed(A)]],
  ])('%s → 간격 세 번이 지나도 요청 0건', async (_label, seed) => {
    mount({ seed, path: '/' });

    await advance(POLL * 3);

    expect(log.all()).toEqual([]);
    expect(showSpy).not.toHaveBeenCalled();
  });

  it('짝 — 같은 하네스에서 생성 중 여행이 하나 끼면 목록을 묻는다(하네스가 귀먹은 게 아니다)', async () => {
    mount({ seed: [none(A), confirmed(B), running('trip-cccc')], path: '/' });

    await advance(POLL + 100);

    expect(listHits(log.all())).toBe(1);
  });
});

describe('K11 · 여행 둘이 생성 중이어도 목록은 간격마다 1건 (N 과 무관)', () => {
  it('A·B 모두 생성 중이어도 간격마다 목록 1건, 일정 GET 0', async () => {
    mount({ seed: [running(A), running(B)], path: '/' });

    await advance(POLL + 100);
    expect(listHits(log.all())).toBe(1);

    await advance(POLL);
    expect(listHits(log.all())).toBe(2);
    expect(itineraryHits(log.all())).toBe(0);
  });
});

describe('K11b · 오래 안 끝나면 간격이 2초에서 5초로 늘어난다 (요청량 브레이크 · pollIntervalMs)', () => {
  it('빠른 구간 14회(2초씩) 뒤에는 2.1초가 지나도 더 묻지 않고, 5초가 차면 묻는다', async () => {
    // 준비 — 서버가 계속 "생성 중"으로 답한다(멈춘 생성). 시드가 갱신 1회로 세어져 14번째 응답에서 빠른 구간(15회 미만)이 끝난다.
    mount({ seed: [running(A)], path: '/' });

    // 실행 1 — 2초 간격 14번이 지나도록 시계를 흘린다
    await advance(14 * POLL + 100);

    // 단언 1 — 앵커: 빠른 구간에서는 정확히 2초마다 한 번이었다
    expect(listHits(log.all())).toBe(14);

    // 실행 2 — 2초 간격이었다면 다음 요청이 나갔을 만큼 더 흘린다
    await advance(POLL + 100);

    // 단언 2 — 5초 간격으로 늘었으므로 아직 그대로
    expect(listHits(log.all())).toBe(14);

    // 실행 3 — 5초가 찰 때까지
    await advance(SLOW - POLL);

    // 단언 3
    expect(listHits(log.all())).toBe(15);
  });
});

describe('K12 · 앱이 백그라운드면 묻지 않고, 돌아오면 낡은 목록을 따라잡는다', () => {
  it('포커스가 없는 동안 요청 0건 → 복귀하면 정확히 1건', async () => {
    mount({ seed: [running(A)], path: '/' });

    // 실행 ① — 백그라운드로 가서 간격이 한참 지난다(데이터가 30초를 넘겨 낡는 길).
    act(() => focusManager.setFocused(false));
    await advance(119_000);

    // 단언 ①
    expect(listHits(log.all())).toBe(0);

    // 실행 ② — 앱으로 돌아온다.
    act(() => focusManager.setFocused(true));
    await advance(100);

    // 단언 ② — 낡은 목록을 정확히 한 번 따라잡았다.
    expect(listHits(log.all())).toBe(1);
  });
});

describe('K13 · 폴링 틱이 실패해도 멈추지 않는다 — 느린 간격으로 계속, 받아 둔 목록은 유지 (D3 · INV-4)', () => {
  it('500 한 번 뒤: 카드는 옛 값 유지 · 5초 간격으로 계속 시도 · 회복하면 그 틱에 토스트 1회', async () => {
    // 준비 — 서버 목록 조회가 실패한다. 카드 대역이 읽는 목록은 시드(옛 PARTIAL).
    const h = mount({ seed: [running(A)], path: '/', withCard: true });
    listFails = true;

    // 실행 ① — 첫 틱이 500 을 받는다.
    await advance(POLL + 100);

    // 단언 ① — 요청 1건, 쿼리는 error, 그래도 받아 둔 목록은 그대로(카드가 "모름"으로 뒤집히지 않는다), 토스트 없음.
    expect(listHits(log.all())).toBe(1);
    expect(h.client.getQueryState(LIST_KEY)?.status).toBe('error');
    expect(h.cardState(A)).toBe('PARTIAL');
    expect(showSpy).not.toHaveBeenCalled();

    // 실행 ② — 옛 규칙(오류면 멈춘다)이었다면 영영 안 묻는다. 새 규칙은 느린 간격(5초)이라 2.1초 뒤엔 아직 안 묻고…
    await advance(POLL + 100);
    expect(listHits(log.all())).toBe(1);
    // …5초가 차면 다시 묻는다(여전히 실패).
    await advance(SLOW - POLL);
    expect(listHits(log.all())).toBe(2);
    expect(showSpy).not.toHaveBeenCalled();

    // 실행 ③ — 서버가 회복해 완료를 준다.
    listFails = false;
    serverTrips = [complete(A)];
    await advance(SLOW + 100);

    // 단언 ③ — 따라잡아 토스트가 한 번 뜨고 카드가 바뀐다.
    expect(h.cardState(A)).toBe('COMPLETE');
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
    expect(itineraryHits(log.all())).toBe(0);
  });
});

describe('K14 · "보기" 는 누른 시점의 목록 캐시로 목적지를 정한다 (AC-7)', () => {
  /** [이름, 전이 때 목록에 들어오는 값, 토스트 id, 누르기 전에 목록이 바뀐 값(없으면 null), 기대 href] */
  const rows: [string, Trip, string, Trip | null, string][] = [
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
    '%s — push 1회, 일정 GET 0',
    (_label, arrived, toastId, changedBeforePress, expectedHref) => {
      const h = mount({ seed: [running(A)], path: '/' });
      h.write([arrived]);
      expect(screen.getByTestId(toastId)).toBeOnTheScreen();
      if (changedBeforePress !== null) h.write([changedBeforePress]);
      expect(PUSH).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId(`${toastId}-action`));

      expect(PUSH).toHaveBeenCalledTimes(1);
      expect(PUSH).toHaveBeenCalledWith(expectedHref);
      expect(screen.queryByTestId(toastId)).toBeNull();
      expect(itineraryHits(log.all())).toBe(0);
    }
  );

  describe('copick 갈래 — 누르는 순간 목록이 다시 "같이 짜기 생성 중"이면 그때만 일정 GET 1번', () => {
    /** 토스트가 뜬 뒤 재생성이 시작돼 목록이 PARTIAL + CO_PLAN 이 된 채로 "보기" 앞까지 간다. */
    function arriveThenRegenerate(): Harness {
      const h = mount({ seed: [running(A, 'CO_PLAN')], path: '/' });
      h.write([complete(A, 'CO_PLAN')]);
      expect(
        screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)
      ).toBeOnTheScreen();
      h.write([running(A, 'CO_PLAN')]);
      // 앵커 — 아직 일정을 안 물었고 이동도 없다.
      expect(itineraryHits(log.all())).toBe(0);
      expect(PUSH).not.toHaveBeenCalled();
      return h;
    }

    it('일정 GET 1번 → 응답을 받은 뒤에야 첫 비고정 슬롯으로 push 1회', async () => {
      arriveThenRegenerate();
      itineraryReply = itinerary({
        tripId: A,
        generationMode: 'CO_PLAN',
        generationState: 'PARTIAL',
      });

      fireEvent.press(
        screen.getByTestId(`${GENERATION_COMPLETE_TOAST_ID}-action`)
      );
      // 응답 전에는 이동하지 않는다(정착 전 오이동 금지).
      expect(PUSH).not.toHaveBeenCalled();
      await advance(100);

      expect(itineraryHits(log.all())).toBe(1);
      expect(PUSH).toHaveBeenCalledTimes(1);
      expect(PUSH).toHaveBeenCalledWith(
        `/trips/${A}/itinerary/copick/${encodeURIComponent(`${DAY1}#poi-a`)}`
      );
    });

    it('W3 잠금 — 응답을 기다리는 사이 새 "보기"(또 다른 알림)를 눌러도 일정 GET 1 · push 1', async () => {
      // 준비 — 첫 "보기"를 눌러 일정 응답을 붙잡아 둔다(응답 대기 중).
      const h = arriveThenRegenerate();
      itineraryGate = new Promise<void>((resolve) => {
        openItineraryGate = resolve;
      });
      itineraryReply = itinerary({
        tripId: A,
        generationMode: 'CO_PLAN',
        generationState: 'PARTIAL',
      });
      fireEvent.press(
        screen.getByTestId(`${GENERATION_COMPLETE_TOAST_ID}-action`)
      );
      await advance(100);
      expect(itineraryHits(log.all())).toBe(1); // 앵커 — 첫 누름이 조회를 시작했다.
      expect(PUSH).not.toHaveBeenCalled();

      // 실행 ① — 응답 전에 다시 완료를 지나가 새 토스트가 뜨고, 목록이 다시 같이 짜기 생성 중이 된 뒤 새 "보기"를 누른다.
      h.write([complete(A, 'CO_PLAN')]);
      h.write([running(A, 'CO_PLAN')]);
      fireEvent.press(
        screen.getByTestId(`${GENERATION_COMPLETE_TOAST_ID}-action`)
      );
      await advance(100);

      // 단언 ① — 처리 중 잠금이 두 번째 누름을 삼켰다: 아직 이동 0.
      expect(PUSH).not.toHaveBeenCalled();

      // 실행 ② — 응답이 온다.
      openItineraryGate();
      await advance(100);

      // 단언 ② — 이동은 한 번(두 번 쌓이면 슬롯 채우기 화면이 스택에 두 번 올라간다), 일정 GET 도 1.
      expect(PUSH).toHaveBeenCalledTimes(1);
      expect(itineraryHits(log.all())).toBe(1);
    });

    it('그 일정 GET 이 500 이면 이동하지 않고 실패 토스트를 띄운다 (INV-4)', async () => {
      arriveThenRegenerate();
      itineraryReply = 500;
      expect(screen.queryByTestId(ITINERARY_OPEN_FAILED_TOAST_ID)).toBeNull();

      fireEvent.press(
        screen.getByTestId(`${GENERATION_COMPLETE_TOAST_ID}-action`)
      );
      await advance(100);

      expect(itineraryHits(log.all())).toBe(1);
      expect(PUSH).not.toHaveBeenCalled();
      expect(
        screen.getByTestId(ITINERARY_OPEN_FAILED_TOAST_ID)
      ).toBeOnTheScreen();
    });
  });

  it('누르는 순간 목록 캐시가 비어 있으면(밀려남) 어디로도 이동하지 않는다 (INV-4)', () => {
    const h = mount({ seed: [running(A)], path: '/' });
    h.write([complete(A)]);
    act(() => {
      h.client.removeQueries({ queryKey: LIST_KEY });
    });

    fireEvent.press(
      screen.getByTestId(`${GENERATION_COMPLETE_TOAST_ID}-action`)
    );

    expect(PUSH).not.toHaveBeenCalled();
  });

  it('누르는 순간 목록에 그 여행이 없으면(다른 기기에서 삭제) 어디로도 이동하지 않는다 (INV-4)', () => {
    const h = mount({ seed: [running(A)], path: '/' });
    h.write([complete(A)]);
    h.write([confirmed(B)]);

    fireEvent.press(
      screen.getByTestId(`${GENERATION_COMPLETE_TOAST_ID}-action`)
    );

    expect(PUSH).not.toHaveBeenCalled();
    expect(itineraryHits(log.all())).toBe(0);
  });
});

describe('K15 · 로그인 전·미결·그려지기 전에는 감시도 토스트도 없다 (AC8)', () => {
  it.each<[string, Gate]>([
    ['아직 그려지지 않았다(HOME)', { drawn: false, destination: 'HOME' }],
    ['로그인 화면', { drawn: true, destination: 'LOGIN' }],
    ['온보딩', { drawn: true, destination: 'ONBOARDING' }],
    ['목적지 미결', { drawn: true, destination: null }],
  ])(
    '%s → 간격 세 번이 지나도 요청 0건, 목록에 완료가 써져도 토스트 0',
    async (_label, gate) => {
      const h = mount({ seed: [running(A)], gate, path: '/' });

      await advance(POLL * 3);
      h.write([complete(A)]);
      await advance(100);

      expect(log.all()).toEqual([]);
      expect(showSpy).not.toHaveBeenCalled();
      expect(PUSH).not.toHaveBeenCalled();
    }
  );

  it('그려진 HOME 이 되면 그때부터 묻고 알린다', async () => {
    const h = mount({
      seed: [running(A)],
      gate: { drawn: false, destination: 'HOME' },
      path: '/',
    });
    serverTrips = [complete(A)];
    await advance(POLL * 2);
    expect(log.all()).toEqual([]);

    h.setGate(HOME);
    await advance(POLL + 100);

    expect(listHits(log.all())).toBe(1);
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });

  it('그려지기 전에 새로 생성 중이 된 여행도, 그려진 HOME 이 되는 순간 따라잡아 묻는다', async () => {
    // 준비 — 훅 단독 렌더(카드 대역 없음): 관찰자가 하나라도 있으면 다시 그릴 때마다 캐시 알림이 와서 따라잡기 줄이 없어도 통과한다.
    const h = mount({
      seed: [none(A)],
      gate: { drawn: false, destination: 'HOME' },
      path: '/',
    });
    serverTrips = [complete(A)];
    // 그려지기 전(감시 귀가 꺼진 동안)에 목록에 생성 중인 여행이 생긴다 — 시드가 아니라 마운트 뒤 쓰기다.
    h.write([running(A)]);
    await advance(POLL * 2);
    expect(log.all()).toEqual([]);

    // 실행 — 그려진 HOME 이 된다
    h.setGate(HOME);
    await advance(POLL + 100);

    // 단언 — 활성화 시점의 목록을 읽어 폴링을 시작하므로 묻고, 전이도 알린다
    expect(listHits(log.all())).toBe(1);
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });

  it('HOME → LOGIN(로그아웃) 으로 바뀌면 이후 간격에 더 묻지 않고, 그 뒤 쓰인 완료도 알리지 않는다', async () => {
    const h = mount({ seed: [running(A)], path: '/' });
    await advance(POLL + 100);
    expect(listHits(log.all())).toBe(1);

    h.setGate({ drawn: true, destination: 'LOGIN' });
    await advance(POLL * 3);
    h.write([complete(A)]);
    await advance(100);

    expect(listHits(log.all())).toBe(1);
    expect(showSpy).not.toHaveBeenCalled();
  });
});

describe('K16 · 진행 화면이어도 셸은 양보하지 않고 목록을 간격마다 1건씩 묻는다 (D3 · 옛 "양보"의 뒤집기)', () => {
  it.each<[string, string]>([
    ['생성 중 화면', `/trips/${A}/itinerary/generating`],
    ['초안 화면', `/trips/${A}/itinerary/draft`],
    [
      '같이 짜기 슬롯 채우기',
      `/trips/${A}/itinerary/copick/${encodeURIComponent('2099-06-10#poi-1')}`,
    ],
    ['일정 탭', '/itinerary'],
    ['같이 짜기 완성 확인', `/trips/${A}/itinerary/copick/complete`],
    ['다른 여행의 초안 화면', `/trips/${B}/itinerary/draft`],
    ['홈', '/'],
  ])('%s → 간격마다 목록 1건, 일정 GET 0', async (_label, path) => {
    mount({ seed: [running(A)], path });

    await advance(POLL + 100);
    expect(listHits(log.all())).toBe(1);

    await advance(POLL);
    expect(listHits(log.all())).toBe(2);
    expect(itineraryHits(log.all())).toBe(0);
  });
});

describe('W1 · 폴링 틱이 돌아도 셸 훅을 부르는 컴포넌트는 다시 그려지지 않는다 (루트 리렌더 0)', () => {
  it('생성 중 폴링 틱을 5번 흘려도 추가 렌더 0회 — 틱마다 앱 루트(SplashGate)가 다시 그려지면 안 된다', async () => {
    // 준비 — 셸 훅만 부르는 컴포넌트(실제로는 앱 루트)를 렌더 횟수와 함께 그린다. 목록은 계속 "생성 중"으로 답한다.
    // *(개념)* 관찰자의 `notifyOnChangeProps: []` = "어떤 값이 바뀌어도 이 컴포넌트를 다시 그리지 마라". 이 줄이 없으면
    // 요청 시작·끝(isFetching) 변화만으로 틱마다 다시 그려진다 — 셸은 값을 읽지 않고 캐시 구독으로 전이를 보기 때문에 불필요한 비용이다.
    mockPathname = '/';
    serverTrips = [running(A)];
    const client = newClient();
    client.setQueryData(LIST_KEY, [running(A)]);
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        useGenerationWatch(HOME.drawn, HOME.destination);
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            <WithToastHost>{children}</WithToastHost>
          </QueryClientProvider>
        ),
      }
    );
    await advance(100);
    const afterMount = renders;
    expect(listHits(log.all())).toBe(0); // 앵커 — 아직 틱 전(시드가 신선하다).

    // 실행 — 폴링 틱 5번.
    await advance(POLL * 5 + 100);

    // 단언 — 틱이 실제로 돌았고(앵커), 그런데도 렌더는 늘지 않았다.
    expect(listHits(log.all())).toBeGreaterThanOrEqual(5);
    expect(renders).toBe(afterMount);
  });
});

describe('K17 · 같은 목록 칸을 읽는 관찰자가 둘이어도 한 간격에 요청은 1건', () => {
  it('카드 대역 + 셸이 함께 있어도 간격당 목록 GET 1', async () => {
    mount({ seed: [running(A)], withCard: true, path: '/' });

    await advance(POLL + 100);
    expect(listHits(log.all())).toBe(1);

    await advance(POLL);
    expect(listHits(log.all())).toBe(2);
  });
});

describe('K18 · 첫 생성은 목록 무효화가 폴링을 시작시킨다 (AC-7 #1 → AC-6)', () => {
  it('생성 중 여행이 없어 조용하던 셸이, 무효화 뒤 서버가 generating 을 실어 오면 폴링을 시작하고 끝나면 알린다', async () => {
    // 준비 — 일정 없는 여행 하나. 폴링 없음(앵커).
    const h = mount({ seed: [none(A)], path: '/' });
    await advance(POLL * 3);
    expect(log.all()).toEqual([]);

    // 실행 ① — 생성 POST 성공 직후의 무효화를 흉내 낸다(서버는 이제 A 를 생성 중으로 싣는다).
    serverTrips = [running(A)];
    await act(async () => {
      await h.client.invalidateQueries({ queryKey: LIST_KEY });
    });
    await advance(100);

    // 단언 ① — 목록을 다시 받았다.
    expect(listHits(log.all())).toBe(1);

    // 실행 ② — 서버에서 끝난다. 다음 간격.
    serverTrips = [complete(A)];
    await advance(POLL + 100);

    // 단언 ② — 폴링이 시작돼 있었으므로 이 틱이 완료를 받아 토스트가 뜬다.
    expect(listHits(log.all())).toBe(2);
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
    expect(itineraryHits(log.all())).toBe(0);
  });
});

describe('K19 · 로그아웃(queryClient.clear) 뒤 첫 값은 "처음 본 값"이다', () => {
  it('캐시를 비운 뒤 이미 완료인 목록이 와도 토스트가 없고, 그 뒤 진짜 전이는 뜬다', () => {
    const h = mount({ seed: [running(A)], path: '/' });

    act(() => {
      h.client.clear();
    });
    // 직전 값(PARTIAL)이 비워졌으므로 곧바로 COMPLETE 가 와도 전이가 아니다.
    h.write([complete(A)]);
    expect(showSpy).not.toHaveBeenCalled();

    // 짝 — 비운 뒤에도 감시 귀는 살아 있어 진짜 전이는 뜬다.
    h.write([running(A)]);
    h.write([complete(A)]);
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(GENERATION_COMPLETE_TOAST_ID)).toBeOnTheScreen();
  });
});
