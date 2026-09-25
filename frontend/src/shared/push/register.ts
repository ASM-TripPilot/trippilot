import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import {
  deleteMePushTokensToken,
  postMePushTokens,
} from '@/shared/api/generated/notifications/notifications';

import { getPushPermission } from './permissions';
import type { PushPermissionStatus } from './permissions';
import { ensureAndroidChannels, requestPushPermission } from './request';
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

/** 이번 세션에 마지막으로 등록한 토큰(TRIP-835) — 서버가 토큰 목록을 주지 않아 해제 때 여기서 꺼낸다.
 * 메모리뿐이라 앱을 재시작하면 비지만, HOME 진입 재등록(`registerPushIfGranted`)이 다시 채운다. */
let storedToken: string | null = null;

/** 해제 응답을 기다리는 상한 — 로그아웃이 느린 서버에 묶이지 않게(TRIP-938 과의 절충, 01b Q3). */
const UNREGISTER_TIMEOUT_MS = 3000;

/** OS 권한 조회 → Expo 토큰 획득 → `POST /me/push-tokens`(osPermission 매핑 경유). 성공하면 토큰 보관. */
export async function registerPushToken(): Promise<void> {
  const local = await getPushPermission();
  const { data: token } = await Notifications.getExpoPushTokenAsync();
  await postMePushTokens({
    token,
    platform: Platform.OS === 'android' ? 'ANDROID' : 'IOS',
    osPermission: toServerOsPermission(local),
  });
  storedToken = token;
}

/** 일정을 처음 만든 직후(TRIP-835): 필요하면 묻고, 허용이면 등록. 화면이 기다리지 않고 부르므로 reject 하지 않는다. */
export async function promptAndRegisterPush(): Promise<void> {
  try {
    if ((await requestPushPermission()) === 'GRANTED') {
      await registerPushToken();
    }
  } catch {
    // 등록 실패는 화면 오류가 아니다 — 다음 HOME 진입이 다시 올린다.
  }
}

/** 인증된 앱 진입·삭제 철회(TRIP-835): **조회만** 하고 허용이면 등록. 절대 묻지 않고 reject 하지 않는다. */
export async function registerPushIfGranted(): Promise<void> {
  try {
    await ensureAndroidChannels();
    if ((await getPushPermission()) === 'GRANTED') {
      await registerPushToken();
    }
  } catch {
    // 위와 같다 — 다음 진입이 복구한다.
  }
}

/**
 * 로그아웃·계정 삭제(TRIP-835, SEC-U6-02): 이번 세션 토큰을 해제한다. 응답을 기다리되(인증이 살아
 * 있을 때 요청이 닿게) 상한에서 끊고, 실패는 삼킨다(404 = 이미 없음). 보관 토큰이 없으면 요청 0회.
 */
export async function unregisterStoredPushToken(): Promise<void> {
  const token = storedToken;
  if (token === null) return;
  storedToken = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      unregisterDeviceToken(token),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, UNREGISTER_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // 해제 실패가 로그아웃을 막지 않는다. 다음 계정이 같은 토큰을 등록하면 서버가 그 계정으로 옮긴다.
  } finally {
    clearTimeout(timer);
  }
}
