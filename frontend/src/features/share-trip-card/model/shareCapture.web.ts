import type { RefObject } from 'react';
import type { View } from 'react-native';

import type { SaveShareCardResult, ShareShareCardResult } from './shareCapture';

// TRIP-1648 · 웹 번들용 — 앨범 저장·OS 공유 시트가 없다. armed=false 라 공유 진입점·버튼 줄이 아예 안 그려진다(TRIP-939 게이트).
// 네이티브 4종(view-shot·media-library·sharing·shareCaptureNative)은 불러오지 않는다. 다운로드는 후속 티켓.
type CaptureTarget = RefObject<View | null>;

export type { SaveShareCardResult, ShareShareCardResult };

export function isShareCaptureArmed(): boolean {
  return false;
}
export async function saveShareCardImage(
  _target: CaptureTarget
): Promise<SaveShareCardResult> {
  return { status: 'failed' };
}
export async function shareShareCardImage(
  _target: CaptureTarget
): Promise<ShareShareCardResult> {
  return { status: 'failed' };
}

// 시그니처 대조 — 실 모듈(shareCapture.ts) 타입이 바뀌면 여기서 빨개진다(tsc 는 소비처를 shareCapture.ts 로만 푼다).
void ({
  isShareCaptureArmed,
  saveShareCardImage,
  shareShareCardImage,
} satisfies typeof import('./shareCapture'));
