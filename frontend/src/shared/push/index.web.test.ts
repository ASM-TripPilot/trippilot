/**
 * @jest-environment node
 */

/**
 * TRIP-1648 · A1~A4 — 웹용 푸시 스텁(`index.web.ts`)과 "푸시 지원 여부" 진입점(`index.support(.web).ts`).
 *
 * 무엇을 보장하나:
 *  - 웹 번들은 `expo-notifications` 를 아예 안 끌어온다 — 이 패키지는 **import 되는 순간** 콘솔 경고를 낸다(호출 안 해도).
 *    그래서 아래 목은 "불러오면 던지는" 모양이고, 이 파일이 스텁을 정적 import 한 채로 살아 있다는 것 자체가 증거다.
 *  - 스텁은 사용자에게 성공을 거짓으로 말하지 않는다: 권한은 `DENIED`, 등록·해제는 서버·OS 를 부르지 않고 조용히 끝나며
 *    (호출처가 기다리지 않거나 실패를 삼키는 함수들이라 reject 하지 않는다), 수신 구독은 빈 해제 함수를 준다.
 *  - 스텁이 내보내는 값 이름이 실제 배럴과 같다 — `tsc` 는 `.web.ts` 를 import 그래프에 안 올려서 이름이 어긋나도
 *    못 잡고, 어긋나면 웹에서만 `undefined is not a function` 이 난다.
 *  - `isPushSupported`: 네이티브 `true`, 웹 `false`(설정의 "알림" 그룹을 웹에서 숨기는 근거).
 *
 * (개념) `jest.mock(경로, 팩토리)` 의 팩토리가 던지게 두면 "그 모듈을 require 하는 순간 실패" 를 만든다 — 호출 횟수가 아니라
 *   로드 자체를 금지할 때 쓴다. `jest.isolateModules` = 그 안에서 require 한 모듈을 캐시 없이 새로 읽는다.
 * 3동작: 준비(던지는 목) → 실행(스텁 함수 호출) → 단언(반환값·호출 여부).
 */

import {
  installForegroundPresentation,
  getPushPermission,
  isDeviceNotRegistered,
  onPushReceived,
  onPushTapped,
  promptAndRegisterPush,
  registerPushIfGranted,
  registerPushToken,
  requestPushPermission,
  takeLaunchPushTap,
  toServerOsPermission,
  unregisterDeviceToken,
  unregisterStoredPushToken,
} from './index.web';
import { isPushSupported as isPushSupportedWeb } from './index.support.web';
import { isPushSupported as isPushSupportedNative } from './index.support';

jest.mock('expo-notifications', () => {
  throw new Error('expo-notifications must not load on web');
});
jest.mock('@/shared/api/generated/notifications/notifications', () => {
  throw new Error('push API client must not load on web');
});

describe('웹 푸시 스텁 — 권한은 거절로, 등록·해제는 아무 일도 안 한다', () => {
  it('권한 조회·요청은 둘 다 DENIED 를 돌려준다 (브라우저 알림 팝업을 띄우지 않는다)', async () => {
    await expect(getPushPermission()).resolves.toBe('DENIED');
    await expect(requestPushPermission()).resolves.toBe('DENIED');
  });

  it('등록·해제 함수는 reject 없이 끝난다 (서버·OS 호출은 목이 던지므로 0회)', async () => {
    await expect(promptAndRegisterPush()).resolves.toBeUndefined();
    await expect(registerPushIfGranted()).resolves.toBeUndefined();
    await expect(unregisterStoredPushToken()).resolves.toBeUndefined();
    await expect(registerPushToken()).resolves.toBeUndefined();
    await expect(unregisterDeviceToken('ExponentPushToken[A]')).resolves.toBe(
      undefined
    );
  });

  it('수신 구독은 빈 해제 함수를 주고, 콜드 스타트 탭은 null 이다', async () => {
    const listener = jest.fn();

    expect(() => installForegroundPresentation()).not.toThrow();
    const offReceived = onPushReceived(listener);
    const offTapped = onPushTapped(listener);

    expect(typeof offReceived).toBe('function');
    expect(typeof offTapped).toBe('function');
    expect(() => {
      offReceived();
      offTapped();
    }).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    await expect(takeLaunchPushTap()).resolves.toBeNull();
  });

  it('순수 보조 함수도 성공 모양을 만들지 않는다 (서버 권한값은 DENIED, 죽은 토큰 판정은 false)', () => {
    expect(toServerOsPermission('GRANTED')).toBe('DENIED');
    expect(isDeviceNotRegistered({ code: 'DeviceNotRegistered' })).toBe(false);
  });
});

describe('웹 스텁 ↔ 실 배럴 — 값 이름이 같다', () => {
  it('index.web 이 내보내는 값 이름 == index(실 배럴)이 내보내는 값 이름', () => {
    // 실 배럴은 expo-notifications 를 진짜로 읽으므로, 이 한 케이스에서만 같은 경로 목을 가벼운 빈 객체로 바꿔 읽는다.
    let real: Record<string, unknown> | undefined;
    jest.isolateModules(() => {
      jest.doMock('expo-notifications', () => ({}));
      jest.doMock(
        '@/shared/api/generated/notifications/notifications',
        () => ({})
      );
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      real = require('./index');
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const web = require('./index.web') as Record<string, unknown>;

    expect(Object.keys(web).sort()).toEqual(Object.keys(real ?? {}).sort());
  });
});

describe('isPushSupported — 네이티브 true · 웹 false', () => {
  it('실 진입점은 true, 웹 진입점은 false 를 돌려준다', () => {
    expect(isPushSupportedNative()).toBe(true);
    expect(isPushSupportedWeb()).toBe(false);
  });

  it('두 진입점은 같은 이름만 내보낸다', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('./index.support') as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const web = require('./index.support.web') as Record<string, unknown>;

    expect(Object.keys(web).sort()).toEqual(Object.keys(native).sort());
    expect(Object.keys(native)).toEqual(['isPushSupported']);
  });
});
