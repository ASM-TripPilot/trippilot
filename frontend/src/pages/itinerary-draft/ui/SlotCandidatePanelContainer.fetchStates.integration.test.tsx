import type { ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type { Itinerary } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotCandidatePanelContainer } from './SlotCandidatePanelContainer';

/**
 * TRIP-1109 · h08 다른 후보 시트의 **조회 중·실패·지연** 배선을 실 HTTP(msw)로 태운다.
 *
 * 무엇을 보장하나:
 *  - 응답 전엔 스켈레톤(loading), 실패면 안내 + [다시 시도](error) — 0건 얼굴은 **응답이 0건일 때만**(INV-4).
 *  - 실패 문구 = `resolveSlotSwapError(error).message` 그대로(404 갈래가 하드코딩 우회를 막는다).
 *  - 10초가 지나도 응답이 없으면 로딩 얼굴 안에 안내 줄 + [다시 시도](slow). 요청은 끊지 않는다.
 *  - [다시 시도]는 같은 바디로 POST 1회, 새 요청 기준으로 10초를 다시 잰다.
 *  - 한 틱 연타는 1회로 접히고(앞 창), 다음 [다시 시도]가 다시 보이면 그 버튼은 산다(뒤 창).
 *
 * ★ 타이머 케이스는 fake timer 를 **렌더 전에** 켜고, 경계 사이엔 `findBy`/`waitFor` 를 쓰지 않는다
 *   (fake 아래 findBy 가 시계를 스스로 민다 — 02a ★2·★4). 해제는 파일 최상위 afterEach.
 *
 * 3동작 뼈대: 준비=POST 호출 순번별 응답 계획 → 실행=시트 열기·시간 흘리기·[다시 시도] → 단언=얼굴·요청 수.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const SLOT_KEY = buildSlotKey(DAY1, 'a');

/** `resolveSlotSwapError` 문구(slotSwapError.ts MESSAGE) — 화면에 그대로 떠야 한다. */
const FALLBACK = '지금은 바꿀 수 없어요. 잠시 후 다시 시도해 주세요';
const NOT_FOUND = '해당 일정을 찾을 수 없어요';
const EMPTY_TITLE = '이 슬롯에 맞는 다른 후보가 없어요';
const SLOW_TEXT = /시간이 걸리고 있어요/;

const ID = {
  loading: 'itinerary-candidate-loading',
  slow: 'itinerary-candidate-slow',
  retry: 'itinerary-candidate-fetch-retry',
  fetchError: 'itinerary-candidate-fetch-error',
  empty: 'itinerary-candidate-empty',
  emptySearch: 'itinerary-candidate-empty-search',
  current: 'itinerary-candidate-current',
  confirm: 'itinerary-candidate-confirm',
  putError: 'itinerary-candidate-error',
  sheet: 'itinerary-candidate-sheet',
  title: 'itinerary-candidate-sheet-title',
} as const;

function itinerary(): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'a',
            nameKo: '경복궁',
            startAt: '09:30:00',
            endAt: '11:00:00',
            category: '문화',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ],
  };
}

const CANDIDATES = {
  candidates: [
    { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
    { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
  ],
  radiusMUsed: 1100,
  degraded: false,
};

/**
 * POST 호출 순번별 응답 계획. `hang` = 영원히 응답 안 함, `gate` = 테스트가 `releaseGate()` 로 풀 때까지
 * 대기 후 후보 2건, 숫자 = 그 상태코드, `network` = 연결 실패, `ok` = 후보 2건, `empty` = 0건.
 */
type PostStep = 'hang' | 'gate' | 'ok' | 'empty' | 'network' | 500 | 404 | 409;

let postPlan: PostStep[] = [];
let postBodies: unknown[] = [];
let releaseGate: () => void = () => undefined;
let putHandler: () => Response;

function postCalls(): number {
  return postBodies.length;
}

async function respond(step: PostStep): Promise<Response> {
  switch (step) {
    case 'hang':
      await delay('infinite');
      return HttpResponse.json(CANDIDATES);
    case 'gate':
      await new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      return HttpResponse.json(CANDIDATES);
    case 'ok':
      return HttpResponse.json(CANDIDATES);
    case 'empty':
      return HttpResponse.json({
        candidates: [],
        radiusMUsed: 3000,
        degraded: false,
        emptyReason: 'NO_NEARBY',
      });
    case 'network':
      return HttpResponse.error();
    case 409:
      // 실서버 모양 — 모든 409 가 `CONFLICT` 로 온다(Q4 · 브리프 ④-c).
      return HttpResponse.json(
        { error: { code: 'CONFLICT', message: '충돌' } },
        { status: 409 }
      );
    default:
      return new HttpResponse(null, { status: step });
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  postPlan = [];
  postBodies = [];
  releaseGate = () => undefined;
  putHandler = () => HttpResponse.json(itinerary());
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.post(
      `${BASE}/trips/:tripId/itinerary/slot-candidates`,
      async ({ request }) => {
        const step = postPlan[postBodies.length] ?? 'hang';
        postBodies.push(await request.json());
        return respond(step);
      }
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, () => putHandler())
  );
});

// 파일 최상위 — 타이머 describe 의 fake 가 다른 케이스로 새지 않게(02a ★2).
afterEach(() => {
  jest.useRealTimers();
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderContainer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <SlotCandidatePanelContainer
      tripId={TRIP_ID}
      slotKey={SLOT_KEY}
      onClose={jest.fn()}
    />,
    { wrapper: Wrapper }
  );
}

/** fake timer 아래에서 시간을 흘리고 그 사이 약속(axios→msw→TanStack)을 함께 푼다. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/** 실시간 짧은 대기 — 더 나갈 요청이 있었다면 이 사이에 나간다(K11 선례). */
async function settleRealTime(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  });
}

function expectConfirmDisabled(): void {
  expect(screen.getByTestId(ID.confirm).props.accessibilityState.disabled).toBe(
    true
  );
}

describe('🔴 TRIP-1109 · 응답 전·도착 (L1·L2·N1·N2)', () => {
  it('C1 · L1·L2 — 응답 전엔 스켈레톤, 0건 얼굴은 없다. 헤더·현재 행은 GET 값, 교체하기는 비활성', async () => {
    postPlan = ['hang'];
    renderContainer();

    await waitFor(() => expect(postCalls()).toBe(1));
    await waitFor(() =>
      expect(screen.getByTestId(ID.title)).toHaveTextContent('경복궁 대신')
    );

    expect(screen.getByTestId(ID.loading)).toBeOnTheScreen();
    expect(screen.queryByTestId(ID.empty)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.queryByTestId(ID.emptySearch)).toBeNull();
    expect(screen.getByTestId(ID.current)).toBeOnTheScreen();
    expectConfirmDisabled();
  });

  it('C13 · L1 첫 프레임 — 시트를 연 바로 그 렌더에도 0건 얼굴이 새지 않는다(03b 참고 2)', async () => {
    postPlan = ['hang'];

    renderContainer();

    // await 없이 곧장 본다 — 기다리면 이미 요청 중(pending)이라 첫 프레임(idle)을 못 본다(C1 의 사각).
    expect(postCalls()).toBe(0);
    expect(screen.queryByTestId(ID.empty)).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(screen.getByTestId(ID.loading)).toBeOnTheScreen();

    // 뒷정리 겸 앵커 — 이 케이스가 본 것이 정말 "요청 직전"이었다(요청은 곧 1회 나간다).
    await waitFor(() => expect(postCalls()).toBe(1));
  });

  it('C2 · N1 — 후보가 도착하면 스켈레톤이 사라지고 후보 행이 선다', async () => {
    postPlan = ['ok'];
    renderContainer();

    await screen.findByTestId('itinerary-candidate-radio-X');
    expect(screen.getByTestId('itinerary-candidate-radio-Y')).toBeOnTheScreen();
    expect(screen.queryByTestId(ID.loading)).toBeNull();
  });

  it('C3 · N2 — 응답이 실제로 0건이면 **그때** 0건 얼굴(BR-U3-25)', async () => {
    postPlan = ['empty'];
    renderContainer();

    await screen.findByTestId(ID.empty);
    expect(screen.getByTestId(ID.emptySearch)).toBeOnTheScreen();
    expect(screen.queryByTestId(ID.loading)).toBeNull();
    expect(screen.queryByTestId(ID.fetchError)).toBeNull();
  });
});

describe('🔴 TRIP-1109 · 조회 실패 (E1·E2·E3·R1·P1)', () => {
  it.each<[string, PostStep, string]>([
    ['500', 500, FALLBACK],
    ['네트워크 실패', 'network', FALLBACK],
    ['404', 404, NOT_FOUND],
  ])(
    'C4 · E1·INV-4 — %s 는 "후보 없음"으로 접히지 않고 실패 카드에 resolveSlotSwapError 문구가 뜬다',
    async (_label, step, message) => {
      postPlan = [step];
      renderContainer();

      const card = await screen.findByTestId(ID.fetchError);
      expect(within(card).getByText(message)).toBeOnTheScreen();
      expect(screen.queryByTestId(ID.empty)).toBeNull();
      expect(screen.queryByTestId(ID.loading)).toBeNull();
      // 조회 실패는 PUT 인라인 오류와 다른 자리다.
      expect(screen.queryByTestId(ID.putError)).toBeNull();
    }
  );

  it('C5 · E3 — 409(실서버 code CONFLICT)는 fallback 문구로 뜬다', async () => {
    postPlan = [409];
    renderContainer();

    const card = await screen.findByTestId(ID.fetchError);
    expect(within(card).getByText(FALLBACK)).toBeOnTheScreen();
  });

  it('C6 · E2 — [다시 시도]는 같은 바디로 POST 1회, 응답 전엔 스켈레톤으로 돌아가고 도착하면 후보', async () => {
    postPlan = [500, 'gate'];
    renderContainer();
    await screen.findByTestId(ID.fetchError);

    fireEvent.press(screen.getByTestId(ID.retry));

    await waitFor(() => expect(postCalls()).toBe(2));
    expect(Object.keys(postBodies[1] as object)).toEqual(['slotKey']);
    expect((postBodies[1] as { slotKey: string }).slotKey).toBe(SLOT_KEY);
    await waitFor(() =>
      expect(screen.getByTestId(ID.loading)).toBeOnTheScreen()
    );
    expect(screen.queryByTestId(ID.fetchError)).toBeNull();

    await act(async () => {
      releaseGate();
    });
    await screen.findByTestId('itinerary-candidate-radio-X');
    expect(screen.queryByTestId(ID.loading)).toBeNull();
  });

  it('C7 · R1(실패 얼굴) — 한 틱 연타는 POST 1회만 더, 다시 실패하면 그다음 [다시 시도]는 산다', async () => {
    postPlan = [500, 500, 'hang'];
    renderContainer();
    await screen.findByTestId(ID.fetchError);

    // 앞 창 — 같은 틱 두 번(리렌더 없이). useState 잠금은 둘 다 옛 값을 읽어 못 막는다.
    const retry = screen.getByTestId(ID.retry);
    act(() => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });
    await waitFor(() => expect(postCalls()).toBe(2));
    await settleRealTime();
    expect(postCalls()).toBe(2);

    // 뒤 창 — 두 번째도 실패해 실패 얼굴이 다시 뜨면, 그 [다시 시도]는 눌린다.
    await screen.findByTestId(ID.fetchError);
    fireEvent.press(screen.getByTestId(ID.retry));
    await waitFor(() => expect(postCalls()).toBe(3));
  });

  it('C12 · P1 — 교체 PUT 실패는 기존 인라인 오류만, 조회 실패 카드는 뜨지 않는다', async () => {
    postPlan = ['ok'];
    putHandler = () => new HttpResponse(null, { status: 500 });
    renderContainer();

    fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId(ID.confirm));

    await screen.findByTestId(ID.putError);
    expect(screen.queryByTestId(ID.fetchError)).toBeNull();
    expect(screen.getByTestId(ID.sheet)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1109 · 10초 지연 (T1~T4·R1) — fake timer', () => {
  it('C8 · T1·T2 — 9.9초엔 안내 없음, 10초를 넘기면 스켈레톤 위에 안내 줄 + [다시 시도]. 자동 재요청은 없다', async () => {
    postPlan = ['hang'];
    jest.useFakeTimers();
    renderContainer();

    await advance(9_900);
    expect(postCalls()).toBe(1);
    expect(screen.getByTestId(ID.loading)).toBeOnTheScreen();
    expect(screen.queryByTestId(ID.slow)).toBeNull();
    expect(screen.queryByTestId(ID.retry)).toBeNull();

    await advance(200);
    expect(screen.getByTestId(ID.slow)).toHaveTextContent(SLOW_TEXT);
    expect(screen.getByTestId(ID.retry)).toBeOnTheScreen();
    // 로딩 얼굴 **안의** 한 줄 — 스켈레톤은 그대로다.
    expect(screen.getByTestId(ID.loading)).toBeOnTheScreen();
    expect(postCalls()).toBe(1);
  });

  it('C9 · T3 — 지연 안내가 뜬 뒤 응답이 오면 후보로 바뀐다(요청을 끊지 않는다)', async () => {
    postPlan = ['gate'];
    jest.useFakeTimers();
    renderContainer();

    await advance(10_100);
    expect(screen.getByTestId(ID.slow)).toBeOnTheScreen();

    await act(async () => {
      releaseGate();
    });
    // 도착 사슬(msw→axios→TanStack 알림)을 풀 여유 — 경계 단언이 아니라 50ms 는 무해(02a §5-1 P2).
    await advance(50);

    expect(screen.getByTestId('itinerary-candidate-radio-X')).toBeOnTheScreen();
    expect(screen.queryByTestId(ID.slow)).toBeNull();
    expect(screen.queryByTestId(ID.loading)).toBeNull();
  });

  it('C10 · T4 — [다시 시도] 뒤엔 새 요청 기준으로 10초를 다시 재고, 다시 뜬 [다시 시도]도 눌린다', async () => {
    postPlan = ['hang', 'hang', 'hang'];
    jest.useFakeTimers();
    renderContainer();

    await advance(10_100);
    fireEvent.press(screen.getByTestId(ID.retry));
    await advance(0);
    expect(postCalls()).toBe(2);
    expect(screen.queryByTestId(ID.slow)).toBeNull();

    // 새 요청 기준 9.9초 — 아직 안내 없음(첫 요청 기준이면 이미 20초라 떠 있다).
    await advance(9_900);
    expect(screen.queryByTestId(ID.slow)).toBeNull();

    // 새 요청 기준 10.1초 — 다시 뜬다.
    await advance(200);
    expect(screen.getByTestId(ID.slow)).toHaveTextContent(SLOW_TEXT);

    // 다시 뜬 버튼이 죽어 있으면 침묵 실패다 — 두 번째 요청은 아직 매달려 있어도 눌려야 한다(02a ★1).
    fireEvent.press(screen.getByTestId(ID.retry));
    await advance(0);
    expect(postCalls()).toBe(3);
  });

  it('C11 · R1(지연 얼굴) — 한 틱 연타는 POST 1회만 더(pending 중이어도 한 번은 나간다)', async () => {
    postPlan = ['hang', 'hang'];
    jest.useFakeTimers();
    renderContainer();

    await advance(10_100);
    const retry = screen.getByTestId(ID.retry);
    act(() => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });
    await advance(0);

    expect(postCalls()).toBe(2);
  });
});
