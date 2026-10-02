import type { RefObject } from 'react';
import { TurboModuleRegistry, type View } from 'react-native';

import {
  isShareCaptureArmed,
  saveShareCardImage,
  shareShareCardImage,
} from './shareCapture';

/**
 * TRIP-1071 · j06 공유 카드 캡처 — armed 판정과 저장·공유 실행.
 *
 * 무엇을 보장하나(계약):
 *  - AC-1(INV-4): 네이티브 모듈 3종(RNViewShot·ExpoMediaLibrary·ExpoSharing)이 **전부** 이 빌드에 있을 때만
 *    armed. 하나라도 없으면 false — 재빌드 전 dev build 에서 버튼을 숨겨 크래시·가짜 성공을 막는다.
 *  - AC-3·AC-7: 저장 = 캡처(PNG·임시 파일) → 추가 전용(writeOnly) 권한 → 앨범 저장.
 *  - AC-4: 공유 = 캡처 → OS 공유 시트(권한·앨범 저장 없음, 결정 3 — 이미지 파일만).
 *  - AC-5·AC-6(INV-4): 권한 거부·캡처/저장/공유 예외는 결과 값으로 돌려준다 — 실행 함수는 reject 하지 않는다.
 *
 * 목은 패키지 3종과 `expo`·`TurboModuleRegistry` 만 바꾼다. 캡처 모듈이 패키지를 부르는 로직은 진짜다.
 * 판정 쪽은 `requireOptionalNativeModule`(expo)과 `TurboModuleRegistry.get` 을 **같은 집합**으로
 * 조종한다 — RNViewShot 을 어느 조회로 찾든 통과하고, `NativeModules` 직조회는 jest-expo 목이 늘
 * "있다"고 답해 "하나 없음" 케이스에서 red 가 난다(02a ★7).
 *
 * 3동작: 준비(모듈 존재 집합·패키지 응답) → 실행(판정·저장·공유 호출) → 단언(반환값·패키지 호출).
 */

const mockPresent = new Set<string>();
jest.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) =>
    mockPresent.has(name) ? {} : null,
}));

const mockCaptureRef = jest.fn();
jest.mock('react-native-view-shot', () => ({
  __esModule: true,
  captureRef: (...args: unknown[]) => mockCaptureRef(...args),
}));

const mockRequestPermissions = jest.fn();
const mockSaveToLibrary = jest.fn();
jest.mock('expo-media-library', () => ({
  __esModule: true,
  requestPermissionsAsync: (...args: unknown[]) =>
    mockRequestPermissions(...args),
  saveToLibraryAsync: (...args: unknown[]) => mockSaveToLibrary(...args),
}));

const mockShareAsync = jest.fn();
jest.mock('expo-sharing', () => ({
  __esModule: true,
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

const ALL_MODULES = ['RNViewShot', 'ExpoMediaLibrary', 'ExpoSharing'] as const;
const CAPTURED_URI = 'file:///tmp/share-card.png';
const GRANTED = {
  granted: true,
  status: 'granted',
  canAskAgain: true,
  expires: 'never',
};
const DENIED = {
  granted: false,
  status: 'denied',
  canAskAgain: false,
  expires: 'never',
};

/** 캡처 대상 — 실제 화면에선 프리뷰 프레임 View 의 ref. 여기선 식별만 되면 된다. */
function frameTarget(): RefObject<View | null> {
  return { current: { marker: 'frame' } as unknown as View };
}

let turboGetSpy: jest.SpyInstance;

beforeEach(() => {
  mockPresent.clear();
  turboGetSpy = jest
    .spyOn(TurboModuleRegistry, 'get')
    .mockImplementation(((name: string) =>
      mockPresent.has(name) ? {} : null) as typeof TurboModuleRegistry.get);
  mockCaptureRef.mockReset();
  mockRequestPermissions.mockReset();
  mockSaveToLibrary.mockReset();
  mockShareAsync.mockReset();
});

afterEach(() => {
  turboGetSpy.mockRestore();
});

describe('🔴 AC-1 · armed 판정 — 네이티브 모듈 3종이 전부 있어야 true (INV-4)', () => {
  it('세 모듈이 모두 있으면 true', () => {
    // 준비
    ALL_MODULES.forEach((name) => mockPresent.add(name));

    // 실행·단언 — 동기 boolean(Promise 가 아니다)
    expect(isShareCaptureArmed()).toBe(true);
  });

  it.each(ALL_MODULES)('%s 하나만 없어도 false(부분 개통 없음)', (missing) => {
    ALL_MODULES.filter((name) => name !== missing).forEach((name) =>
      mockPresent.add(name)
    );

    expect(isShareCaptureArmed()).toBe(false);
  });

  it('하나도 없으면(재빌드 전 dev build) false', () => {
    expect(isShareCaptureArmed()).toBe(false);
  });
});

describe('🔴 AC-3·AC-7 · 저장 — 캡처 → 추가 전용 권한 → 앨범 저장', () => {
  it('정상: PNG 임시 파일로 뜨고, writeOnly 권한을 받은 뒤 그 파일을 앨범에 저장한다', async () => {
    // 준비
    mockCaptureRef.mockResolvedValue(CAPTURED_URI);
    mockRequestPermissions.mockResolvedValue(GRANTED);
    mockSaveToLibrary.mockResolvedValue(undefined);
    const target = frameTarget();

    // 실행
    const result = await saveShareCardImage(target);

    // 단언
    expect(result).toEqual({ status: 'saved' });
    expect(mockCaptureRef).toHaveBeenCalledTimes(1);
    expect(mockCaptureRef).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ format: 'png', result: 'tmpfile' })
    );
    // writeOnly=true — 읽기 요청이면 읽기 문구를 지운 iOS 가 앱을 종료한다(02a ★6).
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(mockRequestPermissions.mock.calls[0][0]).toBe(true);
    expect(mockSaveToLibrary).toHaveBeenCalledTimes(1);
    expect(mockSaveToLibrary).toHaveBeenCalledWith(CAPTURED_URI);
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('권한 거부: 앨범 저장을 부르지 않고 permission-denied 를 돌려준다', async () => {
    mockCaptureRef.mockResolvedValue(CAPTURED_URI);
    mockRequestPermissions.mockResolvedValue(DENIED);

    const result = await saveShareCardImage(frameTarget());

    expect(result).toEqual({ status: 'permission-denied' });
    expect(mockSaveToLibrary).not.toHaveBeenCalled();
  });

  it('캡처 예외: reject 하지 않고 failed, 앨범 저장 0회', async () => {
    mockCaptureRef.mockRejectedValue(new Error('capture failed'));
    mockRequestPermissions.mockResolvedValue(GRANTED);

    await expect(saveShareCardImage(frameTarget())).resolves.toEqual({
      status: 'failed',
    });
    expect(mockSaveToLibrary).not.toHaveBeenCalled();
  });

  it('앨범 저장 예외: reject 하지 않고 failed', async () => {
    mockCaptureRef.mockResolvedValue(CAPTURED_URI);
    mockRequestPermissions.mockResolvedValue(GRANTED);
    mockSaveToLibrary.mockRejectedValue(new Error('save failed'));

    await expect(saveShareCardImage(frameTarget())).resolves.toEqual({
      status: 'failed',
    });
  });

  it('권한 요청 예외: reject 하지 않고 failed', async () => {
    mockCaptureRef.mockResolvedValue(CAPTURED_URI);
    mockRequestPermissions.mockRejectedValue(new Error('permission failed'));

    await expect(saveShareCardImage(frameTarget())).resolves.toEqual({
      status: 'failed',
    });
    expect(mockSaveToLibrary).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-4 · 공유 — 캡처 → OS 공유 시트 (권한·앨범 저장 없음, 결정 3)', () => {
  it('정상: 캡처한 파일 URI 로 공유 시트를 열고 shared 를 돌려준다', async () => {
    mockCaptureRef.mockResolvedValue(CAPTURED_URI);
    mockShareAsync.mockResolvedValue(undefined);
    const target = frameTarget();

    const result = await shareShareCardImage(target);

    expect(result).toEqual({ status: 'shared' });
    expect(mockCaptureRef).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ format: 'png', result: 'tmpfile' })
    );
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    expect(mockShareAsync.mock.calls[0][0]).toBe(CAPTURED_URI);
    // 공유는 앨범을 건드리지 않는다 — 권한 프롬프트도 없다.
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockSaveToLibrary).not.toHaveBeenCalled();
  });

  it('캡처 예외: reject 하지 않고 failed, 공유 시트 0회', async () => {
    mockCaptureRef.mockRejectedValue(new Error('capture failed'));

    await expect(shareShareCardImage(frameTarget())).resolves.toEqual({
      status: 'failed',
    });
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('공유 시트 예외: reject 하지 않고 failed', async () => {
    mockCaptureRef.mockResolvedValue(CAPTURED_URI);
    mockShareAsync.mockRejectedValue(new Error('share failed'));

    await expect(shareShareCardImage(frameTarget())).resolves.toEqual({
      status: 'failed',
    });
  });
});
