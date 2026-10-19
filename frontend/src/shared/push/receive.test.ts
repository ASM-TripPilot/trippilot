import * as Notifications from 'expo-notifications';

import {
  fakePushNotification,
  fakePushResponse,
  lastPushReceiveListener,
  lastPushTapListener,
} from '@/test-support/pushOsFake';

import {
  installForegroundPresentation,
  onPushReceived,
  onPushTapped,
  takeLaunchPushTap,
} from './receive';

/**
 * 상황 감지 FE-A(frontend-components §2.1) · shared/push 수신 입구.
 *
 * 무엇을 보장하나: expo-notifications 의 포그라운드 수신·탭·콜드 스타트 탭을 앱이 읽는 모양 `{id, data}` 하나로 접고,
 * 앱이 켜져 있어도 푸시가 배너·알림 목록에 보이게 한다. 목적지 판정·캐시 무효화는 여기서 하지 않는다(`usePushRouting`).
 *
 * (개념) 콜드 스타트 탭 = 앱이 꺼져 있을 때 알림을 눌러 앱이 켜진 경우. 그 탭은 리스너가 달리기 전에 일어나서
 * OS 가 "마지막 응답"으로 들고 있다가 앱이 꺼내 간다. 꺼낸 뒤 지워야 같은 탭을 다음에 또 처리하지 않는다.
 *
 * 전역 목(`__mocks__/expo-notifications.ts`)은 기본이 "아무 일 없음"이라, 탭·수신은 리스너를 꺼내 직접 부른다.
 * 실제 OS 수신·배너 표시는 jest 가 못 본다 — 6-b 실기(T-RD-1·2).
 */

const setHandler = Notifications.setNotificationHandler as jest.Mock;
const getLast = Notifications.getLastNotificationResponseAsync as jest.Mock;
const clearLast = Notifications.clearLastNotificationResponseAsync as jest.Mock;
const addReceived = Notifications.addNotificationReceivedListener as jest.Mock;
const addTapped =
  Notifications.addNotificationResponseReceivedListener as jest.Mock;

/** 서버가 싣는 탭 data — `{actionType, ...actionPayload}` 를 펼친 모양. */
const PLAN_B_DATA = {
  actionType: 'PLANB_REPLAN',
  tripId: 'trip-1',
  triggerId: 'trigger-1',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('포그라운드 표시 정책 — installForegroundPresentation', () => {
  it('R1 앱이 켜져 있어도 배너·알림 목록에 보이게 하는 처리기를 한 번 설치한다', async () => {
    // 실행
    installForegroundPresentation();

    // 단언 — 처리기 1개, 어떤 푸시든 배너·목록 표시.
    // shouldPlaySound 가 true 인 이유: 안드로이드는 false 면 알림을 무음(setSilent)으로 만들어 위에서 내려오는 배너가
    // 뜨지 않는다(라이브러리 문서). true 는 "알림·채널이 정한 소리를 막지 않는다"는 뜻 — 앱이 꺼져 있을 때와 같다.
    expect(setHandler).toHaveBeenCalledTimes(1);
    const handler = setHandler.mock.calls[0][0];
    await expect(
      handler.handleNotification(fakePushNotification('n1', PLAN_B_DATA))
    ).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });
});

describe('수신·탭 구독 — onPushReceived · onPushTapped', () => {
  it('R2 앱이 켜진 채 온 푸시를 {id, data} 로 넘기고, 돌려준 해제 함수가 구독을 끊는다', () => {
    // 준비
    const received = jest.fn();
    const off = onPushReceived(received);
    const subscription = addReceived.mock.results[0].value;

    // 실행 — OS 가 푸시를 전달했다.
    lastPushReceiveListener(Notifications)(
      fakePushNotification('n1', PLAN_B_DATA)
    );

    // 단언
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith({ id: 'n1', data: PLAN_B_DATA });
    expect(subscription.remove).not.toHaveBeenCalled();
    off();
    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });

  it('R3 사용자가 누른 푸시를 {id, data} 로 넘기고, 돌려준 해제 함수가 구독을 끊는다', () => {
    // 준비
    const tapped = jest.fn();
    const off = onPushTapped(tapped);
    const subscription = addTapped.mock.results[0].value;

    // 실행 — 사용자가 알림을 눌렀다.
    lastPushTapListener(Notifications)(fakePushResponse('n2', PLAN_B_DATA));

    // 단언
    expect(tapped).toHaveBeenCalledTimes(1);
    expect(tapped).toHaveBeenCalledWith({ id: 'n2', data: PLAN_B_DATA });
    off();
    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });

  it('R4 data 가 비어 온 푸시(null)는 빈 data 로 넘긴다 — 받는 쪽이 필드를 읽다 죽지 않게', () => {
    const tapped = jest.fn();
    onPushTapped(tapped);

    lastPushTapListener(Notifications)(fakePushResponse('n3', null));

    expect(tapped).toHaveBeenCalledWith({ id: 'n3', data: {} });
  });
});

describe('콜드 스타트 탭 — takeLaunchPushTap', () => {
  it('R5 앱을 켠 탭이 있으면 꺼내 {id, data} 로 돌려주고, 꺼낸 뒤에 지운다', async () => {
    // 준비 — 알림을 눌러 앱이 켜졌다.
    getLast.mockResolvedValueOnce(fakePushResponse('n-cold', PLAN_B_DATA));

    // 실행
    const tap = await takeLaunchPushTap();

    // 단언 — 꺼낸 값 · 지우기 1회 · 순서(꺼내기 → 지우기)
    expect(tap).toEqual({ id: 'n-cold', data: PLAN_B_DATA });
    expect(clearLast).toHaveBeenCalledTimes(1);
    expect(getLast.mock.invocationCallOrder[0]).toBeLessThan(
      clearLast.mock.invocationCallOrder[0]
    );
  });

  it('R6 탭으로 켜지지 않았으면 null — 지울 것도 없다', async () => {
    await expect(takeLaunchPushTap()).resolves.toBeNull();
    expect(clearLast).not.toHaveBeenCalled();
  });

  it.each([
    [
      '꺼내기가 실패',
      () => getLast.mockRejectedValueOnce(new Error('네이티브 모듈 없음')),
    ],
    [
      '지우기가 실패',
      () => {
        getLast.mockResolvedValueOnce(fakePushResponse('n-cold', PLAN_B_DATA));
        clearLast.mockRejectedValueOnce(new Error('네이티브 모듈 없음'));
      },
    ],
  ])('R7 %s해도 던지지 않고 null', async (_label, arrange) => {
    arrange();

    await expect(takeLaunchPushTap()).resolves.toBeNull();
  });
});
