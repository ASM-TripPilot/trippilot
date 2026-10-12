import * as Location from 'expo-location';
import { Platform } from 'react-native';

import type { OsPermission } from './arming';

/**
 * TRIP-1338 · OS 위치 권한 읽기·승격 요청 (FD §2.2 backgroundPermission).
 *
 * - 읽기는 조회만(팝업 없음). 승격 요청은 `requestAlwaysPermission` 하나 — [켜기] 탭에서만 부른다.
 * - 거절·미응답·Android 설정 이동 실패는 **오류가 아니라 정상 경로**다(BR-U10-06) — 전부 결과 값으로 접는다.
 * - iOS 정밀/대략(accuracy authorization)은 expo-location 19 가 노출하지 않는다 → iOS 는 `precise:true` 로 두고
 *   대략 위치의 거친 표본(수 km)은 판정 리듀서의 정확도 게이트(BR-U10-12, ≤100m)가 걸러 보류시킨다.
 *   Android 는 `android.accuracy === 'fine'` 일 때만 정밀.
 */

export interface PermissionSnapshot {
  foreground: OsPermission;
  background: OsPermission;
  backgroundCanAskAgain: boolean;
  precise: boolean;
}

const fold = (status: string): OsPermission =>
  status === 'granted'
    ? 'granted'
    : status === 'denied'
      ? 'denied'
      : 'undetermined';

export async function readPermissionSnapshot(): Promise<PermissionSnapshot> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    const precise =
      Platform.OS === 'android' ? fg.android?.accuracy === 'fine' : fg.granted;
    return {
      foreground: fold(fg.status),
      background: fold(bg.status),
      backgroundCanAskAgain: bg.canAskAgain !== false,
      precise,
    };
  } catch {
    return {
      foreground: 'undetermined',
      background: 'undetermined',
      backgroundCanAskAgain: false,
      precise: false,
    };
  }
}

export type AlwaysRequestResult = 'granted' | 'denied' | 'blocked';

/** iOS: when-in-use 선행 확인 후 승격 요청. Android 11+ 는 OS 가 설정 화면으로 보낸다. */
export async function requestAlwaysPermission(): Promise<AlwaysRequestResult> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return fg.canAskAgain === false ? 'blocked' : 'denied';
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.granted) return 'granted';
    return bg.canAskAgain === false ? 'blocked' : 'denied';
  } catch {
    return 'denied';
  }
}
