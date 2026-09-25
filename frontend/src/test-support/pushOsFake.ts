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
