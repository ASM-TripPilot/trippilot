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
 *  - **입력이 `preferenceSnapshot`을 실었으면 결과에 그대로 통과시키고, 없으면 결과에도
 *    없다**(TRIP-484 정책 A). 예전엔 이 함수가 스냅숏을 **런타임으로 능동 제거**했으나(생성
 *    시점 동결을 서버 책임으로 봤다), 여행 단위 취향 override(BR-U1-38·G-U1-11)를 실으려면 FE가
 *    보내야 한다 — BE(`TripApiIT`)는 받은 것만 저장하고 스스로 동결하지 않는다. 이 함수는
 *    **지어내지도 지우지도 않는다**(조건부 통과) — 무엇을 실을지는 배선(page)이 정한다.
 *
 * ── ⚠️ TRIP-484에서 **스냅숏 성질이 반전됐다** (동결 개봉, 정책 A) ──────────────
 * 예산 성질은 TRIP-207 그대로다 — `budgetTotal` 키의 유무가 "입력의 `budgetTotal`이 숫자인가"와
 * 정확히 일치한다(취향은 이 함수 인자에 없다). **바뀐 것은 `preferenceSnapshot` 성질뿐이다**:
 * 예전엔 "어떤 입력에서도 안 실린다"(능동 제거)였으나, 이제 "입력에 있으면 그대로 통과, 없으면
 * 부재"(조건부 통과)다. 계약(`preferenceSnapshot`은 자유형 jsonb)은 이미 열려 있었고, 이 함수는
 * 그 통로를 막던 제거 로직을 걷었다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 잠그는 것이 "무엇을 보내고 무엇을 안 보내는가"라 여행 생성
 * 화면이 더 붙어도 red를 내지 않는다. 갱신 시점은 계약이 다시 바뀔 때뿐이다.
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

describe('preferenceSnapshot을 있는 그대로 통과시킨다 (TRIP-484 정책 A)', () => {
  /**
   * ⚠️ `CreateTripInput`의 `Omit`은 **타입 선언에서만** 그 키를 지운다 — 구조적 타이핑 때문에
   * 그 키를 실제로 가진 값(`CreateTripRequest` 타입 변수)을 넘기는 것 자체는 막지 못한다. 그래서
   * 아래 케이스는 **값에 스냅숏을 심어** 넘겨 그 값이 결과까지 통과하는지 본다(★6 — `in`으로 키
   * 존재를 따로 잠근다).
   */
  const CARRIED_CASES: {
    name: string;
    input: CreateTripRequest;
    snapshot: Record<string, unknown>;
  }[] = [
    {
      name: '예산 있음 + override 스냅숏',
      input: {
        ...BASE_FIELDS,
        budgetTotal: 1200000,
        preferenceSnapshot: { styles: ['휴양'], pace: '균형있게' },
      },
      snapshot: { styles: ['휴양'], pace: '균형있게' },
    },
    {
      name: '예산 없음 + 프리필 스냅숏',
      input: {
        ...BASE_FIELDS,
        preferenceSnapshot: { styles: ['미식', '전시'] },
      },
      snapshot: { styles: ['미식', '전시'] },
    },
  ];

  it.each(CARRIED_CASES)(
    '$name → 요청 바디에 스냅숏이 그대로 실린다',
    ({ input, snapshot }) => {
      const request = buildCreateTripRequest(input);

      // 긍정 짝 — 조립이 실제로 뭔가를 만들었다(빈 객체 반환 구현 차단).
      expect(request.startDate).toBe('2026-09-01');

      expect('preferenceSnapshot' in request).toBe(true);
      expect(request.preferenceSnapshot).toEqual(snapshot);
    }
  );

  it('입력에 스냅숏이 없으면 결과에도 없다 — 함수가 지어내지 않는다', () => {
    // 조건부 통과의 나머지 절반: page가 안 주면 이 함수는 `{}`조차 붙이지 않는다.
    const request = buildCreateTripRequest(BASE_INPUT);

    expect('preferenceSnapshot' in request).toBe(false);
  });
});

describe('AC-2 · AC-3 불변식 — 임의의 입력에 대해 (PBT)', () => {
  /**
   * 예시가 못 보는 구석을 훑는다: 금액이 0이든 크든, 키가 있든 없든, 값이 `null`이든
   * `undefined`든 **규칙은 둘이다** — ⓐ `budgetTotal` 키의 유무가 "입력의 `budgetTotal`이
   * 숫자인가"와 정확히 일치하고, ⓑ `preferenceSnapshot` 키의 유무가 "입력이 스냅숏을 실었는가"와
   * 정확히 일치한다(TRIP-484 정책 A — 조건부 통과).
   *
   * 축이 셋이다: ① 값(정수 | `null` | `undefined`) ② **키를 실제로 넣는지**(키 부재와
   * `undefined` 값을 가르는 축) ③ 스냅숏이 값으로 섞여 들어오는지.
   */
  it('budgetTotal·preferenceSnapshot 키의 유무가 각자 입력 값의 유무로만 갈린다', () => {
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

          expect('preferenceSnapshot' in request).toBe(injectSnapshot);

          // 나머지 입력은 어떤 조합에서도 가공되지 않는다.
          expect(request.startDate).toBe(BASE_FIELDS.startDate);
          expect(request.destinations).toEqual(BASE_FIELDS.destinations);
        }
      ),
      { numRuns: 500 }
    );
  });
});
