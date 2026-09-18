/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/**
 * TRIP-683 AC-2·AC-3 — g01/g02 편집 시트 6종이 리포 표준 바텀시트 idiom을 갖는지 소스 스캔.
 *
 * 무엇을 보장하나: 6 시트가 ① 딤(`backdropComponent`) ② 아래로 끌어 닫기(`enablePanDownToClose`)
 * ③ 닫힘 콜백 JSX 배선(`onClose={...}`)을 소스에 갖는다. 이 셋이 있어야 딤 바깥 탭으로 닫히고
 * (AC-2) 시트 열린 동안 뒤 화면이 딤에 덮여 겹침이 안 난다(AC-3). 정상 패턴 선례는 `OtaChoiceSheet`.
 *
 * 왜 소스 스캔인가: `@gorhom/bottom-sheet` 목이 통과형(children 무조건 렌더)이라 **실개폐·딤 커버·
 * 바깥탭 닫힘은 jest가 원리적으로 못 본다**(repo-traps 바텀시트 절). jest 판정의 전부는 "idiom이
 * 소스에 실재하나". 실동작은 6-b 실기 몫(자율 세션 SKIP).
 *
 * ⚠️ 전처리 × 탐지기 조합: `stripComments`로 주석 속 idiom 단어를 걷어야(false green 방지) 하되,
 * URL(`://`)의 슬래시를 주석으로 오인하면 안 된다. g0(리터럴)·g1(실파일 OtaChoiceSheet)이 그 정합을
 * 1회씩 실제 문자열로 태운다. onClose는 인터페이스 선언(`onClose:`)이 아니라 **JSX 배선**(`onClose={`)을
 * 본다 — 인터페이스만 선언하고 시트 요소에 안 배선하면 닫힘이 죽는 부분 결함을 잡기 위해서다(★6).
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

/** 정상 패턴 선례 — 긍정 통제(regex가 실제 idiom을 잡는지·전처리가 안 지우는지 실측). */
const REFERENCE = join(
  SRC_ROOT,
  'features',
  'stay',
  'ui',
  'OtaChoiceSheet.tsx'
);

/** 줄/블록 주석 제거 — `:` 뒤 `//`(URL)는 주석으로 안 본다(`destinationEditSheetStructure` 계승). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const BACKDROP = /backdropComponent/;
const PAN_DOWN = /enablePanDownToClose/;
const ON_CLOSE = /onClose=\{/;

describe('g0 · 탐지기 자가검사 (전처리 × 탐지기 조합)', () => {
  it('stripComments 는 주석 속 idiom 을 걷고, 코드/URL 은 살린다', () => {
    const sample = [
      '// backdropComponent 를 나중에 단다', // 주석 → 걷힘
      '<BottomSheet enablePanDownToClose onClose={onClose} backdropComponent={renderBackdrop}>', // 코드 → 생존
      'const url = "https://x.com/a";', // URL 슬래시 보존
    ].join('\n');

    const stripped = stripComments(sample);

    // 탐지기 자체는 문다.
    expect(BACKDROP.test('backdropComponent')).toBe(true);
    // 코드 줄이 남아서 3 idiom 모두 검출.
    expect(BACKDROP.test(stripped)).toBe(true);
    expect(PAN_DOWN.test(stripped)).toBe(true);
    expect(ON_CLOSE.test(stripped)).toBe(true);
    // 주석만 있으면 걷혀서 미검출(false green 방지).
    expect(BACKDROP.test(stripComments('// backdropComponent'))).toBe(false);
    // URL 은 통째로 살아남는다(주석으로 오인 안 함).
    expect(stripped).toContain('https://x.com/a');
  });
});

describe('g1 · 정상 패턴 선례(OtaChoiceSheet)가 3 idiom 을 만족한다 (긍정 통제)', () => {
  it('전처리 후에도 backdropComponent·enablePanDownToClose·onClose 배선이 실재한다', () => {
    expect(existsSync(REFERENCE)).toBe(true);
    const src = stripComments(readFileSync(REFERENCE, 'utf8'));
    // 구현자가 6 시트에 복사할 실제 idiom 이 내 정규식에 잡히고, 전처리가 그걸 안 지운다.
    expect(BACKDROP.test(src)).toBe(true);
    expect(PAN_DOWN.test(src)).toBe(true);
    expect(ON_CLOSE.test(src)).toBe(true);
  });
});

describe('AC-2·AC-3 · 6 편집 시트가 딤·pan-down·onClose idiom 을 갖는다', () => {
  for (const sheet of SHEETS) {
    describe(basename(sheet), () => {
      it('파일이 실재한다 (빈 스캔 공허통과 차단)', () => {
        expect(existsSync(sheet)).toBe(true);
      });

      it('딤(backdropComponent) 을 배선한다 — 바깥 탭 닫힘·겹침 차단의 근거', () => {
        const src = stripComments(readFileSync(sheet, 'utf8'));
        expect(BACKDROP.test(src)).toBe(true);
      });

      it('enablePanDownToClose 로 아래로 끌어 닫힌다', () => {
        const src = stripComments(readFileSync(sheet, 'utf8'));
        expect(PAN_DOWN.test(src)).toBe(true);
      });

      it('onClose 를 시트 요소에 JSX 배선한다 (인터페이스 선언만으로는 불충분)', () => {
        const src = stripComments(readFileSync(sheet, 'utf8'));
        expect(ON_CLOSE.test(src)).toBe(true);
      });
    });
  }
});
