import fs from 'fs';
import path from 'path';

/**
 * TRIP-1076 (1) · AC-1(US-SHELL-03) — 탭바를 직접 그리는 pages 7곳이 탭 경로를 **한 함수**
 * (`shellTabHref`, `src/shared/ui/BottomTabBar.tsx` 의 named export)에서 얻는다.
 * (개정: 처음엔 별도 파일 `shared/ui/shellTabHref.ts` 였으나 `sharedUiStructure` AC-G2 —
 * shared/ui 비테스트 파일은 전부 className 을 가져야 한다 — 에 걸려 탭 key 타입이 사는 파일로 옮겼다.)
 *
 * 무엇을 보장하나:
 *  - S1 탭바 배선(`onPressTab=`)을 가진 페이지 모집단이 알려진 7곳이다(새 페이지가 생기면 red → 편입 강제).
 *  - S2 7곳 모두 그 함수를 BottomTabBar 에서 값으로 import 하고 부른다.
 *  - S3 7곳 코드에 `key === 'home'` 삼항이 0건이고, src 전체에 `key === 'home' ? '/'` 이 0건이다
 *    (홈만 '/' 로 보내 온보딩 그룹과 부딪히던 모양이 되살아나지 않는다).
 *
 * 왜 소스 스캔인가: 행동 심판은 PlaceExplorePage P-13(실 press → replace 인자)과 함수 단위 테스트
 * (`shared/ui/BottomTabBar.shellTabHref.test.ts`)가 진다. 나머지 6곳을 페이지마다 렌더하지 않고도 "같은 함수를
 * 쓴다"를 잠그는 자리가 여기다. `TripSummaryPage` 테스트는 병행 워크트리 충돌로 건드리지 않는다.
 *
 * 3동작 뼈대: 준비=pages 소스를 주석 제거해 읽음 → 실행=from 절·패턴 검색 → 단언=집합·0건.
 */

const ROOT = path.join(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');

const TAB_PAGES = [
  'pages/daily-reflection/ui/DailyReflectionPage.tsx',
  'pages/destination-detail/ui/DestinationDetailPage.tsx',
  'pages/place-explore/ui/PlaceExplorePage.tsx',
  'pages/stay-search/ui/StaySearchPage.tsx',
  'pages/travel-style/ui/TravelStylePage.tsx',
  'pages/trip-records/ui/TripRecordsPage.tsx',
  'pages/trip-summary/ui/TripSummaryPage.tsx',
];

const FROM_CLAUSE = "from '@/shared/ui/BottomTabBar'";
/**
 * 그 from 절로 끝나는 import 문 전체(여러 줄로 접혀도 한 덩어리). 같은 경로에서 `import type
 * { ShellTabKey }` 와 값 import 가 따로 올 수 있어(7곳 중 4곳이 이미 type import 를 가짐) 줄이 아니라
 * 문 단위로 센다.
 */
const IMPORT_FROM_TABBAR =
  /import\s+(type\s+)?\{([^}]*)\}\s*from\s*'@\/shared\/ui\/BottomTabBar'/g;

/** from 절을 먼저 찾고, 그 문 안에서 `shellTabHref` 를 **값**으로 가져오는 문만 남긴다. */
function valueImportsOfShellTabHref(code: string): string[] {
  return [...code.matchAll(IMPORT_FROM_TABBAR)]
    .filter(([, typeOnly]) => !typeOnly)
    .filter(([, , specifiers]) =>
      specifiers
        .split(',')
        .map((spec) => spec.trim())
        .includes('shellTabHref')
    )
    .map(([statement]) => statement);
}
/** 홈 삼항(어느 경로로 보내든) — 7곳에서 0건이어야 한다. */
const HOME_TERNARY = /key\s*===\s*'home'/;
/** 홈을 '/' 로 보내는 옛 모양 — src 전체에서 0건이어야 한다. */
const HOME_TO_ROOT = /key\s*===\s*'home'\s*\?\s*'\/'/;

/**
 * 주석 제거 — 블록 먼저, 줄 주석은 바로 앞 글자가 `:` 이면 건너뛴다(URL 보호, placeExploreStructure 동형).
 * 완전한 파서가 아니다 — 아래 S0 자가검사가 이 칸의 실제 문자열로 조합을 태워 본다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'generated' ? [] : listSourceFiles(full);
      }
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function rel(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function readCode(relPath: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

describe('S0 · 조합 자가검사 — 주석 제거가 슬래시 리터럴을 지우지 않는다', () => {
  it('옛 배선 한 줄은 살아남아 탐지되고, 주석 속 같은 모양은 걷힌다', () => {
    const sample = [
      "// 옛 모양: router.replace(key === 'home' ? '/' : `/${key}`)",
      "/* 블록: key === 'home' ? '/' */",
      "onPressTab={(key) => router.replace(key === 'home' ? '/' : `/${key}`)}",
      "import type { ShellTabKey } from '@/shared/ui/BottomTabBar';",
      "// import { shellTabHref } from '@/shared/ui/BottomTabBar';",
      'import {',
      '  BottomTabBar,',
      '  shellTabHref,',
      "} from '@/shared/ui/BottomTabBar';",
    ].join('\n');

    const stripped = stripComments(sample);

    // 코드 줄의 옛 모양은 정확히 1건 남는다(주석 2건은 걷혔다).
    expect(stripped.match(new RegExp(HOME_TO_ROOT.source, 'g'))).toHaveLength(
      1
    );
    // from 절은 슬래시가 여럿이어도 잘리지 않는다.
    expect(stripped).toContain(FROM_CLAUSE);
    // 문 단위 census: type import·주석 속 import 는 빠지고, 여러 줄로 접힌 값 import 1건만 남는다.
    expect(valueImportsOfShellTabHref(stripped)).toHaveLength(1);
    expect(valueImportsOfShellTabHref(stripped)[0]).toContain('BottomTabBar,');
    // type 으로만 가져오면 값 import 가 아니다.
    expect(
      valueImportsOfShellTabHref(
        "import type { shellTabHref } from '@/shared/ui/BottomTabBar';"
      )
    ).toEqual([]);
    // 새 배선 모양('/(tabs)')은 옛 모양 탐지기에 안 걸리지만 홈 삼항 탐지기에는 걸린다.
    expect(HOME_TO_ROOT.test("key === 'home' ? '/(tabs)' : `/${key}`")).toBe(
      false
    );
    expect(HOME_TERNARY.test("key === 'home' ? '/(tabs)' : `/${key}`")).toBe(
      true
    );
  });
});

describe('S1 · 탭바 배선을 가진 페이지 모집단 (모집단 앵커)', () => {
  it('pages 중 onPressTab= 을 쓰는 파일은 정확히 7곳이다', () => {
    const withTabBar = listSourceFiles(PAGES_DIR)
      .filter((full) =>
        /onPressTab=/.test(stripComments(fs.readFileSync(full, 'utf8')))
      )
      .map(rel);

    expect(withTabBar).toEqual(TAB_PAGES);
  });
});

describe('🔴 S2 · 7곳이 같은 탭 경로 함수를 import 하고 부른다 (AC-1)', () => {
  it.each(TAB_PAGES)('%s', (relPath) => {
    const code = readCode(relPath);

    // from 절(import 문)을 먼저 찾고, 그 문 안에서 심볼을 확인한다(심볼명 선검색은 주석·동명에 걸린다).
    expect(valueImportsOfShellTabHref(code)).toHaveLength(1);

    // 실제로 부른다(import 만 하고 옛 삼항을 남기는 반쪽 이관 차단 — S3 과 짝).
    expect(code).toMatch(/\bshellTabHref\(/);
  });
});

describe('🔴 S3 · 홈 삼항이 사라졌다 (AC-1 구조 관측)', () => {
  it.each(TAB_PAGES)('%s 코드에 key === "home" 이 없다', (relPath) => {
    expect(readCode(relPath)).not.toMatch(HOME_TERNARY);
  });

  it("src 전체 비테스트 코드에 key === 'home' ? '/' 이 0건이다", () => {
    const offenders = listSourceFiles(ROOT)
      .filter((full) =>
        HOME_TO_ROOT.test(stripComments(fs.readFileSync(full, 'utf8')))
      )
      .map(rel);

    expect(offenders).toEqual([]);
  });
});
