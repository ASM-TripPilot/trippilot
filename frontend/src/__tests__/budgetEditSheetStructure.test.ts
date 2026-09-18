/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-670 예산 편집 시트 소스 층 가드 (AC-5 — 화면 props-only·raw hex 0·INV-3 duration 0).
 *
 * 무엇을 보장하나: `pages/trip-new-step1/ui/BudgetEditSheet.tsx` 가 ① 소요시간(INV-3)·`duration` 을 안 쓰고
 * (blanket 회귀 앵커 — 이 시트엔 시간/거리 축이 없어 자명하지만 회귀 앵커로 둔다) ② raw hex 를 안 쓰며
 * (토큰 경유) ③ 상태·라우터·쿼리·스토어를 직접 물지 않는 **props-only 무상태** 컴포넌트임을(01b D4).
 *
 * 왜 이 파일이 필요한가(gap-filler): `pagesLayerStructure.test.ts`(pages 재귀)가 이 신규 파일을 자동
 * 편입해 duration·zustand·URL·raw hex 를 이미 이중으로 잠근다. 그러나 그 스캔은 **`useState` 를 안 본다** —
 * 이 시트의 "무상태" 계약(드래프트는 배선이 소유, 시트는 useState 0)은 이 파일 g4 가 유일한 그물이다
 * (companion/period 자매 g4 동형). `useState` 가 시트로 새면 g4 가 red 로 잡는다.
 *
 * `toLocaleString`/`Intl` 0 은 이 파일이 아니라 `tripBudgetStructure.test.ts`(canonical 로케일 가드)가
 * 이 시트를 스캔 배열에 편입해 잠근다 — 여기서 중복 스캔하지 않는다(01b D5 · 브리프 §7-⑤).
 *
 * ⚠️ 전처리×탐지기 조합: `stripComments` 가 주석 속 금칙어를 걷되 URL 의 `://` 슬래시는 주석으로
 * 오인하면 안 된다(2026-07-31 실사고). g0 이 실제 문자열로 그 정합을 1회 태운다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const SHEET = join(
  SRC_ROOT,
  'pages',
  'trip-new-step1',
  'ui',
  'BudgetEditSheet.tsx'
);

/** 줄/블록 주석 제거 — `:` 뒤 `//`(URL)는 주석으로 안 본다(`companionEditSheetStructure.test.ts` 계승). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;
const PURITY_FORBIDDEN = [
  /\buseState\b/,
  /\buseReducer\b/,
  /\bzustand\b/,
  /\buseTripWizardStore\b/,
  /expo-router/,
  /@tanstack\/react-query/,
  /from ['"]axios['"]/,
];

describe('g0 · 탐지기 자가검사 (전처리 × 탐지기 조합)', () => {
  it('stripComments 는 주석 속 금칙어를 걷고, 코드/URL 은 살린다', () => {
    const sample = [
      '// 소요시간을 계산한다', // 주석 → 걷힘
      'const label = "15분";', // 코드 → 생존
      'const url = "https://example.com/x";', // URL 슬래시 보존
    ].join('\n');

    const stripped = stripComments(sample);

    expect(DURATION_TEXT.test('소요시간을 계산한다')).toBe(true); // 탐지기 자체는 문다
    expect(DURATION_TEXT.test(stripped)).toBe(true); // '15분'(코드)이 남아서
    expect(DURATION_TEXT.test(stripComments('// 소요시간'))).toBe(false); // 주석만이면 미검출
    expect(stripped).toContain('https://example.com/x'); // URL 오인 안 함
  });
});

describe('AC-5 · BudgetEditSheet.tsx 소스 가드', () => {
  it('g1 · 파일이 실재한다 (빈 스캔 공허통과 차단)', () => {
    expect(existsSync(SHEET)).toBe(true);
  });

  it('g2 · INV-3 — 소요시간·duration 0건 (blanket 회귀 앵커, 이 시트엔 시간/거리 축 없음)', () => {
    const src = stripComments(readFileSync(SHEET, 'utf8'));
    expect(DURATION_TEXT.test(src)).toBe(false);
    expect(/\bduration\b/i.test(src)).toBe(false);
  });

  it('g3 · raw hex 0건 (토큰 경유)', () => {
    const src = stripComments(readFileSync(SHEET, 'utf8'));
    expect(RAW_HEX.test(src)).toBe(false);
  });

  it('g4 · props-only 순수성 — 상태·라우터·쿼리·스토어 0건', () => {
    const src = stripComments(readFileSync(SHEET, 'utf8'));
    for (const forbidden of PURITY_FORBIDDEN) {
      expect(forbidden.test(src)).toBe(false);
    }
    // 짝(긍정) — 콜백 계약이 실재한다(무관 파일/빈 파일 공허통과 차단).
    expect(src).toContain('onSelectTier');
    expect(src).toContain('onApply');
  });
});
