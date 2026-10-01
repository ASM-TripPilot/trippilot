import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { getPushPermission } from './permissions';
import type { PushPermissionStatus } from './permissions';

/**
 * TRIP-835 · shared/push — OS 알림 권한 **요청**과 안드로이드 채널. 조회 전용 `getPushPermission`
 * (TRIP-607)은 그대로 두고 요청을 별도 함수로 둔다.
 *
 * 채널 ID 는 서버 `ExpoPushAdapter` 의 iOS `interruptionLevel` 문자열과 글자까지 같다(BE 가 그대로
 * `channelId` 로 재사용할 수 있게). 중요도는 한 번 만들면 앱이 못 바꾼다 — 바꾸려면 새 ID 가 필요하다.
 */

/** 서버 `PushUrgency` 3단 → 안드로이드 채널. `bypassDnd` 는 켜지 않는다(별도 권한 필요). */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // enum 은 호출 시점에 읽는다 — 이 파일을 로드하는 기존 테스트의 팩토리 목엔 enum 이 없다.
  const { LOW, DEFAULT, HIGH } = Notifications.AndroidImportance;
  await Promise.all([
    Notifications.setNotificationChannelAsync('passive', {
      name: '회고·소식',
      importance: LOW,
    }),
    Notifications.setNotificationChannelAsync('active', {
      name: '여행 알림',
      importance: DEFAULT,
    }),
    Notifications.setNotificationChannelAsync('time-sensitive', {
      name: '일정 임박·Plan-B',
      importance: HIGH,
    }),
  ]);
}

/**
 * 아직 답하지 않은(UNDETERMINED) 사용자에게만 OS 다이얼로그를 띄운다. 이미 답했으면 묻지 않고 현재 값.
 * 채널 생성이 **끝난 뒤** 묻는다 — Android 13+ 는 채널이 하나도 없으면 다이얼로그가 안 뜬다.
 */
export async function requestPushPermission(): Promise<PushPermissionStatus> {
  await ensureAndroidChannels();
  const current = await getPushPermission();
  if (current !== 'UNDETERMINED') return current;
  await Notifications.requestPermissionsAsync();
  return getPushPermission();
}
