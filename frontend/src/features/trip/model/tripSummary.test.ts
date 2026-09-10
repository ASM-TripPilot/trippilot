import type {
  CompanionType,
  TripDestination,
} from '@/shared/api/generated/schemas';

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
 *  - **요약 5행(AC-2)**: 여행지·기간·동행·취향·예산 각각을 화면이 그대로 그릴 문자열로 도출하고,
 *    "미선택/미입력"은 빈 문자열이 아니라 `null`로 구분한다(화면이 빈 얼굴을 그릴 수 있게).
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

describe('summaryDestinations — 여행지 요약 행 (AC-2)', () => {
  it('여러 도시를 "부산 2박 · 경주 1박"으로 조인한다', () => {
    // 준비
    const destinations = [dest('부산', 2, 1), dest('경주', 1, 2)];

    // 실행 + 단언 — 각 도시 `${region} ${nights}박`을 ` · `(U+00B7)로 잇는다.
    expect(summaryDestinations(destinations)).toBe(`부산 2박${DOT}경주 1박`);
  });

  it('도시가 하나면 조인 없이 그 한 줄이다', () => {
    expect(summaryDestinations([dest('서울', 3)])).toBe('서울 3박');
  });

  it('0개면 null이다 (빈 문자열이 아니다 — 화면이 미선택 얼굴을 그린다)', () => {
    expect(summaryDestinations([])).toBeNull();
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
  const EXPECTED_PERIODS: ReadonlyArray<[string, string, string]> = [
    [
      '2026-06-10',
      '2026-06-13',
      `6월 10일(수) ${EN_DASH} 13일(토)${DOT}3박 4일`,
    ],
    ['2026-06-08', '2026-06-09', `6월 8일(월) ${EN_DASH} 9일(화)${DOT}1박 2일`],
    [
      '2026-06-14',
      '2026-06-15',
      `6월 14일(일) ${EN_DASH} 15일(월)${DOT}1박 2일`,
    ],
    [
      '2026-06-11',
      '2026-06-12',
      `6월 11일(목) ${EN_DASH} 12일(금)${DOT}1박 2일`,
    ],
  ];

  it.each(EXPECTED_PERIODS)(
    '%s ~ %s → "%s" (요일은 실제 달력)',
    (startDate, endDate, expected) => {
      expect(summaryPeriod(startDate, endDate)).toBe(expected);
    }
  );

  it('시작일만 있으면 null이다', () => {
    expect(summaryPeriod('2026-06-10', undefined)).toBeNull();
  });

  it('종료일만 있으면 null이다', () => {
    expect(summaryPeriod(undefined, '2026-06-13')).toBeNull();
  });

  it('둘 다 없으면 null이다', () => {
    expect(summaryPeriod(undefined, undefined)).toBeNull();
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

  it.each(CASES)('%s · %p명 → "%s"', (type, party, expected) => {
    expect(summaryCompanion(type, party)).toBe(expected);
  });

  it('동행 유형이 미정이면 null이다 (인원이 있어도)', () => {
    expect(summaryCompanion(undefined, 2)).toBeNull();
  });
});

// ── AC-2 취향 ──────────────────────────────────────────────────────────────────

describe('summaryPreferences — 취향 요약 행 (AC-2, D3)', () => {
  it('라벨을 " · "로 조인하고 온보딩 출처면 " + 온보딩"을 붙인다', () => {
    expect(summaryPreferences(['미식', '전시', '야경'], true)).toBe(
      `미식${DOT}전시${DOT}야경 + 온보딩`
    );
  });

  it('온보딩 출처가 아니면 접미 없이 조인만 한다', () => {
    expect(summaryPreferences(['미식', '전시', '야경'], false)).toBe(
      `미식${DOT}전시${DOT}야경`
    );
  });

  it('라벨이 하나여도 규칙은 같다', () => {
    expect(summaryPreferences(['미식'], true)).toBe('미식 + 온보딩');
    expect(summaryPreferences(['미식'], false)).toBe('미식');
  });

  it('라벨이 0개면 fromOnboarding과 무관하게 null이다 (" + 온보딩"이 새지 않는다)', () => {
    expect(summaryPreferences([], true)).toBeNull();
    expect(summaryPreferences([], false)).toBeNull();
  });
});

// ── AC-2 예산 ──────────────────────────────────────────────────────────────────

describe('summaryBudget — 예산 요약 행 (AC-2, D4·D5)', () => {
  it('tier가 있으면 "120만원 · 1인 총액 · 중간"이다', () => {
    expect(summaryBudget(1200000, '중간')).toBe(
      `120만원${DOT}1인 총액${DOT}중간`
    );
  });

  it('tier가 없으면 tier 절을 생략한다', () => {
    expect(summaryBudget(1200000)).toBe(`120만원${DOT}1인 총액`);
  });

  it('만원 미만 단위는 반올림한다 — 1,234,567원 → "123만원"', () => {
    // 1234567 / 10000 = 123.4567 → 소수부 < 0.5 이므로 round·floor·trunc 모두 123.
    // 이 값만으로는 반올림 방향을 못 가른다.
    expect(summaryBudget(1234567)).toBe(`123만원${DOT}1인 총액`);
    expect(summaryBudget(1234567, '고급')).toBe(
      `123만원${DOT}1인 총액${DOT}고급`
    );
    // 1235000 / 10000 = 123.5 → 소수부 ≥ 0.5. round=124, floor/trunc=123.
    // 이 케이스가 반올림 방향을 실제로 잠근다(뮤테이션 실측: round→floor 시 red).
    expect(summaryBudget(1235000)).toBe(`124만원${DOT}1인 총액`);
  });

  it('금액이 0이면 tier 유무와 무관하게 null이다 (0이 "0만원"으로 새지 않는다)', () => {
    expect(summaryBudget(0)).toBeNull();
    expect(summaryBudget(0, '중간')).toBeNull();
  });
});
