import fc from 'fast-check';

import type { CompanionType } from '@/shared/api/index.schemas';

import { clampParty, partyRangeFor } from './partyRange';

/**
 * TRIP-1787 · 위저드 `TripNewStep1Page.pickCompanion` 안에 있던 "칩을 고르면 인원을 그 유형의 범위 안으로 맞춘다"를
 * 위젯(`widgets/trip-edit-sheets`)으로 올린 순수 함수 `clampParty(type, party)` 의 잠금. 위저드와 여행 설정 화면이 같은 함수를
 * 써야 인원 규칙(TRIP-1423 Q-059 — 혼자 1 · 연인 2 고정, 친구·가족 2 이상)이 두 벌로 갈라지지 않는다.
 * `partyRangeFor` 는 옮겨 오기만 했으므로 표 한 번만 다시 잠근다(내용 불변).
 *
 * 3동작: 준비(유형·현재 인원) → 실행(clampParty) → 단언(범위 안으로 옮겨진 인원).
 */

const TYPES: (CompanionType | undefined)[] = [
  '혼자',
  '친구',
  '연인',
  '가족',
  undefined,
];

describe('partyRangeFor — 이동만(내용 불변)', () => {
  it.each([
    ['혼자', 1, 1],
    ['연인', 2, 2],
    ['친구', 2, Infinity],
    ['가족', 2, Infinity],
    [undefined, 1, Infinity],
  ] as const)('%s → [%s, %s]', (type, min, max) => {
    expect(partyRangeFor(type)).toEqual({ min, max });
  });
});

describe('clampParty — 예시', () => {
  it.each([
    // [유형, 현재 인원, 기대 인원]
    ['혼자', 3, 1],
    ['혼자', 1, 1],
    ['연인', 1, 2],
    ['연인', 5, 2],
    ['친구', 1, 2],
    ['친구', 7, 7],
    ['가족', 1, 2],
    ['가족', 2, 2],
    [undefined, 4, 4],
    [undefined, 0, 1],
  ] as const)('%s · %s명 → %s명', (type, party, expected) => {
    expect(clampParty(type, party)).toBe(expected);
  });
});

describe('clampParty — 속성(PBT)', () => {
  const typeArb = fc.constantFrom(...TYPES);
  const partyArb = fc.integer({ min: 0, max: 30 });

  it('결과는 항상 그 유형의 범위 안이다', () => {
    fc.assert(
      fc.property(typeArb, partyArb, (type, party) => {
        const { min, max } = partyRangeFor(type);
        const out = clampParty(type, party);
        expect(out).toBeGreaterThanOrEqual(min);
        expect(out).toBeLessThanOrEqual(max);
      })
    );
  });

  it('이미 범위 안인 인원은 그대로 둔다', () => {
    fc.assert(
      fc.property(typeArb, partyArb, (type, party) => {
        const { min, max } = partyRangeFor(type);
        fc.pre(party >= min && party <= max);
        expect(clampParty(type, party)).toBe(party);
      })
    );
  });

  it('두 번 적용해도 한 번과 같다(멱등)', () => {
    fc.assert(
      fc.property(typeArb, partyArb, (type, party) => {
        const once = clampParty(type, party);
        expect(clampParty(type, once)).toBe(once);
      })
    );
  });
});
