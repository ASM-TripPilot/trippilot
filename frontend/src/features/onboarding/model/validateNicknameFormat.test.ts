import fc from 'fast-check';

import {
  validateNicknameFormat,
  NICKNAME_MIN_LENGTH,
  NICKNAME_MAX_LENGTH,
} from './validateNicknameFormat';

/**
 * AC B4 + B군 주석(PBT 지정) — 닉네임 **형식** 검증 (BR-U0-15 2~20자).
 *
 * 무엇을 보장하나:
 *  (1) 길이 규칙 2~20자를 **글자 수(코드포인트)** 기준으로 정확히 판정한다,
 *  (2) 클라이언트는 **내용을 판정하지 않는다** — 금칙어·중복은 서버 권한이라
 *      같은 길이의 서로 다른 문자열은 언제나 같은 판정을 받아야 한다.
 *
 * (2)가 이 파일의 핵심이다. 클라에 금칙어 사전이 스며들면 서버와 규칙이 갈라져
 * "클라는 막는데 서버는 허용"(또는 그 반대)이 생긴다. 성질로 못 박아 그 유입을 차단한다.
 *
 * *(개념)* 코드포인트: 사람이 세는 '글자' 단위. JS 의 `'🌍'.length` 는 2(UTF-16 두 칸)지만
 * `[...'🌍'].length` 는 1이다. DB 는 `char_length`(글자 수)로 검사하므로(V1.5) 클라도
 * 코드포인트로 세야 서버와 판정이 일치한다 — `.length` 를 쓰면 이모지 닉네임에서 갈라진다.
 */

/** 사람이 세는 글자 수. 서로게이트 쌍(이모지)을 1글자로 센다. */
function codePointLength(value: string): number {
  return [...value].length;
}

/** 잘 형성된(lone surrogate 없는) 문자열만 만들기 위해 코드포인트를 직접 조립한다. */
const codePointArb = fc
  .oneof(
    fc.integer({ min: 0x41, max: 0x5a }), // A-Z
    fc.integer({ min: 0xac00, max: 0xd7a3 }), // 한글 음절
    fc.integer({ min: 0x1f300, max: 0x1f5ff }) // 이모지(서로게이트 쌍)
  )
  .map((cp) => String.fromCodePoint(cp));

/** 길이(글자 수)를 지정해 임의 닉네임 문자열을 만든다. */
function nicknameArb(minLength: number, maxLength: number) {
  return fc
    .array(codePointArb, { minLength, maxLength })
    .map((chars) => chars.join(''));
}

function expectedReason(length: number): 'OK' | 'TOO_SHORT' | 'TOO_LONG' {
  if (length < NICKNAME_MIN_LENGTH) return 'TOO_SHORT';
  if (length > NICKNAME_MAX_LENGTH) return 'TOO_LONG';
  return 'OK';
}

describe('validateNicknameFormat — 경계 예제 (AC B4)', () => {
  // 경계값을 한 it 에 모아 둔다 — 하나라도 어긋나면 이 테스트가 빨개진다.
  it('2자 미만은 거부, 2~20자는 허용, 20자 초과는 거부한다', () => {
    expect(validateNicknameFormat('')).toEqual({
      valid: false,
      reason: 'TOO_SHORT',
    });
    expect(validateNicknameFormat('가')).toEqual({
      valid: false,
      reason: 'TOO_SHORT',
    });
    expect(validateNicknameFormat('가나')).toEqual({
      valid: true,
      reason: 'OK',
    });
    expect(validateNicknameFormat('가'.repeat(20))).toEqual({
      valid: true,
      reason: 'OK',
    });
    expect(validateNicknameFormat('가'.repeat(21))).toEqual({
      valid: false,
      reason: 'TOO_LONG',
    });
  });

  // 서버(V1.5 char_length)와 세는 단위를 맞춘다. `.length` 로 세면 이 테스트가 빨개진다:
  // '🌍🌎' 는 .length===4 라 TOO_SHORT 를 면해도, 20자 이모지는 .length===40 → TOO_LONG 오판.
  it('이모지를 1글자로 센다 — 서버의 글자 수 기준과 일치한다', () => {
    expect(validateNicknameFormat('🌍🌎')).toEqual({
      valid: true,
      reason: 'OK',
    });
    expect(validateNicknameFormat('🌍'.repeat(20))).toEqual({
      valid: true,
      reason: 'OK',
    });
    expect(validateNicknameFormat('🌍')).toEqual({
      valid: false,
      reason: 'TOO_SHORT',
    });
  });
});

describe('validateNicknameFormat — 성질/PBT (B군 주석)', () => {
  it('임의 문자열에 대해 판정이 글자 수 규칙과 정확히 일치하고, 사유는 형식 3종만 낸다', () => {
    fc.assert(
      fc.property(nicknameArb(0, 30), (value) => {
        const result = validateNicknameFormat(value);
        const length = codePointLength(value);

        expect(result.valid).toBe(
          length >= NICKNAME_MIN_LENGTH && length <= NICKNAME_MAX_LENGTH
        );
        expect(result.reason).toBe(expectedReason(length));
        // 서버 권한 사유가 클라에서 나오면 경계 침범이다.
        expect(['OK', 'TOO_SHORT', 'TOO_LONG']).toContain(result.reason);
      }),
      { numRuns: 500 }
    );
  });

  it('내용에 의존하지 않는다 — 글자 수가 같은 서로 다른 문자열은 항상 같은 판정을 받는다 (금칙어·중복은 서버 권한)', () => {
    // *(개념)* `chain` = 먼저 뽑은 값(길이)에 의존해 다음 값을 뽑는 조합기.
    // 길이를 먼저 정하고, **그 길이의** 서로 다른 문자열 2개를 만들어 짝지어 준다.
    const sameLengthPairArb = fc
      .integer({ min: 0, max: 30 })
      .chain((length) =>
        fc.tuple(
          fc.constant(length),
          nicknameArb(length, length),
          nicknameArb(length, length)
        )
      );

    fc.assert(
      fc.property(sameLengthPairArb, ([length, a, b]) => {
        const first = validateNicknameFormat(a);
        const second = validateNicknameFormat(b);

        // 같은 길이 → 같은 판정. 클라가 내용을 본다면 여기서 갈라진다.
        expect(second).toEqual(first);
        // 내용 무관하기만 하고 값이 틀리면 의미가 없으므로 정답도 고정한다.
        expect(first.reason).toBe(expectedReason(length));
      }),
      { numRuns: 500 }
    );
  });
});
