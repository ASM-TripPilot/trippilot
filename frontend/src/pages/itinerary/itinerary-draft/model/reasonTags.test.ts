import fc from 'fast-check';

import { parseReasonTags } from './reasonTags';

/**
 * TRIP-1779 · AC-P1~P5 — 서버가 슬롯마다 주는 `placementReason`(해시태그를 공백으로 이은 문자열)을
 * 카드에 그릴 태그 목록으로 바꾸는 **순수 함수** 판정.
 *
 * 무엇을 보장하나:
 *  - 서버가 준 태그를 순서·내용 그대로 돌려준다(고치거나 지어내거나 재정렬하지 않는다 · P1/P5).
 *  - 서버 형식이 아닌 것은 전부 빈 결과다 — null·빈 문자열·공백뿐(P3), `#` 없는 옛 문장(P4),
 *    `#` 아닌 토큰이 하나라도 섞인 것·`#` 단독 토큰(01b Q2). 반쪽 표시는 없다(INV-4: 빈 칸·플레이스홀더 금지).
 *
 * 3동작 뼈대: 준비 = 입력 문자열 → 실행 = `parseReasonTags` → 단언 = 반환 배열(`toEqual`).
 * 속성 테스트(PBT)는 "임의 입력을 수백 번 넣어도 항상 성립하는 규칙"을 검증한다(fast-check).
 */

describe('parseReasonTags — 예시', () => {
  it('T1 · 태그를 입력 순서 그대로 돌려준다(정렬하지 않는다)', () => {
    expect(parseReasonTags('#혼자여행 #난타공연 #공연관람')).toEqual([
      '#혼자여행',
      '#난타공연',
      '#공연관람',
    ]);
  });

  it('T2 · 앞뒤·연속 공백, 탭, 줄바꿈, 전각 공백은 구분자로만 쓰이고 태그에 남지 않는다', () => {
    expect(parseReasonTags('  #a \t #b\n#c　')).toEqual(['#a', '#b', '#c']);
  });

  it('T3 · `#`이 중간에 또 나와도 공백 없이 붙은 덩어리는 한 태그로 두고 고치지 않는다', () => {
    expect(parseReasonTags('#a#b')).toEqual(['#a#b']);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['빈 문자열', ''],
    ['공백뿐', '   \t\n'],
  ])('T4 · %s 이면 빈 결과다', (_label, raw) => {
    expect(parseReasonTags(raw)).toEqual([]);
  });

  it('T5 · `#`이 하나도 없는 옛 문장은 빈 결과다', () => {
    expect(parseReasonTags('오전에 들르기 좋아요')).toEqual([]);
  });

  it.each([['#난타공연 오전에 좋아요'], ['오전에 #난타공연'], ['#a b #c']])(
    'T6 · `#` 아닌 토큰이 하나라도 섞인 %j 은 태그 일부만 남기지 않고 전부 빈 결과다',
    (raw) => {
      expect(parseReasonTags(raw)).toEqual([]);
    }
  );

  it.each([['#'], ['#a #'], ['# #a'], ['#a  #  #b']])(
    'T7 · `#` 단독 토큰이 하나라도 있는 %j 은 빈 태그를 만들지 않고 전부 빈 결과다',
    (raw) => {
      expect(parseReasonTags(raw)).toEqual([]);
    }
  );
});

// ── 속성(PBT) ───────────────────────────────────────────────────────────────────
// 생성기가 "태그 목록 → 입력 문자열"을 구성으로 만들므로, 기대값(태그 목록)은 구현식이 아니라 생성기가 안다.

/** 공백을 뺀 문자 집합 — 태그 안에 공백이 섞여 오라클이 틀어지지 않게 한다. */
const wordChar = fc.constantFrom(
  '가',
  '나',
  '다',
  'a',
  'b',
  '1',
  '_',
  '🙂',
  '#'
);
const word = fc.string({ unit: wordChar, minLength: 1, maxLength: 6 });
/** 서버 형식 태그: `#` + 단어. */
const tag = word.map((one) => `#${one}`);
/** `#` 로 시작하지 않는 토큰. */
const plainToken = fc
  .tuple(
    fc.constantFrom('가', 'a', '1', '_'),
    fc.string({ unit: wordChar, maxLength: 5 })
  )
  .map(([head, rest]) => `${head}${rest}`);
/** 구분 공백 열(1~3자) — 스페이스·탭·줄바꿈·전각 공백. */
const gap = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '　'),
  minLength: 1,
  maxLength: 3,
});
const edge = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '　'),
  maxLength: 3,
});

/** 토큰 목록을 임의 공백 열로 잇고 앞뒤에도 공백을 붙인다. */
function joinWithGaps(
  tokens: string[],
  gaps: string[],
  lead: string,
  trail: string
): string {
  return (
    lead +
    tokens
      .map((one, index) => (index === 0 ? one : `${gaps[index - 1]}${one}`))
      .join('') +
    trail
  );
}

describe('parseReasonTags — 속성', () => {
  it('PB1 · 어떤 문자열이 들어와도 결과는 비었거나 모든 항목이 `#`로 시작하고 공백이 없고 `#` 단독이 아니다 (P2)', () => {
    const anyText = fc.oneof(
      fc.string(),
      fc.string({
        unit: fc.constantFrom('#', 'a', '가', ' ', '\t', '\n', '　'),
      })
    );
    fc.assert(
      fc.property(anyText, (raw) => {
        const result = parseReasonTags(raw);
        result.forEach((item) => {
          expect(item.startsWith('#')).toBe(true);
          expect(/\s/.test(item)).toBe(false);
          expect(item.length).toBeGreaterThanOrEqual(2);
        });
      })
    );
  });

  it('PB2 · 태그 목록을 임의 공백으로 이은 입력은 그 목록 그대로(순서·내용 불변) 돌아온다 (P1·P5)', () => {
    fc.assert(
      fc.property(
        fc.array(tag, { minLength: 1, maxLength: 6 }),
        fc.array(gap, { minLength: 6, maxLength: 6 }),
        edge,
        edge,
        (tags, gaps, lead, trail) => {
          expect(
            parseReasonTags(joinWithGaps(tags, gaps, lead, trail))
          ).toEqual(tags);
        }
      )
    );
  });

  it('PB3 · 태그들 사이 어디든 `#` 아닌 토큰이 하나 끼면 전부 빈 결과다 (01b Q2)', () => {
    fc.assert(
      fc.property(
        fc.array(tag, { minLength: 1, maxLength: 5 }),
        plainToken,
        fc.nat(),
        fc.array(gap, { minLength: 6, maxLength: 6 }),
        edge,
        edge,
        (tags, intruder, at, gaps, lead, trail) => {
          const tokens = [...tags];
          tokens.splice(at % (tokens.length + 1), 0, intruder);
          expect(
            parseReasonTags(joinWithGaps(tokens, gaps, lead, trail))
          ).toEqual([]);
        }
      )
    );
  });

  it('PB4 · 태그들 사이 어디든 `#` 단독 토큰이 하나 끼면 전부 빈 결과다 (01b Q2)', () => {
    fc.assert(
      fc.property(
        fc.array(tag, { minLength: 0, maxLength: 5 }),
        fc.nat(),
        fc.array(gap, { minLength: 6, maxLength: 6 }),
        edge,
        edge,
        (tags, at, gaps, lead, trail) => {
          const tokens = [...tags];
          tokens.splice(at % (tokens.length + 1), 0, '#');
          expect(
            parseReasonTags(joinWithGaps(tokens, gaps, lead, trail))
          ).toEqual([]);
        }
      )
    );
  });
});
