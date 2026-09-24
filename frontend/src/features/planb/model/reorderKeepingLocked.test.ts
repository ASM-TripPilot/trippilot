import fc from 'fast-check';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { reorderKeepingLocked } from './reorderKeepingLocked';

/**
 * TRIP-753 · AC-8 — 여행 중 편집(i07)의 재정렬 규칙. 끌어서 순서를 바꿔도 **방문 완료 행과 고정 행은
 * 원래 자리(절대 index)에 남고**, 나머지 칸만 끌기 결과의 순서로 채운다(INV-U3-02 배열 순서 = 슬롯 순서).
 *
 * 옛 `reorderKeepingFixed` 는 `isFixed` 만 봤다(layer-widgets.md 가 적은 맹점) — 완료 행을 끌어 옮기면
 * 이미 다녀온 곳이 아직 안 간 곳 뒤로 밀린 채 저장됐다. 이 규칙은 잠금 목록을 함께 받는다.
 *
 * 3동작: 준비(원래 순서 + 끌기 결과 + 잠금 목록) → 실행(규칙 적용) → 단언(결과 poiId 순서·성질).
 */

type Slot = ItineraryDaysItemSlotsItem;

function slot(poiId: string, isFixed = false): Slot {
  return {
    poiId,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
  };
}

function ids(slots: Slot[]): string[] {
  return slots.map((s) => s.poiId);
}

function pick(pool: Slot[], order: string[]): Slot[] {
  return order.map((id) => pool.find((s) => s.poiId === id) as Slot);
}

describe('🔴 K1 · 예시 — 잠긴 행(완료·고정)은 제자리, 나머지는 끌기 순서', () => {
  const A = slot('A');
  const B = slot('B');
  const C = slot('C');
  const D = slot('D');
  const E = slot('E');
  const Efix = slot('E', true);

  it.each([
    {
      name: '브리프 예시 — 완료 A·B 를 끌어도 앞 두 칸에 남는다',
      original: [A, B, C, D, E],
      dragged: ['C', 'A', 'E', 'B', 'D'],
      locked: ['A', 'B'],
      expected: ['A', 'B', 'C', 'E', 'D'],
    },
    {
      name: '잠금·고정이 없으면 끌기 결과 그대로다',
      original: [A, B, C, D, E],
      dragged: ['E', 'D', 'C', 'B', 'A'],
      locked: [],
      expected: ['E', 'D', 'C', 'B', 'A'],
    },
    {
      name: '고정(isFixed) 행도 잠긴 행처럼 제자리다 — 잠금 목록에 없어도',
      original: [A, B, C, D, Efix],
      dragged: ['E', 'D', 'A', 'C', 'B'],
      locked: ['A'],
      expected: ['A', 'D', 'C', 'B', 'E'],
    },
    {
      name: '완료 행을 맨 뒤로 끌어도 원래 index 로 돌아온다',
      original: [A, B, C, D, E],
      dragged: ['B', 'C', 'D', 'E', 'A'],
      locked: ['A'],
      expected: ['A', 'B', 'C', 'D', 'E'],
    },
  ])('$name', ({ original, dragged, locked, expected }) => {
    const result: Slot[] = reorderKeepingLocked(
      original,
      pick(original, dragged),
      locked
    );

    expect(ids(result)).toEqual(expected);
  });
});

describe('🔴 K2 · 비파괴 — 입력 배열을 바꾸지 않는다', () => {
  it('규칙을 적용한 뒤에도 original·끌기 결과 배열의 순서가 그대로다', () => {
    const original = [slot('A'), slot('B'), slot('C')];
    const dragged = [original[2], original[0], original[1]];

    reorderKeepingLocked(original, dragged, ['A']);

    expect(ids(original)).toEqual(['A', 'B', 'C']);
    expect(ids(dragged)).toEqual(['C', 'A', 'B']);
  });
});

describe('🔴 K3 · PBT — 임의 순열에서도 세 성질이 늘 성립한다', () => {
  // 슬롯 수 n 과 행마다 (잠금, 고정) 플래그를 뽑고, 끌기 결과는 원본의 임의 순열로 만든다.
  const scenario = fc
    .array(fc.record({ locked: fc.boolean(), fixed: fc.boolean() }), {
      minLength: 0,
      maxLength: 8,
    })
    .chain((flags) => {
      const original = flags.map((f, i) => slot(`p${i}`, f.fixed));
      return fc.record({
        flags: fc.constant(flags),
        original: fc.constant(original),
        dragged: fc.shuffledSubarray(original, {
          minLength: original.length,
          maxLength: original.length,
        }),
      });
    });

  it('잠긴 행 index 불변 · 결과는 원본의 순열 · 안 잠긴 행은 끌기 순서를 따른다', () => {
    fc.assert(
      fc.property(scenario, ({ flags, original, dragged }) => {
        const lockedIds = original
          .filter((_, i) => flags[i].locked)
          .map((s) => s.poiId);
        const isPinned = (s: Slot): boolean =>
          s.isFixed || lockedIds.includes(s.poiId);

        const result: Slot[] = reorderKeepingLocked(
          original,
          dragged,
          lockedIds
        );

        // ① 잠긴 행(완료·고정)은 원래 index 에 그대로 있다.
        original.forEach((s, i) => {
          if (isPinned(s)) expect(result[i].poiId).toBe(s.poiId);
        });
        // ② 결과는 원본 poiId 의 순열이다(빠지거나 겹치는 행 없음).
        expect([...ids(result)].sort()).toEqual([...ids(original)].sort());
        // ③ 안 잠긴 행끼리의 상대 순서 = 끌기 결과에서의 상대 순서.
        expect(ids(result.filter((s) => !isPinned(s)))).toEqual(
          ids(dragged.filter((s) => !isPinned(s)))
        );
      })
    );
  });
});
