import type { CuratedStay } from '@/shared/api/index.schemas';

/**
 * 인기 숙소 `stayId`('TRIPCOM:{hotelId}') → 저장 키(TRIP-1579). 저장 훅(`features/save-stay`)이 받는
 * `{ externalSource, externalId, name }` 모양 그대로다 — 좌표는 계약에 없어 싣지 않는다.
 * **첫 콜론으로만** 가른다(hotelId 쪽 콜론은 externalId 에 남는다). 콜론이 없으면 출처가 빈 문자열이다 —
 * 서버 계약상 일어나지 않는 입력이라 따로 막지 않는다.
 */
export function curatedKey(stay: Pick<CuratedStay, 'stayId' | 'name'>): {
  externalSource: string;
  externalId: string;
  name: string;
} {
  const colon = stay.stayId.indexOf(':');
  return {
    externalSource: colon < 0 ? '' : stay.stayId.slice(0, colon),
    externalId: stay.stayId.slice(colon + 1),
    name: stay.name,
  };
}
