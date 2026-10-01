import fc from 'fast-check';

import { withObjectParticle } from './objectParticle';

/**
 * TRIP-800 · AC-5 — CTA `{숙소}을/를 거점으로` 의 목적격 조사 선택(순수 함수).
 *
 * 무엇을 보장하나:
 *  - 끝 글자가 한글 음절이면 받침이 있으면 `을`, 없으면 `를`(`호텔을` / `오션뷰를`).
 *  - 끝 글자가 한글 음절이 아니면(영문·숫자·기호·호환 자모) `을(를)` 병기 — 틀린 조사보다 안전(01b Q8).
 *
 * ★ 오라클은 "합성"이다(02a ★1). 구현은 글자 코드를 **분해**해 받침을 읽을 것이다. 테스트가 같은 식으로
 *   기대값을 만들면 같은 버그를 같이 가진다(순환 심판). 그래서 초성·중성·종성 번호로 음절을 **조립**하고
 *   "종성 번호가 0 인가"로 기대값을 낸다. 조립식 범위(초 19 × 중 21 × 종 28)가 곧 한글 음절 전 범위
 *   `가`(U+AC00)~`힣`(U+D7A3)이다(02a §5 실측).
 *
 * (개념) PBT — 예시 몇 개 대신 "어떤 입력에도 성립할 성질"을 적으면 fast-check 가 무작위 입력 수백 개로
 *   반례를 찾는다. `fc.tuple(a, b, …)` 은 여러 무작위 값을 한 묶음으로 만든다.
 */

const HANGUL_BASE = 0xac00;

/** 초성(0–18)·중성(0–20)·종성(0–27, 0=받침 없음) 번호로 한글 음절 한 글자를 조립한다. */
function composeSyllable(cho: number, jung: number, jong: number): string {
  return String.fromCharCode(HANGUL_BASE + (cho * 21 + jung) * 28 + jong);
}

describe('P1 · 예시 — 화면에 실제로 나오는 이름', () => {
  it.each([
    ['해운대 그랜드 호텔', '해운대 그랜드 호텔을'],
    ['서면 시티 호텔', '서면 시티 호텔을'],
    ['광안리 오션뷰', '광안리 오션뷰를'],
    ['Hotel ABC', 'Hotel ABC을(를)'],
    ['스테이 2', '스테이 2을(를)'],
  ])('%s → %s', (name, expected) => {
    // 준비·실행 — 이름 하나를 넣는다.
    const result = withObjectParticle(name);

    // 단언 — 조사까지 붙은 문자열이 정확히 같다.
    expect(result).toBe(expected);
  });
});

describe('P2 · PBT — 끝 글자가 한글 음절이면 받침 유무로 을/를이 갈린다', () => {
  it('임의 앞 문자열 + 조립한 음절 → 받침 있으면 을, 없으면 를', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.tuple(
          fc.integer({ min: 0, max: 18 }),
          fc.integer({ min: 0, max: 20 }),
          fc.integer({ min: 0, max: 27 })
        ),
        (prefix, [cho, jung, jong]) => {
          // 준비 — 앞부분은 아무 문자열, 끝 글자는 조립한 음절.
          const word = prefix + composeSyllable(cho, jung, jong);

          // 실행
          const result = withObjectParticle(word);

          // 단언 — 종성 번호 0(받침 없음)이면 를, 아니면 을.
          expect(result).toBe(word + (jong === 0 ? '를' : '을'));
        }
      )
    );
  });
});

describe('P3 · PBT — 끝 글자가 한글 음절 밖이면 을(를) 병기', () => {
  it('ASCII 인쇄 문자·호환 자모·음절 블록 바로 앞/뒤 문자로 끝나면 word + 을(를)', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.oneof(
          // 영문·숫자·기호(공백 제외 인쇄 가능 ASCII).
          fc.integer({ min: 0x21, max: 0x7e }),
          // 호환 자모(ㄱ U+3131 ~ ㆎ U+318E) — 한글처럼 보이지만 음절 블록 밖이다(02a ★2).
          fc.integer({ min: 0x3131, max: 0x318e }),
          // 5-b 후속(03b 참고-1) — 음절 블록 **바로 앞**(U+AB00~U+ABFF). 하한 판정을 느슨하게 쓴 구현을 잡는다.
          fc.integer({ min: 0xab00, max: 0xabff }),
          // 음절 블록 **바로 뒤**(U+D7A4~U+D7FF)와 서러게이트 뒤 BMP(U+E000~U+FFFF, 전각 `）`·`～` 포함).
          // 상한 판정을 `<= 0xffff` 처럼 넓힌 구현이 이 문자들에 임의의 을/를을 붙인다(02a ★1b).
          // 서러게이트(U+D800~U+DFFF)는 단독으로 글자가 아니라서 뺀다.
          fc.integer({ min: 0xd7a4, max: 0xd7ff }),
          fc.integer({ min: 0xe000, max: 0xffff })
        ),
        (prefix, code) => {
          const word = prefix + String.fromCharCode(code);

          const result = withObjectParticle(word);

          expect(result).toBe(`${word}을(를)`);
        }
      )
    );
  });
});

describe('P4 · 경계 — 음절 블록의 첫 글자와 마지막 글자', () => {
  it('가(U+AC00) → 가를 · 힣(U+D7A3) → 힣을', () => {
    expect(withObjectParticle('가')).toBe('가를');
    expect(withObjectParticle('힣')).toBe('힣을');
  });

  it('블록 바로 앞 U+ABFF · 바로 뒤 U+D7A4 · 전각 괄호 U+FF09 → 을(를) (5-b 후속, 03b 참고-1)', () => {
    expect(withObjectParticle('\uABFF')).toBe('\uABFF을(를)');
    expect(withObjectParticle('\uD7A4')).toBe('\uD7A4을(를)');
    expect(withObjectParticle('해운대 호텔（본관）')).toBe(
      '해운대 호텔（본관）을(를)'
    );
  });
});
