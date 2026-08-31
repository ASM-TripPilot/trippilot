/**
 * TRIP-566 · AC-3·AC-4 · BR-U5-14/15 · INV-U5-05 · INV-4 — 사진 셀의 표시 상태를 판별한다.
 *
 * 무엇을 보장하나:
 *  - `deviceId` 가 현재 기기와 **다르면** 'other-device'(자산 접근 성공/실패 무관 — 애초에 이 기기에
 *    자산이 없다, BR-U5-15). deviceId 가 assetOk 를 이긴다.
 *  - 같은 기기일 때만 자산 접근 결과로 갈린다: 성공 'available' · 실패 'unavailable'(BR-U5-14/INV-4 —
 *    깨진 썸네일 대신 정직한 사유를 표기하기 위한 판별값).
 *
 * 판별 유니온이라 반환은 정해진 세 문자열 중 하나 — 상위 페이지가 이 값으로 상태별 distinct 셀을 그린다.
 */
export type PhotoAvailability = 'available' | 'other-device' | 'unavailable';

export function photoAvailability(
  photo: { deviceId: string },
  currentDeviceId: string,
  assetOk: boolean
): PhotoAvailability {
  if (photo.deviceId !== currentDeviceId) return 'other-device';
  return assetOk ? 'available' : 'unavailable';
}
