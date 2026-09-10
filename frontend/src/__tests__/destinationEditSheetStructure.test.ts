/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-666 여행지 편집 시트 소스 층 가드 (AC-6 — 화면 props-only·raw hex 0·INV-3 duration 0).
 *
 * 무엇을 보장하나: `DestinationEditSheet.tsx` 가 ① 소요시간(INV-3)·`duration` 을 안 쓰고 ② raw hex 를
 * 안 쓰며(토큰 경유) ③ 상태·라우터·쿼리·스토어를 직접 물지 않는 **props-only** 컴포넌트임을.
 *
 * 왜 소스 스캔인가: props-only 순수성(useState·router 부재)은 렌더로 관찰할 수 없다 — 소스 층이라야
 * "숨은 훅"을 잡는다(`tripWizardStep1Boundary.test.ts`·`placeExploreStructure.test.ts` 선례). INV-3 는
 * `accessibilityLabel` 같은 렌더-비가시 문자열도 소스에서만 확실히 잡힌다(`executionDurationStructure` 선례).
 *
 * ⚠️ 전처리×탐지기 조합: `stripComments` 가 주석 속 금칙어를 걷되 URL 의 `://` 슬래시는 주석으로
 * 오인하면 안 된다(2026-07-31 실사고). g0 이 실제 문자열로 그 정합을 1회 태운다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const SHEET = join(
  SRC_ROOT,
  'features',
  'trip',
  'ui',
  'DestinationEditSheet.tsx'
);

/** 줄/블록 주석 제거 — `:` 뒤 `//`(URL)는 주석으로 안 본다(`tripDraftBoundary.test.ts` 계승). */
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
  /@\/features\/(?!trip)/, // 자기 feature(trip)만 허용, 타 feature import 금지
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
    // 주석줄만 있으면 걷혀서 미검출
    expect(DURATION_TEXT.test(stripComments('// 소요시간'))).toBe(false);
    // URL 은 통째로 살아남는다(주석으로 오인 안 함)
    expect(stripped).toContain('https://example.com/x');
  });
});

describe('AC-6 · DestinationEditSheet.tsx 소스 가드', () => {
  it('g1 · 파일이 실재한다 (빈 스캔 공허통과 차단)', () => {
    expect(existsSync(SHEET)).toBe(true);
  });

  it('g2 · INV-3 — 소요시간·duration 0건', () => {
    const src = stripComments(readFileSync(SHEET, 'utf8'));
    expect(DURATION_TEXT.test(src)).toBe(false);
    expect(/\bduration\b/i.test(src)).toBe(false);
  });

  it('g3 · raw hex 0건 (토큰 경유)', () => {
    const src = stripComments(readFileSync(SHEET, 'utf8'));
    expect(RAW_HEX.test(src)).toBe(false);
  });

  it('g4 · props-only 순수성 — 상태·라우터·쿼리·스토어·타 feature 0건', () => {
    const src = stripComments(readFileSync(SHEET, 'utf8'));
    for (const forbidden of PURITY_FORBIDDEN) {
      expect(forbidden.test(src)).toBe(false);
    }
    // 짝(긍정) — 콜백 계약이 실재한다(무관 파일/빈 파일 공허통과 차단).
    expect(src).toContain('onChangeNights');
    expect(src).toContain('onApply');
  });
});
