import fc from 'fast-check';

import { formatCountBadge } from './formatCountBadge';

/**
 * TRIP-695 (01b AC-2) — 담은 곳 배지 개수 포맷터.
 *
 * 무엇을 보장하나: `formatCountBadge(n)` 이 개수를 배지 문자열로 접는다 —
 *  - n ≤ 0(0·음수) → '' (빈 문자열 = 배지 미표시. 음수는 방어, 01b Q2)
 *  - 1 ≤ n ≤ 99 → String(n) (그대로)
 *  - n ≥ 100 → '99+' (100 이상은 접는다, 티켓 규칙)
 * 이게 "100 이상은 99+로 접는다 + 0은 안 보인다"의 순수-함수 절반이다.
 * 화면 표시 게이트(count≥1일 때만 배지 렌더)는 SavedMenuFab 이 별도로 지고(HomeScreen.test.tsx
 * AC-1), 여기 0→'' 은 이중 방어다.
 *
 * 개념 몇 가지(코드 초심자용):
 *  - **AAA**: 각 테스트는 준비(입력)→실행(함수 호출)→단언(결과 확인) 3동작이다.
 *  - **it.each(표)**: 표의 각 행으로 같은 검사를 반복한다(경계 예제를 한 곳에 모은다).
 *  - **PBT(속성 기반 테스트)**: 예제를 손으로 나열하는 대신 "어떤 입력에도 성립할 성질"을
 *    적으면 fast-check 가 임의 정수 수백 개로 반례를 사냥한다(CI 차단 게이트).
 *  - **toBe**: 원시값 완전일치(문자열이면 글자 단위로 같아야 함).
 */

// ── 단위 경계표 ────────────────────────────────────────────────────────────────
describe('formatCountBadge — 경계 (01b AC-2)', () => {
  const CASES: { input: number; expected: string }[] = [
    { input: 0, expected: '' }, // 0 → 미표시
    { input: 1, expected: '1' }, // 하한 진입
    { input: 99, expected: '99' }, // 접기 직전 최대
    { input: 100, expected: '99+' }, // 접기 시작
    { input: 101, expected: '99+' }, // 접힌 뒤 상수
    { input: -1, expected: '' }, // 음수 방어(01b Q2)
  ];

  it.each(CASES)('$input → "$expected"', ({ input, expected }) => {
    // 준비=input · 실행=호출 · 단언=완전일치.
    expect(formatCountBadge(input)).toBe(expected);
  });
});

// ── 성질(PBT, numRuns 500 — 선례 homePhase.test.ts) ────────────────────────────
describe('formatCountBadge — 성질(PBT)', () => {
  it('P1 · 출력은 항상 {"", String(n), "99+"} 중 하나이고 길이 ≤ 3', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const out = formatCountBadge(n);
        // 실행 결과가 세 형태 중 하나이고, 배지에 들어갈 짧은 문자열이다.
        expect(['', String(n), '99+']).toContain(out);
        expect(out.length).toBeLessThanOrEqual(3);
      }),
      { numRuns: 500 }
    );
  });

  it('P2 · 1~99 는 그대로(String(n)) 반환한다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 }), (n) => {
        expect(formatCountBadge(n)).toBe(String(n));
      }),
      { numRuns: 500 }
    );
  });

  it('P3 · 100 이상은 입력이 아무리 커도 항상 "99+" 다(상수)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 1_000_000_000 }), (n) => {
        expect(formatCountBadge(n)).toBe('99+');
      }),
      { numRuns: 500 }
    );
  });

  it('P4 · 0 이하는 항상 빈 문자열이다', () => {
    fc.assert(
      fc.property(fc.integer({ max: 0 }), (n) => {
        expect(formatCountBadge(n)).toBe('');
      }),
      { numRuns: 500 }
    );
  });

  it('P5 · 출력에서 파싱되는 수는 결코 100 이상이 아니다(숫자 누출 없음)', () => {
    // ★ P3 와 짝 — "99+로 접는다"의 본질. 전처리(parseInt)+탐지기(>=100)를 함께 태운다.
    // 빈 문자열은 parseInt 가 NaN 이고 `NaN >= 100` 은 false(누출 아님)로 안전히 통과한다 —
    // `< 100` 으로 쓰면 `NaN < 100` 도 false 라 빈 문자열을 거짓 red 로 잡는다(02a §10-3 실측).
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const parsed = Number.parseInt(formatCountBadge(n), 10);
        expect(parsed >= 100).toBe(false);
      }),
      { numRuns: 500 }
    );
  });
});
