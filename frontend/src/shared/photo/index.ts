import { getInstallId } from '@/shared/storage/installId';

/**
 * TRIP-566 · TRIP-1070 · shared/photo — 로컬 앨범 접근·자산 메타 shape 경계(features 무관, record 가 소비).
 *
 * 무엇을 보장하나:
 *  - 자산 메타 shape(`PhotoAssetMeta`) 를 한 곳에서 정의한다 — photoAttach(model)·피커가 함께 문다.
 *    shared 는 features 보다 아래 층이라 여기 두어야 record.model 이 위로 가져다 쓸 수 있다.
 *  - `pickPhotoAsset` 은 앨범에서 1장을 고르게 하고 서버로 보낼 **메타만** 뽑는다(파일 본문은 요청하지
 *    않는다 — INV-U5-03). 결과는 다섯 갈래이고 reject 하지 않는다(재빌드 전 앱 = 네이티브 모듈 부재도 failed).
 *  - `resolvePhotoUri` 는 자산 번호로 이 기기 앨범의 파일 주소를 찾는다. 권한을 요청하지 않는다(보기만
 *    하는 화면에서 팝업 금지).
 *  - 두 모듈은 **호출 시점에 `require`** 한다 — 둘 다 로드 순간 `requireNativeModule` 로 던지므로, 정적
 *    import 면 재빌드 전 빌드가 라우트 평가 때 부팅부터 죽는다(TRIP-1071 shareCapture 와 같은 이유). `import()`
 *    가 아니라 `require` 인 것은 jest node 버킷(vm-modules)에서 `jest.mock` 이 동적 import 에 안 걸려서다
 *    (SettingsPage `loadRouter` 선례). 로드 실패는 아래 try 가 받아 failed/null 로 떨어진다(INV-4).
 *
 * ★ 두 네이티브 사진 모듈을 import 하는 유일한 자리 — recordPhotoBinaryGuard G3 가 잠근다.
 *   촬영 시각 변환(`new Date`)도 여기서만 한다(features/record 는 금지 — 타임존 안전).
 *   자산 정보(duration 필드 포함)를 통째로 내보내지 않는다(INV-3).
 */

/** 로컬 사진 한 장에서 뽑은 메타 — 기기 안에서만 뜻이 있는 식별자·촬영시각·좌표(동의 시). */
export interface PhotoAssetMeta {
  localAssetId: string;
  deviceId: string;
  takenAt?: string;
  exifLat?: number;
  exifLng?: number;
  sortOrder?: number;
}

export type PhotoPickResult =
  | { kind: 'picked'; asset: PhotoAssetMeta }
  | { kind: 'canceled' }
  | { kind: 'denied' }
  | { kind: 'no-asset-id' }
  | { kind: 'failed' };

const loadMediaLibrary = () =>
  require('expo-media-library') as typeof import('expo-media-library');

export async function pickPhotoAsset(): Promise<PhotoPickResult> {
  try {
    const MediaLibrary = loadMediaLibrary();
    const ImagePicker =
      require('expo-image-picker') as typeof import('expo-image-picker');
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission?.granted) return { kind: 'denied' };

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
    });
    if (result.canceled) return { kind: 'canceled' };
    // "선택한 사진만 허용"(limited)이면 assetId 가 null 로 온다 — 나중에 다시 찾을 번호가 없다.
    const assetId = result.assets[0]?.assetId;
    if (!assetId) return { kind: 'no-asset-id' };

    // 촬영 시각·좌표는 있으면 싣는다. 조회가 실패해도 필수(자산 번호·기기 id)만으로 기록한다.
    const info = await MediaLibrary.getAssetInfoAsync(assetId).catch(
      () => undefined
    );
    const asset: PhotoAssetMeta = {
      localAssetId: assetId,
      deviceId: await getInstallId(),
    };
    if (info?.creationTime) {
      asset.takenAt = new Date(info.creationTime).toISOString();
    }
    if (info?.location) {
      asset.exifLat = info.location.latitude;
      asset.exifLng = info.location.longitude;
    }
    return { kind: 'picked', asset };
  } catch {
    return { kind: 'failed' };
  }
}

export async function resolvePhotoUri(
  localAssetId: string
): Promise<string | null> {
  try {
    const MediaLibrary = loadMediaLibrary();
    const info = await MediaLibrary.getAssetInfoAsync(localAssetId);
    return info?.localUri ?? null;
  } catch {
    return null;
  }
}
