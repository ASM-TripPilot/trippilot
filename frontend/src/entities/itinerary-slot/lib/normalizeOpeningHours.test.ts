import fc from 'fast-check';

import { normalizeOpeningHours } from './normalizeOpeningHours';

/**
 * TRIP-988 · A(BR-U3-09 · D3) — 영업시간 원문에 섞인 `<br>` 계열 태그를 줄바꿈으로 바꾼다.
 *
 * 무엇을 보장하나: 서버 `openingHours` 는 자유형 원문이라(openapi) 태그가 그대로 올 수 있다.
 * 태그 하나는 줄바꿈 하나가 되고, 결과 양끝의 공백·줄바꿈만 걷는다(01b Q1). 그 밖의 원문 —
 * 안쪽 공백, 연속 줄바꿈, 태그 없는 문자열 — 은 손대지 않는다.
 *
 * 5-b 보강(03b 경고-1·2 오케 판정): 태그 안 공백 변형(`< br>`·`<br >`·`< br / >`)도 태그다.
 * 태그 **바로 뒤**에 원문 줄바꿈(`\n`·`\r\n`) 하나가 붙어 있으면 태그와 합쳐 줄바꿈 하나다 —
 * TourAPI 원문이 `<br>\n` 모양으로 오는 경우가 많아, 따로 바꾸면 빈 줄이 끼어든다.
 * 깨진 모양(`<br<`·`<br-`·잘린 `<br…`)은 범위 밖이다(상류 정리 후보).
 *
 * 3동작: 준비(원문) → 실행(normalizeOpeningHours) → 단언(결과 문자열).
 */

const QA_RAW = '월요일~토요일 12:00~22:30<br>- 일요일 12:00~21:30';
const QA_TWO_LINES = '월요일~토요일 12:00~22:30\n- 일요일 12:00~21:30';

describe('normalizeOpeningHours — 예시', () => {
  it('N1 QA 재현 원문은 태그 자리에서 두 줄이 된다', () => {
    expect(normalizeOpeningHours(QA_RAW)).toBe(QA_TWO_LINES);
  });

  it.each(['a<br>b', 'a<br/>b', 'a<br />b', 'a<BR>b', 'a<Br/>b'])(
    'N2 변형 태그 %j 도 줄바꿈 하나가 된다',
    (raw) => {
      expect(normalizeOpeningHours(raw)).toBe('a\nb');
    }
  );

  it.each([
    ['10:00~17:00<br>', '10:00~17:00'],
    ['<br>10:00~17:00', '10:00~17:00'],
  ])('N3 양끝 태그가 남긴 줄바꿈은 걷는다 — %j → %j', (raw, expected) => {
    expect(normalizeOpeningHours(raw)).toBe(expected);
  });

  it('N4 연속 태그는 연속 줄바꿈으로 남긴다 — 접지 않는다', () => {
    expect(normalizeOpeningHours('a<br><br>b')).toBe('a\n\nb');
  });

  it('N5 태그 없는 원문은 그대로다', () => {
    expect(normalizeOpeningHours('10:00~18:00 (월 휴관)')).toBe(
      '10:00~18:00 (월 휴관)'
    );
  });

  it.each(['a< br>b', 'a<br >b', 'a< br / >b', 'a<br/ >b', 'a< BR />b'])(
    'N6 태그 안 공백 변형 %j 도 줄바꿈 하나가 된다',
    (raw) => {
      expect(normalizeOpeningHours(raw)).toBe('a\nb');
    }
  );

  it.each([
    [
      '- 11:00~21:20< br>- 마지막 주문 20:30',
      '- 11:00~21:20\n- 마지막 주문 20:30',
    ],
    ['< br>', ''],
  ])('N7 실데이터 `< br>` 모양 — %j → %j', (raw, expected) => {
    expect(normalizeOpeningHours(raw)).toBe(expected);
  });

  it.each([
    ['10:00~17:00<br>\n휴무: 월요일', '10:00~17:00\n휴무: 월요일'],
    [
      '상시 개방<br>\n※ 일부 통제될 수 있으므로 방문 시 전화문의 요망',
      '상시 개방\n※ 일부 통제될 수 있으므로 방문 시 전화문의 요망',
    ],
    ['a<br />\nb', 'a\nb'],
    ['a<br>\r\nb', 'a\nb'],
  ])(
    'N8 태그 바로 뒤 원문 줄바꿈은 태그와 합쳐 하나 — 빈 줄 없음 %j → %j',
    (raw, expected) => {
      expect(normalizeOpeningHours(raw)).toBe(expected);
    }
  );

  it('N9 태그가 먹는 원문 줄바꿈은 하나뿐 — 그 뒤 줄바꿈은 원문대로 남는다', () => {
    expect(normalizeOpeningHours('a<br>\n\nb')).toBe('a\n\nb');
  });

  it('N10 "바로 뒤"만 합친다 — 태그와 줄바꿈 사이에 공백이 있으면 합치지 않는다', () => {
    expect(normalizeOpeningHours('a<br> \nb')).toBe('a\n \nb');
  });
});

/** `<br>` 계열 태그 하나 — 이름 대소문자 · `<` 뒤/이름 뒤/`/` 뒤 공백 · 닫는 `/` 조합. */
const gap = fc.constantFrom('', ' ', '  ');
const tagArb = fc
  .tuple(
    gap,
    fc.constantFrom('br', 'BR', 'Br', 'bR'),
    gap,
    fc.constantFrom('', '/'),
    gap
  )
  .map(
    ([lead, name, space, slash, tail]) =>
      `<${lead}${name}${space}${slash}${tail}>`
  );

/** 태그가 아닌 글자 조각. `<` 를 빼서 글자와 태그가 붙어 새 태그가 생기는 입력을 막는다. */
const textArb = fc
  .string({
    unit: fc.oneof(
      fc.constantFrom('\n', '\r', '\t', ' ', '>', '/', 'b', 'r'),
      fc.string({ minLength: 1, maxLength: 1 })
    ),
  })
  .filter((s) => !s.includes('<'));

/** 태그 뒤에 자주 붙는 원문 줄바꿈 모양 — 따로 뽑지 않으면 100회 안에 `\r\n`·`\n\n` 이 태그 뒤에 거의 안 온다. */
const breakArb = fc.constantFrom('\n', '\r\n', '\n\n', ' \n', '\r');

const segmentsArb = fc.array(
  fc.oneof(
    tagArb.map((s) => ({ isTag: true, s })),
    textArb.map((s) => ({ isTag: false, s })),
    breakArb.map((s) => ({ isTag: false, s }))
  )
);

type Segment = { isTag: boolean; s: string };

/**
 * 오라클 — 조각에서 기대값을 직접 만든다(구현의 정규식을 빌리지 않는다).
 * 이웃한 글자 조각을 먼저 합친다: `'\r'` + `'\n'` 처럼 두 조각에 걸친 `\r\n` 도 한 줄바꿈이다.
 * 태그는 `\n` 이 되고, 바로 다음 글자 조각 맨 앞의 `\r\n` 또는 `\n` 하나를 먹는다.
 */
function expectedOf(segments: Segment[]): string {
  const merged: Segment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (!seg.isTag && last && !last.isTag) last.s += seg.s;
    else merged.push({ ...seg });
  }
  return merged
    .map((seg, i) => {
      if (seg.isTag) return '\n';
      if (!merged[i - 1]?.isTag) return seg.s;
      if (seg.s.startsWith('\r\n')) return seg.s.slice(2);
      if (seg.s.startsWith('\n')) return seg.s.slice(1);
      return seg.s;
    })
    .join('')
    .trim();
}

const TAG = /<\s*br\s*\/?\s*>/i;

describe('normalizeOpeningHours — 성질 (PBT)', () => {
  it('P1 태그(+바로 뒤 원문 줄바꿈 하나)만 줄바꿈 하나가 되고 나머지 글자는 그대로, 양끝만 걷힌다', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const raw = segments.map((seg) => seg.s).join('');
        const expected = expectedOf(segments);

        const result = normalizeOpeningHours(raw);

        expect(result).toBe(expected);
        expect(TAG.test(result)).toBe(false);
      })
    );
  });

  it('P2 태그가 없는 입력은 양끝 정리 말고는 그대로 돌아온다', () => {
    fc.assert(
      fc.property(
        fc
          .string({
            unit: fc.constantFrom(
              '\n',
              '\t',
              ' ',
              '<',
              '>',
              '/',
              'b',
              'r',
              'B',
              'R',
              '영',
              '1',
              ':'
            ),
          })
          .filter((s) => !/<\s*br/i.test(s)),
        (raw) => {
          expect(normalizeOpeningHours(raw)).toBe(raw.trim());
        }
      )
    );
  });
});
