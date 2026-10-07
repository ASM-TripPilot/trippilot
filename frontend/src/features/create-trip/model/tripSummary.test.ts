import fc from 'fast-check';

import type {
  CompanionType,
  TripDestination,
} from '@/shared/api/index.schemas';

import {
  formatWizardStep,
  summaryBudget,
  summaryCompanion,
  summaryDestinations,
  summaryPeriod,
  summaryPreferences,
  wizardProgress,
} from './tripSummary';

/**
 * TRIP-664 · US-TRIP-01 · US-TRIP-07 — g01 요약 카드 + 위저드 진행 모델 순수 셀렉터.
 *
 * 무엇을 보장하나:
 *  - **진행 모델(AC-1)**: 총 4단계 고정, 현재 단계를 [1,4]로 클램프해 `"N / 4"`로 표시.
 *    옛 하드코딩 `"1 / 2"`·`"2 / 2"`를 대체할 단일 소스라, 범위 밖 입력도 안전한 값으로 접힌다.
 *  - **요약 5행(AC-1·2, TRIP-732 2톤)**: 여행지·기간·동행·취향·예산 각각을 `{main; sub?}` 객체로
 *    분리 도출한다(취향은 `{main; onboarding}`, 예산은 tier-only 분기). 화면이 굵은 main + 회색 sub
 *    2톤으로 그리고, "미선택/미입력"은 객체가 아니라 `null`로 구분한다(화면이 빈 얼굴을 그릴 수 있게).
 *
 * 커버 경계:
 *  - 기간 행의 요일은 **실제 달력의 요일**을 잠근다(아래 EXPECTED_PERIODS 주석 참조). 시드/브리프
 *    예시의 (화)(금)은 2026-06-10/13의 실제 요일(수/토)과 다른 오기다 — 예시 글자를 베끼지 않는다.
 *  - 내부 포맷터(만원·요일삽입)는 export하지 않으므로 `summaryBudget`·`summaryPeriod`를 통해서만
 *    관찰한다(구현이 아니라 동작을 잠근다).
 *
 * 커버하지 않는 것:
 *  - 취향 라벨이 styles만인지 styles+activities인지 — 셀렉터는 라벨 불가지(D3), 호출부(S1 배선) 결정.
 *  - 예산 tier가 어디서 오는지(프리필 vs 파생) — tierLabel은 인자로 받을 뿐이다(D4).
 *  - 달을 넘는 기간의 둘째 월 표기 — 계약 예시(같은 달)에 없어 잠그지 않는다.
 *
 * 3동작 뼈대: 준비(인자 구성) → 실행(셀렉터 1회 호출) → 단언(반환 문자열/객체/null).
 */

// ── 상수 ──────────────────────────────────────────────────────────────────────

/** 기간 행 구분자 — **en dash U+2013**(하이픈 아님). 눈으로 안 구분돼 상수로 굳힌다
 *  (baseSections.test.ts EN_DASH 관례). 기대 문자열은 전부 이 상수로 조립한다. */
const EN_DASH = '–';

/** 조인 구분자 ` · ` — **U+00B7 미들닷** 앞뒤 공백(실측: 리포 `(tabs)/index.tsx:129` 관례). */
const DOT = ` ${'·'} `;

/** 기존 기간 케이스의 '오늘'(TRIP-1285 — summaryPeriod 셋째 필수 인자). 기대값이 전부 2026 날짜라
 *  "올해" 분기를 탄다 — 그래서 아래 기대 문자열은 한 글자도 안 바뀐다(바이트 보존). */
const TODAY_2026 = '2026-06-01';

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

/** 여행지 픽스처 — orval `TripDestination`(`{seq,region,nights}`) 그대로. */
function dest(region: string, nights: number, seq = 1): TripDestination {
  return { seq, region, nights };
}

// ── AC-1 진행 모델 ─────────────────────────────────────────────────────────────

describe('wizardProgress · formatWizardStep — 위저드 진행 모델 (AC-1, D1)', () => {
  /** [입력 current, 클램프된 current, 표시 문자열]. 총 4는 상수. current는 [1,4]로 접힌다.
   *  범위 밖(0·-3·5·100)이 안전한 경계값으로 접히는지가 "단일 대체 소스"의 핵심. */
  const CASES: ReadonlyArray<[number, number, string]> = [
    [0, 1, '1 / 4'],
    [1, 1, '1 / 4'],
    [2, 2, '2 / 4'],
    [3, 3, '3 / 4'],
    [4, 4, '4 / 4'],
    [5, 4, '4 / 4'],
    [-3, 1, '1 / 4'],
    [100, 4, '4 / 4'],
  ];

  it.each(CASES)(
    'current=%p → {current:%p, total:4} · "%s"',
    (input, expCurrent, expStep) => {
      // 실행 + 단언 — 진행 객체는 클램프된 current와 total:4를 담는다.
      expect(wizardProgress(input)).toEqual({ current: expCurrent, total: 4 });
      // 표시 문자열도 같은 클램프를 타 범위 밖 "5 / 4"·"0 / 4"가 새지 않는다.
      expect(formatWizardStep(input)).toBe(expStep);
    }
  );
});

// ── AC-2 여행지 ────────────────────────────────────────────────────────────────

describe('summaryDestinations — 여행지 요약 행 (AC-1·2, 2톤 분리)', () => {
  it('여러 도시를 main=첫 지역명 · sub=나머지 전체로 가른다', () => {
    // 준비
    const destinations = [dest('부산', 2, 1), dest('경주', 1, 2)];

    // 실행 + 단언 — TRIP-732: main 은 첫 도시 지역명만, sub 는 첫 박수 + 나머지 도시(` · ` 조인).
    // 개념: 셀렉터가 문자열 하나 → `{main, sub}` 객체로 분리(화면 2톤 렌더의 재료).
    expect(summaryDestinations(destinations)).toEqual({
      main: '부산',
      sub: `2박${DOT}경주 1박`,
    });
  });

  it('도시가 하나면 main=지역명 · sub=박수뿐이다', () => {
    expect(summaryDestinations([dest('서울', 3)])).toEqual({
      main: '서울',
      sub: '3박',
    });
  });

  it('0개면 null이다 (객체가 아니라 null — 화면이 미선택 얼굴을 그린다, AC-2)', () => {
    expect(summaryDestinations([])).toBeNull();
  });

  it('0박(도시 하나)이면 sub 가 "0박"이 아니라 "당일치기"다', () => {
    expect(summaryDestinations([dest('부산', 0)])).toEqual({
      main: '부산',
      sub: '당일치기',
    });
  });
});

describe('summaryPeriod — 0박(같은 날)은 당일치기', () => {
  it('같은 날이면 main 은 날짜 하나, sub 는 "당일치기"다', () => {
    expect(summaryPeriod('2026-06-10', '2026-06-10', TODAY_2026)).toEqual({
      main: '6월 10일(수)',
      sub: '당일치기',
    });
  });

  it('하루 이상이면 기존대로 범위와 "N박 M일"이다(분기가 과하게 넓지 않다)', () => {
    expect(summaryPeriod('2026-06-10', '2026-06-11', TODAY_2026)).toEqual({
      main: '6월 10일(수) – 11일(목)',
      sub: '1박 2일',
    });
  });
});

// ── AC-2 기간 ──────────────────────────────────────────────────────────────────

describe('summaryPeriod — 기간 요약 행 (AC-2, 요일 삽입)', () => {
  /**
   * [startDate, endDate, 기대 문자열]. 요일은 **실제 달력**이다 — 독립 오라클
   * `new Date(d+'T00:00:00Z').getUTCDay()`로 검증해 하드코딩했다(02a §5-1).
   * ⚠️ 시드/브리프 예시의 (화)(금)은 오기다: 2026-06-10=수, 2026-06-13=토.
   * 4쌍이 요일 수·토·월·화·일·월·목·금을 훑어 요일 계산기 base(0=목) 오류를 잡는다.
   */
  // [startDate, endDate, 기대 main(날짜범위), 기대 sub(박수라벨)]. 2톤 분리라 main·sub 두 칸.
  const EXPECTED_PERIODS: ReadonlyArray<[string, string, string, string]> = [
    ['2026-06-10', '2026-06-13', `6월 10일(수) ${EN_DASH} 13일(토)`, '3박 4일'],
    ['2026-06-08', '2026-06-09', `6월 8일(월) ${EN_DASH} 9일(화)`, '1박 2일'],
    ['2026-06-14', '2026-06-15', `6월 14일(일) ${EN_DASH} 15일(월)`, '1박 2일'],
    ['2026-06-11', '2026-06-12', `6월 11일(목) ${EN_DASH} 12일(금)`, '1박 2일'],
  ];

  it.each(EXPECTED_PERIODS)(
    '%s ~ %s → {main:"%s", sub:"%s"} (요일은 실제 달력)',
    (startDate, endDate, expectedMain, expectedSub) => {
      // main = 요일삽입 날짜범위, sub = 박수 라벨(2톤 분리, AC-1).
      expect(summaryPeriod(startDate, endDate, TODAY_2026)).toEqual({
        main: expectedMain,
        sub: expectedSub,
      });
    }
  );

  it('시작일만 있으면 null이다', () => {
    expect(summaryPeriod('2026-06-10', undefined, TODAY_2026)).toBeNull();
  });

  it('종료일만 있으면 null이다', () => {
    expect(summaryPeriod(undefined, '2026-06-13', TODAY_2026)).toBeNull();
  });

  it('둘 다 없으면 null이다', () => {
    expect(summaryPeriod(undefined, undefined, TODAY_2026)).toBeNull();
  });
});

// ── TRIP-1285 · 기간 연도 표기 (결정 2 · Seed Q3·Q5) ─────────────────────────────────────

/**
 * TRIP-1285 — 올해가 아닌 날짜는 기간 main 에 연도를 붙인다.
 *
 * 규칙(01b Q3): ① 시작 날짜의 해 ≠ 오늘의 해 → 시작 앞에 `YYYY년 `. ② 끝의 해 ≠ 시작의 해(해 넘김) →
 * 끝 앞에 `YYYY년 `. 같은 해 안이면 끝은 지금처럼 접는다("17일(월)"). 올해 안 범위는 지금 출력과 바이트가 같다.
 *
 * 오늘은 셋째 **필수** 인자다(Q5) — 셀렉터가 시계를 안 읽으니 테스트가 오늘을 고정해 결정론이 된다.
 * 바이트(공백·en dash·괄호)는 여기서 `toEqual` 로 잠근다 — 화면 텍스트 매처는 공백을 접어 못 잰다(02a ★5).
 *
 * 3동작 뼈대: 준비(날짜 쌍 + 오늘) → 실행(summaryPeriod 1회) → 단언(main·sub 완전 일치 / 속성).
 */
describe('summaryPeriod — 올해가 아니면 연도를 붙인다 (TRIP-1285 결정 2)', () => {
  // [오늘, 시작, 끝, 기대 main, 기대 sub]. 요일은 독립 오라클(getUTCDay)로 실측했다(02a §5-1).
  const CASES: readonly [string, string, string, string, string][] = [
    // 올해 — 지금 출력 그대로(무회귀)
    [
      '2026-10-08',
      '2026-11-20',
      '2026-11-21',
      `11월 20일(금) ${EN_DASH} 21일(토)`,
      '1박 2일',
    ],
    // 내년 — 시작에 연도, 같은 해라 끝은 접는다
    [
      '2026-10-08',
      '2027-05-15',
      '2027-05-17',
      `2027년 5월 15일(토) ${EN_DASH} 17일(월)`,
      '2박 3일',
    ],
    // QA 재현값(B-03)
    [
      '2026-10-08',
      '2029-05-15',
      '2029-05-17',
      `2029년 5월 15일(화) ${EN_DASH} 17일(목)`,
      '2박 3일',
    ],
    // 올해 시작 + 해 넘김 — 끝에만 연도
    [
      '2026-10-08',
      '2026-12-30',
      '2027-01-02',
      `12월 30일(수) ${EN_DASH} 2027년 1월 2일(토)`,
      '3박 4일',
    ],
    // 내년 시작 + 해 넘김 — 양쪽 연도
    [
      '2026-10-08',
      '2027-12-30',
      '2028-01-02',
      `2027년 12월 30일(목) ${EN_DASH} 2028년 1월 2일(일)`,
      '3박 4일',
    ],
    // 0박(같은 날) — 날짜 하나에 연도
    [
      '2026-10-08',
      '2027-05-15',
      '2027-05-15',
      '2027년 5월 15일(토)',
      '당일치기',
    ],
    // 12/31 경계 — 오늘이 12/31 이면 다음 날(1/1)은 이미 내년
    [
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      `2027년 1월 1일(금) ${EN_DASH} 2일(토)`,
      '1박 2일',
    ],
    // 1/1 경계 짝 — 오늘이 1/1 이면 같은 날짜가 올해(연도 없음)
    [
      '2027-01-01',
      '2027-01-01',
      '2027-01-02',
      `1월 1일(금) ${EN_DASH} 2일(토)`,
      '1박 2일',
    ],
  ];

  it.each(CASES)(
    '오늘 %s · %s ~ %s → main "%s" · sub "%s"',
    (today, startDate, endDate, expectedMain, expectedSub) => {
      // 실행
      const line = summaryPeriod(startDate, endDate, today);

      // 단언 — 공백 하나·en dash 하나까지 완전 일치(normalizer 없는 toEqual).
      expect(line).toEqual({ main: expectedMain, sub: expectedSub });
    }
  );

  it('한쪽 날짜라도 없으면 오늘과 무관하게 null 이다 (미선택 계약 유지)', () => {
    expect(summaryPeriod('2029-05-15', undefined, '2026-10-08')).toBeNull();
    expect(summaryPeriod(undefined, '2029-05-17', '2026-10-08')).toBeNull();
  });

  it('오늘을 빼고 부르면 타입 오류다 — 호출처가 빠뜨리면 tsc 가 잡는다 (Q5, tsc 심판)', () => {
    // 심판은 jest 가 아니라 `pnpm tsc` 다: 오늘이 필수가 아니면 아래 directive 가 안 쓰여 TS2578 로 실패한다.
    const call = () =>
      // @ts-expect-error 오늘(셋째 인자)은 필수다 — 빠뜨리면 올해 아닌 날짜에 연도가 조용히 안 붙는다
      summaryPeriod('2029-05-15', '2029-05-17');

    expect(typeof call).toBe('function');
  });

  // ── 속성(PBT) — 어떤 날짜·오늘이어도 성립해야 하는 규칙 ──────────────────────────────────

  const MS_PER_DAY = 86_400_000;

  /** 'YYYY-MM-DD' → 에포크 일수(UTC). */
  function epochDayOf(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
  }

  /** 에포크 일수 → 'YYYY-MM-DD'. UTC 한 경로만 쓴다(실행 기계 시간대 무관). */
  function isoFromEpochDay(day: number): string {
    return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
  }

  /** 'YYYY-MM-DD' → [연, 월, 일] 숫자(0 패딩 제거). */
  function ymd(iso: string): [number, number, number] {
    const [y, m, d] = iso.split('-').map(Number);
    return [y, m, d];
  }

  /** 요일 한 글자 — 구현(dayOfWeek)을 부르지 않는 독립 오라클(02a ★8). */
  function dow(iso: string): string {
    return '일월화수목금토'[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  }

  /** 'YYYY년 ' 접두를 전부 지운다 — 연도를 뺀 나머지 바이트를 비교하려고. */
  function stripYears(main: string): string {
    return main.replace(/\d{4}년 /g, '');
  }

  /** 해 경계 날짜 — 균등 범위만으로는 해 넘김이 드물어 섞는다(02a ★7). */
  const BOUNDARY_DAYS = [2025, 2026, 2027, 2028, 2029].flatMap((year) => [
    epochDayOf(`${year}-12-30`),
    epochDayOf(`${year}-12-31`),
    epochDayOf(`${year + 1}-01-01`),
  ]);

  const startArb = fc.oneof(
    fc.integer({
      min: epochDayOf('2025-12-01'),
      max: epochDayOf('2030-01-31'),
    }),
    fc.constantFrom(...BOUNDARY_DAYS)
  );
  const nightsArb = fc.integer({ min: 0, max: 40 });

  /** 오늘 — 시작의 해 기준 −1·0·+1 해의 임의 날. 올해/올해 아님/지난해 세 분기를 고르게 밟는다. */
  function todayArb(startYear: number) {
    return fc
      .tuple(
        fc.integer({ min: -1, max: 1 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 })
      )
      .map(
        ([delta, month, day]) =>
          `${startYear + delta}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      );
  }

  /** (시작, 끝, 오늘 두 개) 표본. */
  const sampleArb = fc
    .tuple(startArb, nightsArb)
    .chain(([startDay, nights]) => {
      const start = isoFromEpochDay(startDay);
      const end = isoFromEpochDay(startDay + nights);
      const [startYear] = ymd(start);
      return fc
        .tuple(todayArb(startYear), todayArb(startYear))
        .map(([today, otherToday]) => ({ start, end, today, otherToday }));
    });

  it('PBT — 시작이 올해면 "M월 D일(" 로, 올해가 아니면 "YYYY년 M월 D일(" 로 시작한다', () => {
    fc.assert(
      fc.property(sampleArb, ({ start, end, today }) => {
        // 준비 — 기대 머리를 날짜 문자열에서 직접 만든다(구현 미사용).
        const [sy, sm, sd] = ymd(start);
        const [ty] = ymd(today);
        const head = `${sm}월 ${sd}일(${dow(start)})`;

        // 실행
        const main = summaryPeriod(start, end, today)?.main ?? '';

        // 단언
        if (sy === ty) expect(main.startsWith(head)).toBe(true);
        else expect(main.startsWith(`${sy}년 ${head}`)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('PBT — 해를 넘기면 끝 앞에 연도가 붙고, 같은 해 안이면 끝에 연도가 없다', () => {
    fc.assert(
      fc.property(sampleArb, ({ start, end, today }) => {
        const [sy] = ymd(start);
        const [ey, em, ed] = ymd(end);

        const main = summaryPeriod(start, end, today)?.main ?? '';

        if (start === end) {
          // 0박은 날짜 하나 — 구분자가 없다.
          expect(main.includes(` ${EN_DASH} `)).toBe(false);
          return;
        }
        const tail = main.split(` ${EN_DASH} `)[1] ?? '';
        if (ey !== sy) {
          expect(tail).toBe(`${ey}년 ${em}월 ${ed}일(${dow(end)})`);
        } else {
          expect(tail.includes('년')).toBe(false);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('PBT — 연도 접두를 지우면 나머지 글자는 오늘과 무관하고, sub 도 오늘과 무관하다 (바이트 보존)', () => {
    fc.assert(
      fc.property(sampleArb, ({ start, end, today, otherToday }) => {
        // 실행 — 같은 범위를 서로 다른 오늘로 두 번.
        const a = summaryPeriod(start, end, today);
        const b = summaryPeriod(start, end, otherToday);

        // 단언 — 오늘이 바꾸는 것은 'YYYY년 ' 접두뿐이다.
        expect(a).not.toBeNull();
        expect(stripYears(a?.main ?? '')).toBe(stripYears(b?.main ?? ''));
        expect(a?.sub).toBe(b?.sub);
      }),
      { numRuns: 300 }
    );
  });
});

// ── AC-2 동행 ──────────────────────────────────────────────────────────────────

describe('summaryCompanion — 동행 요약 행 (AC-2, D2)', () => {
  /** [companionType, party, 기대]. 혼자는 인원을 떼고(유형이 혼자라서), 그 외는 party=1이어도
   *  명수를 붙인다 — "혼자 특례"와 "party=1 특례"를 갈라 잠근다. */
  const CASES: ReadonlyArray<[CompanionType, number, string]> = [
    ['혼자', 1, '혼자'],
    ['혼자', 3, '혼자'],
    ['친구', 1, '친구 1명'],
    ['친구', 2, '친구 2명'],
    ['연인', 2, '연인 2명'],
    ['가족', 4, '가족 4명'],
  ];

  it.each(CASES)('%s · %p명 → {main:"%s"} (sub 없음)', (type, party, main) => {
    // 동행은 sub 가 없다 — toEqual 이 여분 sub 키까지 검사해 "sub 새면 red"를 잠근다(★A).
    expect(summaryCompanion(type, party)).toEqual({ main });
  });

  it('동행 유형이 미정이면 null이다 (인원이 있어도)', () => {
    expect(summaryCompanion(undefined, 2)).toBeNull();
  });
});

// ── AC-2 취향 ──────────────────────────────────────────────────────────────────

describe('summaryPreferences — 취향 요약 행 (AC-1·5, onboarding 플래그)', () => {
  it('라벨을 " · "로 조인하고 온보딩 여부는 문자열이 아니라 플래그로 낸다', () => {
    // TRIP-732: 옛 " + 온보딩" 접미 문자열 소멸 → `{main, onboarding:boolean}`.
    // main 은 라벨 조인만, onboarding 은 별도 불리언(화면이 스파클+분홍 배지로 그림).
    expect(summaryPreferences(['미식', '전시', '야경'], true)).toEqual({
      main: `미식${DOT}전시${DOT}야경`,
      onboarding: true,
    });
  });

  it('온보딩 출처가 아니면 onboarding:false (main 은 동일 조인)', () => {
    expect(summaryPreferences(['미식', '전시', '야경'], false)).toEqual({
      main: `미식${DOT}전시${DOT}야경`,
      onboarding: false,
    });
  });

  it('라벨이 하나여도 규칙은 같다', () => {
    expect(summaryPreferences(['미식'], true)).toEqual({
      main: '미식',
      onboarding: true,
    });
    expect(summaryPreferences(['미식'], false)).toEqual({
      main: '미식',
      onboarding: false,
    });
  });

  it('★ main 에 "온보딩" 문자열이 새지 않는다 (배지로 대체 — 부정 앵커)', () => {
    // 옛 계약이 main 에 " + 온보딩"을 접미했다 → 신 계약은 배지라 main 은 라벨뿐.
    expect(summaryPreferences(['미식', '전시'], true)?.main).not.toMatch(
      /온보딩/
    );
  });

  it('라벨이 0개면 fromOnboarding과 무관하게 null이다 (AC-2)', () => {
    expect(summaryPreferences([], true)).toBeNull();
    expect(summaryPreferences([], false)).toBeNull();
  });
});

// ── AC-2 예산 ──────────────────────────────────────────────────────────────────

describe('summaryBudget — 예산 요약 행 (AC-1, 금액형·tier-only 분기)', () => {
  it('금액+tier면 main=금액 · sub="1인 총액 · {tier}"', () => {
    expect(summaryBudget(1200000, '중간')).toEqual({
      main: '120만원',
      sub: `1인 총액${DOT}중간`,
    });
  });

  it('금액만(tier 없음)이면 sub 에서 tier 절을 생략한다', () => {
    expect(summaryBudget(1200000)).toEqual({
      main: '120만원',
      sub: '1인 총액',
    });
  });

  it('만원 미만 단위는 반올림한다 — 1,234,567원 → "123만원"', () => {
    // 1234567 / 10000 = 123.4567 → 소수부 < 0.5 이므로 round·floor·trunc 모두 123.
    // 이 값만으로는 반올림 방향을 못 가른다.
    expect(summaryBudget(1234567)).toEqual({
      main: '123만원',
      sub: '1인 총액',
    });
    expect(summaryBudget(1234567, '고급')).toEqual({
      main: '123만원',
      sub: `1인 총액${DOT}고급`,
    });
    // 1235000 / 10000 = 123.5 → 소수부 ≥ 0.5. round=124, floor/trunc=123.
    // 이 케이스가 반올림 방향을 실제로 잠근다(뮤테이션: round→floor 시 red).
    expect(summaryBudget(1235000)).toEqual({
      main: '124만원',
      sub: '1인 총액',
    });
  });

  it('★ 금액 없고 tier 만 있으면 tier-only — main=tier · sub="1인 총액 · 온보딩" (empty)', () => {
    // TRIP-732: empty 얼굴 예산은 금액이 없고 프리필 tier 만 있다. 옛 계약은 amount<=0 → null 이라
    // 이 형태를 못 냈다(정본 공백). 이제 tier 를 main 으로 내는 분기를 셀렉터가 소유한다.
    expect(summaryBudget(0, '중간')).toEqual({
      main: '중간',
      sub: `1인 총액${DOT}온보딩`,
    });
  });

  it('금액도 tier 도 없으면 null이다 (0이 "0만원"으로 새지 않는다, AC-2)', () => {
    expect(summaryBudget(0)).toBeNull();
  });
});
