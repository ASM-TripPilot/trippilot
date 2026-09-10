/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-676 · S12 꼭 갈 곳 전용 목록 3층 구조 + 화면 순수성(AC-4) 소스 스캔 가드.
 *
 * 왜 이 파일이 필요한가 — `features/trip/ui` 를 재귀 스캔하는 구조 가드가 리포에 **없다**(시트류는
 * 전부 per-file, `tripWizardStep1Boundary`는 특정 파일 대상). `pagesLayerStructure.test.ts`(층 전수
 * 재귀)가 신 페이지(`pages/trip-new-mustvisit/`)는 자동 편입해 잠그지만, **화면(`features/trip/ui/
 * MustVisitListScreen.tsx`)의 props-only·raw-hex 0 은 이 파일이 유일한 그물**이다(02a ★7).
 *
 * 전제 — 주석을 걷어낸 소스를 스캔한다(`stripComments`, `:` 앞 `//`는 URL 로 보존, 2026-07-31 회귀 가드).
 * "없어야 한다" 단언은 "있어야 한다" 짝과 같은 it 에 둔다(빈 스캔 공짜 통과 차단).
 */

const ROOT = path.resolve('src');

const ROUTE = path.join(ROOT, 'app', 'trips', 'new', 'must-visits.tsx');
const BARREL = path.join(ROOT, 'pages', 'trip-new-mustvisit', 'index.ts');
const PAGE = path.join(
  ROOT,
  'pages',
  'trip-new-mustvisit',
  'ui',
  'MustVisitListPage.tsx'
);
const SCREEN = path.join(
  ROOT,
  'features',
  'trip',
  'ui',
  'MustVisitListScreen.tsx'
);

/** 소요시간 표기 탐지기(INV-3) — `HH:mm`(숫자 뒤 `:`)은 안 걸린다. */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 토큰으로 이미 존재하는 색 — raw hex 로 적으면 토큰 우회다. */
const TOKENIZED_HEX = [
  '#ffffff',
  '#222222',
  '#6a6a6a',
  '#dddddd',
  '#ededed',
  '#ff385c',
  '#f2f2f2',
  '#9aa1ab',
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readStripped(full: string): string {
  return fs.existsSync(full)
    ? stripComments(fs.readFileSync(full, 'utf8'))
    : '';
}

describe('S0 · 탐지기 자가검사 — 전처리 × 탐지기 조합', () => {
  it('주석 속 어휘·hex 는 걷히고, 코드의 분·hex 는 살아남고, URL 슬래시는 보존된다', () => {
    const sample = [
      '/**',
      ' * 소요시간·#ffffff 는 계산·사용하지 않는다 — https://figma.com/x 참조.',
      ' */',
      '// 15분 · #eeeeee 주석',
      "const label = '도보 15분';",
      "const color = '#FF385C';",
      "const u = 'https://a/b';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 '15분'·hex 는 걷힌다 — 코드 줄만 남긴 뒤엔 duration 이 안 걸린다.
    const commentOnly = stripped
      .replace("const label = '도보 15분';", '')
      .replace("const color = '#FF385C';", '');
    expect(DURATION_TEXT.test(commentOnly)).toBe(false);
    expect(commentOnly.toLowerCase()).not.toContain('#ffffff');
    expect(commentOnly.toLowerCase()).not.toContain('#eeeeee');
    // ② ★ 조합 — 전처리 뒤에도 코드의 '15분'·'#FF385C' 는 살아남아 탐지된다.
    expect(DURATION_TEXT.test(stripped)).toBe(true);
    expect(stripped.toLowerCase()).toContain('#ff385c');
    // ③ ★ 조합 — URL 의 `://` 슬래시는 주석으로 오인되지 않는다.
    expect(stripped).toContain("const u = 'https://a/b';");
  });
});

describe('S1 · 3층 파일 실재 (라우트·배럴·페이지·화면)', () => {
  it('네 파일이 정본 경로에 모두 존재한다', () => {
    for (const p of [ROUTE, BARREL, PAGE, SCREEN]) {
      expect({
        file: path.relative(ROOT, p),
        exists: fs.existsSync(p),
      }).toEqual({
        file: path.relative(ROOT, p),
        exists: true,
      });
    }
  });
});

describe('S2 · 라우트 얇은 위임', () => {
  it('라우트는 @/pages/trip-new-mustvisit 만 위임하고 상태·스토어를 안 진다', () => {
    const src = readStripped(ROUTE);

    // 긍정 — pages 층 위임(step1.tsx 선례, 배럴 경유든 딥 임포트든 허용).
    expect(src).toContain('@/pages/trip-new-mustvisit');
    // 부정 — 라우트는 로직을 안 진다.
    expect(src).not.toContain('useState');
    expect(src).not.toContain('useTripWizardStore');
  });
});

describe('S3 · 배럴 재수출', () => {
  it('배럴이 TripMustVisitsPage 를 재수출한다 (S12 개명 — itinerary 축 동명 심볼과 분리)', () => {
    expect(readStripped(BARREL)).toContain('TripMustVisitsPage');
  });
});

describe('S4 · 배선은 페이지가 진다', () => {
  it('페이지가 store·removeMustVisit·화면·useSavedPlaces 를 참조한다', () => {
    const src = readStripped(PAGE);

    expect(src).toContain('useTripWizardStore');
    expect(src).toContain('removeMustVisit');
    expect(src).toContain('MustVisitListScreen');
    expect(src).toContain('useSavedPlaces');
  });
});

describe('S5 · 화면 순수성 — props-only (AC-4)', () => {
  it('화면은 상태·라우터·쿼리·스토어·타 feature 를 import 하지 않는다', () => {
    const src = readStripped(SCREEN);

    // 긍정 짝 — 화면이 실재하고 시드 타입을 받는다(빈 스캔 공허 통과 차단).
    expect(src).toContain('MustVisitListScreen');
    expect(src).toContain('MustVisitSeedItem');

    // 부정 — 판정·조회·항법·전역상태를 화면이 지면 안 된다.
    for (const forbidden of [
      'useState',
      'useReducer',
      'expo-router',
      '@tanstack/react-query',
      'useQuery',
      'useTripWizardStore',
      'axios',
      '@/features/itinerary',
      '@/features/explore',
    ]) {
      expect({ forbidden, present: src.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe('S6 · 화면 raw-hex 0 + INV-3 (AC-4)', () => {
  it('화면이 토큰 경유로만 색을 쓰고 소요시간 표기가 없다', () => {
    const src = readStripped(SCREEN);
    const lower = src.toLowerCase();

    // 긍정 짝 — 회색 자리(INV-1)를 그리려면 imageUrl 을 본다(빈 스캔 방지).
    expect(src).toContain('imageUrl');

    const hexOffenders = TOKENIZED_HEX.filter((hex) => lower.includes(hex));
    expect(hexOffenders).toEqual([]);
    expect(DURATION_TEXT.test(src)).toBe(false);
  });
});
