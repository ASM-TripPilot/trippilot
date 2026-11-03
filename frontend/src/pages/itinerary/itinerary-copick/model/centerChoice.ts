import { isAxiosError } from 'axios';

import type { SlotCandidatesRequestCenter } from '@/shared/api/index.schemas';
import type { MapCenter } from '@/shared/map';

/**
 * TRIP-1669 · 같이 짜기 "찾는 중심" — 후보를 어느 지점 주변에서 찾을지 고르는 값(순수).
 *
 * 서버(`SlotCandidatesRequest.center`)가 탐색 중심의 권위다. 이 파일은 사용자의 선택(`CenterSel`)을 요청 모양으로
 * 옮기고, 서버가 "그 중심은 못 쓴다"고 거절했는지(409·400)만 읽는다 — REGION·STAY 의 실제 좌표는 클라가 모르고
 * 짐작해 그리지도 않는다.
 */

export type CenterChoiceKey = 'auto' | 'previous' | 'region' | 'stay' | 'point';

/** 고른 중심. `point` 는 확정한 좌표를 함께 든다(다른 키는 null). */
export interface CenterSel {
  key: CenterChoiceKey;
  point: MapCenter | null;
}

export const AUTO_CENTER: CenterSel = { key: 'auto', point: null };

/**
 * 선택 → 요청 `center`. 자동은 `undefined` 라 호출부가 **키 자체를 안 싣는다**(`null` 로 보내도 서버는 같게 보지만
 * 종전 바디 계약을 지킨다). `lat`·`lng` 는 `POINT` 에만 있다.
 */
export function buildCenter(
  sel: CenterSel
): SlotCandidatesRequestCenter | undefined {
  switch (sel.key) {
    case 'auto':
      return undefined;
    case 'previous':
      return { mode: 'PREVIOUS' };
    case 'region':
      return { mode: 'REGION' };
    case 'stay':
      return { mode: 'STAY' };
    case 'point':
      return sel.point === null
        ? undefined
        : { mode: 'POINT', lat: sel.point.lat, lng: sel.point.lng };
  }
}

// 되돌림 안내 문구 — 정본·Figma 에 없는 발명값이다(6-b 에서 확정). 서버 문장("…다른 기준을 골라 주세요")은
// 이미 자동으로 돌아간 상태와 어긋나서 그대로 쓰지 않는다. 시간·분 표현 없음(INV-3).
const REVERT_NOTICE = {
  REGION: '고른 지역의 중심을 찾지 못해 자동 추천으로 돌아왔어요',
  STAY: '이 날은 등록한 숙소가 없어서 자동 추천으로 돌아왔어요',
  POINT: '찍은 위치를 쓸 수 없어 자동 추천으로 돌아왔어요',
} as const;

// 지도를 열 시작 좌표(원 중심·채우는 슬롯 좌표)가 하나도 없을 때 — 거짓 좌표로 열지 않고 말한다(INV-4).
export const POINT_UNAVAILABLE_NOTICE = '지도를 열 기준 위치를 찾지 못했어요';

/**
 * 중심을 실은 요청이 "그 중심 때문에" 거절됐으면 되돌림 안내 문구를, 아니면 null.
 * REGION·STAY 는 재료(그 날 목적지·숙소)가 없으면 서버가 409 로 막고, POINT 는 좌표가 범위 밖이면 400 이다.
 * PREVIOUS·자동의 실패는 중심 탓이 아니라 종전 오류 경로(`resolveSlotSwapError`)에 맡긴다.
 */
export function centerRejectionNotice(
  mode: 'PREVIOUS' | 'REGION' | 'STAY' | 'POINT',
  error: unknown
): string | null {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if ((mode === 'REGION' || mode === 'STAY') && status === 409) {
    return REVERT_NOTICE[mode];
  }
  if (mode === 'POINT' && status === 400) return REVERT_NOTICE.POINT;
  return null;
}
