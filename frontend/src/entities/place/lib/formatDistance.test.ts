import fc from 'fast-check';

import { formatDistance } from './formatDistance';

/**
 * TRIP-806 · AC-M3 · INV-3 — 미터 숫자를 거리 문자열로 바꾸는 순수 코어(`legDistance`·
 * `radiusUsedLabel` 이 복붙하던 반올림을 한 곳으로 추출).
 *
 * 무엇을 보장하나:
 *  - 🔴 `<1000m` → 가장 가까운 10m("820m"), `≥1000m` → 소수 1자리 km("3.2km").
 *  - 🔴 반올림은 round-half-up(내림 아님): 825→830, 3280→3.3km.
 *  - 🔴 접두 없음 — `이동`/`약` 은 소비처가 붙인다. 그래서 `legDistance` 는 `이동 ${formatDistance(합)}`,
 *    `radiusUsedLabel` 은 `약 ${formatDistance(반경)}` 로 소비하고, **두 파일의 기존 테스트가 무수정
 *    green** 이 된다(02a §5-F 실검증 — 이 세션 node 1회로 전 경계 케이스 바이트 일치 확인).
 *  - 🔴 INV-3: 반환에 소요시간 단위(분·시간·소요)가 원리적으로 없다(거리만).
 *
 * ⚠️ `legDistance` 의 `null`/broken/스킵/`합계 0→null` 로직은 **이 함수 밖**에 남는다 — formatDistance 는
 *    항상 양수 미터를 받아 문자열을 낸다. 그 로직은 `legDistance.test.ts`(무수정)가 계속 심판한다.
 *
 * *(개념)* **순수 함수** — 같은 입력이면 항상 같은 출력이라 fast-check(임의 입력 수백 개를 자동 생성해
 *  속성을 검사하는 도구)로 통째로 태울 수 있다.
 *
 * 3동작 뼈대: 준비=미터 숫자 → 실행=`formatDistance(m)` → 단언=거리 문자열.
 * 기대값은 Figma 목업이 아니라 02a §5-F 프로브(실제 알고리즘 실행)로 검증한 값이다.
 */

describe('🔴 F1 · AC-M3 — 경계 표 전수(EXACT)', () => {
  it.each([
    [820, '820m'],
    [824, '820m'], // round-down 쪽
    [825, '830m'], // round-half-up
    [500, '500m'],
    [700, '700m'],
    [999, '1000m'], // <1000 이라 10m 단위(999→1000m, km 전환은 값 자체가 ≥1000일 때만)
    [1000, '1.0km'], // 경계: ≥1000 → 소수 1자리
    [1100, '1.1km'],
    [3247, '3.2km'],
    [3280, '3.3km'], // round-half-up
    [4050, '4.1km'],
    [11300, '11.3km'],
  ])('formatDistance(%i) === "%s"', (meters, expected) => {
    expect(formatDistance(meters)).toBe(expected);
  });
});

describe('🔴 F2 · 속성(fast-check) — 1km 단위전환 형식 경계', () => {
  it('m<1000 이면 "…m", m≥1000 이면 "….km" 로 끝난다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200000 }), (meters) => {
        const label = formatDistance(meters);
        return meters >= 1000
          ? /^\d+\.\d+km$/.test(label)
          : /^\d+m$/.test(label);
      })
    );
  });
});

describe('🔴 F3 · 속성(fast-check) — <1000m 은 10m 단위로 반올림된다', () => {
  it('m<1000 결과의 숫자부는 10 의 배수다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), (meters) => {
        const label = formatDistance(meters); // "NNNm"
        const value = Number(label.replace('m', ''));
        return value % 10 === 0;
      })
    );
  });
});

describe('🔴 F4 · INV-3 — 반환에 소요시간 단위 0(거리만)', () => {
  it('경계 표·임의 미터 어디에도 분·시간·소요 문자가 없다', () => {
    for (const meters of [820, 1000, 3280, 11300, 500]) {
      expect(formatDistance(meters)).not.toMatch(/분|시간|소요/);
    }
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200000 }), (meters) => {
        return !/분|시간|소요/.test(formatDistance(meters));
      })
    );
  });
});
