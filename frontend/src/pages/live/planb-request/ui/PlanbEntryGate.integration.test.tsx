import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { server } from '@/mocks/server';
import { useReplanFormStore } from '@/features/request-replan';
import type {
  ReplanSession,
  TriggerDetail,
  TriggerList,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { BASE } from '@/test-support/apiBase';
import { liveItinerary, liveSlot } from '@/test-support/liveHubFixtures';
import { createGate } from '@/test-support/mswHookHarness';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';

import { PlanbEntryGate } from './PlanbEntryGate';

/**
 * 상황 감지 FE-B · frontend-components §3.2·§6·§9·§11 · BR-SA-23 — 진입 게이트 통합(실 HTTP = MSW).
 *
 * 무엇을 보장하나(판정표 대표 행 — 표 전수는 `entryRoute.test.ts` PBT-SA-21):
 *  - 트리거 상세를 읽고 **그 트리거 날짜**로 준비된 대안을 묻는다(`?date=affectedDate`).
 *  - DRAFT → i06, SOLVING → i05, NO_SOLUTION → i06 로 **replace**(게이트를 스택에 남기지 않는다).
 *  - APPLIED → 토스트 `이미 반영한 대안이에요` + 허브로 `dismissTo`. 해당 없는 알림 → `지금은 해당하지 않는 알림이에요` + 허브.
 *  - 대안 없음·stale ∧ ACTIVE → 같은 라우트 안에서 i04 를 시드와 함께 그린다 — 제출하면 준비 세션의 사유·지시·제외와
 *    트리거 날짜가 body 로 나간다.
 *  - 상세 404 → 404 얼굴. 상세 실패·3초 초과 → i04(URL 그대로 — 막다른 길 없음).
 *  - 기다리는 동안 대기 얼굴(접근성 이름 `확인하고 있어요`), 3초 상한은 `useElapsedFlag(…, 3000)`.
 *  - 결정은 한 번만 — 굳은 뒤 재조회가 다른 답을 줘도 화면이 바뀌지 않는다.
 *  - MSW: `…/replan-sessions/prepared` 는 `…/replan-sessions/:sessionId` 에도 걸린다 — prepared 를 **먼저** 건다(§11).
 *
 * 대역: 라우터(목 — 이동은 "어떤 인자로 불렀나"까지, 실제 스택 모양은 실기 §12 #4), GPS seam(동의·측위 밖),
 * 3초 시계(`useElapsedFlag` — 실타이머 3초를 기다리지 않게 결과를 쥔다). 나머지(쿼리·i04 배선·POST)는 실물.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: (...args: unknown[]) => mockReplace(...args),
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    canGoBack: () => true,
  }),
}));

jest.mock('../model/useReplanGpsOrigin', () => ({
  useReplanGpsOrigin: () => () => Promise.resolve(undefined),
}));

// 3초 상한 — 결과를 테스트가 쥔다(인자는 기록해 3000 인지 본다). 실물 계약 그대로 `active && 지남`.
let mockTimedOut = false;
const mockElapsedMs: number[] = [];
jest.mock('@/shared/lib/useElapsedFlag', () => ({
  useElapsedFlag: (active: boolean, ms: number) => {
    mockElapsedMs.push(ms);
    return active && mockTimedOut;
  },
}));

const TRIP_ID = 'trip-1';
const TODAY = '2026-10-19';
const TOMORROW = '2026-10-20';

const detail = (over: Partial<TriggerDetail> = {}): TriggerDetail =>
  ({
    triggerId: 'trg-1',
    kind: 'WEATHER',
    affectedDate: TOMORROW,
    slotKey: null,
    reason: '10월 20일(화) 오후에 비 소식이 있어요.',
    scope: 'FULL_DAY',
    detectedAt: '2026-10-19T11:15:00Z',
    severity: 'RISK',
    variant: 'RAIN',
    attribution: '기상청 단기예보',
    state: 'ACTIVE',
    currentTriggerId: 'trg-1',
    ...over,
  }) as TriggerDetail;

const prepared = (over: Partial<ReplanSession> = {}): ReplanSession =>
  ({
    sessionId: 'sys-1',
    tripId: TRIP_ID,
    itineraryId: 'it1',
    triggerId: 'trg-1',
    scope: 'FULL_DAY',
    targetDate: TOMORROW,
    fromInstant: '2026-10-19T11:15:00Z',
    originKind: 'STAY_ANCHOR',
    originEstimated: true,
    reasons: ['WEATHER'],
    directives: ['AVOID_OUTDOOR'],
    freeText: null,
    excludedPoiIds: ['poi-out'],
    status: 'DRAFT',
    createdAt: '2026-10-19T11:16:00Z',
    initiatedBy: 'SYSTEM',
    stale: false,
    ...over,
  }) as ReplanSession;

/** i04 가 쓰는 목록(감지 칩) — 상세와 같은 트리거. */
const activeList = (over: Partial<TriggerDetail> = {}): TriggerList => {
  const {
    state: _state,
    currentTriggerId: _current,
    ...trigger
  } = detail(over);
  return { triggers: [trigger] };
};

const ITINERARY = liveItinerary(
  [
    { date: TODAY, slots: [liveSlot('p1', '해운대 해변', '17:00:00')] },
    { date: TOMORROW, slots: [liveSlot('p9', '태종대', '10:00:00')] },
  ],
  TRIP_ID
);

let preparedQueries: string[] = [];
let postedBodies: unknown[] = [];

/** 기본 핸들러 — prepared 를 `:sessionId` 보다 **먼저** 건다(§11 함정). 케이스는 앞에 덧건다. */
function baseHandlers({
  triggerDetail = () => HttpResponse.json(detail()),
  preparedSession = () => new HttpResponse(null, { status: 404 }),
  list = activeList(),
}: {
  triggerDetail?: () => Response | Promise<Response>;
  preparedSession?: () => Response | Promise<Response>;
  list?: TriggerList;
} = {}) {
  return [
    http.get(`${BASE}/trips/:tripId/triggers/:triggerId`, () =>
      triggerDetail()
    ),
    http.get(
      `${BASE}/trips/:tripId/replan-sessions/prepared`,
      ({ request }) => {
        preparedQueries.push(new URL(request.url).search);
        return preparedSession();
      }
    ),
    // 같은 경로를 `:sessionId` 로 잡는 핸들러 — prepared 보다 뒤라 prepared 요청을 가로채지 못해야 한다.
    http.get(`${BASE}/trips/:tripId/replan-sessions/:sessionId`, () =>
      HttpResponse.json(prepared({ sessionId: 'wrong-route' }))
    ),
    http.get(`${BASE}/trips/:tripId/triggers`, () => HttpResponse.json(list)),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(ITINERARY)
    ),
    http.post(`${BASE}/trips/:tripId/replan-sessions`, async ({ request }) => {
      postedBodies.push(await request.json());
      return HttpResponse.json(
        prepared({
          sessionId: 'user-1',
          status: 'SOLVING',
          initiatedBy: 'USER',
        }),
        {
          status: 201,
        }
      );
    }),
  ];
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <WithToastHost>{children}</WithToastHost>
    </QueryClientProvider>
  );
}

function renderGate(props: Partial<Parameters<typeof PlanbEntryGate>[0]> = {}) {
  return render(
    <PlanbEntryGate
      tripId={TRIP_ID}
      triggerId="trg-1"
      today={TODAY}
      {...props}
    />,
    { wrapper }
  );
}

beforeAll(() => {
  setAccessToken('a');
  server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  mockReplace.mockClear();
  mockDismissTo.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
  mockTimedOut = false;
  mockElapsedMs.length = 0;
  preparedQueries = [];
  postedBodies = [];
  useReplanFormStore.getState().reset();
});
afterEach(() => {
  server.resetHandlers();
  resetToast();
});
afterAll(() => {
  server.close();
  clearAccessToken();
});

const DRAFT_HREF = (sessionId: string) => ({
  pathname: '/trips/[tripId]/planb/draft',
  params: { tripId: TRIP_ID, sessionId },
});
const HUB_HREF = {
  pathname: '/trips/[tripId]/live',
  params: { tripId: TRIP_ID },
};

describe('🔴 PlanbEntryGate · 준비된 대안으로 간다 (행 6·7·8)', () => {
  it('G1 DRAFT → 그 트리거 날짜로 묻고 i06 으로 replace(prepared 가 :sessionId 보다 먼저 맞는다)', async () => {
    server.use(
      ...baseHandlers({
        preparedSession: () => HttpResponse.json(prepared()),
      })
    );

    renderGate();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(DRAFT_HREF('sys-1'));
    expect(preparedQueries).toEqual([`?date=${TOMORROW}`]);
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(screen.queryByTestId('planb-request-sheet')).toBeNull();
  });

  it('G2 SOLVING → i05 로 replace', async () => {
    server.use(
      ...baseHandlers({
        preparedSession: () =>
          HttpResponse.json(prepared({ status: 'SOLVING' })),
      })
    );

    renderGate();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/planb/solving',
      params: { tripId: TRIP_ID, sessionId: 'sys-1' },
    });
  });

  it('G3 NO_SOLUTION → i06(대안 없음 얼굴은 i06 이 세션으로 고른다)', async () => {
    server.use(
      ...baseHandlers({
        preparedSession: () =>
          HttpResponse.json(prepared({ status: 'NO_SOLUTION' })),
      })
    );

    renderGate();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(DRAFT_HREF('sys-1'));
  });
});

describe('🔴 PlanbEntryGate · 허브로 돌아간다 (행 3·5)', () => {
  it('G4 APPLIED → "이미 반영한 대안이에요" 토스트 + 허브 dismissTo', async () => {
    server.use(
      ...baseHandlers({
        preparedSession: () =>
          HttpResponse.json(prepared({ status: 'APPLIED', stale: true })),
      })
    );

    renderGate();

    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledTimes(1));
    expect(mockDismissTo).toHaveBeenCalledWith(HUB_HREF);
    expect(screen.getByText('이미 반영한 대안이에요')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('G5 대안 없음 ∧ 해제된 트리거 ∧ current 없음 → "지금은 해당하지 않는 알림이에요" + 허브', async () => {
    server.use(
      ...baseHandlers({
        triggerDetail: () =>
          HttpResponse.json(
            detail({ state: 'EXPIRED', currentTriggerId: null })
          ),
      })
    );

    renderGate();

    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledTimes(1));
    expect(mockDismissTo).toHaveBeenCalledWith(HUB_HREF);
    expect(screen.getByText('지금은 해당하지 않는 알림이에요')).toBeTruthy();
    // 해제를 '괜찮아졌어요'로 단정하지 않는다(BR-SA-23 근거).
    expect(screen.queryByText(/괜찮아졌어요/)).toBeNull();
  });
});

describe('🔴 PlanbEntryGate · i04 를 그린다 (행 4·2)', () => {
  it('G6 낡은 준비 세션 + ACTIVE → i04 가 그 세션 입력으로 켜지고, 제출하면 트리거 날짜·제외 POI 가 나간다', async () => {
    server.use(
      ...baseHandlers({
        preparedSession: () => HttpResponse.json(prepared({ stale: true })),
      })
    );

    renderGate();

    await waitFor(() =>
      expect(screen.getByTestId('planb-request-sheet')).toBeTruthy()
    );
    await waitFor(() =>
      expect(screen.getByTestId('planb-request-trigger-chip')).toBeSelected()
    );
    expect(
      screen.getByTestId('planb-request-directive-AVOID_OUTDOOR')
    ).toBeSelected();
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('planb-request-submit'));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).toEqual({
      scope: 'FULL_DAY',
      originKind: null,
      reasons: ['WEATHER'],
      directives: ['AVOID_OUTDOOR'],
      freeText: null,
      excludedPoiIds: ['poi-out'],
      triggerId: 'trg-1',
      targetDate: TOMORROW,
    });
  });

  it('G6b 오늘 트리거 + 대안 없음 → 날짜 없이 트리거 범위(PARTIAL_SLOTS)로, kind 사유를 켜고 연다', async () => {
    const todayTrigger = {
      affectedDate: TODAY,
      scope: 'PARTIAL_SLOTS',
    } as const;
    server.use(
      ...baseHandlers({
        triggerDetail: () => HttpResponse.json(detail(todayTrigger)),
        list: activeList(todayTrigger),
      })
    );

    renderGate();

    await waitFor(() =>
      expect(screen.getByTestId('planb-request-trigger-chip')).toBeSelected()
    );
    expect(preparedQueries).toEqual([`?date=${TODAY}`]);
    fireEvent.press(screen.getByTestId('planb-request-submit'));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).toEqual({
      scope: 'PARTIAL_SLOTS',
      originKind: null,
      reasons: ['WEATHER'],
      directives: [],
      freeText: null,
      excludedPoiIds: [],
      triggerId: 'trg-1',
    });
  });

  it('G7 주의(흐림) + 대안 없음 → i04 는 시드 없이 열린다(감지 칩 꺼짐)', async () => {
    const caution = { severity: 'CAUTION', variant: 'CLOUD' } as const;
    server.use(
      ...baseHandlers({
        triggerDetail: () => HttpResponse.json(detail(caution)),
        list: activeList(caution),
      })
    );

    renderGate();

    await waitFor(() =>
      expect(screen.getByTestId('planb-request-trigger-chip')).toBeTruthy()
    );
    expect(screen.getByTestId('planb-request-trigger-chip')).not.toBeSelected();
    expect(screen.getByTestId('planb-request-trigger-chip')).toHaveTextContent(
      '흐림'
    );
  });

  it('G8 상세 조회가 실패(500)하면 i04 를 URL 그대로 연다 — 막다른 길이 없다', async () => {
    server.use(
      ...baseHandlers({
        triggerDetail: () => new HttpResponse(null, { status: 500 }),
        list: activeList({ affectedDate: TODAY }),
      })
    );

    renderGate({ scope: 'PARTIAL_SLOTS' });

    await waitFor(() =>
      expect(screen.getByTestId('planb-request-sheet')).toBeTruthy()
    );
    // 기존 동작 — 활성 목록의 감지 칩이 kind 사유로 켜진다.
    await waitFor(() =>
      expect(screen.getByTestId('planb-request-trigger-chip')).toBeSelected()
    );
    expect(preparedQueries).toEqual([]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('G8b 준비된 대안 조회가 실패(500)해도 i04 를 URL 그대로 연다', async () => {
    server.use(
      ...baseHandlers({
        preparedSession: () => new HttpResponse(null, { status: 500 }),
      })
    );

    renderGate();

    await waitFor(() =>
      expect(screen.getByTestId('planb-request-sheet')).toBeTruthy()
    );
    expect(preparedQueries).toEqual([`?date=${TOMORROW}`]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();

    // URL 그대로(기존 동작)라 트리거 날짜·시드를 싣지 않는다 — '없음'(행 4)으로 읽었다면 내일 날짜가 실렸다.
    fireEvent.press(screen.getByTestId('planb-request-submit'));
    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).not.toHaveProperty('targetDate');
    expect(postedBodies[0]).toMatchObject({ excludedPoiIds: [] });
  });

  it('G9 3초가 지나도 답이 없으면 i04 로 — 상한은 3000ms 다', async () => {
    const hang = createGate();
    server.use(
      ...baseHandlers({
        triggerDetail: async () => {
          await hang.opened;
          return HttpResponse.json(detail());
        },
      })
    );

    renderGate();
    expect(screen.getByLabelText('확인하고 있어요')).toBeTruthy();
    expect(mockElapsedMs).toContain(3000);

    mockTimedOut = true;
    await act(async () => {
      screen.rerender(
        <PlanbEntryGate tripId={TRIP_ID} triggerId="trg-1" today={TODAY} />
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('planb-request-sheet')).toBeTruthy()
    );
    hang.release();
  });
});

describe('🔴 PlanbEntryGate · 404 얼굴 · 대기 얼굴 · 한 번만 (행 1)', () => {
  it('G10 상세 404 → 404 얼굴, 이동·i04 없음', async () => {
    server.use(
      ...baseHandlers({
        triggerDetail: () => new HttpResponse(null, { status: 404 }),
      })
    );

    renderGate();

    await waitFor(() =>
      expect(screen.getByTestId('planb-entry-gate-notfound')).toBeTruthy()
    );
    expect(screen.queryByTestId('planb-request-sheet')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('G11 기다리는 동안은 대기 얼굴이고 아무 데도 가지 않는다', async () => {
    const hang = createGate();
    server.use(
      ...baseHandlers({
        preparedSession: async () => {
          await hang.opened;
          return HttpResponse.json(prepared());
        },
      })
    );

    renderGate();

    await waitFor(() => expect(preparedQueries).toHaveLength(1));
    expect(screen.getByTestId('planb-entry-gate-waiting')).toBeTruthy();
    expect(screen.getByLabelText('확인하고 있어요')).toBeTruthy();
    expect(screen.queryByTestId('planb-request-sheet')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();

    hang.release();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  });

  it('G12 결정은 한 번만 — i04 로 굳은 뒤 재조회가 DRAFT 를 줘도 화면이 바뀌지 않는다', async () => {
    server.use(...baseHandlers());

    renderGate();
    await waitFor(() =>
      expect(screen.getByTestId('planb-request-sheet')).toBeTruthy()
    );

    server.use(
      http.get(`${BASE}/trips/:tripId/replan-sessions/prepared`, () =>
        HttpResponse.json(prepared())
      )
    );
    await act(async () => {
      await client.refetchQueries();
    });

    expect(screen.getByTestId('planb-request-sheet')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
