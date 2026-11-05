import fc from 'fast-check';

import {
  MAX_PHOTOS_PER_VISIT,
  MAX_PICK_PER_BATCH,
  remainingPhotoSlots,
} from './visitPhotoLimit';

/**
 * TRIP-1797 · AC2·AC2b·AC2c — 방문 사진 "이번에 고를 수 있는 장수" 산식.
 *
 * 무엇을 보장하나:
 *  - 한 방문에 붙일 수 있는 사진은 최대 30장(`MAX_PHOTOS_PER_VISIT`, 서버 상수의 사본 — openapi 에 수치가 없다),
 *    한 번에 고르는 것은 최대 10장(`MAX_PICK_PER_BATCH`).
 *  - 이번에 고를 수 있는 장수 = `min(10, 30 − 이미 붙은 장수)`, 음수는 0. 장수를 모르면(`null`) 10 으로 열고 서버가 최후 가드다.
 *
 * (개념) PBT = 입력을 무작위로 많이 만들어 "항상 성립해야 하는 성질"을 검사한다. `examples` 는 경계 값을 반드시 포함시키는 장치.
 * 3동작: 준비(현재 장수) → 실행(remainingPhotoSlots) → 단언(남은 칸).
 */
describe('remainingPhotoSlots', () => {
  it('상수는 방문당 30장 · 한 번에 10장이다', () => {
    expect(MAX_PHOTOS_PER_VISIT).toBe(30);
    expect(MAX_PICK_PER_BATCH).toBe(10);
  });

  it.each<[number | null, number]>([
    [null, 10],
    [0, 10],
    [20, 10],
    [21, 9],
    [26, 4],
    [29, 1],
    [30, 0],
    [31, 0],
  ])('현재 %s장이면 이번엔 %s장까지 고른다', (count, expected) => {
    expect(remainingPhotoSlots(count)).toBe(expected);
  });

  it('성질: 항상 0~10 정수이고, 30 이하에서는 붙인 장수와 합쳐 30 을 넘지 않는다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), (count) => {
        const slots = remainingPhotoSlots(count);
        expect(Number.isInteger(slots)).toBe(true);
        expect(slots).toBeGreaterThanOrEqual(0);
        expect(slots).toBeLessThanOrEqual(10);
        if (count <= 30) expect(count + slots).toBeLessThanOrEqual(30);
      }),
      { examples: [[0], [20], [21], [29], [30], [31]] }
    );
  });
});
