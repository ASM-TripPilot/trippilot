import type { PhotoPickResult } from './index';

// TRIP-1648 · 웹 번들용 — 앨범 자산 번호를 서버에 적는 모델이라 웹에서 성립하지 않는다. `denied` 로 접으면 화면이
// 무반응 [설정 열기] 를 그리므로 별도 갈래(`unsupported`)로 정직하게 답한다. 앨범·피커 패키지는 불러오지 않는다.
export type { PhotoAssetMeta, PhotoPickResult } from './index';

export async function pickPhotoAsset(): Promise<PhotoPickResult> {
  return { kind: 'unsupported' };
}
export async function resolvePhotoUri(_localAssetId: string): Promise<null> {
  return null;
}

// 시그니처 대조 — 실 모듈(index.ts) 타입이 바뀌면 여기서 빨개진다(tsc 는 소비처를 index.ts 로만 푼다).
void ({ pickPhotoAsset, resolvePhotoUri } satisfies Pick<
  typeof import('./index'),
  'pickPhotoAsset' | 'resolvePhotoUri'
>);
