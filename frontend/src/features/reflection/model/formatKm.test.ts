import fc from 'fast-check';

import { formatKm } from './formatKm';

/**
 * TRIP-1086 · formatKm — 회고 화면의 이동 거리(km, 서버 double)를 표시 문자열로 바꾼다.
 *
 * 무엇을 보장하나:
 *  - 0.1 단위 반올림(사람이 쓴 10진 기준 half-up: 0.15 → 0.2), 끝 `.0` 은 생략(12 → '12km').
 *  - 50m 미만(0 < d < 0.05)은 '0km'(01b 판단 1). "측정 못 함 '—'" 판정은 이 함수 밖(호출부)이 먼저 한다.
 *  - 출력은 거리 단위뿐 — 소요시간 표기 없음(INV-3).
 *
 * 왜 이렇게 테스트하나(02a §4-★1·★2):
 *  - `toFixed(1)` 은 0.15(실제 저장값 0.1499…)를 '0.1' 로 내려 결정 1 과 다르다 → 경계 예제에 0.15·0.35·0.95·1.15.
 *  - PBT 기대값을 구현과 같은 식으로 계산하면 무엇이든 통과한다 → 성질(형식·오차·순서)만 보거나,
 *    정수 산술로 만든 10진 문자열을 기대값으로 쓴다.
 *
 * (개념) `fc.assert(fc.property(생성기, 검사))` = 생성기가 만든 입력 여러 개로 검사를 반복한다.
 */

/** 정수 k 를 "k/10" 의 10진 문자열로 — 부동소수 연산 없이 만든다(12 → '1.2', 120 → '12'). */
function decimalOfTenths(k: number): string {
  const whole = Math.floor(k / 10);
  const tenth = k % 10;
  return tenth === 0 ? String(whole) : `${whole}.${tenth}`;
}

/** 'Nkm' 의 숫자 부분. */
function numberPart(text: string): number {
  return Number(text.slice(0, -'km'.length));
}

const distanceArb = fc.double({ min: 0, max: 10000, noNaN: true });

describe('AC-4 · 경계 예제 — 0.1 단위 half-up, 끝 .0 생략', () => {
  it.each([
    [0, '0km'],
    [0.04, '0km'],
    [0.05, '0.1km'],
    [0.15, '0.2km'],
    [0.35, '0.4km'],
    [0.4, '0.4km'],
    [0.95, '1km'],
    [1.15, '1.2km'],
    [1.25, '1.3km'],
    [1.9294588176597474, '1.9km'],
    [12, '12km'],
    [38, '38km'],
    [99.95, '100km'],
  ])('%p → %p', (km, expected) => {
    expect(formatKm(km)).toBe(expected);
  });
});

describe('AC-5 · 속성(PBT) — 0 ~ 10,000km', () => {
  it('형식: 정수 또는 소수 1자리(끝 0 없음) + km, 소요시간 표기 없음(INV-3)', () => {
    fc.assert(
      fc.property(distanceArb, (km) => {
        const text = formatKm(km);

        expect(text).toMatch(/^(0|[1-9]\d*)(\.[1-9])?km$/);
        expect(text).not.toMatch(/소요|분|시간/);
      })
    );
  });

  it('오차: 표시값과 입력의 차이는 0.05 이하(반올림 한 칸의 절반)', () => {
    fc.assert(
      fc.property(distanceArb, (km) => {
        const shown = numberPart(formatKm(km));

        expect(Math.abs(shown - km)).toBeLessThanOrEqual(0.05 + 1e-9);
      })
    );
  });

  it('격자 항등: 이미 0.1 단위인 값은 그 10진 표기 그대로 나온다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), (k) => {
        const written = decimalOfTenths(k);

        expect(formatKm(Number(written))).toBe(`${written}km`);
      })
    );
  });

  it('동점 half-up: 사람이 쓴 x.x5 는 항상 위로 올라간다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99999 }), (k) => {
        const written = `${Math.floor(k / 10)}.${k % 10}5`;

        expect(formatKm(Number(written))).toBe(`${decimalOfTenths(k + 1)}km`);
      })
    );
  });

  it('단조: 더 먼 거리가 더 작게 표시되지 않는다', () => {
    fc.assert(
      fc.property(distanceArb, distanceArb, (a, b) => {
        const [near, far] = a <= b ? [a, b] : [b, a];

        expect(numberPart(formatKm(near))).toBeLessThanOrEqual(
          numberPart(formatKm(far))
        );
      })
    );
  });
});
