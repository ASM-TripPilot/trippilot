import fc from 'fast-check';

import { formatOpeningHoursLabel } from './openingHoursLabel';

/**
 * TRIP-746 · AC-5 · Seed 열린 질문 3 — 예정 카드 상태줄 꼬리(" · 11:00–22:00 영업")의 영업시간 표기.
 *
 * 무엇을 보장하나: 서버 `openingHours`는 자유형 원문이다. `HH:mm` 두 개가 `-`/`–`로 이어진 모양만
 * `HH:mm–HH:mm 영업`(en-dash 붙여쓰기)으로 다듬고, 그 밖의 문자열(`24시간 개방` 등)은 원문 그대로 둔다.
 * 원문이 없으면(null·undefined·공백뿐) `null` — 카드가 ` · …` 조각 자체를 생략한다(G6, 빈 칸 금지).
 *
 * TRIP-1021(D11) — 상태줄 꼬리는 한 줄이다: 줄머리 `- ` 불릿을 걷고 여러 줄을 " · " 로 잇는다(OH6 개정·OH8~OH10).
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

  it('OH4 TRIP-988 원문 끝의 `<br>` 는 걷히고, `~` 범위는 규칙 밖이라 글자 그대로 남는다', () => {
    expect(formatOpeningHoursLabel('10:00~17:00<br>')).toBe('10:00~17:00');
  });

  // TRIP-1021 D11 — 상태줄 꼬리는 한 줄이다. 여러 줄은 줄바꿈 대신 " · " 로 잇는다(OH6 기대값 개정).
  it('OH6 TRIP-1021 태그·원문 줄바꿈으로 나뉜 두 줄은 " · " 로 이어진 한 줄이 된다', () => {
    expect(
      formatOpeningHoursLabel(
        '상시 개방<br>\n※ 일부 통제될 수 있으므로 방문 시 전화문의 요망'
      )
    ).toBe('상시 개방 · ※ 일부 통제될 수 있으므로 방문 시 전화문의 요망');
  });

  it('OH8 TRIP-1021 AC-6 줄머리 "- " 불릿을 걷고 줄들을 " · " 로 잇는다 (태그·줄바꿈·불릿 0)', () => {
    expect(
      formatOpeningHoursLabel(
        '- 화요일~목요일 / 일요일 10:00~20:00<br>\n- 금요일~토요일 10:00~22:00'
      )
    ).toBe('화요일~목요일 / 일요일 10:00~20:00 · 금요일~토요일 10:00~22:00');
  });

  it.each([
    ['- 09:00-18:00', '09:00–18:00 영업'],
    ['- 24시간 개방', '24시간 개방'],
  ])(
    'OH9 TRIP-1021 AC-8 불릿을 걷은 결과가 한 줄이면 그 줄에 기존 규칙을 쓴다 — 원문 %j → %j',
    (raw, expected) => {
      expect(formatOpeningHoursLabel(raw)).toBe(expected);
    }
  );

  it('OH7 TRIP-988 공백 변형 태그뿐인 원문(`< br>`)도 정리하면 비어 null', () => {
    expect(formatOpeningHoursLabel('< br>')).toBeNull();
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

  it('OH5 TRIP-988 원문에 `<br>` 계열 태그가 섞여 있어도 라벨에는 태그가 남지 않는다', () => {
    const gap = fc.constantFrom('', ' ');
    const tag = fc
      .tuple(
        gap,
        fc.constantFrom('br', 'BR', 'Br'),
        gap,
        fc.constantFrom('', '/'),
        gap
      )
      .map(
        ([lead, name, space, slash, tail]) =>
          `<${lead}${name}${space}${slash}${tail}>`
      );
    // 글자 조각에 `<` 를 빼서 글자와 태그가 붙어 새 태그가 생기는 입력을 막는다.
    const text = fc.string().filter((s) => !s.includes('<'));

    fc.assert(
      fc.property(fc.array(fc.oneof(tag, text)), (parts) => {
        const label = formatOpeningHoursLabel(parts.join(''));

        expect(label === null || !/<\s*br\s*\/?\s*>/i.test(label)).toBe(true);
      })
    );
  });

  // TRIP-988 Q1 — 태그 정리 함수를 거치며 양끝 공백이 걷힌다. 그 밖의 원문은 여전히 그대로다.
  // TRIP-1021 — 줄머리 `-` 는 불릿으로 걷히므로 모집단에서 뺀다(fc.string 은 개행을 만들지 않는다).
  it('OH3 숫자·`<br`·앞머리 `-` 가 없는 비어 있지 않은 원문은 양끝 공백만 걷고 그대로 돌려준다', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1 })
          .filter(
            (s) =>
              !/\d/.test(s) &&
              s.trim() !== '' &&
              !/<\s*br/i.test(s) &&
              !/^\s*-/.test(s)
          ),
        (raw) => {
          expect(formatOpeningHoursLabel(raw)).toBe(raw.trim());
        }
      )
    );
  });

  it('OH10 TRIP-1021 AC-6 여러 줄 원문(불릿 유무·구분자 무관)은 줄마다 다듬어 " · " 로 이은 한 줄이다', () => {
    // 숫자를 빼서 "범위 규칙을 줄마다 쓰나"라는 명세 밖 선택을 강제하지 않는다(02a ★11).
    const line = fc
      .string({ minLength: 1 })
      .filter(
        (s) =>
          !/\d/.test(s) &&
          !s.includes('<') &&
          !/^\s*-/.test(s) &&
          s.trim() !== ''
      );
    const separator = fc.constantFrom('<br>', '<br>\n', '\n', '<BR/>');
    const bullet = fc.constantFrom('', '- ');

    fc.assert(
      fc.property(
        fc.array(fc.tuple(line, bullet, separator), {
          minLength: 2,
          maxLength: 4,
        }),
        (parts) => {
          const raw = parts
            .map(([text, mark, sep], index) =>
              index === 0 ? `${mark}${text}` : `${sep}${mark}${text}`
            )
            .join('');

          expect(formatOpeningHoursLabel(raw)).toBe(
            parts.map(([text]) => text.trim()).join(' · ')
          );
        }
      )
    );
  });
});
