/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-754 · AC-2·12 · E2 — i19 전면화면 삭제 census 와 i08 시트 순수성 구조가드.
 *
 * 무엇을 보장하나(소스를 글자로 읽어 잰다 — 앱을 안 돌린다):
 *  - 🔴 옛 i19 `ReplanAppliedScreen.tsx`·`.test.tsx` 가 없고, src 어디서도(테스트 포함) 그 모듈을
 *    import·`jest.mock`·`require` 하지 않는다.
 *  - 🔴 i19 전용 글리프(`AppliedBackGlyph`·`AppliedCheckGlyph`)는 사라지고, PlanbDiffPage 오류 얼굴이 쓰는
 *    `AppliedAlertGlyph` 는 남는다.
 *  - 🔴 옛 표면(`planb-applied-check`·`-continue`·`-back` testID, "여행 계속하기")이 비테스트 소스에 0.
 *  - 🔴 새 시트는 순수하다 — 전면화면 래퍼(SafeAreaView·인셋 훅)·라우터·네트워크·확정/취소 훅을 모른다.
 *    허브 페이지는 되돌리기에 서버를 부르지 않는다(E2 — cancel·restore 훅 이름 0).
 *
 * 전처리×탐지기 조합: 전부 `stripComments`(콜론 예외로 URL 보존) 뒤 소스에 건다. G1 이 그 조합을 실제
 * 문자열로 잠근다(문제로그 [[2026-07-31 stripComments가 URL의 슬래시를 주석으로 오인]] 계열).
 * census 는 import 지정자를 먼저 뽑고 그 **끝 조각**을 정확 비교한다(하네스 census 규칙 — `from` 먼저).
 */

const ROOT = path.resolve('src');
const SELF = path.join(ROOT, '__tests__', 'planbAppliedStructure.test.ts');

const OLD_SCREEN = 'ReplanAppliedScreen';
const OLD_SCREEN_REL = 'features/planb/ui/ReplanAppliedScreen.tsx';
const OLD_TEST_REL = 'features/planb/ui/ReplanAppliedScreen.test.tsx';
const SHEET_REL = 'features/planb/ui/ReplanAppliedSheet.tsx';
const GLYPHS_REL = 'features/planb/ui/PlanbGlyphs.tsx';
const PAGE_REL = 'pages/live-itinerary/ui/LiveItineraryPage.tsx';

// 옛 표면 문자열은 이 파일이 스캔 대상이 되지 않아도 조립해 둔다(다른 가드의 오탐 방지).
const OLD_SURFACES = [
  ...['check', 'continue', 'back'].map((suffix) =>
    ['planb', 'applied', suffix].join('-')
  ),
  ['여행', '계속하기'].join(' '),
];
const OLD_GLYPHS = ['AppliedBackGlyph', 'AppliedCheckGlyph'];

/** import·jest.mock·require·동적 import 의 모듈 지정자. */
const IMPORT_SPEC =
  /(?:\bfrom\s*|\bjest\.mock\(\s*|\brequire\(\s*|\bimport\(\s*)['"]([^'"]+)['"]/g;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function specifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_SPEC)].map((match) => match[1]);
}

/** 지정자의 끝 조각이 정확히 옛 화면 모듈인가(`ReplanAppliedSheet`·`…ScreenLike` 는 아니다). */
function isOldScreen(spec: string): boolean {
  const last = spec.split('/').pop() ?? '';
  return last.replace(/\.tsx?$/, '') === OLD_SCREEN;
}

function listSources(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSources(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    })
    .sort();
}

const isTest = (full: string) => /\.test\.tsx?$/.test(full);

function readOne(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

describe('G1 · 전처리×탐지기 자가검사', () => {
  it('주석 속 참조는 걷히고, 진짜 import·jest.mock·require·코드 문자열·URL 은 살아남는다', () => {
    const sample = [
      "// import { ReplanAppliedScreen } from './ReplanAppliedScreen';",
      "import { ReplanAppliedSheet } from './ReplanAppliedSheet';",
      "import { X } from '@/features/planb/ui/ReplanAppliedScreenLike';",
      "jest.mock('@/features/planb/ui/ReplanAppliedScreen', () => ({}));",
      "const lazy = require('./ReplanAppliedScreen');",
      "const doc = 'https://x.dev/ReplanAppliedScreen';",
      '// 여행 계속하기 버튼은 지웠다',
      "const label = '여행 계속하기';",
      '{/* AppliedCheckGlyph 자리 */}',
      '<AppliedCheckGlyph />',
    ].join('\n');

    const stripped = stripComments(sample);
    const specs = specifiers(stripped);

    // 추출 — 코드의 지정자 4개만(주석 속 import 는 없다, URL 은 import 가 아니다).
    expect(specs).toEqual([
      './ReplanAppliedSheet',
      '@/features/planb/ui/ReplanAppliedScreenLike',
      '@/features/planb/ui/ReplanAppliedScreen',
      './ReplanAppliedScreen',
    ]);
    // 끝 조각 정확 판정 — 시트·Like 는 옛 화면이 아니다.
    expect(specs.filter(isOldScreen)).toEqual([
      '@/features/planb/ui/ReplanAppliedScreen',
      './ReplanAppliedScreen',
    ]);
    // URL 은 주석으로 오인되지 않고 살아남는다.
    expect(stripped).toContain('https://x.dev/ReplanAppliedScreen');
    // 옛 표면·글리프 — 주석 속은 걷히고 코드 속은 남는다(각 1건).
    expect(stripped.split('여행 계속하기').length - 1).toBe(1);
    expect(stripped.split('AppliedCheckGlyph').length - 1).toBe(1);
  });
});

describe('🔴 G2 · AC-12 — 옛 i19 화면·테스트 파일이 없다', () => {
  it('두 파일이 존재하지 않는다(git rm)', () => {
    // 짝 앵커 — 같은 폴더를 올바르게 가리키고 있다.
    expect(fs.existsSync(path.join(ROOT, GLYPHS_REL))).toBe(true);

    expect(fs.existsSync(path.join(ROOT, OLD_SCREEN_REL))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, OLD_TEST_REL))).toBe(false);
  });
});

describe('🔴 G3 · AC-12 — src 전수(테스트 포함)에서 옛 화면 모듈 참조 0', () => {
  it('import·jest.mock·require 지정자 끝 조각이 ReplanAppliedScreen 인 곳이 없다', () => {
    const files = listSources(ROOT).filter((full) => full !== SELF);
    const all = files.map((full) => ({
      file: relOf(full),
      specs: specifiers(stripComments(fs.readFileSync(full, 'utf8'))),
    }));

    // 짝 앵커 — 모집단이 크고, 살아 있는 형제 시트 import 는 추출된다.
    expect(all.length).toBeGreaterThan(100);
    expect(
      all.some(({ specs }) =>
        specs.some((spec) => spec.endsWith('/RiskDetailSheet'))
      )
    ).toBe(true);

    const offenders = all.flatMap(({ file, specs }) =>
      specs.filter(isOldScreen).map((spec) => `${file} → ${spec}`)
    );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G4 · AC-12 — i19 전용 글리프 2종은 사라지고 AppliedAlertGlyph 는 남는다', () => {
  it('비테스트 소스(주석 제외)에 두 이름이 0건 + PlanbGlyphs 에 AppliedAlertGlyph 선언', () => {
    // 짝 앵커 — PlanbDiffPage 오류 얼굴이 쓰는 글리프는 남는다.
    expect(readOne(GLYPHS_REL)).toMatch(/export function AppliedAlertGlyph\b/);

    const offenders = listSources(ROOT)
      .filter((full) => !isTest(full))
      .flatMap((full) => {
        const source = stripComments(fs.readFileSync(full, 'utf8'));
        return OLD_GLYPHS.filter((name) =>
          new RegExp(`\\b${name}\\b`).test(source)
        ).map((name) => `${relOf(full)} ⊃ ${name}`);
      });
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G5 · AC-2 — 옛 표면 문자열이 비테스트 소스에 0', () => {
  it('planb-applied-check·continue·back · "여행 계속하기" 가 없다 + 새 시트는 자기 표면을 그린다', () => {
    // 짝 앵커 — 새 시트 파일이 있고 자기 루트 testID 를 그린다.
    expect(readOne(SHEET_REL)).toContain('planb-applied-sheet');

    const offenders = listSources(ROOT)
      .filter((full) => !isTest(full))
      .flatMap((full) => {
        const source = stripComments(fs.readFileSync(full, 'utf8'));
        return OLD_SURFACES.filter((needle) => source.includes(needle)).map(
          (needle) => `${relOf(full)} ⊃ ${needle}`
        );
      });
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G6 · AC-2 · E2 — 시트는 순수하고, 허브는 되돌리기에 서버를 부르지 않는다', () => {
  it('시트: gorhom 시트이고 전면화면 래퍼·라우터·네트워크·확정/취소 훅을 모른다', () => {
    const sheet = readOne(SHEET_REL);

    expect(sheet).toContain('@gorhom/bottom-sheet');
    for (const token of [
      'SafeAreaView',
      'useSafeAreaInsets',
      'expo-router',
      '@/shared/api',
      'useApplyReplan',
      'useCancelReplan',
    ]) {
      expect(sheet).not.toContain(token);
    }
  });

  it('허브 페이지: 시트를 쓰고, cancel·restore 훅 이름이 없다', () => {
    const page = readOne(PAGE_REL);

    expect(page).toContain('ReplanAppliedSheet');
    for (const token of ['useCancelReplan', 'Restore', 'SessionIdCancel']) {
      expect(page).not.toContain(token);
    }
  });
});
