/**
 * @jest-environment node
 */

/**
 * TRIP-1648 · D1 — 웹 사진 앨범(`shared/photo/index.web.ts`): "앱에서만" 로 정직하게 답한다.
 *
 * 무엇을 보장하나:
 *  - `pickPhotoAsset()` 은 권한 팝업·파일 선택 창 없이 `{ kind: 'unsupported' }` 를 돌려준다. 이 기능은 "기기 앨범의
 *    자산 번호를 서버에 적는" 모델이라 웹에서 성립하지 않는다(웹 피커엔 자산 번호가 없다). 거부(`denied`)로 접으면
 *    화면이 `[설정 열기]` 를 그리는데 웹에선 그 버튼이 무반응이라 INV-4 위반이다.
 *  - `resolvePhotoUri(id)` 는 `null`(이 기기 앨범에서 못 찾음과 같은 모양 — 호출처가 이미 처리한다).
 *  - 앨범·피커 패키지를 한 번도 로드하지 않는다(던지는 목). 두 파일은 같은 이름만 내보낸다.
 *
 * 3동작: 준비(던지는 목) → 실행(두 함수 호출) → 단언(값 완전 일치·export 이름).
 */

import { pickPhotoAsset, resolvePhotoUri } from './index.web';

jest.mock('expo-media-library', () => {
  throw new Error('expo-media-library must not load on web');
});
jest.mock('expo-image-picker', () => {
  throw new Error('expo-image-picker must not load on web');
});
jest.mock('@/shared/storage/installId', () => ({ getInstallId: jest.fn() }));

describe('웹 사진 앨범 스텁', () => {
  it('pickPhotoAsset 은 unsupported 한 갈래만 돌려준다 (reject·denied 아님)', async () => {
    await expect(pickPhotoAsset()).resolves.toStrictEqual({
      kind: 'unsupported',
    });
  });

  it('resolvePhotoUri 는 null 이다', async () => {
    await expect(resolvePhotoUri('asset-1')).resolves.toBeNull();
  });

  it('네이티브·웹 파일은 같은 이름만 내보낸다', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('./index') as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const web = require('./index.web') as Record<string, unknown>;

    expect(Object.keys(web).sort()).toEqual(Object.keys(native).sort());
  });
});
