/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1039 · 폴백 셸 이전의 **소스 층 가드**. 렌더로 못 보는 것만 본다 — 보이는 것은
 * `DraftPage.fallbackShell.integration.test.tsx` 가 맡는다.
 *
 * 무엇을 보장하나:
 *  - 🔴 초안 화면 3파일의 사용자 노출 문자열에 내부 용어 「슬롯」이 0건이다(AC-8 · QA #033). 렌더 스캔은
 *    얼굴마다 따로 그려야 하고 `accessibilityLabel` 을 놓쳐 소스를 훑는다. 범위는 3파일로 한정한다 —
 *    후보 시트(`SlotCandidateSheet.tsx`)의 문구는 새 티켓 후보다(브리프 맹점 ⑤).
 *  - 🔴 셸 안 폴백 안내 파일이 그 경로에 있고 **순수 표시**다(상태·라우터·조회 0) — 프리뷰가 네트워크
 *    계층 없이 그것만 가져다 쓸 수 있어야 한다(`layer-pages.md`).
 *  - 🔴 프리뷰는 그 파일을 **딥 경로**로 가져온다. `@/pages/itinerary-draft` 배럴은 DraftPage → 생성 훅
 *    (`@/shared/api/generated/...` 딥 경로)을 끄는데, 프리뷰 테스트의 지뢰 목은 `@/shared/api` 배럴 한
 *    경로만 막아 이 전이 로드를 못 잡는다.
 *
 * 전제 — 모든 스캔은 주석을 걷어낸 소스를 본다(`stripComments`, 파일마다 각자 갖는 리포 관례).
 * 걷지 않으면 "// 슬롯 교체 트리거" 같은 설명 주석 자체가 위반이 되어 어떤 구현도 통과 못 한다.
 *
 * 가짜 통과 방지: "없어야 한다" 단언은 같은 it 안의 "있어야 한다"(파일 실재·대표 심볼)와 짝을 이룬다.
 *
 * 졸업 조건(frontend/CLAUDE.md 「장치 판정 규칙」): G2·G3 은 이번 칸의 경로·심볼 스냅숏이라 정당한
 * 리네임에 red 를 낸다. 정당한 작업이 이 파일 때문에 red 를 낸 것이 2회 누적되면 G1(「슬롯」 0건)만
 * 남기고 나머지를 뗀다.
 */

const ROOT = path.resolve('src');

const SCREEN_REL = 'features/itinerary/ui/DraftScreen.tsx';
const PAGE_REL = 'pages/itinerary-draft/ui/DraftPage.tsx';
const BANNER_REL = 'pages/itinerary-draft/ui/DraftFallbackBanner.tsx';
const PREVIEW_REL = 'app/_dev/preview.tsx';

/** 블록 주석을 먼저 지운다. 줄 주석은 바로 앞 글자가 `:` 가 아닐 때만 — `'https://…'` 보존. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

/** 없는 파일은 빈 문자열 — 빈 문자열이 부정 단언을 공짜로 통과시키는 것은 같은 it 의 실재 단언이 막는다. */
function readStripped(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 아래 「슬롯」 0건이 의미를 갖는다', () => {
  it('주석 속 「슬롯」은 걷히고, 문자열 속 「슬롯」과 URL 은 살아남는다', () => {
    const sample = [
      '// 슬롯 교체 트리거 — 비고정에만',
      '/* 슬롯 하나만 바꾼다 */',
      '{/* JSX 주석의 슬롯 */}',
      "const label = '이 슬롯의 다른 후보';",
      "const url = 'https://example.com/a';",
    ].join('\n');

    const stripped = stripComments(sample);

    expect(count(stripped, '슬롯')).toBe(1);
    expect(stripped).toContain("'이 슬롯의 다른 후보'");
    expect(stripped).toContain('https://example.com/a');
  });
});

describe('🔴 G1 · AC-8 — 초안 화면 3파일의 문자열에 「슬롯」이 0건이다 (QA #033 · D3)', () => {
  it('세 파일이 모두 있고, 주석을 걷은 본문에 「슬롯」이 없다', () => {
    const files = [SCREEN_REL, PAGE_REL, BANNER_REL];

    // 긍정 짝 — 모집단 전부 실재(배너 파일이 없으면 빈 문자열이 공짜로 통과한다).
    expect(files.filter((rel) => !exists(rel))).toEqual([]);

    const offenders = files.filter((rel) => readStripped(rel).includes('슬롯'));
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G2 · 셸 안 폴백 안내는 순수 표시 파일이다 (layer-pages · 프리뷰 재사용)', () => {
  it('파일이 있고 무언가를 export 하며, 상태·라우터·조회 import 가 0건이다', () => {
    expect(exists(BANNER_REL)).toBe(true);
    const source = readStripped(BANNER_REL);
    expect(source).toMatch(/export (function|const) \w+/);

    const forbidden = [
      'useState',
      'expo-router',
      '@/shared/api',
      '@tanstack/react-query',
    ].filter((needle) => source.includes(needle));
    expect(forbidden).toEqual([]);
  });
});

describe('🔴 G3 · 배선 — DraftPage 와 프리뷰가 그 파일을 쓰고, 프리뷰는 배럴을 안 문다', () => {
  it('DraftPage 는 ./DraftFallbackBanner 를, 프리뷰는 딥 경로를 import 하고 배럴 import 는 0이다', () => {
    const page = readStripped(PAGE_REL);
    const preview = readStripped(PREVIEW_REL);

    // 긍정 짝 — 두 소비처가 실재한다.
    expect(page).toContain('export function DraftPage');
    expect(preview.length).toBeGreaterThan(0);

    expect(page).toMatch(/from '\.\/DraftFallbackBanner'/);
    expect(preview).toMatch(
      /from '@\/pages\/itinerary-draft\/ui\/DraftFallbackBanner'/
    );
    // 따옴표로 닫힌 배럴만 — `@/pages/itinerary-draft/ui/...` 딥 경로는 걸리지 않는다.
    expect(preview).not.toContain("'@/pages/itinerary-draft'");
  });
});
