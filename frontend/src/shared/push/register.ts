import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import {
  deleteMePushTokensToken,
  postMePushTokens,
} from '@/shared/api/generated/notifications/notifications';

import { getPushPermission } from './permissions';
import type { PushPermissionStatus } from './permissions';
import type { RegisterPushTokenRequestOsPermission } from '@/shared/api/generated/schemas';

/**
 * TRIP-576 · shared/push — Expo 푸시 토큰 등록·해제 배선(권한 조회만 있던 TRIP-607 위에 신설).
 *
 * - `registerPushToken`: 로컬 권한 조회 → expo-notifications 토큰 획득 → `POST /me/push-tokens`.
 * - `toServerOsPermission`: 로컬 유니온 → 서버 enum 매핑(맹점② — `UNDETERMINED`→`NOT_DETERMINED`,
 *   그대로 넘기면 계약 위반).
 * - `isDeviceNotRegistered`/`unregisterDeviceToken`: Expo `DeviceNotRegistered`→토큰 즉시 무효화
 *   (BR-U6-37·INV-U6-07). 실 다이얼로그·수신·발화는 jest 사각 → 6-b 실기/서버 선행. */

/** 로컬 OS 유니온 → 서버 enum. `UNDETERMINED`→`NOT_DETERMINED`(맹점② — 그대로 넘기면 계약 위반). */
export function toServerOsPermission(
  local: PushPermissionStatus
): RegisterPushTokenRequestOsPermission {
  if (local === 'GRANTED') return 'GRANTED';
  if (local === 'DENIED') return 'DENIED';
  return 'NOT_DETERMINED';
}

/** Expo 영수증 오류가 `{code:'DeviceNotRegistered'}` 인지 — 토큰 무효화 판별(BR-U6-37). */
export function isDeviceNotRegistered(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'DeviceNotRegistered'
  );
}

/** 죽은 토큰 제거 — `DELETE /me/push-tokens/{token}`(INV-U6-07). */
export async function unregisterDeviceToken(token: string): Promise<void> {
  await deleteMePushTokensToken(token);
}

/** OS 권한 조회 → Expo 토큰 획득 → `POST /me/push-tokens`(osPermission 매핑 경유). */
export async function registerPushToken(): Promise<void> {
  const local = await getPushPermission();
  const { data: token } = await Notifications.getExpoPushTokenAsync();
  await postMePushTokens({
    token,
    platform: Platform.OS === 'android' ? 'ANDROID' : 'IOS',
    osPermission: toServerOsPermission(local),
  });
}
