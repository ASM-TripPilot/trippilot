import fc from 'fast-check';

import { resolveToastBottom } from './toastBottom';

/**
 * TRIP-1559 · T1(속성) — `resolveToastBottom(등록[], 하단인셋)` 이 어떤 입력에서도 지키는 것.
 *
 * *(개념)* 속성 테스트 = 예시 몇 개가 아니라 무작위 입력 수백 개에 같은 규칙이 맞는지 보는 테스트.
 * 기대식은 구현과 다른 모양으로 적는다(`max` 를 두 번 써서 같은 식을 베끼지 않는다).
 *
 * 무엇을 보장하나(P1~P6): 비면 인셋+16 · 안전영역 바닥 아래로 안 내려감 · 등록이 있으면 max+12 와 바닥 중 큰 쪽 ·
 * 순서·중복 무관 · 등록을 더해도 낮아지지 않음(=T1 "등록이 있으면 없을 때보다 작지 않다").
 */

const heights = fc.array(fc.integer({ min: 0, max: 2000 }), {
  minLength: 1,
  maxLength: 8,
});
const insets = fc.integer({ min: 0, max: 120 });

describe('resolveToastBottom — 성질', () => {
  it('P1 등록이 없으면 인셋+16 이다', () => {
    fc.assert(
      fc.property(insets, (inset) => {
        expect(resolveToastBottom([], inset)).toBe(inset + 16);
      })
    );
  });

  it('P2 등록이 있으면 (최댓값+12) 와 (인셋+16) 중 큰 쪽이다', () => {
    fc.assert(
      fc.property(heights, insets, (registered, inset) => {
        const tallest = [...registered].sort((a, b) => b - a)[0];
        const expected = tallest + 12 >= inset + 16 ? tallest + 12 : inset + 16;
        expect(resolveToastBottom(registered, inset)).toBe(expected);
      })
    );
  });

  it('P3 어떤 입력에서도 안전영역 바닥(인셋+16) 아래로 내려가지 않는다', () => {
    fc.assert(
      fc.property(
        fc.oneof(heights, fc.constant([])),
        insets,
        (registered, inset) => {
          expect(resolveToastBottom(registered, inset)).toBeGreaterThanOrEqual(
            inset + 16
          );
        }
      )
    );
  });

  it('P4 등록 순서와 중복은 결과에 영향이 없다', () => {
    fc.assert(
      fc.property(heights, insets, (registered, inset) => {
        const reversed = [...registered].reverse();
        const doubled = [...registered, ...registered];
        const base = resolveToastBottom(registered, inset);
        expect(resolveToastBottom(reversed, inset)).toBe(base);
        expect(resolveToastBottom(doubled, inset)).toBe(base);
      })
    );
  });

  it('P5 등록을 하나 더해도 결과는 낮아지지 않는다', () => {
    fc.assert(
      fc.property(
        fc.oneof(heights, fc.constant([])),
        fc.integer({ min: 0, max: 2000 }),
        insets,
        (registered, extra, inset) => {
          expect(
            resolveToastBottom([...registered, extra], inset)
          ).toBeGreaterThanOrEqual(resolveToastBottom(registered, inset));
        }
      )
    );
  });

  it('P6 받은 배열을 바꾸지 않는다', () => {
    fc.assert(
      fc.property(heights, insets, (registered, inset) => {
        const copy = [...registered];
        resolveToastBottom(registered, inset);
        expect(registered).toEqual(copy);
      })
    );
  });
});
