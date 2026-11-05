import fc from 'fast-check';

import { titleViolation } from './titleRule';

/**
 * TRIP-1787 · 여행 이름 검증 `titleViolation(s): 'EMPTY' | 'TOO_LONG' | null` — 서버 규칙의 UX 사본이다(권위는 서버:
 * 비거나 공백이면 서버가 `{첫 목적지} 여행` 으로 바꿔 버리고, 120자 초과는 400).
 *
 * 새 개념 한 줄 — **코드포인트**: 사람이 한 글자로 세는 이모지는 JS 문자열 `.length`(UTF-16 단위)로는 2칸(가족 이모지처럼
 * 이어 붙인 것은 11칸)이다. 서버는 코드포인트로 세므로 앱도 `[...s].length` 로 센다. `.length` 로 세면 이모지 60개 이름이
 * 앱에서 막히는데 서버는 받아 주는 어긋남이 생긴다. 서버는 이름을 트림하지 않으므로 길이도 원문 기준이다.
 *
 * 3동작: 준비(이름 문자열) → 실행(titleViolation) → 단언(위반 코드 또는 null).
 */

describe('titleViolation — 길이 경계(코드포인트)', () => {
  it('120자는 통과, 121자는 TOO_LONG', () => {
    expect(titleViolation('가'.repeat(120))).toBeNull();
    expect(titleViolation('가'.repeat(121))).toBe('TOO_LONG');
  });

  it('이모지는 한 글자로 센다 — 이모지 120개는 통과, 121개는 TOO_LONG ("😀".length 는 2 이므로 .length 기준이면 61개부터 막힌다)', () => {
    expect(titleViolation('😀'.repeat(120))).toBeNull();
    expect(titleViolation('😀'.repeat(121))).toBe('TOO_LONG');
  });

  it('이어 붙인 이모지(👨‍👩‍👧 = 코드포인트 5개)는 코드포인트 5로 센다 — 24개(=120)는 통과, 25개(=125)는 TOO_LONG', () => {
    const family = '👨‍👩‍👧';
    expect([...family]).toHaveLength(5); // 전제 확인 — 이 문자열이 코드포인트 5개라는 것
    expect(titleViolation(family.repeat(24))).toBeNull();
    expect(titleViolation(family.repeat(25))).toBe('TOO_LONG');
  });

  it('앞뒤 공백도 길이에 든다(원문 기준) — 글자 119 + 공백 2 = 121 은 TOO_LONG', () => {
    expect(titleViolation(` ${'가'.repeat(119)} `)).toBe('TOO_LONG');
    expect(titleViolation(` ${'가'.repeat(118)} `)).toBeNull();
  });
});

describe('titleViolation — 비어 있음', () => {
  it.each([
    ['빈 문자열', ''],
    ['공백만', '   '],
    ['탭·줄바꿈만', ' \t\n '],
  ])('%s 는 EMPTY', (_label, value) => {
    expect(titleViolation(value)).toBe('EMPTY');
  });

  it('글자가 하나라도 있으면 EMPTY 가 아니다', () => {
    expect(titleViolation('a')).toBeNull();
    expect(titleViolation(' 부산 ')).toBeNull();
  });
});

describe('titleViolation — 속성(PBT)', () => {
  it('코드포인트 120개 이하이고 공백만이 아니면 항상 null', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', minLength: 1, maxLength: 120 }),
        (s) => {
          fc.pre([...s].length <= 120 && s.trim() !== '');
          expect(titleViolation(s)).toBeNull();
        }
      )
    );
  });

  it('코드포인트가 120개를 넘으면 항상 TOO_LONG(공백만 아닌 한)', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', minLength: 121, maxLength: 200 }),
        (s) => {
          fc.pre([...s].length > 120 && s.trim() !== '');
          expect(titleViolation(s)).toBe('TOO_LONG');
        }
      )
    );
  });
});
