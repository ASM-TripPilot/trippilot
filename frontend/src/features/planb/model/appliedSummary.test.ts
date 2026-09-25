import fc from 'fast-check';

import { formatDistance } from '@/entities/place/lib/formatDistance';

import { appliedSummaryBadges } from './appliedSummary';

/**
 * TRIP-754 · AC-5 · INV-3 — i08 요약 배지 3종 문구(순수 함수).
 *
 * 무엇을 보장하나:
 *  - `{바뀐 곳 수, 방문 수 전→후, 이동 거리 차이 m}` → `['바뀐 곳 N', '방문지 A→B', '이동 ±X']`.
 *  - 거리 차이의 부호: 음수는 U+2212(−), 양수는 '+', 0 은 부호 없이 `이동 0m`(Q6). null 이면 거리 배지를 뺀다.
 *  - 어떤 입력에도 소요시간 단위(분·시간·소요)가 나오지 않는다(INV-3). 이 파일은 model 이라
 *    `executionDurationStructure`(ui 폴더만 스캔) 사정거리 밖 — 그래서 여기서 직접 단언한다.
 *
 * 3동작 뼈대: 준비=입력 → 실행=호출 → 단언=배열.
 */

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

describe('🔴 M1 · Figma 예시', () => {
  it('바뀐 곳 1 · 방문지 5→5 · 이동 −6.9km', () => {
    const badges = appliedSummaryBadges({
      changedCount: 1,
      visitsBefore: 5,
      visitsAfter: 5,
      distanceDeltaM: -6900,
    });

    expect(badges).toEqual(['바뀐 곳 1', '방문지 5→5', '이동 −6.9km']);
    // 빼기 기호는 하이픈(U+002D)이 아니라 수학 빼기(U+2212)다.
    expect(badges[2].codePointAt(3)).toBe(0x2212);
  });
});

describe('🔴 M2 · Q6 — 거리 차이의 부호와 null', () => {
  it.each([
    [1200, '이동 +1.2km'],
    [0, '이동 0m'],
    [-50, '이동 −50m'],
    // |Δ|<10m 는 부호 없이 0m(`−0m`·`−10m` 금지) — 경계 반대편 10 과 짝.
    [-4, '이동 0m'],
    [9, '이동 0m'],
    [-9, '이동 0m'],
    [10, '이동 +10m'],
  ])('Δ=%s → "%s"', (delta, expected) => {
    const badges = appliedSummaryBadges({
      changedCount: 2,
      visitsBefore: 5,
      visitsAfter: 4,
      distanceDeltaM: delta,
    });

    expect(badges).toEqual(['바뀐 곳 2', '방문지 5→4', expected]);
  });

  it('Δ=null 이면 거리 배지를 뺀다(서버가 값을 안 줄 때)', () => {
    const badges = appliedSummaryBadges({
      changedCount: 1,
      visitsBefore: 5,
      visitsAfter: 5,
      distanceDeltaM: null,
    });

    expect(badges).toEqual(['바뀐 곳 1', '방문지 5→5']);
  });
});

describe('🔴 M3 · 개수는 받은 값 그대로', () => {
  it('바뀐 곳 3 · 방문지 4→5', () => {
    const badges = appliedSummaryBadges({
      changedCount: 3,
      visitsBefore: 4,
      visitsAfter: 5,
      distanceDeltaM: 300,
    });

    expect(badges).toEqual(['바뀐 곳 3', '방문지 4→5', '이동 +300m']);
  });
});

describe('🔴 M4·M5 · PBT', () => {
  const count = fc.integer({ min: 0, max: 20 });

  it('M4 어떤 입력에도 소요시간 단위가 없고, 배지 수는 Δ 유무로 정해진다 (INV-3)', () => {
    fc.assert(
      fc.property(
        count,
        count,
        count,
        fc.option(fc.integer({ min: -200000, max: 200000 }), { nil: null }),
        (changedCount, visitsBefore, visitsAfter, distanceDeltaM) => {
          const badges = appliedSummaryBadges({
            changedCount,
            visitsBefore,
            visitsAfter,
            distanceDeltaM,
          });

          expect(badges).toHaveLength(distanceDeltaM === null ? 2 : 3);
          badges.forEach((badge: string) =>
            expect(DURATION_TEXT.test(badge)).toBe(false)
          );
        }
      )
    );
  });

  it('M5 |Δ|≥10 이면 부호 + formatDistance(|Δ|), ASCII 하이픈은 없다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 200000 }),
        fc.boolean(),
        (magnitude, negative) => {
          const delta = negative ? -magnitude : magnitude;
          const badges = appliedSummaryBadges({
            changedCount: 1,
            visitsBefore: 5,
            visitsAfter: 5,
            distanceDeltaM: delta,
          });

          const sign = negative ? '−' : '+';
          expect(badges[2]).toBe(`이동 ${sign}${formatDistance(magnitude)}`);
          expect(badges[2]).not.toContain('-');
        }
      )
    );
  });
});
