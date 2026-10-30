/**
 * @jest-environment node
 */

/**
 * TRIP-1648 · C1·C2 — 웹 공유 카드 캡처(`shareCapture.web.ts`): 끄되, 터지지 않는다.
 *
 * 무엇을 보장하나:
 *  - `isShareCaptureArmed()` 는 웹에서 던지지 않고 `false` 다. 네이티브 구현은 `TurboModuleRegistry.get(...)` 를 부르는데
 *    웹용 react-native 에는 그 이름이 없어서(= undefined) 여행 요약 화면이 렌더 중에 크래시한다. 그래서 "끄기"보다
 *    "안 터지게 하기"가 먼저다. `false` 면 기존 TRIP-939 게이트가 `[공유]` 진입점과 저장/공유 버튼 줄을 그리지 않는다
 *    → 눌러도 무반응인 버튼이 아예 없다(INV-4, Q2 = 웹은 숨김).
 *  - 저장·공유 함수는 (구조상 불리지 않지만) 불려도 `failed` 값으로 답하고 네이티브 패키지 4종을 한 번도 로드하지 않는다.
 *    특히 `shareCaptureNative`(html2canvas 포함 큰 청크)가 웹 번들에서 빠지는 전제다.
 *
 * 웹 런타임 흉내(02a ★4): `react-native` 를 빈 객체로 바꿔 `TurboModuleRegistry` 를 없애고, `expo` 의 모듈 조회는
 * **전부 "있다"** 고 답하게 한다 — 조회 결과로 true 를 만드는 구현도 잡는다.
 * (개념) 패키지 로드 카운터 — 목 팩토리는 "그 모듈이 처음 require 될 때" 한 번 실행되므로 팩토리 안에서 센다.
 * 3동작: 준비(웹 흉내 목) → 실행(armed·저장·공유) → 단언(false/failed·로드 0).
 */

import type { RefObject } from 'react';
import type { View } from 'react-native';

import {
  isShareCaptureArmed,
  saveShareCardImage,
  shareShareCardImage,
} from './shareCapture.web';

const mockLoaded: string[] = [];

jest.mock('react-native', () => ({}));
jest.mock('expo', () => ({ requireOptionalNativeModule: () => ({}) }));
jest.mock('./shareCaptureNative', () => {
  mockLoaded.push('shareCaptureNative');
  return {};
});
jest.mock('react-native-view-shot', () => {
  mockLoaded.push('react-native-view-shot');
  return {};
});
jest.mock('expo-media-library', () => {
  mockLoaded.push('expo-media-library');
  return {};
});
jest.mock('expo-sharing', () => {
  mockLoaded.push('expo-sharing');
  return {};
});

const target = { current: null } as RefObject<View | null>;

describe('웹 공유 카드 캡처 — 숨김 + 크래시 없음', () => {
  it('isShareCaptureArmed() 는 던지지 않고 false 다 (TurboModuleRegistry 가 없어도, 모듈이 "있다"고 답해도)', () => {
    expect(() => isShareCaptureArmed()).not.toThrow();
    expect(isShareCaptureArmed()).toBe(false);
  });

  it('저장·공유는 reject 하지 않고 failed 로 답하며 네이티브 패키지를 로드하지 않는다', async () => {
    await expect(saveShareCardImage(target)).resolves.toEqual({
      status: 'failed',
    });
    await expect(shareShareCardImage(target)).resolves.toEqual({
      status: 'failed',
    });

    expect(mockLoaded).toEqual([]);
  });

  it('네이티브·웹 파일은 같은 이름만 내보낸다', () => {
    // 실 shareCapture 는 react-native·expo 를 읽으므로 이 케이스에서만 목을 풀어 읽는다.
    let native: Record<string, unknown> | undefined;
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ TurboModuleRegistry: {} }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      native = require('./shareCapture');
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const web = require('./shareCapture.web') as Record<string, unknown>;

    expect(Object.keys(web).sort()).toEqual(Object.keys(native ?? {}).sort());
  });
});
