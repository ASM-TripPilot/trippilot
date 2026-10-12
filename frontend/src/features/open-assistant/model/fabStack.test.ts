import fc from 'fast-check';

import {
  ASSISTANT_FAB_SIZE,
  FAB_STACK_GAP,
  TAB_FAB_BASE,
  assistantFabBottom,
  stackTop,
  toastBottomWith,
} from './fabStack';

/**
 * TRIP-1320 · PBT-U8-F1(차단 게이트) — 임의의 스택 구성(0~2단)·화면 바닥에 대해
 * ✦ 바닥 ≥ 기존 스택 윗변 + 12, 토스트 바닥 ≥ ✦ 윗변 + 12 (business-rules.md BR-U8-50~52).
 * jest 는 실제 겹침을 못 본다 — 숫자 계약만 여기서 굳히고 화면 겹침은 6-b 실기.
 */

const stackArb = fc.record({
  base: fc.integer({ min: 0, max: 400 }),
  count: fc.integer({ min: 0, max: 2 }),
});

describe('fabStack (TRIP-1320 · PBT-U8-F1)', () => {
  it('✦ 는 기존 스택 윗변보다 12 이상 위, 토스트는 ✦ 윗변보다 12 이상 위', () => {
    fc.assert(
      fc.property(stackArb, (stack) => {
        const fab = assistantFabBottom(stack);
        const toast = toastBottomWith(stack);
        if (stack.count > 0) {
          expect(fab).toBeGreaterThanOrEqual(stackTop(stack) + FAB_STACK_GAP);
        } else {
          expect(fab).toBeGreaterThanOrEqual(stack.base);
        }
        expect(toast).toBeGreaterThanOrEqual(
          fab + ASSISTANT_FAB_SIZE + FAB_STACK_GAP
        );
      }),
      {
        examples: [
          [{ base: TAB_FAB_BASE, count: 2 }],
          [{ base: TAB_FAB_BASE, count: 1 }],
          [{ base: 0, count: 0 }],
        ],
      }
    );
  });

  it('탭 화면 2단 스택(홈·숙소 검색)은 ✦ 220 · 토스트 288 (FD §5 표)', () => {
    expect(stackTop({ base: TAB_FAB_BASE, count: 2 })).toBe(208);
    expect(assistantFabBottom({ base: TAB_FAB_BASE, count: 2 })).toBe(220);
    expect(toastBottomWith({ base: TAB_FAB_BASE, count: 2 })).toBe(288);
  });

  it('1단 스택이면 ✦ 152, 스택이 없으면 바닥 그대로', () => {
    expect(assistantFabBottom({ base: TAB_FAB_BASE, count: 1 })).toBe(152);
    expect(assistantFabBottom({ base: 40, count: 0 })).toBe(40);
  });
});
