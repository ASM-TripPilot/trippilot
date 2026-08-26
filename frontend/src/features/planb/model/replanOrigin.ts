import type { StartReplanRequestOriginKind } from '@/shared/api/generated/schemas/startReplanRequestOriginKind';

/**
 * TRIP-442 · 순수 origin 조각 — `buildStartReplanRequest` 에 **additive** 로 실린다.
 *
 * `buildStartReplanRequest(form, origin?)` 의 두 번째 인자 타입. 미제공(undefined)이면 빌더가
 * 기존과 바이트 동일하게 `originKind: null`(lat/lng 키 없음)을 싣는다(BR-U4-19, 서버 사다리 위임).
 * MANUAL 핀이면 `originKind:'MANUAL'` + 좌표.
 *
 * ⚠️ test-designer 스텁 — 아래 두 함수 몸통은 red 유도용이다. 구현자가 채운다(03 구현).
 */
export interface ReplanOrigin {
  originKind: StartReplanRequestOriginKind;
  originLat?: number;
  originLng?: number;
}

/** MANUAL 핀 좌표 → origin 조각. `originKind:'MANUAL'` + 좌표만(정확히 3키) — 빌더가 이걸
 * additive 로 봉투에 싣는다. 좌표를 새 이름으로 옮기기만 하는 순수 조립이다. */
export function buildManualOrigin(coords: {
  lat: number;
  lng: number;
}): ReplanOrigin {
  return { originKind: 'MANUAL', originLat: coords.lat, originLng: coords.lng };
}

/** "(추정)" 표기 판정 — GPS 만 실측, 그 외(MANUAL·LAST_VISIT·STAY_ANCHOR·null)는 추정.
 * 세션 originEstimated 되읽기 금지, originKind 로 로컬 즉시 도출한다(BR-U4-19, Seed 결정). */
export function isEstimatedOrigin(
  originKind: StartReplanRequestOriginKind
): boolean {
  return originKind !== 'GPS';
}
