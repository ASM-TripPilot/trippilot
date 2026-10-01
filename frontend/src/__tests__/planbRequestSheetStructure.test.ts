/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-750 · AC-5 — i04 재계획 요청 시트에서 감지 배너·범위 밖 안내·[직접 고르기]를 걷어낸 뒤의 삭제 가드.
 *
 * 무엇을 보장하나:
 *  - R1 `OutOfScopeNotice` 소스·테스트가 없다. 짝: 시트와 새 카탈로그(`config/replanChoices.ts`)는 있다.
 *  - R2 `OutOfScopeNotice` 를 무는 import·jest.mock·require 가 src 전수에서 0이다.
 *  - R3 티켓 완료 조건 "삭제 testID 가 리포에 없음" — 4개 문자열이 src 원문(주석 포함) 어디에도 없다.
 *    프리뷰 키 2개(`…-detected`·`…-out-of-scope`)가 같은 문자열이라 함께 잡힌다.
 *  - R4 시트 props(`outOfScope`·`onSuppress`·`onManual`)와 페이지의 manual push·outOfScope 가드가 없다.
 *
 * **자기 참조 회피(02a ★3)**: R3 의 4개 문자열은 조립한다 — 리터럴이면 이 파일이 자기 자신을 잡는다.
 * R2 는 R0 표본의 import 문 때문에 이 파일만 뺀다(riskSheetStructure 와 같은 처리).
 * **census 순서(02a ★16)**: `from` 절(·`jest.mock(`·`require(`)을 먼저 뽑고 그 경로 안에서 판정한다.
 * R4 금칙어는 `\b` 경계로 찾는다 — `planb-request-trigger-chip` 같은 testID 에 걸리지 않게.
 */

const ROOT = path.resolve('src');
const SELF = '__tests__/planbRequestSheetStructure.test.ts';

const DELETED_IDS = ['detected', 'out-of-scope', 'manual', 'suppress'].map(
  (suffix) => ['planb', 'request', suffix].join('-')
);

const DELETED = [
  'features/planb/ui/OutOfScopeNotice.tsx',
  'features/planb/ui/OutOfScopeNotice.test.tsx',
];
const SHEET_REL = 'features/planb/ui/ReplanRequestSheet.tsx';
const PAGE_REL = 'pages/planb-request/ui/PlanbRequestPage.tsx';
const ANCHORS = [SHEET_REL, PAGE_REL, 'features/planb/config/replanChoices.ts'];
const DELETED_MODULE = 'OutOfScopeNotice';

const SHEET_FORBIDDEN = [
  /\boutOfScope\b/,
  /\bonSuppress\b/,
  /\bonManual\b/,
  /\bReplanDetectionBanner\b/,
  /직접 고르기/,
];
const PAGE_FORBIDDEN = [/\boutOfScope\b/, /\bonManual\b/, /planb\/manual/];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function listAllSources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listAllSources(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    })
    .sort();
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

const IMPORT_SPEC =
  /(?:\bfrom\s+|\bjest\.mock\(\s*|\brequire\(\s*)['"]([^'"]+)['"]/g;

function importSpecs(source: string): string[] {
  return [...stripComments(source).matchAll(IMPORT_SPEC)].map((m) => m[1]);
}

function isDeletedModule(spec: string): boolean {
  return (spec.split('/').pop() ?? '') === DELETED_MODULE;
}

function forbiddenHits(source: string, patterns: RegExp[]): string[] {
  const code = stripComments(source);
  return patterns
    .filter((pattern) => pattern.test(code))
    .map((pattern) => pattern.source);
}

describe('R0 · 조합 자가검사 — 주석 제거 + 추출 + 판정 + 금칙어 탐지가 서로를 지우지 않는다', () => {
  it('주석 속 import·금칙어는 걷히고, URL 줄은 추출되지 않으며, 실제 import·코드 식별자는 잡힌다', () => {
    const sample = [
      "// import { OutOfScopeNotice } from './OutOfScopeNotice';",
      "/* jest.mock('./OutOfScopeNotice') */",
      '// onManual 은 TRIP-750 에서 삭제',
      "const url = 'https://x.dev/OutOfScopeNotice';",
      "import { OutOfScopeNotice } from './OutOfScopeNotice';",
      "jest.mock('@/features/planb/ui/OutOfScopeNotice', () => ({}));",
      "import { Like } from './OutOfScopeNoticeLike';",
      '  onManual: () => void;',
      "const chip = 'planb-request-trigger-chip';",
    ].join('\n');

    const specs = importSpecs(sample);
    expect(stripComments(sample)).toContain('https://x.dev/OutOfScopeNotice');
    expect(specs.filter(isDeletedModule)).toEqual([
      './OutOfScopeNotice',
      '@/features/planb/ui/OutOfScopeNotice',
    ]);
    expect(isDeletedModule('./OutOfScopeNoticeLike')).toBe(false);

    // 코드 식별자는 잡히고, 주석 속 언급만 있으면 안 잡힌다.
    expect(forbiddenHits(sample, SHEET_FORBIDDEN)).toEqual(['\\bonManual\\b']);
    expect(
      forbiddenHits('// onManual 은 삭제\nconst a = 1;', SHEET_FORBIDDEN)
    ).toEqual([]);
    // 새 감지 칩 testID 는 어떤 금칙어·삭제 testID 에도 걸리지 않는다.
    const chipOnly = "const chip = 'planb-request-trigger-chip';";
    expect(forbiddenHits(chipOnly, SHEET_FORBIDDEN)).toEqual([]);
    expect(DELETED_IDS.filter((id) => chipOnly.includes(id))).toEqual([]);
  });
});

describe('🔴 R1 · OutOfScopeNotice 가 사라졌고 시트·페이지·새 카탈로그는 있다', () => {
  it('삭제 2경로 부재 + 앵커 3파일 존재', () => {
    const missingAnchors = ANCHORS.filter(
      (rel) => !fs.existsSync(path.join(ROOT, rel))
    );
    expect(missingAnchors).toEqual([]);

    const remaining = DELETED.filter((rel) =>
      fs.existsSync(path.join(ROOT, rel))
    );
    expect(remaining).toEqual([]);
  });
});

describe('🔴 R2 · OutOfScopeNotice 를 무는 import·jest.mock·require 가 0건이다', () => {
  it('src 전수(테스트 포함, 이 파일 제외)에서 삭제 모듈 경로를 가리키는 곳이 없다', () => {
    const files = listAllSources(ROOT);
    expect(files.length).toBeGreaterThan(100);

    const offenders = files
      .filter((full) => relOf(full) !== SELF)
      .flatMap((full) =>
        importSpecs(fs.readFileSync(full, 'utf8'))
          .filter(isDeletedModule)
          .map((spec) => `${relOf(full)} → ${spec}`)
      );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 R3 · 삭제 testID·프리뷰 키 4문자열이 src 어디에도 없다 (티켓 완료 조건)', () => {
  it('src 전수 원문(주석 포함 · 이 파일 포함)에 4문자열이 0건이다', () => {
    const files = listAllSources(ROOT);
    expect(files.map(relOf)).toContain(SELF);

    const offenders = files.flatMap((full) => {
      const source = fs.readFileSync(full, 'utf8');
      return DELETED_IDS.filter((needle) => source.includes(needle)).map(
        (needle) => `${relOf(full)} ⊃ ${needle}`
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe('🔴 R4 · 시트 옛 props · 페이지 manual 분기·outOfScope 가드가 없다', () => {
  it('시트·페이지 소스(주석 제외)에 금칙 식별자가 0건이다', () => {
    const sheet = fs.readFileSync(path.join(ROOT, SHEET_REL), 'utf8');
    const page = fs.readFileSync(path.join(ROOT, PAGE_REL), 'utf8');

    // 짝 앵커 — 파일이 비지 않았다.
    expect(sheet).toMatch(/export function ReplanRequestSheet\b/);
    expect(page).toMatch(/export function PlanbRequestPage\b/);

    expect(forbiddenHits(sheet, SHEET_FORBIDDEN)).toEqual([]);
    expect(forbiddenHits(page, PAGE_FORBIDDEN)).toEqual([]);
  });
});
