import type { PushEvent } from './receive';
import type { PushPermissionStatus } from './permissions';

// 웹 번들에서 `@/shared/push` 대신 Metro 가 고르는 스텁(같은 이름의 값 14개). `expo-notifications` 는 import 되는 순간
// 콘솔 경고를 내고 웹에 푸시 서버 등록 길이 없으므로, 여기선 그 패키지와 푸시 API 클라이언트를 불러오지 않는다(TRIP-1648).
// 성공을 흉내 내지 않는다 — 권한은 거절, 등록·해제는 아무 일도 안 한다. 이름이 실 배럴과 어긋나지 않는지는 index.web.test 가 본다.
export { PushPreprompt } from './index.view';
export type { PushEvent, PushPermissionStatus };

export async function getPushPermission(): Promise<PushPermissionStatus> {
  return 'DENIED';
}
export async function requestPushPermission(): Promise<PushPermissionStatus> {
  return 'DENIED';
}

export async function registerPushToken(): Promise<void> {}
export async function unregisterDeviceToken(_token: string): Promise<void> {}
export async function promptAndRegisterPush(): Promise<void> {}
export async function registerPushIfGranted(): Promise<void> {}
export async function unregisterStoredPushToken(): Promise<void> {}

export function toServerOsPermission(_local: PushPermissionStatus): 'DENIED' {
  return 'DENIED';
}
export function isDeviceNotRegistered(_error: unknown): boolean {
  return false;
}

export function installForegroundPresentation(): void {}
export function onPushReceived(_listener: (event: PushEvent) => void) {
  return () => {};
}
export function onPushTapped(_listener: (event: PushEvent) => void) {
  return () => {};
}
export async function takeLaunchPushTap(): Promise<PushEvent | null> {
  return null;
}

// 시그니처 대조 — tsc 는 소비처를 실 배럴(index.ts)로만 풀어 이 파일과 비교하지 않는다. 실 배럴 타입이 바뀌면 여기서 빨개진다.
void ({
  getPushPermission,
  requestPushPermission,
  registerPushToken,
  unregisterDeviceToken,
  promptAndRegisterPush,
  registerPushIfGranted,
  unregisterStoredPushToken,
  toServerOsPermission,
  isDeviceNotRegistered,
  installForegroundPresentation,
  onPushReceived,
  onPushTapped,
  takeLaunchPushTap,
} satisfies Omit<typeof import('./index'), 'PushPreprompt'>);
