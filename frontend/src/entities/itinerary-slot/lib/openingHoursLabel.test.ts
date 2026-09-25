import fc from 'fast-check';

import { formatOpeningHoursLabel } from './openingHoursLabel';

/**
 * TRIP-746 · AC-5 · Seed 열린 질문 3 — 예정 카드 상태줄 꼬리(" · 11:00–22:00 영업")의 영업시간 표기.
 *
 * 무엇을 보장하나: 서버 `openingHours`는 자유형 원문이다. `HH:mm` 두 개가 `-`/`–`로 이어진 모양만
 * `HH:mm–HH:mm 영업`(en-dash 붙여쓰기)으로 다듬고, 그 밖의 문자열(`24시간 개방` 등)은 원문 그대로 둔다.
 * 원문이 없으면(null·undefined·공백뿐) `null` — 카드가 ` · …` 조각 자체를 생략한다(G6, 빈 칸 금지).
 *
 * 3동작: 준비(원문) → 실행(formatOpeningHoursLabel) → 단언(라벨 또는 null).
 */

describe('formatOpeningHoursLabel — 예시 (OH1)', () => {
  it.each([
    ['11:00 - 22:00', '11:00–22:00 영업'],
    ['11:00–22:00', '11:00–22:00 영업'],
    ['09:00-18:00', '09:00–18:00 영업'],
    ['24시간 개방', '24시간 개방'],
    ['9:00 - 18:00', '9:00 - 18:00'],
    ['매주 월요일 휴무', '매주 월요일 휴무'],
  ])('원문 %j → %j', (raw, expected) => {
    expect(formatOpeningHoursLabel(raw)).toBe(expected);
  });

  it.each([[null], [undefined], [''], ['   ']])(
    '원문이 없으면(%j) null — 조각을 생략한다',
    (raw) => {
      expect(formatOpeningHoursLabel(raw)).toBeNull();
    }
  );
});

const hhmm = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(
    ([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  );
const spaces = fc.integer({ min: 0, max: 2 }).map((n) => ' '.repeat(n));

describe('formatOpeningHoursLabel — 성질 (PBT)', () => {
  it('OH2 HH:mm 범위는 구분자·공백과 무관하게 항상 "HH:mm–HH:mm 영업" 이다', () => {
    fc.assert(
      fc.property(
        hhmm,
        hhmm,
        fc.constantFrom('-', '–'),
        spaces,
        spaces,
        (open, close, dash, before, after) => {
          const raw = `${open}${before}${dash}${after}${close}`;
          expect(formatOpeningHoursLabel(raw)).toBe(`${open}–${close} 영업`);
        }
      )
    );
  });

  it('OH3 숫자가 없는 비어 있지 않은 원문은 손대지 않고 그대로 돌려준다', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1 })
          .filter((s) => !/\d/.test(s) && s.trim() !== ''),
        (raw) => {
          expect(formatOpeningHoursLabel(raw)).toBe(raw);
        }
      )
    );
  });
});
