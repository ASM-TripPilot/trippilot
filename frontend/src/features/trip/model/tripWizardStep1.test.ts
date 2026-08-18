import fc from 'fast-check';

import {
  COMPANION_OPTIONS,
  PERIOD_PRESETS,
  deriveEndDate,
  formatDateRange,
  presetRange,
} from './tripWizardStep1';

/**
 * TRIP-205 — 위저드 1/2 화면이 쓰는 순수 함수 (AC-5 · AC-8).
 *
 * 무엇을 보장하나: 기간 프리셋이 **주입된 기준일**만 보고 날짜를 계산하고(실행일이 바뀌어도
 * 결과가 안 흔들린다 — 01b D5), 날짜 표시 문자열이 Figma 실측 형태(en dash)와 정확히 같으며,
 * 프리셋·동반 유형의 코드↔라벨 표가 정본 어휘(BR-U1-36 · BR-U1-39)에서 벗어나지 않는다.
 *
 * 커버하지 않는 것: 화면 렌더와 스토어 반영은 각각 `TripWizardStep1Screen.test.tsx`·
 * `tripWizardStore.test.ts`가 본다. 여기는 계산만 본다.
 *
 * ⚠️ 프리셋 계산 규칙 자체는 **정본에 없다**(BR-U1-36은 "자동 채우되 수정 가능"만 말한다).
 * 아래 표는 이 칸이 정한 규칙이고, 게이트①에서 뒤집히면 이 파일의 기대값만 갈아 끼운다.
 */

/** 기준일 고정값. 이 날(수요일)의 `3박 4일` 결과가 Figma 날짜 카드 실측값과 정확히 같다. */
const BASE = '2026-06-10';

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' 두 개의 간격(일). 로컬 타임존과 무관하게 센다. */
function daysBetween(from: string, to: string): number {
  const toUtc = (date: string): number => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

/** 에포크 일수 → 'YYYY-MM-DD'. **테스트 오라클 전용** — `new Date`로 임의의 유효 날짜를
 * 만든다(소스 스캔이 금지하는 건 프로덕션 파일이지 테스트가 아니다). PBT에서 `deriveEndDate`에
 * 넘길 출발일을 무작위로 생성하는 데 쓴다. */
function epochToIso(epochDay: number): string {
  const t = new Date(epochDay * MS_PER_DAY);
  const year = t.getUTCFullYear();
  const month = String(t.getUTCMonth() + 1).padStart(2, '0');
  const day = String(t.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('AC-5 · 기간 프리셋 → 날짜 범위 (기준일 주입)', () => {
  it('프리셋 4종이 기준일 2026-06-10에서 정해진 범위를 낸다', () => {
    // 준비 — 기준일은 상수. 실행 — 4종을 한 번에 계산.
    const actual = {
      'this-weekend': presetRange('this-weekend', BASE),
      'next-weekend': presetRange('next-weekend', BASE),
      '1n2d': presetRange('1n2d', BASE),
      '3n4d': presetRange('3n4d', BASE),
    };

    // 단언 — 네 건을 **한 객체로 통째 비교**한다. 따로 단언하면 첫 실패에서 멈춰
    // 나머지 셋이 맞는지 못 본다(diff 한 번에 전부 보이는 형태가 낫다).
    expect(actual).toEqual({
      // 2026-06-10은 수요일 → 이번 주말은 6/13(토)~6/14(일)
      'this-weekend': { startDate: '2026-06-13', endDate: '2026-06-14' },
      'next-weekend': { startDate: '2026-06-20', endDate: '2026-06-21' },
      '1n2d': { startDate: '2026-06-10', endDate: '2026-06-11' },
      // Figma 날짜 카드 실측 `6월 10일 – 6월 13일`과 같은 값이다.
      '3n4d': { startDate: '2026-06-10', endDate: '2026-06-13' },
    });
  });

  it('주말 프리셋의 요일 경계 — 토요일은 당일, 일요일은 다음 주 토요일', () => {
    // 준비 — 토(2026-06-13) · 일(2026-06-14).
    const saturday = presetRange('this-weekend', '2026-06-13');
    const sunday = presetRange('this-weekend', '2026-06-14');

    // 단언 — 토요일이면 그날이 곧 '이번 주말'이다.
    expect(saturday).toEqual({
      startDate: '2026-06-13',
      endDate: '2026-06-14',
    });
    // 일요일에는 이번 주말이 이미 끝났다고 본다 → 다음 토요일로 넘어간다.
    expect(sunday).toEqual({ startDate: '2026-06-20', endDate: '2026-06-21' });

    // '다음 주말'은 어느 기준일에서든 '이번 주말'의 정확히 7일 뒤다.
    expect(presetRange('next-weekend', '2026-06-13')).toEqual({
      startDate: '2026-06-20',
      endDate: '2026-06-21',
    });
    expect(presetRange('next-weekend', '2026-06-14')).toEqual({
      startDate: '2026-06-27',
      endDate: '2026-06-28',
    });
  });

  it('라벨의 박수와 실제 간격이 어긋나지 않는다 — 3박 4일은 3박이다', () => {
    // 라벨(`3박 4일`)과 계산 결과가 갈리면 사용자가 본 것과 서버로 갈 값이 달라진다.
    // INV-U1-14의 "기간(박) = endDate − startDate"와 같은 셈이다.
    const range = presetRange('3n4d', BASE);
    expect(daysBetween(range.startDate, range.endDate)).toBe(3);

    const short = presetRange('1n2d', BASE);
    expect(daysBetween(short.startDate, short.endDate)).toBe(1);

    const weekend = presetRange('this-weekend', BASE);
    expect(daysBetween(weekend.startDate, weekend.endDate)).toBe(1);
  });
});

describe('AC-5 · 날짜 표시 문자열 (Figma 실측)', () => {
  it('구분자는 en dash(–)다 — 하이픈(-)이 아니다', () => {
    // 준비·실행.
    const text = formatDateRange('2026-06-10', '2026-06-13');

    // 단언 — Figma `dateF` 실측 문구 그대로.
    expect(text).toBe('6월 10일 – 6월 13일');

    // 짝(부정) — 하이픈은 다른 글자(U+2013 vs U+002D)라 조용히 어긋난다. 명시적으로 못박는다.
    expect(text).not.toBe('6월 10일 - 6월 13일');
  });

  it('한쪽이라도 비면 표시할 문자열이 없다', () => {
    // 미선택 상태를 "빈 문자열"이 아니라 null로 구별한다 — 화면이 자리표시 문구를
    // 그릴지 말지를 판단할 수 있어야 한다.
    expect(formatDateRange(undefined, '2026-06-13')).toBeNull();
    expect(formatDateRange('2026-06-10', undefined)).toBeNull();
    expect(formatDateRange(undefined, undefined)).toBeNull();
  });
});

describe('정본 어휘 — 프리셋·동반 유형 표', () => {
  it('기간 프리셋은 BR-U1-36이 정한 4종이고 라벨이 그대로다', () => {
    // 코드는 testID에 들어가는 ASCII(01b D7), 라벨은 화면에 보이는 한글이다.
    expect(PERIOD_PRESETS).toEqual([
      { code: 'this-weekend', label: '이번 주말' },
      { code: 'next-weekend', label: '다음 주말' },
      { code: '1n2d', label: '1박 2일' },
      { code: '3n4d', label: '3박 4일' },
    ]);
  });

  it('동반 유형 코드가 서버 enum 4종에 1:1로 붙는다', () => {
    // testID·키에는 ASCII를, 스토어·서버에는 enum 한글을 쓴다. 둘을 섞으면
    // 셀렉터가 깨지거나 서버가 거부한다(BR-U1-39 · 01b D7).
    expect(COMPANION_OPTIONS).toEqual([
      { code: 'alone', type: '혼자' },
      { code: 'friend', type: '친구' },
      { code: 'partner', type: '연인' },
      { code: 'family', type: '가족' },
    ]);
  });
});

/**
 * TRIP-389 — 여행 기간을 여행지 박수 합에서 파생한다. 달력은 출발일만 고르고, 종료일은
 * `deriveEndDate(출발, Σ박수)`로 자동 계산한다.
 *
 * 무엇을 보장하나: (1) 종료일이 출발일에서 정확히 Σ박수만큼 뒤이고(월·연·윤년 경계도 정확),
 * (2) 그래서 `종료일 − 출발일 === Σ박수`가 **항상** 성립한다 — 이 등호가 곧 "박수 합이 기간을
 * 넘을 수 없다"(INV-U1-14)의 구조적 불가다(달력 파생 경로 한정 — 프리셋은 별도 함수라 스코프 밖).
 *
 * ⚠️ 시계를 안 읽는다 — 역변환은 `tripWizardStep1.ts`에 이미 private으로 있는 `fromEpochDay`
 * (Hinnant civil_from_days)를 재사용하고 `new Date(`를 안 쓴다. 이 파일의 오라클(`new Date`)은
 * 테스트 안에서만 쓰는 대조용이다(소스 스캔 대상은 프로덕션 파일뿐).
 */
describe('TRIP-389 · deriveEndDate — 출발일 + Σ박수 → 종료일 파생', () => {
  it('1박은 하루 뒤, 0박은 당일, 월·연·윤년 경계를 정확히 넘는다', () => {
    // 준비·실행·단언을 값마다 한 줄로 — 여러 경계를 한눈에 diff한다.
    expect(deriveEndDate('2026-08-20', 1)).toBe('2026-08-21'); // 기본 1박
    expect(deriveEndDate('2026-06-15', 0)).toBe('2026-06-15'); // 여행지 0개 → 당일(degrade)
    expect(deriveEndDate('2026-08-31', 3)).toBe('2026-09-03'); // 월 넘김
    expect(deriveEndDate('2026-12-30', 3)).toBe('2027-01-02'); // 연 넘김
    expect(deriveEndDate('2024-02-28', 1)).toBe('2024-02-29'); // 2024 윤년 2월
    expect(deriveEndDate('2024-02-28', 2)).toBe('2024-03-01'); // 윤년 2월 경계 넘김
    expect(deriveEndDate('2026-02-28', 1)).toBe('2026-03-01'); // 2026 평년 2월
  });
});

describe('AC-4 · deriveEndDate 경로는 종료일 − 출발일 === Σ박수 (PBT)', () => {
  it('임의의 출발일·박수(≥0)에서 간격이 정확히 박수와 같다', () => {
    // 예시가 못 보는 구석(월말·연말·윤년·먼 미래)을 무작위로 훑는다. 이 등호가 깨지지 않는
    // 한 달력 파생 경로에서는 INV-U1-14 위반을 만들 방법이 없다. 프리셋 경로는 이 함수를
    // 안 타므로(별도 presetRange) 여기서 잠그지 않는다 — 결정2 영역 침범 금지(02a ★2).
    fc.assert(
      fc.property(
        // 출발 에포크 일수: 대략 1915~2035 범위(오라클로 유효 날짜 문자열을 만든다).
        fc.integer({ min: -20000, max: 24000 }),
        // 박수: 0(당일)부터 약 10년까지.
        fc.integer({ min: 0, max: 3650 }),
        (startEpoch, nights) => {
          const startDate = epochToIso(startEpoch);
          const endDate = deriveEndDate(startDate, nights);
          expect(daysBetween(startDate, endDate)).toBe(nights);
        }
      ),
      { numRuns: 500 }
    );
  });
});
