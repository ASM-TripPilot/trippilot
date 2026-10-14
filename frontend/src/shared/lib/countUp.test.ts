import fc from 'fast-check';

import {
  countUpInt,
  countUpText,
  easeOutCubic,
  isCountable,
} from '@/shared/lib/countUp';

/** TRIP-1386 · 카운트업 순수 계산 성질 테스트(PBT 게이트). */

const progressArb = fc.double({ min: 0, max: 1, noNaN: true });

describe('easeOutCubic', () => {
  it('0 에서 0, 1 에서 1, 그 사이는 단조 증가', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    fc.assert(
      fc.property(progressArb, progressArb, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return easeOutCubic(lo) <= easeOutCubic(hi);
      })
    );
  });
});

describe('countUpInt', () => {
  it('중간값은 0 이상 목표값 이하 정수, 진행률 1 에서 목표값', () => {
    fc.assert(
      fc.property(fc.nat(100000), progressArb, (target, p) => {
        const v = countUpInt(target, p);
        return Number.isInteger(v) && v >= 0 && v <= target;
      })
    );
    fc.assert(
      fc.property(fc.nat(100000), (target) => countUpInt(target, 1) === target)
    );
  });

  it('진행률이 오르면 값은 줄지 않는다', () => {
    fc.assert(
      fc.property(fc.nat(100000), progressArb, progressArb, (t, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return countUpInt(t, lo) <= countUpInt(t, hi);
      })
    );
  });
});

describe('countUpText', () => {
  // formatKm 모양: 0.1 단위, 끝 .0 없음(예: 38km · 1.9km)
  const kmArb = fc.integer({ min: 1, max: 99999 }).map((n) => `${n / 10}km`);

  it('진행률 1 에서는 입력 문자열 그대로(INV-2)', () => {
    fc.assert(fc.property(kmArb, (t) => countUpText(t, 1) === t));
    expect(countUpText('12', 1)).toBe('12');
  });

  it('중간값도 같은 형식 — 숫자 + 같은 접미사, 값은 목표 이하·단조 증가', () => {
    fc.assert(
      fc.property(kmArb, progressArb, progressArb, (t, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const re = /^(\d+(?:\.\d)?)km$/;
        const mx = re.exec(countUpText(t, lo));
        const my = re.exec(countUpText(t, hi));
        return (
          mx !== null &&
          my !== null &&
          Number(mx[1]) <= Number(my[1]) &&
          Number(my[1]) <= Number(t.replace('km', ''))
        );
      })
    );
  });

  it('정수 목표는 소수점 없이 오른다(38km → 정수km)', () => {
    for (const p of [0, 0.1, 0.4, 0.9]) {
      expect(countUpText('38km', p)).toMatch(/^\d+km$/);
    }
    expect(countUpText('38km', 0)).toBe('0km');
  });

  it('숫자가 아니거나 0 이면 지어내지 않고 그대로', () => {
    expect(countUpText('—', 0.3)).toBe('—');
    expect(countUpText('0', 0.3)).toBe('0');
    expect(countUpText('0km', 0.3)).toBe('0km');
    expect(isCountable('—')).toBe(false);
    expect(isCountable('0')).toBe(false);
    expect(isCountable('12')).toBe(true);
    expect(isCountable('38.4km')).toBe(true);
  });
});
