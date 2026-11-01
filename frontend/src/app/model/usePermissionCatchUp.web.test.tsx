import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { renderHook } from '@testing-library/react-native';

import { getPushPermission } from '@/shared/push';
import { readInstallFlag, writeInstallFlag } from '@/shared/storage';

import { settle } from '@/test-support/queryRender';

import { usePermissionCatchUp } from './usePermissionCatchUp';

/**
 * TRIP-1648 · A7 — 웹에서는 "기존 계정 HOME 진입 시 권한 안내"(TRIP-1601)가 통째로 꺼진다.
 *
 * 무엇을 보장하나:
 *  - 웹이면 위치·푸시 권한 조회와 "봤음" 표식 읽기·쓰기를 **한 번도 안 하고**, 안내 화면으로 보내지도 않으며, 스플래시를 붙잡지
 *    않는다. 이 안내의 존재 이유("재설치하면 OS 권한이 초기화된다")는 앱 모델이고, 웹은 표식 저장이 안 남아 매 진입마다 반복될
 *    수 있다. 브라우저 위치 권한은 쓰는 순간 브라우저가 묻는다(Q1).
 *  - 짝 대조(02a ★5): 같은 입력(위치·푸시 둘 다 미결정, 표식 없음)에서 iOS 는 `/permission-location` 으로 보낸다 — 웹 케이스의
 *    "0회"가 목이 약해서가 아님을 증명한다. 푸시는 일부러 `UNDETERMINED` 로 둬서(02a ★8) 위치 쪽 웹 가드를 단독으로 본다.
 *  - 구현은 `Platform.OS` 를 **호출 시점에** 읽어야 한다(모듈 로드 때 한 번 굳히면 이 테스트의 `replaceProperty` 가 안 먹는다).
 *
 * (개념) `renderHook` — 컴포넌트 없이 훅만 그려 반환값을 `result.current` 로 읽는다. `jest.replaceProperty(객체, 키, 값)` —
 *   객체의 속성을 임시로 바꾸고 `restoreAllMocks` 로 원복한다(여기선 `Platform.OS`).
 * 3동작: 준비(OS 권한·표식·라우터 목 + Platform.OS) → 실행(훅 렌더 후 비동기 정착) → 단언(호출 횟수·이동·holdSplash).
 */

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
}));
jest.mock('expo-router', () => {
  // 홈 탭이 최상위인 라우터 상태 — 안내 이동이 허용되는 자리. 실물처럼 렌더마다 같은 객체를 돌려준다(새로 만들면 훅 효과가 매 렌더 다시 돈다).
  const navigation = {
    getRootState: () => ({
      routes: [{ state: { index: 0, routes: [{ name: '(tabs)' }] } }],
    }),
  };
  return {
    router: { replace: jest.fn() },
    useNavigationContainerRef: () => navigation,
  };
});
jest.mock('@/shared/push', () => ({ getPushPermission: jest.fn() }));
jest.mock('@/shared/storage', () => ({
  readInstallFlag: jest.fn(),
  writeInstallFlag: jest.fn(),
}));

const mockLocation = Location.getForegroundPermissionsAsync as jest.Mock;
const mockPush = getPushPermission as jest.Mock;
const mockRead = readInstallFlag as jest.Mock;
const mockWrite = writeInstallFlag as jest.Mock;
const mockReplace = router.replace as jest.Mock;

// 모듈 싱글턴이 아니라 전역 객체(Platform.OS)를 바꾸므로 복원은 파일 최상위에서 한다 — describe 안에 두면 웹 상태가 새어 iOS 대조가 거짓이 된다.
afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  mockLocation.mockReset().mockResolvedValue({ status: 'undetermined' });
  mockPush.mockReset().mockResolvedValue('UNDETERMINED');
  mockRead.mockReset().mockResolvedValue(false);
  mockWrite.mockReset().mockResolvedValue(undefined);
  mockReplace.mockReset();
});

describe('usePermissionCatchUp — 플랫폼', () => {
  it('(대조) iOS 는 미결정 위치 권한이면 홈 직후 위치 안내로 보낸다', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');

    renderHook(() => usePermissionCatchUp(true, 'HOME'));
    await settle();

    expect(mockReplace).toHaveBeenCalledWith('/permission-location');
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('웹은 권한·표식을 읽지도 쓰지도 않고, 어디로도 보내지 않고, 스플래시를 붙잡지 않는다', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');

    const { result } = renderHook(() => usePermissionCatchUp(true, 'HOME'));
    await settle();

    expect(mockLocation).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });
});
