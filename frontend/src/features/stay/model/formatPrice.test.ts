import fc from 'fast-check';

import { formatPrice } from './formatPrice';

/**
 * TRIP-180 · US-STAY-01 — formatPrice: 최저가 스냅숏 → 카드 금액 문자열.
 *
 * 무엇을 보장하나: 스냅숏이 없으면(null·undefined·인자 생략) 항상 "가격 미확인"을,
 * 있으면 어떤 정수 금액·어떤 통화 문자열에서도 "{천단위구분}원~" 꼴을 반환한다.
 * 반환값에 duration·분·소요 같은 소요 시간 표현이 없고(INV-3), 같은 입력을 두 번
 * 호출하면 같은 값이 나온다(결정성). 순수 함수(부수효과 없음)라 화면·서버 없이
 * 검증한다. `· 1박` 합성·통화 분기·48h 신선도는 이 함수의 범위 밖이다.
 *
 * 3동작: 준비(입력 값·arbitrary) → 실행(formatPrice 호출) → 단언(반환 문자열).
 */

// PBT 입력 도메인(describe 밖 — 파일 전체에서 재사용).

// amountArb — 계약 기준(D-Q1): 정수·비음수·JS 안전정수 상한까지. min: 0은 amount === 0을
// "가격 있음"(0원~)으로 판정하는 falsy 함정(D-Q3)을 표본에 밟히게 하는 장치다.
const amountArb = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

// priceArb — 스냅숏이 "있는" 경우의 형태. currency는 fc.string()으로 임의화해
// "출력이 currency와 무관하다"를 공짜 속성으로 얻는다(D-Q2).
const priceArb = fc.record({ amount: amountArb, currency: fc.string() });

// absentArb — 스냅숏이 "없는" 두 형태. StayItem.price가 optional이면서 nullable이라
// 실제로 null·undefined 둘 다 온다.
const absentArb = fc.constantFrom(null, undefined);

// anyInputArb — 있음/없음 두 갈래를 약 50:50으로 섞는다. fc.oneof는 arbitrary를,
// fc.constantFrom은 값을 받는다 — 이 중첩 순서(oneof 바깥 / constantFrom 안쪽)를
// 뒤집으면 에러 없이 조용히 잘못 돈다.
const anyInputArb = fc.oneof(absentArb, priceArb);

describe('formatPrice — 최저가 스냅숏 → 카드 금액 문자열 (TRIP-180)', () => {
  it('스냅숏이 없으면(null·undefined·인자 생략) 항상 "가격 미확인"을 반환한다 (AC-1)', () => {
    // 준비 — 입력 후보가 null·undefined·인자 생략 3개뿐인 유한 집합이라 PBT를 쓰지 않는다.
    // 실행 + 단언 — 세 꼴 각각 완전 일치로 확인한다.
    expect(formatPrice(null)).toBe('가격 미확인');
    expect(formatPrice(undefined)).toBe('가격 미확인');
    expect(formatPrice()).toBe('가격 미확인'); // 인자 생략 = 필드 자체가 응답에서 빠진 경우
  });

  it('스냅숏이 있으면 어떤 정수 금액·어떤 통화에서도 "{천단위구분}원~" 꼴을 지킨다 (AC-2, PBT)', () => {
    fc.assert(
      fc.property(priceArb, (price) => {
        // 준비 — priceArb가 { amount, currency }를 임의로 만든다.
        // 실행
        const out = formatPrice(price);

        // 단언 L1 — 모양 앵커: 문자열 전체가 [숫자·쉼표]+ 뒤에 원~ 로 끝난다.
        expect(out).toMatch(/^[0-9,]+원~$/);

        // 단언 L2 — 정보 보존: 쉼표를 지우면 원래 숫자가 그대로 남는다(자릿수 유실·왜곡 차단).
        expect(out.replace(/,/g, '')).toBe(String(price.amount) + '원~');

        // 단언 L3 — 자리수 규칙: 원~ 를 벗긴 숫자부가 "맨 앞 1~3자리 + (쉼표+3자리) 반복"이다.
        expect(out.replace(/원~$/, '')).toMatch(/^\d{1,3}(,\d{3})*$/);

        // 단언 L4 — 경계 명시(의도된 중복, L1에 이미 함의됨): `· 1박`은 StayCard(TRIP-181) 몫이다.
        expect(out).not.toContain('1박');
      }),
      { numRuns: 500 }
    );
  });

  it('경계 금액을 손으로 적은 기대값과 대조한다 — 0·한자리·999·1000·상한 (AC-2, 예제)', () => {
    // 준비 — 금액과 기대 문자열 쌍(currency는 'KRW' 고정 — 이 케이스는 금액 서식만 본다).
    const CASES = [
      [0, '0원~'],
      [7, '7원~'],
      [999, '999원~'],
      [1000, '1,000원~'],
      [120000, '120,000원~'],
      [9007199254740991, '9,007,199,254,740,991원~'],
    ] as const;

    // 실행 + 단언 — 표를 순회하며 완전 일치로 대조한다.
    for (const [amount, expected] of CASES) {
      expect(formatPrice({ amount, currency: 'KRW' })).toBe(expected);
    }
  });

  it('어떤 입력에서도 반환값에 duration·분·소요가 없다 (AC-3, PBT)', () => {
    fc.assert(
      fc.property(anyInputArb, (input) => {
        // 준비 — anyInputArb(있음/없음 두 갈래를 섞은 입력).
        // 실행
        const out = formatPrice(input);

        // 단언 — 긍정 앵커 먼저(없으면 아래 부정 3줄은 빈 문자열에도 통과한다).
        expect(out).toMatch(/^(가격 미확인|[0-9,]+원~)$/);

        // 단언 — 부정 3종(DoD 명시). 확장(시간·min·hr)은 정본 근거가 없어 넣지 않는다.
        expect(out).not.toMatch(/duration/i);
        expect(out).not.toContain('분');
        expect(out).not.toContain('소요');
      }),
      { numRuns: 500 }
    );
  });

  it('같은 입력을 두 번 호출하면 같은 값을 반환한다 (AC-5, PBT)', () => {
    fc.assert(
      fc.property(anyInputArb, (input) => {
        // 준비 — anyInputArb.
        // 실행 — 같은 input으로 두 번 호출한다.
        const first = formatPrice(input);
        const second = formatPrice(input);

        // 단언 — 두 값이 완전 일치한다(호출 사이에 남는 상태·난수가 없다).
        expect(second).toBe(first);
      }),
      { numRuns: 500 }
    );
  });
});
