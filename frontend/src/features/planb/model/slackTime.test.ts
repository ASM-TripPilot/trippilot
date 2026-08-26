import fs from 'fs';
import path from 'path';
import fc from 'fast-check';

import { slackTime } from './slackTime';

/**
 * TRIP-440 · AC-7 · PBT-U4-F2 — slackTime(from, toFixed): 여유는 **두 확정 시각의 차**만.
 *
 * 무엇을 보장하나:
 *  - "여유 N시간 M분"/"여유 N분"/"여유 없음" 세 포맷이 diff 경계에서 정확하다(D2).
 *  - 임의의 두 확정 시각에서 **소요시간 언어(소요·이동)가 안 나오고**, 표시된 숫자가 **실제 차와 일치**하며,
 *    함수가 **시계를 안 읽는다**(BR-U4-24 · wall-clock 미사용 · 재현 결정론).
 *
 * ★ slackTime.ts 는 model 이라 두 구조가드(execution-only `liveTimeStructure`, ui-only
 *   `executionDurationStructure`) **어디에도 안 걸린다** → 이 PBT + wall-clock 소스 스캔이 유일한 그물이다
 *   (리포 CI 차단 게이트). "여유 N시간 M분"은 두 고정 시각의 간격이라 INV-3(소요시간) 위반이 아니다.
 *
 * ★ from/toFixed 는 "HH:mm" 또는 "HH:mm:ss". **초는 버리고 시·분만** 쓴다(resolveSlackLabel 선례, D1) —
 *   `toMin` 을 테스트가 독립 재유도(초 무시)해 성질을 판정한다(함수 재구현 아님 — 출력의 숫자를 되파싱).
 *
 * *(개념)* PBT(fast-check) = 임의 입력 수백 개를 던져 성질을 반증하려 든다. `fc.assert(fc.property(arb, fn))`.
 */

/** "HH:mm(:ss)" → 분(시·분만, 초 버림). 구현과 같은 규약을 테스트가 독립적으로 다시 적는다. */
function toMin(clock: string): number {
  const [hh, mm] = clock.split(':');
  return Number(hh) * 60 + Number(mm);
}

const pad = (n: number): string => String(n).padStart(2, '0');

// ---- A. 경계 예시(하드코딩 기대값 = 포맷 앵커, STRING EXACT) ----
describe('slackTime — 포맷 경계(AC-7 A)', () => {
  const CASES: { from: string; to: string; expected: string }[] = [
    { from: '14:00', to: '15:20', expected: '여유 1시간 20분' }, // 80분
    { from: '14:00', to: '15:00', expected: '여유 1시간 0분' }, // 60 경계(0분 표기)
    { from: '14:00', to: '14:59', expected: '여유 59분' }, // 59 경계
    { from: '14:00', to: '14:01', expected: '여유 1분' }, // 최소 양수
    { from: '14:00', to: '14:00', expected: '여유 없음' }, // 0
    { from: '15:00', to: '14:00', expected: '여유 없음' }, // 음수(다음 고정이 지남)
    { from: '22:00', to: '23:30', expected: '여유 1시간 30분' },
    { from: '14:00:45', to: '15:00:10', expected: '여유 1시간 0분' }, // 초 무시(HH:mm:ss)
    { from: '14:00', to: '16:00:00', expected: '여유 2시간 0분' },
  ];

  // STRING 인자는 완전일치(RNTL·jest 아님 — toBe 는 언제나 정확일치). 포맷 전체를 잠근다.
  it.each(CASES)('$from → $to = "$expected"', ({ from, to, expected }) => {
    expect(slackTime(from, to)).toBe(expected);
  });
});

// ---- B. 성질(PBT-U4-F2, numRuns 500) ----
describe('slackTime — 성질(AC-7 B · PBT-U4-F2)', () => {
  /** "HH:mm" 또는 "HH:mm:ss" 무작위 시각. */
  const timeArb = fc
    .record({
      h: fc.integer({ min: 0, max: 23 }),
      m: fc.integer({ min: 0, max: 59 }),
      s: fc.integer({ min: 0, max: 59 }),
      withSeconds: fc.boolean(),
    })
    .map(({ h, m, s, withSeconds }) =>
      withSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`
    );

  it('P1 — 출력에 소요시간 언어(소요·이동)가 없다', () => {
    fc.assert(
      fc.property(timeArb, timeArb, (from, to) => {
        expect(slackTime(from, to)).not.toMatch(/소요|이동/);
      }),
      { numRuns: 500 }
    );
  });

  it('P2 — diff<=0 이면 "여유 없음", diff>0 이면 숫자를 낸다(부호 정합)', () => {
    fc.assert(
      fc.property(timeArb, timeArb, (from, to) => {
        const diff = toMin(to) - toMin(from);
        const out = slackTime(from, to);
        if (diff <= 0) {
          expect(out).toBe('여유 없음');
        } else {
          expect(out).not.toBe('여유 없음');
          expect(out).toMatch(/^여유 /);
          expect(out).toMatch(/\d/);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('P3 — 표시된 숫자가 실제 차와 일치한다(되파싱, 항진명제 회피)', () => {
    fc.assert(
      fc.property(timeArb, timeArb, (from, to) => {
        const diff = toMin(to) - toMin(from);
        const out = slackTime(from, to);
        if (diff <= 0) return; // "여유 없음" — 숫자 없음(P2 가 담당)
        // 함수를 재포맷하지 않고 출력에서 숫자를 되파싱해 입력 차와 맞는지 본다.
        const hourMatch = out.match(/(\d+)\s*시간/);
        const minMatch = out.match(/(\d+)\s*분/);
        const hours = hourMatch ? Number(hourMatch[1]) : 0;
        const mins = minMatch ? Number(minMatch[1]) : 0;
        expect(hours * 60 + mins).toBe(diff);
      }),
      { numRuns: 500 }
    );
  });
});

// ---- C. wall-clock 미사용 소스 스캔(AC-7 C) ----
describe('slackTime — wall-clock 미사용(AC-7 C)', () => {
  const WALL_CLOCK = /new\s+Date|Date\.now/;

  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  it('탐지기 자가검사 — 주석 속 new Date 는 걷히고, 코드의 new Date 는 잡힌다', () => {
    const stripped = stripComments('// new Date 안 씀\nconst x = 1;');
    expect(stripped).not.toContain('new Date');
    expect(stripped).toContain('const x = 1;');
    expect(WALL_CLOCK.test(stripped)).toBe(false);
    expect(WALL_CLOCK.test('const t = new Date();')).toBe(true);
    expect(WALL_CLOCK.test('const t = Date.now();')).toBe(true);
  });

  it('slackTime.ts 소스에 new Date·Date.now 가 0건이다(BR-U4-24 두 확정 시각의 차)', () => {
    const rel = 'src/features/planb/model/slackTime.ts';
    const full = path.resolve(rel);
    // 긍정 앵커 — 파일이 실재하고 문자열을 쪼갠다(빈 파일 가짜통과·시계 읽기 차단).
    expect(fs.existsSync(full)).toBe(true);
    const stripped = stripComments(fs.readFileSync(full, 'utf8'));
    expect(stripped).toContain('slackTime');
    expect(stripped).toContain("split(':')");
    // 부정 — 시계를 안 읽는다.
    expect(WALL_CLOCK.test(stripped)).toBe(false);
  });
});
