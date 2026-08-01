import fc from 'fast-check';

import type { PreferenceView } from '@/shared/api/generated/schemas';

import {
  buildCreateTripRequest,
  type CreateTripInput,
} from './createTripRequest';

/**
 * TRIP-203 AC-5 · AC-6 — 서버로 나갈 여행 생성 본문의 조립.
 *
 * 무엇을 보장하나:
 *  - **예산 러프값이 있으면 그대로 실리고, 없으면 `budgetTotal` 키 자체가 안 붙는다**(AC-5).
 *    "키 부재"와 "`null` 전송"은 서버에 다른 뜻이다 — 선례 `buildStayRegisterRequest`
 *    (TRIP-198 AC-5)가 날짜에 대해 세운 규칙과 같은 성질이라 근거를 새로 세우지 않는다.
 *  - **어떤 입력에서도 `preferenceSnapshot`을 보내지 않는다**(AC-6). 생성 시점 취향 동결은
 *    서버 책임이고(BE TRIP-177 · BR-U1-38 "계정 취향은 불변"), 계약상 필수가 아니다.
 *
 * 근거: US-TRIP-01(예산은 선택 · 온보딩 러프값 기본 제시) + 사용자 결정 2026-07-30(예산 입력
 * UI 없이 취향 러프값을 쓴다). 취향 값을 **화면에 그리는 것**은 TRIP-205/207 몫이다.
 *
 * "없음"이 세 갈래다: ① `budget` 축 자체가 없다 ② 있지만 `rawAmount`가 `null`이다
 * ③ 취향이 아직 안 왔다(`usePreferencePrefill` 로딩/실패 → `undefined`). ③은 01b Seed가 적은
 * 두 갈래에 더한 것으로, 같은 규칙의 세 번째 입력이지 새 AC가 아니다(02a ★12).
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 잠그는 것이 "무엇을 보내고 무엇을 안 보내는가"라 여행 생성
 * 화면(TRIP-205~209)이 붙어도 red를 내지 않는다. 갱신 시점은 계약이 바뀔 때뿐이다.
 */

/** 픽스처는 파일마다 각자 갖는 것이 리포 관례다. */
const BASE_INPUT: CreateTripInput = {
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  party: 2,
  destinations: [{ seq: 1, region: '제주', nights: 2 }],
};

/** 예산 러프값이 실제로 있는 취향(온보딩에서 금액을 고른 사용자). */
const PREF_WITH_AMOUNT: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 1200000, isNeutralDefault: false },
};

/** budget 축 자체가 없는 취향 — `PreferenceView`의 7축은 전부 옵셔널이다(실측). */
const PREF_WITHOUT_BUDGET_AXIS: PreferenceView = {
  pace: { value: '느긋하게', isNeutralDefault: true },
};

/**
 * budget 축은 있는데 금액이 `null` — 티어만 고르고 금액은 안 적은 상태다.
 * `isNeutralDefault: true` = "사용자가 고른 게 아니라 서버가 중립 기본값을 파생했다"는 표시.
 */
const PREF_WITH_NULL_AMOUNT: PreferenceView = {
  budget: { tier: '중간', rawAmount: null, isNeutralDefault: true },
};

describe('AC-5 · 예산 러프값 전달과 생략', () => {
  it('취향에 rawAmount가 있으면 그 값이 budgetTotal로 실린다', () => {
    // 준비 → 실행
    const request = buildCreateTripRequest(BASE_INPUT, PREF_WITH_AMOUNT);

    // 단언 — 입력은 가공 없이 통과하고 budgetTotal만 더해진다.
    expect(request).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      party: 2,
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      budgetTotal: 1200000,
    });
  });

  /**
   * "없음" 세 갈래를 한 표로 돌린다. 셋 다 결과가 같아야 한다 — **키가 아예 없다.**
   * `toEqual`은 값이 `undefined`인 키를 무시하므로, 객체 비교만으로는
   * `{budgetTotal: undefined}`와 키 부재를 구별하지 못한다(선례 `stayRegisterForm.test.ts:181`
   * 이 같은 함정을 적어 뒀다). 그래서 `in` 연산자로 키의 존재 자체를 따로 잠근다.
   */
  const ABSENT_CASES: {
    name: string;
    preference: PreferenceView | undefined;
  }[] = [
    { name: 'budget 축 자체가 없다', preference: PREF_WITHOUT_BUDGET_AXIS },
    {
      name: 'budget은 있는데 rawAmount가 null이다',
      preference: PREF_WITH_NULL_AMOUNT,
    },
    { name: '취향이 아직 안 왔다(로딩/실패)', preference: undefined },
  ];

  it.each(ABSENT_CASES)(
    '$name → budgetTotal 키 자체가 붙지 않는다 (null 전송이면 실패)',
    ({ preference }) => {
      const request = buildCreateTripRequest(BASE_INPUT, preference);

      expect(request).toEqual({
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        party: 2,
        destinations: [{ seq: 1, region: '제주', nights: 2 }],
      });
      expect('budgetTotal' in request).toBe(false);
    }
  );
});

describe('AC-6 · preferenceSnapshot을 보내지 않는다', () => {
  const ALL_CASES: { name: string; preference: PreferenceView | undefined }[] =
    [
      { name: '러프값 있음', preference: PREF_WITH_AMOUNT },
      { name: 'budget 축 없음', preference: PREF_WITHOUT_BUDGET_AXIS },
      { name: 'rawAmount null', preference: PREF_WITH_NULL_AMOUNT },
      { name: '취향 없음', preference: undefined },
    ];

  it.each(ALL_CASES)(
    '$name → 요청 바디에 preferenceSnapshot 키가 없다',
    ({ preference }) => {
      const request = buildCreateTripRequest(BASE_INPUT, preference);

      // 긍정 짝 — 조립이 실제로 뭔가를 만들었다. 이게 없으면 빈 객체를 돌려주는 구현도
      // "스냅숏 키 없음"을 통과한다.
      expect(request.startDate).toBe('2026-09-01');

      expect('preferenceSnapshot' in request).toBe(false);
    }
  );
});

describe('AC-5 · AC-6 불변식 — 임의의 취향에 대해 (PBT)', () => {
  /**
   * 예시 케이스가 못 보는 구석을 훑는다: 금액이 0이거나 음수여도, 티어 문자열이 무엇이어도,
   * budget 축이 있든 없든 **규칙은 하나다** — `budgetTotal` 키의 유무가 "rawAmount가 숫자인가"와
   * 정확히 일치하고, `preferenceSnapshot`은 항상 없다.
   *
   * `budgetTotal: 0`이 "예산 없음"으로 잘못 접히는 구현(`rawAmount ? {...} : {}`)을 이 성질이
   * 잡는다 — 0은 거짓값이지만 "사용자가 예산 0을 골랐다"는 유효한 값이다.
   */
  it('budgetTotal 키의 유무가 rawAmount의 타입으로만 갈리고, preferenceSnapshot은 항상 없다', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: 100_000_000 }), { nil: null }),
        fc.boolean(),
        fc.boolean(),
        (rawAmount, hasBudgetAxis, isNeutralDefault) => {
          const preference: PreferenceView = hasBudgetAxis
            ? { budget: { tier: '중간', rawAmount, isNeutralDefault } }
            : {};

          const request = buildCreateTripRequest(BASE_INPUT, preference);

          const shouldCarryBudget =
            hasBudgetAxis && typeof rawAmount === 'number';
          expect('budgetTotal' in request).toBe(shouldCarryBudget);
          if (shouldCarryBudget) {
            expect(request.budgetTotal).toBe(rawAmount);
          }

          expect('preferenceSnapshot' in request).toBe(false);

          // 입력은 어떤 취향에도 가공되지 않는다.
          expect(request.startDate).toBe(BASE_INPUT.startDate);
          expect(request.destinations).toEqual(BASE_INPUT.destinations);
        }
      )
    );
  });
});
