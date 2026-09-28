import type { RefObject } from 'react';
import { TurboModuleRegistry, type View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * TRIP-1071 · j06 공유 카드 캡처 — armed 판정(동기)과 저장·공유 실행(비동기)의 단일 출처.
 *
 * 캡처 3종(view-shot·media-library·sharing)은 import 하는 순간 네이티브 모듈을 강제 조회해, 재빌드 전
 * 빌드에서는 모듈 로드 자체가 던진다. 그래서 이 파일은 패키지를 import 하지 않는다 — 판정은 던지지 않는
 * 조회(`requireOptionalNativeModule`·`TurboModuleRegistry.get`)로만 하고, 실행은 어댑터를 동적 import 로
 * 부른다(auth `makeAuthorize` 선례). 실행 함수는 reject 하지 않고 결과 값을 돌려준다(INV-4).
 */

export type SaveShareCardResult = {
  status: 'saved' | 'permission-denied' | 'failed';
};
export type ShareShareCardResult = { status: 'shared' | 'failed' };

type CaptureTarget = RefObject<View | null>;

/** 세 네이티브 모듈이 **전부** 이 빌드에 있을 때만 true — 부분 개통 없음. */
export function isShareCaptureArmed(): boolean {
  return (
    TurboModuleRegistry.get('RNViewShot') != null &&
    requireOptionalNativeModule('ExpoMediaLibrary') != null &&
    requireOptionalNativeModule('ExpoSharing') != null
  );
}

async function captureCard(target: CaptureTarget) {
  const native = await import('./shareCaptureNative');
  // tmpfile — file:// 경로를 준다(base64 로 들고 다니지 않는다, BR-U5-46).
  const uri = await native.captureRef(target, {
    format: 'png',
    result: 'tmpfile',
  });
  return { native, uri };
}

/** 캡처 → 추가 전용 권한 → 앨범 저장. */
export async function saveShareCardImage(
  target: CaptureTarget
): Promise<SaveShareCardResult> {
  try {
    const { native, uri } = await captureCard(target);
    // writeOnly=true — 읽기 문구를 지운 iOS 에서 읽기 권한을 요청하면 앱이 종료된다.
    const permission = await native.requestPermissionsAsync(true);
    if (!permission.granted) return { status: 'permission-denied' };
    await native.saveToLibraryAsync(uri);
    return { status: 'saved' };
  } catch {
    return { status: 'failed' };
  }
}

/** 캡처 → OS 공유 시트(이미지 파일만, 권한·앨범 저장 없음). */
export async function shareShareCardImage(
  target: CaptureTarget
): Promise<ShareShareCardResult> {
  try {
    const { native, uri } = await captureCard(target);
    await native.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
    return { status: 'shared' };
  } catch {
    return { status: 'failed' };
  }
}
