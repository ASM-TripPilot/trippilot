import { act, renderHook } from '@testing-library/react-native';
import type { QueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import type { BootstrapDestination } from '@/features/auth/index.view';
import {
  getGetMeNotificationsQueryKey,
  getGetTripsTripIdTriggersQueryKey,
} from '@/shared/api/index.hooks';
import {
  fakePushNotification,
  fakePushResponse,
  lastPushReceiveListener,
  lastPushTapListener,
  primeOsLastResponse,
} from '@/test-support/pushOsFake';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';

import { usePushRouting } from './usePushRouting';

/**
 * 상황 감지 FE-A(frontend-components §2.2 · 설계서 T-D7-U) — 푸시를 누르면 알림함 행과 **같은 곳**으로 간다.
 *
 * 무엇을 보장하나:
 *  - 그려진(drawn) HOME 에서 누른 탭은 `notificationAction` 의 목적지로 1번 `router.push` 하고, 알림함·그 여행 트리거 캐시를 낡게 한다.
 *  - 앱이 켜진 채 받은 푸시는 캐시만 낡게 한다(이동 없음).
 *  - 로그인 전·부팅 중·콜드 스타트 탭은 보류했다가 HOME 이 그려지면 1번 간다.
 *  - 같은 알림 식별자는 1번만. 목적지가 없는 탭(모르는 actionType·필수 필드 없음·data 없음)은 이동 0.
 *  - 언마운트하면 구독을 끊고, 늦게 꺼내진 콜드 스타트 탭으로도 가지 않는다.
 *
 * 어떻게: 실물 `shared/push` 입구 위에 전역 목(`__mocks__/expo-notifications.ts`)을 두고, 앱이 단 리스너를 꺼내
 * OS 대신 부른다(`pushOsFake`). 라우터는 `push` 기록기만 둔 목이다 — 진짜 라우터에서 그려진 뒤 이동이 먹는지는
 * `SplashGate.integration.test.tsx` 가 본다. 캐시 무효화는 진짜 QueryClient 의 `isInvalidated` 로 읽는다(관찰자가
 * 없어 다시 요청은 나가지 않는다).
 *
 * 3동작 뼈대: 준비 = 게이트 상태로 훅을 띄우고 캐시를 심는다 → 실행 = 탭·수신·게이트 전환 → 단언 = 이동 기록·캐시 상태.
 */

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    router: ['push'],
  })
);

const mockPush = router.push as jest.Mock;
const getLast = Notifications.getLastNotificationResponseAsync as jest.Mock;
const addReceived = Notifications.addNotificationReceivedListener as jest.Mock;
const addTapped =
  Notifications.addNotificationResponseReceivedListener as jest.Mock;

type GateProps = {
  drawn: boolean;
  destination: BootstrapDestination | null;
};

const HOME: GateProps = { drawn: true, destination: 'HOME' };

/** 서버가 싣는 탭 data — `{actionType, ...actionPayload}` 를 펼친 모양. */
const PLAN_B = {
  actionType: 'PLANB_REPLAN',
  tripId: 'trip-1',
  triggerId: 'trigger-1',
};
/** 알림함 행이 같은 data 로 가는 곳(`notificationAction`). */
const PLAN_B_ROUTE = '/trips/trip-1/planb?triggerId=trigger-1';

const NOTIFICATIONS_KEY = getGetMeNotificationsQueryKey();
const TRIGGERS_TRIP_1 = getGetTripsTripIdTriggersQueryKey('trip-1');
const TRIGGERS_TRIP_2 = getGetTripsTripIdTriggersQueryKey('trip-2');

let client: QueryClient;
/** 켜진 앱에서 누른 탭 — OS 가 리스너에 보내면서 "마지막 응답" 칸에도 넣는다(`primeOsLastResponse`). */
let osTap: ReturnType<typeof primeOsLastResponse>;

function mount(initial: GateProps) {
  return renderHook(
    (props: GateProps) => usePushRouting(props.drawn, props.destination),
    { initialProps: initial, wrapper: createWrapper(client) }
  );
}

function tap(id: string, data: Record<string, unknown> | null): void {
  act(() => {
    lastPushTapListener(Notifications)(fakePushResponse(id, data));
  });
}

function receive(id: string, data: Record<string, unknown>): void {
  act(() => {
    lastPushReceiveListener(Notifications)(fakePushNotification(id, data));
  });
}

/** 콜드 스타트 탭 조회(비동기)가 끝나기를 기다린다. */
async function settleLaunchTap(): Promise<void> {
  await act(async () => {});
}

function isInvalidated(key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated ?? false;
}

beforeEach(() => {
  jest.clearAllMocks();
  osTap = primeOsLastResponse(Notifications);
  client = newTestQueryClient();
  client.setQueryData(NOTIFICATIONS_KEY, { items: [] });
  client.setQueryData(TRIGGERS_TRIP_1, []);
  client.setQueryData(TRIGGERS_TRIP_2, []);
});

afterEach(() => {
  client.clear();
});

describe('그려진 HOME — 탭은 알림함과 같은 곳으로, 수신·탭은 캐시를 낡게', () => {
  it('P1 재계획 알림을 누르면 그 트리거 진입으로 1번 가고, 알림함·그 여행의 트리거 캐시만 낡게 한다', () => {
    // 준비
    mount(HOME);

    // 실행
    tap('n1', PLAN_B);

    // 단언 — 이동
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(PLAN_B_ROUTE);
    // 단언 — 캐시: 알림함 · 이 여행 트리거는 낡음, 다른 여행 트리거는 그대로
    expect(isInvalidated(NOTIFICATIONS_KEY)).toBe(true);
    expect(isInvalidated(TRIGGERS_TRIP_1)).toBe(true);
    expect(isInvalidated(TRIGGERS_TRIP_2)).toBe(false);
  });

  it('P2 앱이 켜진 채 푸시가 오면 캐시만 낡게 하고 이동하지 않는다 — 그 배너를 나중에 누르면 그때 간다', () => {
    // 준비
    mount(HOME);

    // 실행 1 — 포그라운드 수신
    receive('n1', PLAN_B);

    // 단언 1
    expect(mockPush).not.toHaveBeenCalled();
    expect(isInvalidated(NOTIFICATIONS_KEY)).toBe(true);
    expect(isInvalidated(TRIGGERS_TRIP_1)).toBe(true);

    // 실행 2 — 받은 그 알림을 누른다(수신은 '처리함'으로 세지 않는다)
    tap('n1', PLAN_B);

    // 단언 2
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(PLAN_B_ROUTE);
  });
});

describe('보류 — 로그인 전·부팅 중 탭은 HOME 이 그려진 뒤 1번', () => {
  it.each<[string, GateProps]>([
    ['로그인 화면', { drawn: true, destination: 'LOGIN' }],
    ['온보딩', { drawn: true, destination: 'ONBOARDING' }],
    [
      '스플래시(HOME 판정, 아직 안 그림)',
      { drawn: false, destination: 'HOME' },
    ],
    ['목적지 미결', { drawn: false, destination: null }],
  ])(
    'H1 %s 에서 누른 탭은 그때는 가지 않고, HOME 이 그려지면 1번 간다 — 다시 그리거나 재로그인해도 또 가지 않는다',
    (_label, before) => {
      // 준비
      const view = mount(before);

      // 실행 1 — HOME 이 아닐 때 탭
      tap('n1', PLAN_B);

      // 단언 1
      expect(mockPush).not.toHaveBeenCalled();

      // 실행 2 — HOME 이 그려진다
      view.rerender(HOME);

      // 단언 2
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(PLAN_B_ROUTE);

      // 실행 3 — 같은 HOME 으로 다시 그림 · 로그아웃 → 재로그인
      view.rerender(HOME);
      view.rerender({ drawn: true, destination: 'LOGIN' });
      view.rerender(HOME);

      // 단언 3 — 보류분은 한 번 쓰고 비었다
      expect(mockPush).toHaveBeenCalledTimes(1);
    }
  );

  it('H2 보류 중에 여러 알림을 누르면 마지막 탭 하나로만 1번 간다', () => {
    // 준비
    const view = mount({ drawn: true, destination: 'LOGIN' });

    // 실행
    tap('n1', PLAN_B);
    tap('n2', { actionType: 'TRIP_ITINERARY', tripId: 'trip-2' });
    view.rerender(HOME);

    // 단언
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      '/trips/trip-2/itinerary?from=notification'
    );
  });
});

describe('콜드 스타트 — 앱을 켠 탭', () => {
  it('C1 꺼낸 탭은 스플래시 동안 보류했다가 HOME 이 그려지면 1번 가고, 같은 탭이 리스너로 또 와도 다시 가지 않는다', async () => {
    // 준비 — 알림을 눌러 앱이 켜졌다.
    getLast.mockResolvedValueOnce(fakePushResponse('n-cold', PLAN_B));
    const view = mount({ drawn: false, destination: null });

    // 실행 1 — 꺼내기가 끝난다(아직 스플래시)
    await settleLaunchTap();

    // 단언 1
    expect(mockPush).not.toHaveBeenCalled();

    // 실행 2 — HOME 이 그려진다
    view.rerender(HOME);

    // 단언 2
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(PLAN_B_ROUTE);

    // 실행 3 — 플랫폼에 따라 같은 탭이 리스너로도 온다
    tap('n-cold', PLAN_B);

    // 단언 3
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('같은 알림은 한 번', () => {
  it('D1 같은 식별자의 탭이 두 번 와도 1번만 가고, 다른 알림은 따로 간다', () => {
    // 준비
    mount(HOME);

    // 실행
    tap('n1', PLAN_B);
    tap('n1', PLAN_B);
    tap('n2', { actionType: 'TRIP_ITINERARY', tripId: 'trip-2' });

    // 단언
    expect(mockPush.mock.calls).toEqual([
      [PLAN_B_ROUTE],
      ['/trips/trip-2/itinerary?from=notification'],
    ]);
  });
});

describe('목적지가 없는 탭은 이동하지 않는다(INV-4 — 이동 없음 · 무효화만)', () => {
  it.each<[string, Record<string, unknown> | null]>([
    ['모르는 actionType', { actionType: 'NEW_KIND_LATER', tripId: 'trip-1' }],
    [
      '재계획인데 triggerId 없음',
      { actionType: 'PLANB_REPLAN', tripId: 'trip-1' },
    ],
    ['actionType 없음', { tripId: 'trip-1' }],
  ])(
    'N1 %s → 이동 0, 알림함·그 여행 트리거 캐시는 낡게 한다',
    (_label, data) => {
      mount(HOME);

      tap('n1', data);

      expect(mockPush).not.toHaveBeenCalled();
      expect(isInvalidated(NOTIFICATIONS_KEY)).toBe(true);
      expect(isInvalidated(TRIGGERS_TRIP_1)).toBe(true);
    }
  );

  it('N2 data 없이 온 탭은 죽지 않고 이동 0 — 알림함만 낡게 한다', () => {
    mount(HOME);

    tap('n1', null);

    expect(mockPush).not.toHaveBeenCalled();
    expect(isInvalidated(NOTIFICATIONS_KEY)).toBe(true);
    expect(isInvalidated(TRIGGERS_TRIP_1)).toBe(false);
  });
});

describe('언마운트', () => {
  it('U1 언마운트하면 수신·탭 구독을 둘 다 끊는다', () => {
    // 준비
    const view = mount(HOME);
    const receiveSubscription = addReceived.mock.results[0].value;
    const tapSubscription = addTapped.mock.results[0].value;

    // 실행
    view.unmount();

    // 단언
    expect(receiveSubscription.remove).toHaveBeenCalledTimes(1);
    expect(tapSubscription.remove).toHaveBeenCalledTimes(1);
  });

  it('U2 콜드 스타트 탭을 꺼내는 사이에 언마운트되면, 늦게 꺼내져도 가지 않는다', async () => {
    // 준비 — 꺼내기가 아직 안 끝났다.
    let finishTake!: (value: unknown) => void;
    getLast.mockReturnValueOnce(
      new Promise((resolve) => {
        finishTake = resolve;
      })
    );
    const view = mount(HOME);

    // 실행
    view.unmount();
    finishTake(fakePushResponse('n-cold', PLAN_B));
    await settleLaunchTap();

    // 단언
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('다시 마운트 — JS 런타임·네이티브 모듈은 그대로, React 트리만 새로', () => {
  it('W1 켜진 앱에서 처리한 탭은 루트가 다시 마운트돼도(안드로이드 Activity 재생성) 다시 가지 않는다', async () => {
    // 준비 — 켜진 앱에서 알림을 눌러 그 화면으로 갔다(OS 는 그 탭을 "마지막 응답" 칸에도 넣는다).
    const first = mount(HOME);
    act(() => {
      osTap(fakePushResponse('n1', PLAN_B));
    });
    expect(mockPush).toHaveBeenCalledTimes(1);

    // 실행 — 글꼴 크기·언어 변경 등으로 루트가 언마운트됐다가 다시 마운트되고, 콜드 스타트 탭 조회가 끝난다.
    first.unmount();
    mount(HOME);
    await settleLaunchTap();

    // 단언 — 이미 처리한 탭으로 또 가지 않는다.
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
