import type * as NotificationsModule from 'expo-notifications';

/**
 * TRIP-835 · OS 알림 권한 가짜(테스트 전용). 전역 목(`__mocks__/expo-notifications.ts`)의 함수에
 * **상태가 있는 구현**을 덮어쓴다 — 실제 OS 처럼 "한 번 묻고 나면 답이 굳는다".
 *
 *  - 조회(`getPermissionsAsync`)는 지금 상태를 돌려준다.
 *  - 요청(`requestPermissionsAsync`)은 지금 상태가 `undetermined` 일 때만 `answer` 로 바꾼다(다이얼로그).
 *    이미 `granted`/`denied` 면 그대로 돌려준다(iOS·Android 13+ 모두 다시 묻지 않는다).
 *
 * 왜 상태가 있어야 하나: 구현이 요청 결과를 쓰든, 요청 뒤 다시 조회하든 **둘 다 올바른 구현**이다. 조회를
 * 고정값으로 목하면 "요청 전에 읽어 둔 낡은 `undetermined` 를 서버에 올리는" 버그와 올바른 재조회를
 * 구분할 수 없다.
 *
 * 모듈을 인자로 받는 이유: `jest.resetModules()` 뒤에는 목 모듈도 새 인스턴스라, 테스트가 방금 require
 * 한 그 인스턴스에 구현을 심어야 구현 코드가 같은 것을 본다.
 */
export type OsPermission = 'granted' | 'denied' | 'undetermined';

type Notifications = typeof NotificationsModule;

function permission(status: OsPermission) {
  return {
    status,
    granted: status === 'granted',
    canAskAgain: status === 'undetermined',
    expires: 'never',
  };
}

export function primeOsPermission(
  notifications: Notifications,
  initial: OsPermission,
  answer: OsPermission = 'denied'
): void {
  let current = initial;
  (notifications.getPermissionsAsync as jest.Mock).mockImplementation(
    async () => permission(current)
  );
  (notifications.requestPermissionsAsync as jest.Mock).mockImplementation(
    async () => {
      if (current === 'undetermined') current = answer;
      return permission(current);
    }
  );
}

/** Expo 푸시 토큰 획득이 이 값을 돌려주게 한다. */
export function primeExpoToken(
  notifications: Notifications,
  token: string
): void {
  (notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
    type: 'expo',
    data: token,
  });
}

/**
 * 상황 감지 FE-A · 푸시 한 건(실물 `Notification` 모양). 앱이 읽는 칸 — `request.identifier`·`request.content.data` —
 * 은 실물과 같은 자리에 두고, 나머지 칸은 화면에 보이는 값만 채운다. data 는 서버가 `{actionType, ...actionPayload}` 를
 * 펼쳐 싣는 모양이다(`PushDispatchService.toMessage`).
 */
export function fakePushNotification(
  identifier: string,
  data: Record<string, unknown> | null
): NotificationsModule.Notification {
  return {
    date: 0,
    request: {
      identifier,
      content: { title: '알림', subtitle: null, body: '본문', data },
      trigger: null,
    },
  } as unknown as NotificationsModule.Notification;
}

/** 사용자가 그 푸시를 누른 응답(실물 `NotificationResponse` — 기본 동작 식별자 = 본문 탭). */
export function fakePushResponse(
  identifier: string,
  data: Record<string, unknown> | null
): NotificationsModule.NotificationResponse {
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: fakePushNotification(identifier, data),
  };
}

/** 앱이 가장 최근에 단 탭 리스너 — 테스트가 OS 대신 불러 "알림을 눌렀다"를 흉내 낸다. */
export function lastPushTapListener(
  notifications: Notifications
): (response: NotificationsModule.NotificationResponse) => void {
  const calls = (
    notifications.addNotificationResponseReceivedListener as jest.Mock
  ).mock.calls;
  return calls[calls.length - 1][0];
}

/**
 * 상황 감지 FE-A · OS 의 "마지막 응답" 칸(상태 있는 가짜 — `primeOsPermission` 과 같은 이유). 실물(expo-notifications
 * 0.32.17 — 안드로이드 `NotificationsEmitter.onNotificationResponseReceived` · iOS `EmitterModule.didReceive`)은 앱이 켜져
 * 있을 때 누른 탭까지 **모든 탭**을 이 칸에 넣고, 지울 때까지 네이티브 모듈이 들고 있다 — React 트리만 다시 마운트되면
 * (안드로이드 Activity 재생성) 그대로 남는다. 조회는 칸을 읽고, 지우기는 칸을 비운다.
 *
 * 돌려준 함수가 "켜진 앱에서 사용자가 그 알림을 눌렀다"를 흉내 낸다 — 칸에 넣고 앱이 마지막으로 단 탭 리스너에 보낸다.
 * 칸을 고정값으로 목하면 "넘긴 탭을 지우지 않아 다시 마운트 때 또 꺼내는" 구현과 올바른 구현을 가를 수 없다.
 * 칸은 부를 때마다 새로 비어 있다 — 테스트 파일의 `beforeEach` 에서 불러 테스트 사이로 새지 않게 한다.
 */
export function primeOsLastResponse(
  notifications: Notifications
): (response: NotificationsModule.NotificationResponse) => void {
  let last: NotificationsModule.NotificationResponse | null = null;
  (
    notifications.getLastNotificationResponseAsync as jest.Mock
  ).mockImplementation(async () => last);
  (
    notifications.clearLastNotificationResponseAsync as jest.Mock
  ).mockImplementation(async () => {
    last = null;
  });
  return (response) => {
    last = response;
    lastPushTapListener(notifications)(response);
  };
}

/** 앱이 가장 최근에 단 포그라운드 수신 리스너 — 테스트가 OS 대신 불러 "앱이 켜진 채 푸시가 왔다"를 흉내 낸다. */
export function lastPushReceiveListener(
  notifications: Notifications
): (notification: NotificationsModule.Notification) => void {
  const calls = (notifications.addNotificationReceivedListener as jest.Mock)
    .mock.calls;
  return calls[calls.length - 1][0];
}
