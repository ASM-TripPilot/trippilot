import { useGetMeLocationConsent } from '@/shared/api/generated/location/location';
import { readDevicePosition } from '@/shared/location/readDevicePosition';

import { buildGpsOrigin, type ReplanOrigin } from './replanOrigin';

/**
 * TRIP-979 · 재계획 요청 직전 GPS origin 을 1회 읽는 seam(동의 GET + 단말 권한 + 측위).
 *
 * 돌려주는 함수는 **reject 하지 않는다**. 성공이면 `buildGpsOrigin` 조각, 동의 OFF·미도착·오류·
 * 권한 없음·측위 실패·5초 초과면 `undefined`(= 빌더가 originKind:null 로 싣는다, BR-U4-19).
 * 서버 미러(`osPermissionMirror`)는 낡을 수 있어 보지 않는다 — 단말 실권한은 readDevicePosition 이 본다.
 */
export type ReadReplanGpsOrigin = () => Promise<ReplanOrigin | undefined>;

export function useReplanGpsOrigin(): ReadReplanGpsOrigin {
  const consentOn = useGetMeLocationConsent().data?.legalConsent === true;
  // 렌더마다 새 함수 — 호출부가 최신 렌더의 함수를 부르므로 늦게 도착한 동의도 반영된다.
  return async () => {
    if (!consentOn) return undefined;
    const coords = await readDevicePosition();
    return coords ? buildGpsOrigin(coords) : undefined;
  };
}
