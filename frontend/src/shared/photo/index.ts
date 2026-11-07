import { getInstallId } from '@/shared/storage/installId';

import { deleteLocalCopies, localCopyUri, moveToLocalCopy } from './localCopy';

/**
 * TRIP-566 · TRIP-1070 · shared/photo — 로컬 앨범 접근·자산 메타 shape 경계(features 무관, record 가 소비).
 *
 * 무엇을 보장하나:
 *  - 자산 메타 shape(`PhotoAssetMeta`) 를 한 곳에서 정의한다 — photoAttach(model)·피커가 함께 문다.
 *    shared 는 features 보다 아래 층이라 여기 두어야 record.model 이 위로 가져다 쓸 수 있다.
 *  - `pickPhotoAssets` 는 앨범에서 최대 `limit` 장을 고르게 하고(TRIP-1797 — 고른 순서대로) 서버로 보낼 **메타만** 뽑는다(파일 본문은 요청하지
 *    않는다 — INV-U5-03). 결과는 일곱 갈래이고 reject 하지 않는다(재빌드 전 앱 = 네이티브 모듈 부재도 failed).
 *  - `resolvePhotoUri` 는 자산 번호로 이 기기 앨범의 파일 주소를 찾는다. 권한을 요청하지 않는다(보기만
 *    하는 화면에서 팝업 금지).
 *  - TRIP-1803 · "선택한 사진만"(limited)이면 피커는 번호를 주지만 고른 사진이 허용 목록 밖이면 앨범 조회가 비어 있다. 그 사진만 고를 때
 *    앱 문서 폴더 사본을 두고(`localCopy.ts`), `resolvePhotoUri` 는 앨범 먼저 → 못 풀고 지금 limited 일 때만 사본 → 그 밖 null 로 답한다
 *    (전체 허용에서 원본을 지운 사진·권한 거부 사진은 사본이 있어도 null — INV-U5-05. 단 limited 에서는 "허용 목록 밖"과
 *    "원본 삭제"를 앱이 구별할 수 없어 지운 사진도 사본으로 보인다).
 *  - 두 모듈은 **호출 시점에 `require`** 한다 — 둘 다 로드 순간 `requireNativeModule` 로 던지므로, 정적
 *    import 면 재빌드 전 빌드가 라우트 평가 때 부팅부터 죽는다(TRIP-1071 shareCapture 와 같은 이유). `import()`
 *    가 아니라 `require` 인 것은 jest node 버킷(vm-modules)에서 `jest.mock` 이 동적 import 에 안 걸려서다
 *    (SettingsPage `loadRouter` 선례). 로드 실패는 아래 try 가 받아 failed/null 로 떨어진다(INV-4).
 *
 * ★ 두 네이티브 사진 모듈을 import 하는 유일한 자리 — `eslintReleaseRules` 탐침이 잠근다(eslint `no-restricted-imports`).
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
  | { kind: 'picked'; assets: PhotoAssetMeta[]; skipped: number }
  | { kind: 'canceled' }
  | { kind: 'denied' }
  | { kind: 'limited' }
  | { kind: 'no-asset-id' }
  | { kind: 'failed' }
  // TRIP-1648 · 웹 — 앨범 자산 번호 모델이 성립하지 않는다(index.web.ts). 네이티브는 이 갈래를 만들지 않는다.
  | { kind: 'unsupported' };

const loadMediaLibrary = () =>
  require('expo-media-library') as typeof import('expo-media-library');

export async function pickPhotoAssets({
  limit,
}: {
  limit: number;
}): Promise<PhotoPickResult> {
  try {
    const MediaLibrary = loadMediaLibrary();
    const ImagePicker =
      require('expo-image-picker') as typeof import('expo-image-picker');
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission?.granted) return { kind: 'denied' };
    // 5.1.1(iii): 사진 고르는 기능에 전체 접근을 요구하지 않는다 — "선택한 사진만"(limited)이어도 피커를 연다.
    // 자산 번호를 못 받으면 아래 no-asset-id 로 떨어진다.
    const limited = permission.accessPrivileges === 'limited';

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: limit,
      orderedSelection: true,
    });
    if (result.canceled) return { kind: 'canceled' };
    // 피커가 한도를 어기고 더 줘도 앞 limit 장까지만(방어). 초과분은 skipped 에 세지 않는다.
    const chosen = result.assets.slice(0, limit);
    // 피커는 권한과 무관하게 번호를 준다. 그래도 번호가 없는 장은 나중에 다시 찾을 길이 없어 뺀다.
    const withId = chosen.filter((a) => !!a.assetId);
    if (withId.length === 0) return { kind: 'no-asset-id' };

    const deviceId = await getInstallId();
    // 촬영 시각·좌표는 있으면 싣는다. 조회가 실패해도 필수(자산 번호·기기 id)만으로 기록한다.
    const assets = await Promise.all(
      withId.map(async (picked): Promise<PhotoAssetMeta> => {
        const assetId = picked.assetId as string;
        const info = await MediaLibrary.getAssetInfoAsync(assetId).catch(
          () => undefined
        );
        // 앨범이 못 푸는 사진(허용 목록 밖)만 — 옮기지 않으면 다시 볼 길이 없다.
        if (limited && !info?.localUri) moveToLocalCopy(assetId, picked.uri);
        const asset: PhotoAssetMeta = { localAssetId: assetId, deviceId };
        if (info?.creationTime) {
          asset.takenAt = new Date(info.creationTime).toISOString();
        }
        if (info?.location) {
          asset.exifLat = info.location.latitude;
          asset.exifLng = info.location.longitude;
        }
        return asset;
      })
    );
    return {
      kind: 'picked',
      assets,
      skipped: chosen.length - withId.length,
    };
  } catch {
    return { kind: 'failed' };
  }
}

/** TRIP-1798 · 이 빌드가 기기 앨범에서 사진 주소를 풀 수 있는가(앱 true · 웹 false — index.web.ts). 앨범 화면 진입 링크의 웹 숨김 판정. */
export function canResolveDevicePhotos(): boolean {
  return true;
}

export async function resolvePhotoUri(
  localAssetId: string
): Promise<string | null> {
  try {
    const MediaLibrary = loadMediaLibrary();
    const info = await MediaLibrary.getAssetInfoAsync(localAssetId).catch(
      () => undefined
    );
    if (info?.localUri) return info.localUri;
    return (await readPhotoAccess()) === 'limited'
      ? localCopyUri(localAssetId)
      : null;
  } catch {
    return null;
  }
}

export type PhotoAccess = 'all' | 'limited' | 'denied';

/** TRIP-1803 · 지금 사진 권한 수준 — 조회만 한다(요청 아님, 팝업 0). 아직 안 물어봄·조회 실패는 all(모르면 [설정 열기]를 내밀지 않는다). */
export async function readPhotoAccess(): Promise<PhotoAccess> {
  try {
    const permission = await loadMediaLibrary().getPermissionsAsync();
    if (permission.accessPrivileges === 'limited') return 'limited';
    return permission.status === 'denied' ? 'denied' : 'all';
  } catch {
    return 'all';
  }
}

/** TRIP-1803 · 기기 안 사진 사본을 비운다(계정 삭제). 던지지 않는다. */
export function deletePhotoCopies(): void {
  deleteLocalCopies();
}
