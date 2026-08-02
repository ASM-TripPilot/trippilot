import fc from 'fast-check';

import type { CreateTripRequest } from '@/shared/api/generated/schemas';

import {
  buildCreateTripRequest,
  type CreateTripInput,
} from './createTripRequest';

/**
 * TRIP-207 AC-2 · AC-3 (TRIP-203 AC-5 · AC-6 갱신) — 서버로 나갈 여행 생성 본문의 조립.
 *
 * 무엇을 보장하나:
 *  - **사용자가 예산을 넣었으면 그대로 실리고, 안 넣었으면 `budgetTotal` 키 자체가 안 붙는다**
 *    (AC-2 · AC-3). "키 부재"와 "`null` 전송"은 서버에 다른 뜻이다 — 선례
 *    `buildStayRegisterRequest`(TRIP-198 AC-5)가 날짜에 대해 세운 규칙과 같은 성질이다.
 *  - **어떤 입력에서도 `preferenceSnapshot`을 보내지 않는다**. 생성 시점 취향 동결은 서버
 *    책임이고(BE TRIP-177 · BR-U1-38 "계정 취향은 불변"), 계약상 필수가 아니다.
 *
 * ── ⚠️ TRIP-207에서 **성질의 주어가 바뀌었다** (02a §6-1) ──────────────────
 * TRIP-203 승인분은 "`budgetTotal` 키의 유무 = **취향의** `rawAmount`가 숫자인가"를 잠갔다.
 * 그때는 예산 입력 UI가 없어 취향 러프값을 그대로 실어 보내는 것이 유일한 경로였기 때문이다.
 * TRIP-207이 예산 입력을 붙이면서 US-TRIP-01("예산은 **선택**")이 요구하는 것이 뒤집혔다 —
 * **사용자가 비웠으면 취향에 값이 있어도 보내지 않는다**(AC-2). 그래서 성질의 주어가
 * *취향* → *입력*으로 옮겨 갔고, 이 함수는 취향을 아예 인자로 받지 않는다.
 *
 * **약화가 아니라 강화다.** ① 양자화 축에 "**키는 있는데 값이 `undefined`**"가 새로 들어왔다 —
 * 취향에서 오는 값은 그 상태가 될 수 없어 옛 성질에 아예 없던 갈래인데, 이제 배선이
 * `budgetTotal: parsed.kind === 'amount' ? amount : undefined`로 그 상태를 실제로 만든다.
 * ② 취향이 예산에 영향을 줄 경로가 **타입 단계에서 사라졌다**(인자가 없다) — 테스트로 지키는
 * 것보다 강하다. ③ `preferenceSnapshot` 성질은 그대로 두고 PBT 축에 "스냅숏을 실제로 주입한
 * 입력"을 더해 오히려 넓혔다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 잠그는 것이 "무엇을 보내고 무엇을 안 보내는가"라 여행 생성
 * 화면(TRIP-208·209)이 붙어도 red를 내지 않는다. 갱신 시점은 계약이 바뀔 때뿐이다.
 */

/** 픽스처는 파일마다 각자 갖는 것이 리포 관례다. 예산은 일부러 없다 — 선택 항목이다. */
const BASE_INPUT: CreateTripInput = {
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  party: 2,
  destinations: [{ seq: 1, region: '제주', nights: 2 }],
};

const BASE_FIELDS = {
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  party: 2,
  destinations: [{ seq: 1, region: '제주', nights: 2 }],
};

describe('AC-3 · 사용자가 넣은 예산이 그대로 실린다', () => {
  it('입력의 budgetTotal이 정수 그대로 통과한다', () => {
    // 준비 → 실행
    const request = buildCreateTripRequest({
      ...BASE_INPUT,
      budgetTotal: 1200000,
    });

    // 단언 — 입력은 가공 없이 통과한다.
    expect(request).toEqual({ ...BASE_FIELDS, budgetTotal: 1200000 });
  });

  it('0원도 실린다 — 거짓값으로 접히지 않는다', () => {
    // 0은 거짓값이지만 "사용자가 예산 0을 골랐다"는 유효한 값이다. `input.budgetTotal ? … : …`
    // 꼴로 쓰면 여기서 키가 사라진다(02a ★2 — `formatPrice`가 `== null`을 쓰는 것과 같은 이유).
    const request = buildCreateTripRequest({ ...BASE_INPUT, budgetTotal: 0 });

    expect('budgetTotal' in request).toBe(true);
    expect(request.budgetTotal).toBe(0);
  });
});

describe('AC-2 · 예산이 없으면 키 자체가 붙지 않는다', () => {
  /**
   * "없음"이 세 갈래다. 셋 다 결과가 같아야 한다 — **키가 아예 없다.**
   *
   * `toEqual`은 값이 `undefined`인 키를 무시하므로, 객체 비교만으로는
   * `{budgetTotal: undefined}`와 키 부재를 구별하지 못한다(선례 `stayRegisterForm.test.ts:181`이
   * 같은 함정을 적어 뒀다). 그래서 `in` 연산자로 키의 존재 자체를 따로 잠근다.
   *
   * ⚠️ 두 번째 갈래(`undefined`)가 TRIP-207에서 새로 현실이 된 자리다 — 배선이 파싱 결과에
   * 따라 `budgetTotal: undefined`를 실제로 만들고, 그 객체를 `{...input}`으로 그냥 펼치면
   * **값이 `undefined`인 키가 결과에 남는다**(02a ★3). 스프레드 전에 값에서 떼어내야 한다.
   */
  const ABSENT_CASES: { name: string; input: CreateTripInput }[] = [
    { name: '키가 아예 없다(예산을 안 건드림)', input: BASE_INPUT },
    {
      name: '키는 있는데 값이 undefined다(파싱 결과 없음)',
      input: { ...BASE_INPUT, budgetTotal: undefined },
    },
    {
      name: '값이 null이다(계약상 nullable)',
      input: { ...BASE_INPUT, budgetTotal: null },
    },
  ];

  it.each(ABSENT_CASES)(
    '$name → budgetTotal 키가 붙지 않는다 (null 전송이면 실패)',
    ({ input }) => {
      const request = buildCreateTripRequest(input);

      expect(request).toEqual(BASE_FIELDS);
      expect('budgetTotal' in request).toBe(false);
    }
  );
});

describe('preferenceSnapshot을 보내지 않는다 (BR-U1-38)', () => {
  /**
   * ⚠️ `CreateTripInput`의 `Omit`은 **타입 선언에서만** 그 키를 지운다 — 구조적 타이핑 때문에
   * 그 키를 실제로 가진 값(예: `CreateTripRequest` 타입 변수)을 넘기는 것 자체는 막지 못한다
   * (TRIP-203 code-critic W-1 실측). 그래서 아래 케이스는 **일부러 값에 스냅숏을 심어** 넘긴다.
   */
  const ALL_CASES: { name: string; input: CreateTripRequest }[] = [
    {
      name: '예산 있음 + 스냅숏이 값으로 섞여 들어옴',
      input: {
        ...BASE_FIELDS,
        budgetTotal: 1200000,
        preferenceSnapshot: { pace: '균형있게' },
      },
    },
    {
      name: '예산 없음 + 스냅숏이 값으로 섞여 들어옴',
      input: { ...BASE_FIELDS, preferenceSnapshot: {} },
    },
  ];

  it.each(ALL_CASES)('$name → 요청 바디에 키가 없다', ({ input }) => {
    const request = buildCreateTripRequest(input);

    // 긍정 짝 — 조립이 실제로 뭔가를 만들었다. 이게 없으면 빈 객체를 돌려주는 구현도
    // "스냅숏 키 없음"을 통과한다.
    expect(request.startDate).toBe('2026-09-01');

    expect('preferenceSnapshot' in request).toBe(false);
  });
});

describe('AC-2 · AC-3 불변식 — 임의의 입력에 대해 (PBT)', () => {
  /**
   * 예시가 못 보는 구석을 훑는다: 금액이 0이든 크든, 키가 있든 없든, 값이 `null`이든
   * `undefined`든 **규칙은 하나다** — `budgetTotal` 키의 유무가 "입력의 `budgetTotal`이
   * 숫자인가"와 정확히 일치하고, `preferenceSnapshot`은 항상 없다.
   *
   * 축이 셋이다: ① 값(정수 | `null` | `undefined`) ② **키를 실제로 넣는지**(키 부재와
   * `undefined` 값을 가르는 축 — 02a ★3) ③ 스냅숏이 값으로 섞여 들어오는지(★4).
   */
  it('budgetTotal 키의 유무가 입력 값의 타입으로만 갈리고, preferenceSnapshot은 항상 없다', () => {
    fc.assert(
      fc.property(
        fc.option(
          fc.option(fc.integer({ min: 0, max: 100_000_000 }), { nil: null }),
          { nil: undefined }
        ),
        fc.boolean(),
        fc.boolean(),
        (budgetTotal, includeKey, injectSnapshot) => {
          const input = {
            ...BASE_FIELDS,
            ...(includeKey ? { budgetTotal } : {}),
            ...(injectSnapshot
              ? { preferenceSnapshot: { pace: '균형있게' } }
              : {}),
          } as CreateTripInput;

          const request = buildCreateTripRequest(input);

          const shouldCarryBudget =
            includeKey && typeof budgetTotal === 'number';
          expect('budgetTotal' in request).toBe(shouldCarryBudget);
          if (shouldCarryBudget) {
            expect(request.budgetTotal).toBe(budgetTotal);
          }

          expect('preferenceSnapshot' in request).toBe(false);

          // 나머지 입력은 어떤 조합에서도 가공되지 않는다.
          expect(request.startDate).toBe(BASE_FIELDS.startDate);
          expect(request.destinations).toEqual(BASE_FIELDS.destinations);
        }
      ),
      { numRuns: 500 }
    );
  });
});
