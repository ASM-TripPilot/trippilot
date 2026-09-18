/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { SHEET_HANDLE_INDICATOR_STYLE } from '@/features/trip/lib/sheetHandle';

/**
 * TRIP-735 — g01/g02 편집 시트 6종의 바텀시트 핸들 단일화 소스 층 가드.
 *
 * 무엇을 보장하나: 6 시트가 ① 콘텐츠 안 커스텀 그래버 바(2겹의 원인)를 **더는 갖지 않고**
 * ② gorhom 기본 핸들을 `handleIndicatorStyle` 로 덮되 그 값을 **공용 상수 1출처**
 * (`SHEET_HANDLE_INDICATOR_STYLE`)에 **바인딩**한다. 이 둘이라야 "1겹·연회색·통일"이 성립한다.
 *
 * 왜 소스 스캔인가: `@gorhom/bottom-sheet` 목이 통과형(children 무조건 렌더·prop 무시)이라
 * **핸들 실렌더·색·2겹 여부는 jest 가 원리적으로 못 본다**(repo-traps 바텀시트 절). 이 변경엔
 * 자연 jest 심판이 0이라(그래버는 testID 없음) 이 파일이 유일한 jest 그물이다 — 실동작(핸들
 * 1겹 육안)은 6-b 자동 육안 게이트 몫.
 *
 * ⚠️ 탐지 강도(5-b 봉합): 그래버 판정은 **클래스 순서 무관 정규식**이라 `h-[4px]`·`w-[40px]`를
 * 한 className 안에 함께 가진 바를 순서와 무관히 잡는다(정확 문자열이면 순서만 바꿔 재삽입한
 * 2겹 회귀가 통과했다 — 5-b 경고-1). 핸들은 `handleIndicatorStyle={SHEET_HANDLE_INDICATOR_STYLE}`
 * **한 덩어리**를 잠가 prop-상수 바인딩까지 본다(문자열 공존만으로는 인라인 스타일로 새면 못 잡음 —
 * 참고-2). 모든 단언은 stripComments 후에 돈다(주석에 남은 idiom 의 거짓 GREEN 차단 — 참고-1).
 *
 * 상수를 raw ViewStyle 로 두는 이유: handleIndicatorStyle 은 NativeWind className 이 아니라
 * raw 스타일을 받으므로 hex 가 필요하다. 시트 6종의 g3 raw-hex 가드(.tsx 스캔)를 지키려면 색을
 * `.ts` 상수 모듈로 빼야 한다(gradients.ts·locationColors.ts 동일 패턴).
 */

const SRC_ROOT = resolve(__dirname, '..');

/** 스캔 대상 6 시트(트립 4 + step1 2). */
const SHEETS = [
  join(SRC_ROOT, 'features', 'trip', 'ui', 'DestinationEditSheet.tsx'),
  join(SRC_ROOT, 'features', 'trip', 'ui', 'PeriodEditSheet.tsx'),
  join(SRC_ROOT, 'features', 'trip', 'ui', 'CompanionEditSheet.tsx'),
  join(SRC_ROOT, 'features', 'trip', 'ui', 'StaySelectSheet.tsx'),
  join(SRC_ROOT, 'pages', 'trip-new-step1', 'ui', 'BudgetEditSheet.tsx'),
  join(SRC_ROOT, 'pages', 'trip-new-step1', 'ui', 'PrefOverrideSheet.tsx'),
];

/** 줄/블록 주석 제거 — `:` 뒤 `//`(URL)는 주석으로 안 본다(형제 6가드 계승). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** prop 이 공용 상수에 바인딩됐는지 — 한 덩어리로 잠근다(문자열 공존 아님). */
const HANDLE_WIRING = /handleIndicatorStyle=\{SHEET_HANDLE_INDICATOR_STYLE\}/;
/** 종전 커스텀 그래버 바 — h-[4px]·w-[40px] 를 한 className 안에 함께 가진 View(순서 무관). */
const GRABBER_BAR =
  /className="[^"]*(?:h-\[4px\][^"]*w-\[40px\]|w-\[40px\][^"]*h-\[4px\])/;

describe('g0 · 탐지기 자가검사 (전처리 × 탐지기 조합)', () => {
  it('stripComments 는 주석 속 idiom 을 걷고, 코드/URL 은 살린다', () => {
    const sample = [
      '// handleIndicatorStyle={SHEET_HANDLE_INDICATOR_STYLE} 나중에', // 주석 → 걷힘
      '      handleIndicatorStyle={SHEET_HANDLE_INDICATOR_STYLE}', // 코드 → 생존
      'const url = "https://x.com/a";', // URL 슬래시 보존
    ].join('\n');

    const stripped = stripComments(sample);

    // 코드 줄이 남아 바인딩이 잡힌다.
    expect(HANDLE_WIRING.test(stripped)).toBe(true);
    // 주석만이면 걷혀서 미검출(false GREEN 차단).
    expect(
      HANDLE_WIRING.test(
        stripComments('// handleIndicatorStyle={SHEET_HANDLE_INDICATOR_STYLE}')
      )
    ).toBe(false);
    // URL 은 통째로 살아남는다.
    expect(stripped).toContain('https://x.com/a');
  });

  it('GRABBER_BAR 는 클래스 순서와 무관히 그래버 바를 잡는다', () => {
    // 원본 순서
    expect(
      GRABBER_BAR.test(
        '<View className="h-[4px] w-[40px] rounded-[2px] bg-hairline-strong" />'
      )
    ).toBe(true);
    // 순서만 바꾼 재삽입(5-b 경고-1 시나리오)
    expect(
      GRABBER_BAR.test(
        '<View className="w-[40px] h-[4px] rounded-[2px] bg-hairline-strong" />'
      )
    ).toBe(true);
    // 무관한 원형 버튼(h-9 w-9)은 안 잡는다.
    expect(GRABBER_BAR.test('<View className="h-9 w-9 rounded-full" />')).toBe(
      false
    );
  });
});

describe('TRIP-735 · 공용 핸들 상수 shape', () => {
  it('SHEET_HANDLE_INDICATOR_STYLE 은 폭40·높이4·r2·hairline-strong(#DDDDDD) 이다', () => {
    // Arrange/Act: 상수를 그대로 읽는다(Act 없음 — 값 계약 검증).
    // Assert: 종전 커스텀 그래버 바(w-40·h-4·r2·#DDDDDD)와 육안 동일한 값.
    // ⚠️ 색은 hairline-strong 토큰의 손수 복제라 토큰 드리프트 시 여기만 갈라진다(5-b 참고-3, 후속 후보).
    expect(SHEET_HANDLE_INDICATOR_STYLE).toMatchObject({
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: '#DDDDDD',
    });
  });
});

describe('TRIP-735 · 6 편집 시트 핸들 단일화', () => {
  for (const sheet of SHEETS) {
    describe(basename(sheet), () => {
      it('파일이 실재한다 (빈 스캔 공허통과 차단)', () => {
        expect(existsSync(sheet)).toBe(true);
      });

      it('gorhom 기본 핸들을 공용 상수에 바인딩해 덮는다 (prop=const, 주석 제외)', () => {
        const src = stripComments(readFileSync(sheet, 'utf8'));
        expect(HANDLE_WIRING.test(src)).toBe(true);
      });

      it('콘텐츠 안 커스텀 그래버 바가 제거됐다 (2겹 해소, 클래스 순서 무관)', () => {
        const src = stripComments(readFileSync(sheet, 'utf8'));
        expect(GRABBER_BAR.test(src)).toBe(false);
      });
    });
  }
});
