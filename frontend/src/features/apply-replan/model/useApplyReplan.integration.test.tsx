import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient } from '@tanstack/react-query';

import { server } from '@/mocks/server';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdTriggersQueryKey,
  useGetTripsTripIdTriggers,
} from '@/shared/api/index.hooks';
import type { Trigger, TriggerList } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { BASE } from '@/test-support/apiBase';
import { createGate } from '@/test-support/mswHookHarness';
import {
  createWrapper,
  settle,
  newTestQueryClient,
} from '@/test-support/queryRender';

import { useApplyReplan } from './useApplyReplan';

/**
 * 재계획 확정 seam(`useApplyReplan`)의 캐시 반영 — 확정이 성공하면 그 여행의 일정을 낡게 하고(INV-U4-05), 트리거 목록은
 * 다시 받되 **이 적용이 근거로 쓴 트리거는 뺀다**(상황 감지 FE-A · BR-SA-14: 적용이 트리거를 소비한다).
 *
 * 왜 빼야 하나: 서버는 적용 요청 안에서 트리거를 닫지 않는다. 적용은 `ItineraryRecalculated` 를 아웃박스에 쌓기만 하고,
 * 소비(CONSUMED)는 릴레이(2초 주기)가 배달한 뒤 `ReplanAppliedSubscriber` 가 한다. 그래서 적용 직후 다시 받은 목록엔 그
 * 트리거가 아직 있다 — 가짜 서버가 그 상태(소비 전)를 그대로 돌려준다. 무효화만 하면 그 목록이 새것으로 남아 알약이 그대로다.
 *
 * 왜 따로 두나: 페이지 테스트(`PlanbDraftPage`·`PlanbDiffPage` 통합)는 이 seam 을 통째로 목으로 바꿔 끼워, 확정 뒤 캐시에
 * 무엇이 남는지는 거기서 안 보인다. 여기서 가짜 서버(MSW)로 실제 apply 왕복을 태우고, 허브가 그리는 재료 — 생성 훅
 * `useGetTripsTripIdTriggers`(허브·i04 의 `useActiveTriggers` 가 감싼 그것)의 data — 를 읽는다. 알약 렌더 자체는 허브 몫이다.
 *
 * 클라이언트는 앱 전역 쿼리 기본값(`AppProviders` — staleTime 30초)과 같게 둔다: 허브가 새로 마운트할 때 다시 받는지가 이 값에 달렸다.
 *
 * 3동작: 준비 = 가짜 서버 상태 + 화면(관찰자) → 실행 = 확정(mutate) → 단언 = 화면이 읽는 목록·나간 요청 수.
 */

// authedClient(인증 계층)가 @/shared/storage 를 정적으로 문다(useReplanDiff.integration 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const TRIP = 'trip-1';
const APPLY_URL = `${BASE}/trips/${TRIP}/replan-sessions/s9/apply`;
const TRIGGERS_URL = `${BASE}/trips/${TRIP}/triggers`;
const ITINERARY_TRIP_1 = getGetTripsTripIdItineraryQueryKey(TRIP);
const TRIGGERS_TRIP_2 = getGetTripsTripIdTriggersQueryKey('trip-2');

function trigger(triggerId: string, affectedDate: string): Trigger {
  return {
    triggerId,
    kind: 'WEATHER',
    affectedDate,
    slotKey: null,
    reason: '비 예보 70%',
    scope: 'FULL_DAY',
    detectedAt: '2026-10-19T06:15:00Z',
  };
}

/** 이 적용이 근거로 쓴 트리거(10-20 하루) — 서버가 릴레이 뒤에 소비한다. */
const USED = trigger('trg-used', '2026-10-20');
/** 같은 여행의 다른 트리거 — 이 적용과 무관해 서버가 닫지 않는다. */
const OTHER = trigger('trg-other', '2026-10-21');
/** 적용 뒤 서버 목록에 새로 보이는 트리거 — 실제로 다시 받았다는 표지. */
const FRESH = trigger('trg-fresh', '2026-10-21');

/** 적용 응답(`ReplanSession`) — 이 seam 이 읽는 칸은 근거 트리거와 다시 짠 날뿐이라 그 둘만 정한다. */
function appliedSession(targetDate: string) {
  return {
    sessionId: 's9',
    tripId: TRIP,
    status: 'APPLIED',
    triggerId: USED.triggerId,
    targetDate,
  };
}

/** 가짜 서버가 지금 돌려주는 트리거 목록 — 테스트가 "적용 뒤, 소비 전" 상태로 바꾼다. */
let serverTriggers: Trigger[];
let triggerGets: number;
let client: QueryClient;

function appLikeClient(): QueryClient {
  return newTestQueryClient({ staleTime: 30_000 });
}

function ids(list: TriggerList | undefined): string[] | undefined {
  return list?.triggers.map((item) => item.triggerId);
}

function isInvalidated(key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated ?? false;
}

/** 허브(또는 i04)가 트리거 목록을 보고 있는 화면. */
function mountTriggerScreen() {
  return renderHook(() => useGetTripsTripIdTriggers(TRIP), {
    wrapper: createWrapper(client),
  });
}

/** 허브가 스택에 남은 채 i06 에서 확정하는 경로 — 알약 → i04 → i06 → `dismissTo` 로 같은 허브에 돌아온다. */
function mountHubWithApply() {
  return renderHook(
    () => ({
      hub: useGetTripsTripIdTriggers(TRIP),
      apply: useApplyReplan(),
    }),
    { wrapper: createWrapper(client) }
  );
}

/** 적용 뒤 트리거 목록 다시 받기(2번째 GET)가 끝나고 알림까지 흘러간 뒤 — 그 다음에 화면이 읽는 값을 본다. */
async function refetchSettled(isFetching: () => boolean): Promise<void> {
  await waitFor(() => expect(triggerGets).toBe(2));
  await waitFor(() => expect(isFetching()).toBe(false));
  await settle();
}

function mountApply() {
  return renderHook(() => useApplyReplan(), {
    wrapper: createWrapper(client),
  });
}

function serveApply(targetDate: string): void {
  server.use(
    http.post(APPLY_URL, () => HttpResponse.json(appliedSession(targetDate)))
  );
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  setAccessToken('a');
  client = appLikeClient();
  serverTriggers = [USED, OTHER];
  triggerGets = 0;
  server.use(
    http.get(TRIGGERS_URL, () => {
      triggerGets += 1;
      return HttpResponse.json({ triggers: serverTriggers });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  client.clear();
});

afterAll(() => server.close());

describe('확정(apply) 뒤 일정 캐시', () => {
  it('A1 확정이 성공하면 그 여행의 일정 캐시를 낡게 하고, 다른 여행 트리거 캐시는 건드리지 않는다', async () => {
    // 준비
    client.setQueryData(ITINERARY_TRIP_1, { days: [] });
    client.setQueryData(TRIGGERS_TRIP_2, { triggers: [OTHER] });
    serveApply(USED.affectedDate);
    const { result } = mountApply();

    // 실행
    act(() => {
      result.current.mutate({ tripId: TRIP, sessionId: 's9' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 단언
    expect(isInvalidated(ITINERARY_TRIP_1)).toBe(true);
    expect(isInvalidated(TRIGGERS_TRIP_2)).toBe(false);
    expect(ids(client.getQueryData(TRIGGERS_TRIP_2))).toEqual(['trg-other']);
  });
});

describe('확정(apply) 뒤 트리거 목록 — 서버의 소비는 적용 응답보다 늦다(릴레이)', () => {
  it('B1 허브가 보고 있을 때: 쓴 트리거는 다시 받는 동안에도, 받은 목록에 아직 있어도 허브 목록에서 빠진다 — 나머지는 다시 받은 그대로다', async () => {
    // 준비 — 허브가 적용 전 목록을 그리고 있다. 적용 뒤 다시 받기는 테스트가 열 때까지 응답하지 않는다.
    const refetch = createGate();
    server.use(
      http.get(TRIGGERS_URL, async () => {
        triggerGets += 1;
        if (triggerGets > 1) await refetch.opened;
        return HttpResponse.json({ triggers: serverTriggers });
      })
    );
    serveApply(USED.affectedDate);
    const view = mountHubWithApply();
    await waitFor(() =>
      expect(ids(view.result.current.hub.data)).toEqual([
        'trg-used',
        'trg-other',
      ])
    );
    // 적용 뒤 서버: 쓴 트리거는 아직 ACTIVE(소비 전), 새 트리거가 하나 보인다.
    serverTriggers = [USED, OTHER, FRESH];

    // 실행 1 — 확정
    act(() => {
      view.result.current.apply.mutate({ tripId: TRIP, sessionId: 's9' });
    });
    await waitFor(() => expect(view.result.current.apply.isSuccess).toBe(true));
    await waitFor(() => expect(triggerGets).toBe(2));
    await settle();

    // 단언 1 — 다시 받는 중에도 쓴 트리거는 이미 안 보인다(허브가 dismissTo 로 드러나는 사이 깜빡이지 않게).
    expect(ids(view.result.current.hub.data)).toEqual(['trg-other']);

    // 실행 2 — 서버 응답(소비 전 목록)이 온다.
    refetch.release();

    // 단언 2 — 다시 받았고(새 트리거가 보인다), 쓴 트리거는 여전히 안 보인다.
    await refetchSettled(() => view.result.current.hub.isFetching);
    expect(ids(view.result.current.hub.data)).toEqual([
      'trg-other',
      'trg-fresh',
    ]);
    expect(triggerGets).toBe(2);
  });

  it('B2 트리거 진입(푸시·알림함 → i04 → i06)이라 적용 순간 목록을 보는 화면이 없어도, 그 뒤 열린 허브에 쓴 트리거가 없다', async () => {
    // 준비 — i04 가 목록을 받아 두고 내려갔다(solving 으로 replace). 허브는 스택에 없다.
    const i04 = mountTriggerScreen();
    await waitFor(() =>
      expect(ids(i04.result.current.data)).toEqual(['trg-used', 'trg-other'])
    );
    i04.unmount();
    serverTriggers = [USED, OTHER, FRESH];
    serveApply(USED.affectedDate);
    const draft = mountApply();

    // 실행 — i06 [적용] → 허브가 새로 열린다(dismissTo 가 스택에서 못 찾아 바꿔 넣는다).
    act(() => {
      draft.result.current.mutate({ tripId: TRIP, sessionId: 's9' });
    });
    await waitFor(() => expect(draft.result.current.isSuccess).toBe(true));
    const hub = mountTriggerScreen();

    // 단언 — 허브가 열리며 소비 전 목록을 다시 받아 되살리지 않는다.
    await refetchSettled(() => hub.result.current.isFetching);
    expect(ids(hub.result.current.data)).toEqual(['trg-other', 'trg-fresh']);
    expect(triggerGets).toBe(2);
  });

  it('B3 다른 날을 다시 짠 적용은 그 트리거를 빼지 않는다 — 서버도 날짜가 다르면 소비하지 않는다(BR-SA-14)', async () => {
    // 준비 — 트리거는 10-20, 세션은 10-19 를 다시 짰다.
    serveApply('2026-10-19');
    const view = mountHubWithApply();
    await waitFor(() =>
      expect(ids(view.result.current.hub.data)).toEqual([
        'trg-used',
        'trg-other',
      ])
    );
    serverTriggers = [USED, OTHER, FRESH];

    // 실행
    act(() => {
      view.result.current.apply.mutate({ tripId: TRIP, sessionId: 's9' });
    });
    await waitFor(() => expect(view.result.current.apply.isSuccess).toBe(true));

    // 단언 — 다시 받은 그대로
    await refetchSettled(() => view.result.current.hub.isFetching);
    expect(ids(view.result.current.hub.data)).toEqual([
      'trg-used',
      'trg-other',
      'trg-fresh',
    ]);
  });

  it('B4 확정이 실패하면(409) 트리거 목록을 다시 받지도 빼지도 않는다 — 소비는 성공한 적용만', async () => {
    // 준비
    server.use(
      http.post(APPLY_URL, () =>
        HttpResponse.json({ code: 'STALE' }, { status: 409 })
      )
    );
    const view = mountHubWithApply();
    await waitFor(() =>
      expect(ids(view.result.current.hub.data)).toEqual([
        'trg-used',
        'trg-other',
      ])
    );

    // 실행
    act(() => {
      view.result.current.apply.mutate({ tripId: TRIP, sessionId: 's9' });
    });
    await waitFor(() => expect(view.result.current.apply.isError).toBe(true));
    await settle();

    // 단언
    expect(ids(view.result.current.hub.data)).toEqual([
      'trg-used',
      'trg-other',
    ]);
    expect(triggerGets).toBe(1);
  });
});
