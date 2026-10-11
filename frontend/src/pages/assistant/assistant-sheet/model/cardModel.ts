import type { ProposalSlotFace } from '../api/assistantContract';

/**
 * 카드 렌더 모델(TRIP-1320 · PBT-U8-8 FE 몫). 서버 문자열을 이어 붙이기만 한다 — 시각·거리를 계산하거나
 * 소요시간 문구를 만들지 않는다(INV-2·3, BR-U8-35). 이동은 거리만(`이동 630m`, b02).
 */
export function slotFaceLine(face: ProposalSlotFace): string {
  const head = `${face.startAt} ${face.name}`;
  return face.distanceRange ? `${head} · 이동 ${face.distanceRange}` : head;
}
