import fc from 'fast-check';

import {
  formatBudgetAmount,
  parseBudgetAmount,
  type BudgetAmount,
} from './budgetAmount';

/**
 * TRIP-207 AC-3 · AC-5 (01b D7 · D8) — 예산 총액의 **표시값 ↔ 전송값** 변환.
 *
 * 무엇을 보장하나:
 *  - 화면에 보이는 `1,200,000`과 서버로 가는 정수 `1200000` 사이를 오가는 규칙이 하나다.
 *  - "비어 있음"과 "숫자로 못 읽음"이 **다른 갈래**다 — 전자는 키를 생략할 뿐 오류가 아니고
 *    (AC-2), 후자만 오류 표시 + 전송 금지다(AC-4).
 *  - 천단위 구분을 **직접 삽입한 정규식**으로 찍는다. `toLocaleString`/`Intl`은 쓰지 않는다
 *    — 테스트는 node, 앱은 Hermes에서 돌아 로케일 서식이 갈릴 수 있고 **그 갈림을 테스트가
 *    원리적으로 못 본다**(`formatPrice.ts` 선례 · 01b D5). 그 금지는 렌더로 관찰할 수 없어
 *    `src/__tests__/tripBudgetStructure.test.ts`가 소스 층에서 따로 잠근다.
 *
 * > *(개념)* **판별 유니온(discriminated union)** — `kind`라는 공통 꼬리표 하나로 갈래를
 * > 구분하는 타입. `null`을 돌려주고 "없음인지 오류인지"를 호출부가 다시 추측하게 하는 대신,
 * > **세 갈래를 타입이 직접 이름 짓는다.** 리포 선례는 `resolveStaySearchState`(TRIP-182)의
 * > 5갈래 `kind`다.
 *
 * > *(개념)* **PBT(속성 기반 테스트)** — 예시를 손으로 적는 대신 "어떤 입력에도 항상 참인
 * > 성질"을 적고, fast-check가 입력을 수백 개 만들어 반례를 찾는다. 다만 **생성기가 못 만드는
 * > 입력은 원리적으로 못 본다** — 그래서 아래 예제 표가 PBT와 짝을 이룬다(02a §5-7 실측:
 * > `fc.string()` 200개 중 전부-숫자 문자열은 4개뿐이었고 전부 1~2자였다).
 *
 * 3동작 뼈대: 준비=입력 문자열 → 실행=parse/format → 단언=갈래와 값.
 */

describe('AC-3 · 콤마 표기를 정수로 읽는다', () => {
  it('1,200,000 → 정수 1200000 (문자열이 아니고 콤마가 없다)', () => {
    const result = parseBudgetAmount('1,200,000');

    expect(result).toEqual({ kind: 'amount', amount: 1200000 });
    // 계약이 `integer`다 — 문자열이나 소수가 흘러가면 서버가 거부한다.
    expect(typeof (result as { amount: number }).amount).toBe('number');
  });

  it('콤마 자리는 보지 않는다 — 1,2,3도 123으로 읽는다', () => {
    // 엄격한 형식 검사(콤마가 3자리마다 정확히 있는지)는 **타이핑 중간 상태를 계속 오류로
    // 만든다**(01b D7이 명시적으로 기각한 선택지). 콤마는 표시용 장식으로 보고 걷어낸다.
    expect(parseBudgetAmount('1,2,3')).toEqual({ kind: 'amount', amount: 123 });
  });

  it('앞뒤 공백은 무시한다', () => {
    expect(parseBudgetAmount('  120000  ')).toEqual({
      kind: 'amount',
      amount: 120000,
    });
  });
});

describe('AC-2 · 0은 유효값이고, 비어 있음은 오류가 아니다', () => {
  it('0원은 "예산 없음"이 아니라 금액 0이다', () => {
    // ⚠️ 0은 거짓값이라 `raw ? … : …` 꼴 판정에서 조용히 "없음"으로 접힌다. 리포에 선례가
    // 둘 있다 — `formatPrice`가 `== null`을 쓰는 이유, TRIP-203 PBT가 `budgetTotal: 0`을
    // 명시적으로 지킨 이유(02a ★2).
    expect(parseBudgetAmount('0')).toEqual({ kind: 'amount', amount: 0 });
    expect(formatBudgetAmount(0)).toBe('0');
  });

  const EMPTY_CASES = [
    { name: '빈 문자열', raw: '' },
    { name: '공백만', raw: '   ' },
    { name: '탭만', raw: '\t' },
  ];

  it.each(EMPTY_CASES)(
    '$name → empty (오류가 아니다 — 키를 생략할 뿐이다)',
    ({ raw }) => {
      // 이 갈래를 `invalid`로 접으면 "예산을 비운 채 다음으로 진행"(AC-2)이 통째로 막힌다.
      expect(parseBudgetAmount(raw)).toEqual({ kind: 'empty' });
    }
  );
});

describe('AC-4 · 숫자로 못 읽는 값은 전부 invalid', () => {
  /**
   * ⚠️ 여기 여섯 줄은 **`Number()` 기반 구현이 조용히 삼키는 입력**이다(02a ★8 · §5-4 실측).
   * `Number('')`=0 · `Number(' ')`=0 · `Number('1e3')`=1000 · `Number('0x10')`=16 ·
   * `Number('Infinity')`=Infinity — `!Number.isNaN(Number(raw))`로 유효성을 판정하면 다섯이
   * 전부 통과하고, 그중 최악은 **빈 입력이 0원으로 전송되는 것**이다.
   *
   * `','` 한 줄이 특히 좁은 함정이다: 콤마를 걷어내면 빈 문자열이 남는데, 판정 정규식을
   * `/^\d*$/`(별표)로 쓰면 매치되고 `Number('')`가 **0원**을 만든다. 별표가 아니라 `+`여야 한다.
   */
  const INVALID_CASES = [
    { name: '콤마만', raw: ',' },
    { name: '지수 표기', raw: '1e3' },
    { name: '16진수 표기', raw: '0x10' },
    { name: 'Infinity', raw: 'Infinity' },
    { name: '음수', raw: '-1' },
    { name: '소수점', raw: '1.5' },
    { name: '단위가 섞인 한글', raw: '120만' },
    { name: '중간 공백', raw: '1 200' },
  ];

  it.each(INVALID_CASES)('$name → invalid', ({ raw }) => {
    expect(parseBudgetAmount(raw)).toEqual({ kind: 'invalid' });
  });

  it('ASCII 숫자가 아닌 숫자 문자도 거부한다', () => {
    // `Number('١٢٣')`·`Number('１２３')`는 NaN이라 `Number` 기반 구현도 거르지만, "숫자처럼
    // 생겼으니 통과시키자"는 관대한 파싱(`replace(/[^0-9]/g,'')`)은 이것들을 빈 문자열로
    // 만들어 **0원**으로 접는다. 관대한 파싱을 기각한 D7의 자리다.
    expect(parseBudgetAmount('١٢٣')).toEqual({ kind: 'invalid' });
    expect(parseBudgetAmount('１２３')).toEqual({ kind: 'invalid' });
  });
});

describe('AC-5 · 천단위 구분 표기', () => {
  it('3자리마다 콤마가 들어간다', () => {
    expect(formatBudgetAmount(1200000)).toBe('1,200,000');
    expect(formatBudgetAmount(1000)).toBe('1,000');
    // 경계 — 3자리 이하에는 콤마가 없다(`\B` 앵커가 하는 일).
    expect(formatBudgetAmount(999)).toBe('999');
    expect(formatBudgetAmount(1)).toBe('1');
  });
});

describe('AC-3 · AC-5 불변식 — 임의의 값에 대해 (PBT)', () => {
  /**
   * 상한을 1e12로 잡은 것은 01b 사다리와 짝이다 — **클라이언트 자릿수 상한 가드를 넣지
   * 않기로 했으므로**(비즈니스 규칙 권위는 서버) 정밀도가 깨지는 구간을 성질로 요구하지
   * 않는다. 여행 예산이 닿을 수 있는 범위를 넉넉히 덮는다.
   */
  const amountArb = fc.integer({ min: 0, max: 1_000_000_000_000 });

  it('왕복 — 포맷한 것을 다시 파싱하면 원래 정수가 그대로 나온다', () => {
    fc.assert(
      fc.property(amountArb, (amount) => {
        expect(parseBudgetAmount(formatBudgetAmount(amount))).toEqual({
          kind: 'amount',
          amount,
        });
      }),
      { numRuns: 500 }
    );
  });

  it('포맷 결과는 3자리 그룹 형태이고, 콤마를 지우면 원래 숫자다', () => {
    fc.assert(
      fc.property(amountArb, (amount) => {
        const formatted = formatBudgetAmount(amount);

        // 콤마가 3자리 경계에만 들어간다 — `1,2,3` 같은 표기를 **만들지는** 않는다
        // (읽을 때는 관대하고 쓸 때는 엄격하다).
        expect(formatted).toMatch(/^\d{1,3}(,\d{3})*$/);
        expect(formatted.replace(/,/g, '')).toBe(String(amount));
      }),
      { numRuns: 500 }
    );
  });

  /**
   * 분류 완전성 — 어떤 문자열에도 결과가 세 갈래 중 **정확히 하나**이고 "아무것도 아님"이
   * 없다(INV-4 계열, `resolveStaySearchState` 선례).
   *
   * ⚠️ 생성기를 `fc.string()`으로 두면 이 성질이 **사실상 invalid 갈래만 훑는다** — 200
   * 샘플 중 전부-숫자 문자열이 4개뿐이었고 전부 1~2자였다(02a §5-7 실측). 그래서 예산 입력에
   * 실제로 등장하는 글자(숫자·콤마·공백·문자·점·부호)로 알파벳을 좁힌 혼합 생성기를 쓴다 —
   * 300 샘플에서 empty 42 / amount 32 / invalid 226으로 **세 갈래가 전부 나온다**(실측).
   * 그래도 생성기가 못 만드는 갈래(`0x10`·`Infinity`·전각 숫자)는 위 예제 표가 덮는다.
   */
  const mixedArb = fc.string({
    unit: fc.constantFrom('0', '1', '9', ',', ' ', 'a', '.', '-'),
    maxLength: 10,
  });

  it('어떤 문자열에도 갈래가 정확히 하나이고, amount면 0 이상 정수다', () => {
    const KINDS: BudgetAmount['kind'][] = ['empty', 'amount', 'invalid'];

    fc.assert(
      fc.property(mixedArb, (raw) => {
        const result = parseBudgetAmount(raw);

        expect(KINDS).toContain(result.kind);
        if (result.kind === 'amount') {
          expect(Number.isInteger(result.amount)).toBe(true);
          expect(result.amount).toBeGreaterThanOrEqual(0);
          // 전송값이 유한하지 않으면 JSON이 `null`로 직렬화돼 서버가 거부한다.
          expect(Number.isFinite(result.amount)).toBe(true);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('공백만으로 이뤄진 문자열은 항상 empty다 (amount 0으로 접히지 않는다)', () => {
    // `Number(' ')`가 0이라는 사실(§5-4 실측)이 정확히 이 성질을 깨는 자리다.
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(' ', '\t'), maxLength: 6 }),
        (blank) => {
          expect(parseBudgetAmount(blank)).toEqual({ kind: 'empty' });
        }
      ),
      { numRuns: 200 }
    );
  });
});
