jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));
jest.mock('@/shared/api/generated/notifications/notifications');

import * as Notifications from 'expo-notifications';

import {
  deleteMePushTokensToken,
  postMePushTokens,
} from '@/shared/api/generated/notifications/notifications';

import {
  isDeviceNotRegistered,
  registerPushToken,
  toServerOsPermission,
  unregisterDeviceToken,
} from './register';

/**
 * TRIP-576 · shared/push · AC-8 — Expo 푸시 토큰 등록·해제 배선.
 *
 * 무엇을 보장하나:
 *  - **P1 osPermission 매핑(맹점②)**: 로컬 유니온 → 서버 enum. `UNDETERMINED`→`NOT_DETERMINED` 가 급소
 *    (그대로 넘기면 계약 위반 — 서버 enum 에 UNDETERMINED 가 없다).
 *  - **P2 DeviceNotRegistered 판별**: `{code:'DeviceNotRegistered'}` 만 true.
 *  - **W1 등록 배선(★5)**: expo 로 토큰 획득 → `POST /me/push-tokens` 를 매핑된 osPermission 으로 호출.
 *    권한 조회가 undetermined 인 실경로에서 실제 바디가 `NOT_DETERMINED` 임을 잠근다(매핑을 선언만
 *    하고 안 쓰는 회피 차단).
 *  - **W2 해제 배선**: `unregisterDeviceToken(token)` → `DELETE /me/push-tokens/{token}`(BR-U6-37).
 *
 * 커버하지 않는 것(6-b 실기/서버 선행): 실제 권한 다이얼로그·푸시 수신·탭 발화·Expo 영수증의
 * DeviceNotRegistered 발생 자체. 여기선 목으로 배선(호출·인자)만 잰다.
 *
 * (개념) `jest.mock('expo-notifications')` = 네이티브 모듈을 가짜로 대체(실기기·권한 없이 반환값 주입).
 *  auto-mock 된 생성 함수(postMePushTokens 등)는 jest.fn() 이라 "무슨 인자로 불렸나"를 캡처한다.
 */

const mockGetPermissions = Notifications.getPermissionsAsync as jest.Mock;
const mockGetExpoToken = Notifications.getExpoPushTokenAsync as jest.Mock;
const mockPost = postMePushTokens as jest.Mock;
const mockDelete = deleteMePushTokensToken as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('P1 · toServerOsPermission — 로컬 유니온 → 서버 enum (맹점②)', () => {
  it.each([
    ['GRANTED', 'GRANTED'],
    ['DENIED', 'DENIED'],
    ['UNDETERMINED', 'NOT_DETERMINED'],
  ] as const)('%s → %s', (local, server) => {
    expect(toServerOsPermission(local)).toBe(server);
  });
});

describe('P2 · isDeviceNotRegistered — DeviceNotRegistered 만 true', () => {
  it('{code:"DeviceNotRegistered"} → true', () => {
    expect(isDeviceNotRegistered({ code: 'DeviceNotRegistered' })).toBe(true);
    expect(
      isDeviceNotRegistered(
        Object.assign(new Error('x'), { code: 'DeviceNotRegistered' })
      )
    ).toBe(true);
  });

  it('다른 code·null·문자열 → false', () => {
    expect(isDeviceNotRegistered({ code: 'OTHER' })).toBe(false);
    expect(isDeviceNotRegistered(null)).toBe(false);
    expect(isDeviceNotRegistered('DeviceNotRegistered')).toBe(false);
    expect(isDeviceNotRegistered(new Error('boom'))).toBe(false);
  });
});

describe('W1 · registerPushToken — 토큰 획득 → POST(매핑된 osPermission)', () => {
  it('권한 undetermined → POST 바디 osPermission=NOT_DETERMINED, token 은 expo 값', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockGetExpoToken.mockResolvedValue({ data: 'ExponentPushToken[TEST]' });

    await registerPushToken();

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'ExponentPushToken[TEST]',
        osPermission: 'NOT_DETERMINED',
        platform: expect.stringMatching(/^(IOS|ANDROID)$/),
      })
    );
  });
});

describe('W2 · unregisterDeviceToken — DELETE /me/push-tokens/{token}', () => {
  it('토큰 해제가 그 토큰으로 DELETE 를 1회 호출한다', async () => {
    await unregisterDeviceToken('ExponentPushToken[TEST]');

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('ExponentPushToken[TEST]');
  });
});
