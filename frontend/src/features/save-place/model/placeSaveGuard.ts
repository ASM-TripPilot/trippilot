/**
 * 담기 전 방어(좌표)와 담기 실패 안내(4갈래 전수) — 01b Seed Q12 · AC-14 · AC-G6 · BR-U1-02.
 *
 * `hasUsableCoords`는 계약(`Place.lat`·`lng` required·non-nullable)이 만들 수 없는 입력까지
 * 정직하게 받도록 파라미터 타입을 넓힌다 — 그래서 US-EXPL-04 예외 AC는 이 리포 계약에서는
 * "발생 불가"로 남고, 이 함수가 그 방어 코드의 유일한 심판이다(BR-U1-02는 UX 사본, 정본은 서버).
 *
 * `SAVE_FAILURE_NOTICE`는 `Record<SavedPlacesFailureReason, …>`라서 `useSavedPlaces`의 실패
 * 갈래가 늘면 tsc가 먼저 깨진다 — 침묵 실패를 타입 수준에서 막는다(INV-4).
 */
import type { SavedPlacesFailureReason } from './savedPlaces';

export interface PlaceSaveNotice {
  message: string;
  action: 'retry' | 'login' | null;
}

export function hasUsableCoords(coords: {
  lat?: number | null;
  lng?: number | null;
}): boolean {
  const { lat, lng } = coords;
  // NaN·±Infinity는 별도 유한성 검사 없이도 범위 비교에서 이미 걸러진다 — `NaN <= 90`과
  // `Infinity <= 90`은 둘 다 false다(TRIP-222 03b N-2, 뮤테이션 실측: Number.isFinite를
  // 지워도 placeSaveGuard.test.ts 18/18 green).
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export const SAVE_FAILURE_NOTICE: Record<
  SavedPlacesFailureReason,
  PlaceSaveNotice
> = {
  unauthenticated: {
    message: '로그인하면 마음에 든 장소를 담을 수 있어요',
    action: 'login',
  },
  'saved-id-unknown': {
    message: '담기 처리 중이에요. 잠시 후 다시 시도해 주세요',
    action: null,
  },
  // 계약은 404 하나로 "POI 없음"과 "비-ACTIVE"를 준다 — 원인을 지어내지 않는다(INV-1 · AC-G6).
  'not-found': {
    message: '지금은 담을 수 없는 장소예요',
    action: null,
  },
  network: {
    message: '연결이 불안정해 담지 못했어요',
    action: 'retry',
  },
};

/** 좌표 방어가 발동했을 때의 안내 — 계약상 발동 불가(미충족 기록 대상, 01b Seed Q12). */
export const COORD_BLOCKED_NOTICE: PlaceSaveNotice = {
  message: '위치를 확인할 수 없어 담을 수 없어요',
  action: null,
};

/**
 * 해제(d02) 실패 4갈래 — TRIP-223. `SAVE_FAILURE_NOTICE`는 전부 **담기** 기준 문구라
 * ("지금은 담을 수 없는 장소예요" 등) 해제 화면에 그대로 쓰면 사용자가 "담기에 실패했다"로
 * 읽는다(INV-4). `not-found`는 계약이 404 하나로 "없음"·"타 계정"을 묶어 주므로 원인을
 * 단정하지 않는다(AC-G6 계승).
 */
export const REMOVE_FAILURE_NOTICE: Record<
  SavedPlacesFailureReason,
  PlaceSaveNotice
> = {
  unauthenticated: {
    message: '로그인이 풀렸어요. 다시 로그인해 주세요',
    action: 'login',
  },
  'saved-id-unknown': {
    message: '담기 처리 중이에요. 잠시 후 다시 시도해 주세요',
    action: null,
  },
  'not-found': {
    message: '지금은 해제할 수 없는 장소예요',
    action: null,
  },
  network: {
    message: '연결이 불안정해 해제하지 못했어요',
    action: 'retry',
  },
};
