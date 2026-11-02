import { Platform } from 'react-native';

import { getInstallId } from '@/shared/storage/installId';

import { loginDeviceId } from './loginDeviceId';

/**
 * 로그인 요청의 `deviceId` = `{플랫폼}-{설치 id}`. 서버는 이 값을 refresh_session.device_id 에 그대로
 * 저장하므로 운영 DB 에서 `device_id LIKE 'web-%'` 로 앱/웹 가입자를 가를 수 있다(서버·DB 무변경).
 * 3동작: 준비(플랫폼·설치 id 대역) → 실행(loginDeviceId) → 단언(문자열 또는 undefined).
 */

jest.mock('@/shared/storage/installId', () => ({ getInstallId: jest.fn() }));

const mockGetInstallId = getInstallId as jest.Mock;
const INSTALL_ID = '3f1c2a9e-7b4d-4e2a-9c1f-0a5b6c7d8e9f';
// 서버 상한 RefreshSession.DEVICE_ID_MAX(backend/modules/auth/.../RefreshSession.kt) — 넘으면 400.
const SERVER_DEVICE_ID_MAX = 128;

afterEach(() => {
  jest.restoreAllMocks();
  mockGetInstallId.mockReset();
});

describe('loginDeviceId', () => {
  it.each(['web', 'ios', 'android'] as const)(
    '%s → "%s-<설치 id>" (서버 상한 이하)',
    async (os) => {
      jest.replaceProperty(Platform, 'OS', os);
      mockGetInstallId.mockResolvedValue(INSTALL_ID);

      const deviceId = await loginDeviceId();

      expect(deviceId).toBe(`${os}-${INSTALL_ID}`);
      expect(deviceId!.length).toBeLessThanOrEqual(SERVER_DEVICE_ID_MAX);
    }
  );

  it('설치 id 를 못 읽으면(시크릿 모드 저장소 막힘 등) undefined — 로그인은 deviceId 없이 그대로 나간다', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    mockGetInstallId.mockRejectedValue(new Error('SecurityError'));

    await expect(loginDeviceId()).resolves.toBeUndefined();
  });
});
