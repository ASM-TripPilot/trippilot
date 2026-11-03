import fc from 'fast-check';

import { sortSlotsByStartAt } from './sortSlotsByStartAt';

/**
 * TRIP-1674 · `sortSlotsByStartAt` — 어떤 입력에서도 지키는 성질.
 *
 * > *(개념)* **속성 테스트** = 예시 몇 개가 아니라 무작위 입력 수백 개에 "항상 맞는 성질"을 검사한다.
 * > 기대식은 구현(문자열 비교)을 베끼지 않고 **초 단위 숫자 환산**으로 따로 적었다.
 *
 * 무엇을 보장하나(정렬 규칙 ①~⑤ 가 입력이 어떻든 성립):
 *  P1 시각 있는 원소는 시작 시각이 비내림차순 · P2 null 이던 자리는 같은 객체가 그대로
 *  P3 같은 시각끼리 입력 순서 유지 · P4 원소 구성 보존(없어지거나 늘지 않음)
 *  P5 멱등(두 번 해도 같다) · P6 입력 배열 불변.
 *
 * 생성기의 시각 풀은 6개뿐이라 같은 시각(동점)·초만 다른 시각(09:30:00/09:30:30)·자정 넘김 후보
 * (23:15/00:45)가 자주 나온다.
 */

const TIME_POOL = [
  '00:45:00',
  '09:30:00',
  '09:30:30',
  '11:00:00',
  '13:00:00',
  '23:15:00',
] as const;

interface Item {
  id: number;
  startAt: string | null;
}

const toSeconds = (hhmmss: string): number => {
  const [h, m, sec] = hhmmss.split(':').map(Number);
  return h * 3600 + m * 60 + sec;
};

const itemsArb = fc
  .array(fc.constantFrom<string | null>(null, ...TIME_POOL), {
    maxLength: 12,
  })
  .map((startAts): Item[] => startAts.map((startAt, id) => ({ id, startAt })));

// 동점·null·초 차이를 한꺼번에 가진 입력 하나는 확률에 맡기지 않고 박아 둔다.
const PINNED: [Item[]][] = [
  [
    [
      { id: 0, startAt: '09:30:30' },
      { id: 1, startAt: null },
      { id: 2, startAt: '09:30:00' },
      { id: 3, startAt: '09:30:30' },
      { id: 4, startAt: '00:45:00' },
    ],
  ],
];

const run = (prop: (items: Item[]) => void): void =>
  fc.assert(fc.property(itemsArb, prop), { examples: PINNED });

describe('sortSlotsByStartAt — 성질', () => {
  it('P1 시각 있는 원소의 시작 시각(초 환산)은 비내림차순이다', () => {
    run((items) => {
      const seconds = sortSlotsByStartAt(items)
        .filter((one) => one.startAt !== null)
        .map((one) => toSeconds(one.startAt as string));
      expect(seconds).toEqual([...seconds].sort((x, y) => x - y));
    });
  });

  it('P2 null 이던 자리에는 같은 원소가 그대로 있다', () => {
    run((items) => {
      const sorted = sortSlotsByStartAt(items);
      items.forEach((one, index) => {
        if (one.startAt === null) expect(sorted[index]).toBe(one);
      });
    });
  });

  it('P3 같은 시작 시각끼리는 입력 순서(id 오름차순)가 유지된다', () => {
    run((items) => {
      const sorted = sortSlotsByStartAt(items).filter(
        (one) => one.startAt !== null
      );
      sorted.forEach((one, index) => {
        const next = sorted[index + 1];
        if (next && next.startAt === one.startAt)
          expect(one.id).toBeLessThan(next.id);
      });
    });
  });

  it('P4 원소 구성이 보존된다(없어지거나 늘지 않는다)', () => {
    run((items) => {
      const ids = sortSlotsByStartAt(items)
        .map((one) => one.id)
        .sort((x, y) => x - y);
      expect(ids).toEqual(items.map((one) => one.id));
    });
  });

  it('P5 멱등 — 한 번 정렬한 열을 다시 정렬해도 같다', () => {
    run((items) => {
      const once = sortSlotsByStartAt(items);
      expect(sortSlotsByStartAt(once)).toEqual(once);
    });
  });

  it('P6 입력 배열은 바뀌지 않는다', () => {
    run((items) => {
      const snapshot = items.map((one) => ({ ...one }));
      sortSlotsByStartAt(items);
      expect(items).toEqual(snapshot);
    });
  });
});
