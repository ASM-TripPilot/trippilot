/**
 * TRIP-948 · 슬롯 후보 0건 얼굴 판정(BR-U3-24·25 · INV-4). 후보 소비처 두 곳(pages/itinerary-draft 시트 ·
 * pages/itinerary-copick 채우기)이 형제 slice 라 서로 import 할 수 없어 아래 층인 여기에 둔다.
 *
 * 알려진 두 사유만 갈린다. null·미지 값(계약이 사유를 늘려도)은 `FALLBACK` — 호출부가 기존 한 문구를
 * 그린다(빈 화면 금지). 입력을 `unknown` 으로 받는 이유다.
 */
export type SlotEmptyFace = 'NO_NEARBY' | 'ALL_IN_ITINERARY' | 'FALLBACK';

export const ALL_IN_ITINERARY_TITLE = '근처 후보가 이미 모두 일정에 있어요';
export const ALL_IN_ITINERARY_HINT =
  '반경을 넓혀도 같아요. 다른 슬롯의 장소를 빼면 후보가 생겨요';

export function resolveSlotEmptyFace(reason: unknown): SlotEmptyFace {
  if (reason === 'NO_NEARBY') return 'NO_NEARBY';
  if (reason === 'ALL_IN_ITINERARY') return 'ALL_IN_ITINERARY';
  return 'FALLBACK';
}
