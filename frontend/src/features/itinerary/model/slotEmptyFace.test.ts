import {
  ALL_IN_ITINERARY_HINT,
  ALL_IN_ITINERARY_TITLE,
  resolveSlotEmptyFace,
} from './slotEmptyFace';

/**
 * TRIP-948 — 후보 0건 얼굴을 emptyReason 으로 가른다. 알려진 두 사유 말고는 전부 기존 한 문구로 폴백
 * (빈 화면 금지 · INV-4). 계약이 사유를 더 늘려도 이 함수가 던지지 않는다.
 */
describe('resolveSlotEmptyFace', () => {
  it.each([
    ['NO_NEARBY', 'NO_NEARBY'],
    ['ALL_IN_ITINERARY', 'ALL_IN_ITINERARY'],
    [null, 'FALLBACK'],
    [undefined, 'FALLBACK'],
    ['SOMETHING_NEW', 'FALLBACK'],
    ['', 'FALLBACK'],
    [42, 'FALLBACK'],
  ])('%p → %s', (reason, face) => {
    expect(resolveSlotEmptyFace(reason)).toBe(face);
  });

  it('ALL_IN 문구는 반경 확대를 권하지 않고 INV-3 소요시간이 없다', () => {
    const text = `${ALL_IN_ITINERARY_TITLE} ${ALL_IN_ITINERARY_HINT}`;
    expect(ALL_IN_ITINERARY_TITLE).toBe('근처 후보가 이미 모두 일정에 있어요');
    expect(ALL_IN_ITINERARY_HINT).toBe(
      '반경을 넓혀도 같아요. 다른 슬롯의 장소를 빼면 후보가 생겨요'
    );
    expect(text).not.toMatch(/\d+\s*(분|시간)|소요/);
  });
});
