import fc from 'fast-check';

import { slotFaceLine } from './cardModel';

/**
 * TRIP-1320 · PBT-U8-8(FE 몫) — 카드 렌더 모델은 서버 문자열을 이어 붙이기만 한다.
 * 소요시간 문구를 스스로 만들지 않고(INV-3), 시각·거리 문자열은 그대로 실린다(INV-2).
 */

const clean = fc.string().filter((s) => !/분|소요|duration/i.test(s));

describe('slotFaceLine (TRIP-1320)', () => {
  it('시각·이름·거리를 그대로 싣고 소요시간 문구를 만들지 않는다', () => {
    fc.assert(
      fc.property(
        clean,
        clean,
        fc.option(clean, { nil: null }),
        (startAt, name, distanceRange) => {
          const line = slotFaceLine({ startAt, name, distanceRange });
          expect(line).not.toMatch(/분|소요|duration/i);
          expect(line).toContain(startAt);
          expect(line).toContain(name);
          if (distanceRange) expect(line).toContain(distanceRange);
        }
      )
    );
  });

  it('b02 모양 — "14:00 책방카페 · 이동 630m", 거리 없으면 거리 줄 없음', () => {
    expect(
      slotFaceLine({
        startAt: '14:00',
        name: '책방카페',
        distanceRange: '630m',
      })
    ).toBe('14:00 책방카페 · 이동 630m');
    expect(slotFaceLine({ startAt: '14:00', name: '책방카페' })).toBe(
      '14:00 책방카페'
    );
  });
});
