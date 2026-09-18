/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-673 숙소 선택 시트(S9) 소스 층 가드 (AC-6 — 화면 props-only · raw hex 0 · INV-3 · 사진 발명 금지).
 *
 * 무엇을 보장하나: `StaySelectSheet.tsx` 가 ① 상태·라우터·쿼리·스토어를 직접 물지 않는 **props-only**
 * 컴포넌트고(드래프트=선택 savedStayId 는 배선 TripNewStep2Page 가 소유, 01b D5) ② raw hex 를 안 쓰며
 * (토큰 경유) ③ 소요시간(INV-3)·`duration` 을 안 쓰고 ④ **사진을 발명하지 않는다**(SavedStay 계약에
 * imageUrl 없음 — 회색 placeholder 만, `require(`·URL 리터럴 0, INV-1).
 *
 * 왜 소스 스캔인가: props-only 순수성(useState·router 부재)·사진 발명 금지는 렌더로 관찰할 수 없다 —
 * 소스 층이라야 "숨은 훅"·"숨은 이미지 소스"를 잡는다(`companionEditSheetStructure.test.ts` 선례 동형).
 *
 * ⚠️ 전처리×탐지기 조합: `stripComments` 가 주석 속 금칙어를 걷되 URL 의 `://` 슬래시는 주석으로
 * 오인하면 안 된다(2026-07-31 실사고). g0 이 실제 문자열로 그 정합을 1회 태운다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const SHEET = join(SRC_ROOT, 'features', 'trip', 'ui', 'StaySelectSheet.tsx');

/** 줄/블록 주석 제거 — `:` 뒤 `//`(URL)는 주석으로 안 본다(`tripDraftBoundary.test.ts` 계승). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요|duration)/;
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;
const IMAGE_SOURCE = /(require\(|https?:\/\/)/;
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

    expect(stripped).not.toMatch(/소요시간/); // 주석은 사라졌다
    expect(stripped).toMatch(/15분/); // 코드 리터럴은 남았다
    expect(stripped).toMatch(/https:\/\/example\.com/); // URL 슬래시 보존
    // 탐지기가 코드 속 금칙어는 실제로 문다.
    expect(DURATION_TEXT.test(stripped)).toBe(true);
  });
});

describe('구조 가드 — StaySelectSheet.tsx', () => {
  it('파일이 정본 경로에 실재하고 시트 루트 testID 를 소유한다 (긍정 앵커)', () => {
    expect(existsSync(SHEET)).toBe(true);
    const source = readFileSync(SHEET, 'utf8');
    expect(source).toContain('trip-base-staysheet'); // 빈 파일 공허 통과 차단
  });

  it('g1 · props-only — 상태·라우터·쿼리·스토어·타 feature import 0건', () => {
    const source = stripComments(readFileSync(SHEET, 'utf8'));
    for (const forbidden of PURITY_FORBIDDEN) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it('g2 · raw hex 0건 (토큰 경유)', () => {
    const source = stripComments(readFileSync(SHEET, 'utf8'));
    expect(RAW_HEX.test(source)).toBe(false);
  });

  it('g3 · INV-3 — 소요시간·duration 문자열 0건', () => {
    const source = stripComments(readFileSync(SHEET, 'utf8'));
    expect(DURATION_TEXT.test(source)).toBe(false);
  });

  it('g4 · 사진 발명 금지 — require(·URL 리터럴 0건 (INV-1, 회색 placeholder 만)', () => {
    const source = stripComments(readFileSync(SHEET, 'utf8'));
    expect(IMAGE_SOURCE.test(source)).toBe(false);
  });
});
