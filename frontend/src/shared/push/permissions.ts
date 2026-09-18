import * as Notifications from 'expo-notifications';

/**
 * TRIP-607 · shared/push — OS 푸시 권한 **조회만**(토큰 등록·수신 핸들러는 TRIP-576 소관, 손대지 않는다).
 *
 * l02 알림 설정은 권한을 서버에 미러하지 않고(NotificationToggle 계약에 미러 필드가 없다), 페이지가
 * 여기서 로컬 OS 권한을 직접 읽어 순수 `channelAvailability.resolvePushColumn` 에 주입한다 —
 * `useLocationConsent` 의 서버 미러 방식과 다르다(01 맹점②).
 *
 * 반환 타입은 이 층 로컬 유니온이다 — `features/notification` 의 `PushPermission` 과 리터럴이 같아
 * 구조적으로 그대로 대입되므로(shared→features import 금지 회피) 페이지가 다리를 놓는다.
 */

export type PushPermissionStatus = 'GRANTED' | 'DENIED' | 'UNDETERMINED';

/** expo-notifications 로 현재 푸시 권한을 읽는다(요청하지 않는다 — 조회만). */
export async function getPushPermission(): Promise<PushPermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'GRANTED';
  if (status === 'denied') return 'DENIED';
  return 'UNDETERMINED';
}
