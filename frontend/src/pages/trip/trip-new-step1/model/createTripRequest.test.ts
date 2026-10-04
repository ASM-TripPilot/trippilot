import fc from 'fast-check';

import type { CreateTripRequest } from '@/shared/api/index.schemas';

import {
  buildCreateTripRequest,
  tripTitle,
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

// ── TRIP-1210 · 다도시 여행 제목 ────────────────────────────────────────────────
//
// 서버는 요청에 제목이 없으면 "첫 목적지 이름 + 여행"을 만든다(`Trip.kt` resolveTitle — 생성·수정 둘 다).
// 그래서 서울+부산 여행이 `서울특별시 여행`이 된다. 앱이 도시가 둘 이상일 때만 제목을 지어 보낸다
// (01b 결정 1·2). 도시가 한 곳이면 `undefined`(= 제목을 안 보냄 → 서버가 지금처럼 만든다).
//
// > *(개념)* **오라클(oracle)** — 정답을 따로 계산하는 테스트 쪽 기준표. 아래 `SHORT`는 짧은 이름을
// > 손으로 적은 표라, 구현이 `sidoKey`를 어떻게 부르든 그와 무관하게 "나와야 할 글자"를 안다.

/** 지역 카탈로그 이름 → 제목에 쓰일 짧은 이름(`sidoKey` 규칙의 손 계산 결과). 짧은 이름이 서로 다른 것만 골랐다. */
const SHORT: Record<string, string> = {
  서울특별시: '서울',
  부산광역시: '부산',
  대구광역시: '대구',
  인천광역시: '인천',
  광주광역시: '광주',
  대전광역시: '대전',
  울산광역시: '울산',
  세종특별자치시: '세종',
  경기도: '경기',
  강원특별자치도: '강원',
  충청북도: '충북',
  충청남도: '충남',
  전북특별자치도: '전북',
  전라남도: '전남',
  경상북도: '경북',
  경상남도: '경남',
  제주특별자치도: '제주',
  // 시군구는 접지 않는다(`sidoKey` — "대덕구를 접으면 대구가 된다").
  경주시: '경주시',
  강릉시: '강릉시',
  해운대구: '해운대구',
};
const REGION_NAMES = Object.keys(SHORT);

/** 이름 목록 → 스토어 모양의 목적지 목록(seq 1..N, 1박). */
function destinationsOf(names: string[]) {
  return names.map((region, index) => ({ seq: index + 1, region, nights: 1 }));
}

/** 앞에서부터 처음 나온 순서대로 중복을 지운다(오라클). */
function firstOccurrences(names: string[]): string[] {
  return names.filter((name, index) => names.indexOf(name) === index);
}

describe('TRIP-1210 · 제목 조립 tripTitle — 예시', () => {
  it('두 도시면 짧은 이름을 가운뎃점으로 잇는다: 서울·부산 여행', () => {
    // 준비
    const destinations = destinationsOf(['서울특별시', '부산광역시']);

    // 실행
    const title = tripTitle(destinations);

    // 단언
    expect(title).toBe('서울·부산 여행');
  });

  it('담은 순서를 그대로 따른다: 부산을 먼저 담으면 부산·서울 여행', () => {
    expect(tripTitle(destinationsOf(['부산광역시', '서울특별시']))).toBe(
      '부산·서울 여행'
    );
  });

  it('세 곳 이상이면 앞의 두 곳만 쓰고 나머지는 "외 N곳"으로 접는다', () => {
    expect(
      tripTitle(destinationsOf(['서울특별시', '부산광역시', '경주시']))
    ).toBe('서울·부산 외 1곳 여행');
    expect(
      tripTitle(
        destinationsOf(['서울특별시', '부산광역시', '경주시', '강릉시'])
      )
    ).toBe('서울·부산 외 2곳 여행');
  });

  it('같은 도시를 두 번 담아도 제목에는 한 번만 나온다', () => {
    expect(
      tripTitle(destinationsOf(['서울특별시', '부산광역시', '서울특별시']))
    ).toBe('서울·부산 여행');
    // 세 곳처럼 보이지만 실제로는 두 곳이다 — "외 1곳"이 붙으면 안 된다.
    expect(
      tripTitle(destinationsOf(['서울특별시', '서울특별시', '부산광역시']))
    ).toBe('서울·부산 여행');
  });

  it('도시가 한 곳이면 제목을 만들지 않는다(undefined — 서버가 지금처럼 "{지역} 여행"을 만든다)', () => {
    expect(tripTitle(destinationsOf(['서울특별시']))).toBeUndefined();
    // 같은 도시만 두 번이어도 한 곳이다.
    expect(
      tripTitle(destinationsOf(['서울특별시', '서울특별시']))
    ).toBeUndefined();
  });

  it('도시가 없으면 제목을 만들지 않는다(undefined)', () => {
    expect(tripTitle([])).toBeUndefined();
  });

  it('도 이름은 두 글자로 접고(충청북도 → 충북), 특별자치도도 접는다(제주특별자치도 → 제주)', () => {
    expect(tripTitle(destinationsOf(['충청북도', '제주특별자치도']))).toBe(
      '충북·제주 여행'
    );
  });

  it('시군구 이름은 접지 않고 그대로 쓴다: 부산·경주시 여행', () => {
    expect(tripTitle(destinationsOf(['부산광역시', '경주시']))).toBe(
      '부산·경주시 여행'
    );
  });
});

describe('TRIP-1210 · 제목 조립 tripTitle — 속성(PBT)', () => {
  // 지역 목록 생성기 — 카탈로그 이름에서 1~6개를 고른다. 같은 이름이 여러 번 나올 수 있다(중복 담기).
  const namesArb = fc.array(fc.constantFrom(...REGION_NAMES), {
    minLength: 1,
    maxLength: 6,
  });

  it('제목 = 중복을 지운 도시 목록으로 정해진다(1곳 → 없음, 2곳 → A·B 여행, 3곳+ → A·B 외 N곳 여행)', () => {
    fc.assert(
      fc.property(namesArb, (names) => {
        // 준비 — 오라클: 처음 나온 순서대로 중복을 지운 목록.
        const unique = firstOccurrences(names);

        // 실행
        const title = tripTitle(destinationsOf(names));

        // 단언
        if (unique.length === 1) {
          expect(title).toBeUndefined();
          return;
        }
        const head = `${SHORT[unique[0]]}·${SHORT[unique[1]]}`;
        const rest = unique.length - 2;
        expect(title).toBe(
          rest === 0 ? `${head} 여행` : `${head} 외 ${rest}곳 여행`
        );
      }),
      { numRuns: 300 }
    );
  });

  it('이미 담은 도시를 뒤에 몇 번 더 담아도 제목이 바뀌지 않는다', () => {
    fc.assert(
      fc.property(
        namesArb,
        fc.array(fc.nat(), { minLength: 1, maxLength: 4 }),
        (names, picks) => {
          // 준비 — 이미 있는 이름을 골라 뒤에 다시 붙인다.
          const repeated = [
            ...names,
            ...picks.map((pick) => names[pick % names.length]),
          ];

          // 실행·단언
          expect(tripTitle(destinationsOf(repeated))).toBe(
            tripTitle(destinationsOf(names))
          );
        }
      ),
      { numRuns: 300 }
    );
  });

  it('제목이 있으면 비지 않고, "undefined"·빈 토막(··)이 섞이지 않으며 " 여행"으로 끝난다', () => {
    fc.assert(
      fc.property(namesArb, (names) => {
        const title = tripTitle(destinationsOf(names));
        if (title === undefined) return;

        expect(title.endsWith(' 여행')).toBe(true);
        expect(title).not.toMatch(/undefined|null|··|^·|· /);
      }),
      { numRuns: 300 }
    );
  });
});
