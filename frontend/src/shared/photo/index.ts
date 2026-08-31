/**
 * TRIP-566 · shared/photo — 로컬 앨범 접근·자산 메타 shape 경계(features 무관, record 가 소비).
 *
 * 무엇을 보장하나:
 *  - 자산 메타 shape(`PhotoAssetMeta`) 를 한 곳에서 정의한다 — photoAttach(model)·미래 피커가 함께 문다.
 *    shared 는 features 보다 아래 층이라 여기 두어야 record.model 이 위로 가져다 쓸 수 있다.
 *  - 피커 어댑터는 지금 **degrade 스텁**(`armed:false`) — 네이티브 피커를 실제로 띄우지 않는다.
 *
 * ★ 네이티브 미설치 경계: 이 파일은 네이티브 사진 모듈을 import 하지 않는다(순수 유지 — 하면 tsc/jest
 *   가 깨진다). 그 잠금은 recordPhotoBinaryGuard 가 소스 스캔으로 담당한다.
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

/** 피커 발화 결과 — 지금은 미장전(degrade). 후속 티켓이 armed:true(선택된 자산) 분기를 넓힌다. */
export type PhotoPickResult = { armed: false };

/**
 * ponytail: 네이티브 피커 degrade 스텁 — 미설치 모듈을 안 물고 항상 armed:false 를 돌려준다.
 *   실 피커(로컬 앨범 launch → PhotoAssetMeta 추출 → localAssetId→URI 해상 → EXIF 추출)는 네이티브
 *   리빌드(prebuild/run) 동반 후속 티켓 몫(geofence.ts·dwellMinutes.ts TRIP-396 선례).
 */
export function pickPhotoAsset(): PhotoPickResult {
  return { armed: false };
}
