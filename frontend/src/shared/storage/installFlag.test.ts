import * as SecureStore from 'expo-secure-store';

import {
  documentFileCount,
  failFileReads,
  resetFakeFs,
} from '@/test-support/fakeExpoFileSystem';

import { readInstallFlag, writeInstallFlag } from './installFlag';

/**
 * TRIP-1601 — 설치 단위 "한 번 했음" 표식 읽기/쓰기(`readInstallFlag`·`writeInstallFlag`).
 *
 * 왜 SecureStore 가 아닌가: iOS 키체인 값은 앱을 지웠다 다시 깔아도 남는다(`installId.ts` 주석). 권한 안내는 "재설치하면
 * OS 권한이 초기화되니 다시 한 번"이 핵심이라, 앱 샌드박스(문서 폴더 — 앱을 지우면 같이 지워진다)에 파일로 남긴다.
 *
 * 무엇을 보장하나: 없으면 false, 쓴 이름만 true(이름끼리 안 섞임), 기록은 문서 폴더에 남고 SecureStore 는 한 번도 안 부른다,
 * 읽다 실패하면 false 로 접지 않고 **reject** 한다(호출부가 "모름"과 "아직 안 함"을 구별해야 한다 — 모름이면 안내를 안 띄운다).
 * 쓰기 실패를 helper 가 삼킬지 호출부가 삼킬지는 정하지 않았다(SplashGate.integration W1 이 "실패해도 안내 진행"을 행동으로 본다).
 *
 * 3동작: 준비(파일 대역 초기화) → 실행(읽기/쓰기) → 단언(값·문서 폴더 파일 수·SecureStore 호출 0).
 */

jest.mock(
  'expo-file-system',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/test-support/fakeExpoFileSystem').fakeExpoFileSystemModule
);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

afterEach(() => {
  resetFakeFs();
  jest.clearAllMocks();
});

describe('🔴 installFlag · 설치 단위 표식 (TRIP-1601)', () => {
  it('I1 쓴 적 없으면 false', async () => {
    await expect(readInstallFlag('permission-catchup')).resolves.toBe(false);
  });

  it('I2 쓰면 같은 이름으로 true, 다른 이름은 여전히 false', async () => {
    await writeInstallFlag('permission-catchup');

    await expect(readInstallFlag('permission-catchup')).resolves.toBe(true);
    await expect(readInstallFlag('other-flag')).resolves.toBe(false);
  });

  it('I3 같은 이름을 두 번 써도 던지지 않고 true 그대로다', async () => {
    await writeInstallFlag('permission-catchup');
    await writeInstallFlag('permission-catchup');

    await expect(readInstallFlag('permission-catchup')).resolves.toBe(true);
  });

  it('I4 기록은 앱 문서 폴더에 남고 SecureStore(키체인)는 한 번도 부르지 않는다', async () => {
    expect(documentFileCount()).toBe(0);

    await writeInstallFlag('permission-catchup');
    await readInstallFlag('permission-catchup');

    expect(documentFileCount()).toBeGreaterThan(0);
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('I5 읽다 실패하면 false 로 접지 않고 reject 한다("모름"과 "아직 안 함"을 구별)', async () => {
    await writeInstallFlag('permission-catchup');
    failFileReads();

    await expect(readInstallFlag('permission-catchup')).rejects.toThrow();
  });
});
