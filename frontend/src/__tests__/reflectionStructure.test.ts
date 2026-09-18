/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-571 · AC-7 — j03 오늘의 회고 3층 배선·경계·testID·INV-3 소스 층 가드
 * (`recordsStructure.test.ts` G0~G6 미러 — features/record 대신 features/reflection).
 *
 * 무엇을 보장하나:
 *  - **G1 편입 앵커**: 신규 12파일이 정본 경로에 실재한다.
 *  - **G2 ★features 경계(유일한 그물)**: `features/reflection/**` 가 다른 feature(특히 record)를 직접
 *    import 하지 않는다 — record↔reflection 상호 import 금지의 유일한 기계 심판(eslint FEATURES 밖).
 *  - **G3 3층 책임**: 라우트→페이지→화면/훅 이 각자 몫만 진다.
 *  - **G4 testID 4종**: reflection-daily-narrative · reflection-daily-edit · reflection-daily-stats ·
 *    reflection-daily-photo-grid 실재.
 *  - **G5 ★새 HTTP 함수 금지**: features/reflection 에 customInstance·axios 0 + 재사용 3훅 참조.
 *  - **G6 INV-3**: features/reflection/ui 에 소요시간 문자열 0(거리만).
 *
 * 왜 소스 스캔인가:
 *  - **G2** — `eslint.config.js` 의 `FEATURES` 배열이 `['onboarding','home']` 뿐이라 reflection·record
 *    경계는 lint 무강제(repo-traps 실측). 이 파일이 그 유일한 그물이다.
 *  - **G6** — 어느 재귀 스캔도 `features/reflection/ui` 를 안 훑는다 — 이 축의 유일 그물.
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론 예외로 URL·경로 보존).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const NEW_FILES = [
  'features/reflection/model/useDailyReflection.ts',
  'features/reflection/model/reflectionFallback.ts',
  'features/reflection/model/statsCard.ts',
  'features/reflection/model/missingParts.ts',
  'features/reflection/ui/DailyReflectionScreen.tsx',
  'features/reflection/ui/ReflectionStatsRow.tsx',
  'features/reflection/ui/NarrativeBlock.tsx',
  'features/reflection/ui/ReflectionPhotoGrid.tsx',
  'features/reflection/ui/ChangeSummaryRow.tsx',
  'pages/daily-reflection/index.ts',
  'pages/daily-reflection/ui/DailyReflectionPage.tsx',
  'app/trips/[tripId]/records/reflection/[date].tsx',
];

const REFLECTION_FEATURE_DIR_REL = 'features/reflection';
const REFLECTION_UI_DIR_REL = 'features/reflection/ui';
const SCREEN_REL = 'features/reflection/ui/DailyReflectionScreen.tsx';
const NARRATIVE_REL = 'features/reflection/ui/NarrativeBlock.tsx';
const STATS_REL = 'features/reflection/ui/ReflectionStatsRow.tsx';
const PHOTO_REL = 'features/reflection/ui/ReflectionPhotoGrid.tsx';
const HOOK_REL = 'features/reflection/model/useDailyReflection.ts';
const ROUTE_REL = 'app/trips/[tripId]/records/reflection/[date].tsx';
const PAGE_REL = 'pages/daily-reflection/ui/DailyReflectionPage.tsx';

/** 다른 feature 를 가리키는 import(자기 reflection 은 상대경로라 여기 안 걸린다). */
const FEATURE_IMPORT = /@\/features\/([a-z][a-z-]*)/g;
/** 소요시간 표기 탐지기(INV-3) — HH:mm 은 숫자 뒤가 `:` 라 안 걸린다. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

/** 콜론(:) 뒤 // 는 주석으로 보지 않는다 — URL·경로의 `//` 를 스캔 전에 안 지우기 위함. */
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
      if (entry.isDirectory()) return listSourceFiles(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function scanDir(dirRel: string): { file: string; source: string }[] {
  return listSourceFiles(path.join(ROOT, dirRel)).map((full) => ({
    file: relOf(full),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사 — stripComments × 탐지기 조합', () => {
  it('주석 속 금칙어는 걷히고, 코드·URL·시각은 살아남는다', () => {
    const sample = [
      '/**',
      ' * 소요시간·@/features/record 를 산문으로 적어도 걷힌다.',
      ' * 참조: https://figma.com/design/x',
      ' */',
      "const url = 'https://example.com/a'; // 15분",
      "const label = '14:20 도착';",
      "import { deriveStayAttribution } from '@/features/record/model/stayAttribution';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 산문 금칙어는 걷힌다(주석에 근거를 적는 리포 관례).
    expect(DURATION_TEXT.test(stripped.split('\n')[0] ?? '')).toBe(false);
    // ② URL 의 // 는 주석으로 오인되지 않아 그 줄이 살아남는다.
    expect(stripped).toContain("const url = 'https://example.com/a';");
    // ③ HH:mm 시각은 소요시간으로 안 걸린다(숫자 뒤가 `:`).
    expect(DURATION_TEXT.test("const label = '14:20 도착';")).toBe(false);
    // ④ 코드에 실재하는 금칙 import·소요시간은 살아남는다(전처리가 다 지우면 아래 단언이 공허).
    expect(
      [...stripped.matchAll(FEATURE_IMPORT)].some((m) => m[1] === 'record')
    ).toBe(true);
    expect(DURATION_TEXT.test('const t = "15분";')).toBe(true);
  });
});

describe('G1 · 편입 앵커 — 신규 12파일이 정본 경로에 실재한다', () => {
  it.each(NEW_FILES)('%s 가 존재한다', (rel) => {
    expect({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
      file: rel,
      exists: true,
    });
  });
});

describe('G2 · ★features 경계 — reflection 은 다른 feature 를 직접 import 하지 않는다', () => {
  it('features/reflection/** 에 타 feature import 0건이고, 화면은 @/shared 를 문다', () => {
    const sources = scanDir(REFLECTION_FEATURE_DIR_REL);

    // 긍정 앵커 — 모집단이 비어있지 않고 이 칸의 화면이 그 안에 있다.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain(SCREEN_REL);

    // 부정 — 타 feature import 0건(특히 record — 상호 import 금지). 자기 reflection 은 상대경로라 대상 아님.
    const offenders = sources
      .filter(({ source }) =>
        [...source.matchAll(FEATURE_IMPORT)].some((m) => m[1] !== 'reflection')
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);

    // 긍정 짝(🔴 red-first) — 화면이 실제로 공용 층을 소비한다.
    expect(readOne(SCREEN_REL)).toContain('@/shared/');
  });
});

describe('🔴 G3 · 3층 책임 — 라우트→페이지→화면/훅', () => {
  it('라우트는 페이지에 위임하고 feature·조회를 직접 모른다', () => {
    const route = readOne(ROUTE_REL);
    // 긍정 — 페이지로 위임.
    expect(route).toContain('@/pages/daily-reflection');
    // 부정 — 라우트가 feature·조회훅을 직접 물지 않는다.
    expect(route).not.toContain('@/features/reflection');
    expect(route).not.toContain('useGetTripsTripIdReflections');
  });

  it('페이지가 화면·조회훅을 물어 배선한다', () => {
    const page = readOne(PAGE_REL);
    expect(page).toContain('@/features/reflection');
    expect(page).toContain('useDailyReflection');
    expect(page).toContain('DailyReflectionScreen');
  });
});

describe('🔴 G4 · testID 4종이 feature 소스에 실재한다', () => {
  it('reflection-daily-narrative · -edit · -stats · -photo-grid', () => {
    const feature = scanDir(REFLECTION_FEATURE_DIR_REL)
      .map((s) => s.source)
      .join('\n');
    expect(feature).toContain('reflection-daily-narrative');
    expect(feature).toContain('reflection-daily-edit');
    expect(feature).toContain('reflection-daily-stats');
    expect(feature).toContain('reflection-daily-photo-grid');
    // 긍정 앵커 — 넷은 각각 서술·화면·통계·그리드가 소유한다(빈 파일 공허 통과 차단).
    expect(readOne(NARRATIVE_REL)).toContain('reflection-daily-narrative');
    expect(readOne(SCREEN_REL)).toContain('reflection-daily-edit');
    expect(readOne(STATS_REL)).toContain('reflection-daily-stats');
    expect(readOne(PHOTO_REL)).toContain('reflection-daily-photo-grid');
  });
});

describe('🔴 G5 · ★새 HTTP 함수 금지 — 재사용만', () => {
  it('features/reflection/** 에 customInstance·axios 0 + 훅이 재사용 3함수를 참조한다', () => {
    const sources = scanDir(REFLECTION_FEATURE_DIR_REL);
    // 부정 — raw HTTP 를 새로 만들지 않는다.
    const offenders = sources
      .filter(
        ({ source }) =>
          source.includes('customInstance') || /from ['"]axios['"]/.test(source)
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);

    // 긍정 짝 — 조회훅이 생성 클라이언트의 재사용 3함수를 실제로 문다(새 함수 금지의 증거).
    const hook = readOne(HOOK_REL);
    expect(hook).toContain('useGetTripsTripIdReflections');
    expect(hook).toContain('usePostTripsTripIdReflectionsDayDate');
    expect(hook).toContain('usePutTripsTripIdReflectionsDayDate');
  });
});

describe('🔴 G6 · INV-3 — features/reflection/ui 에 소요시간 문자열 0(거리만)', () => {
  it('reflection/ui 재귀 스캔에 소요시간 표기 0건 + 모집단 앵커', () => {
    const sources = scanDir(REFLECTION_UI_DIR_REL);
    // 긍정 앵커 — 모집단이 실제로 채워졌다(화면이 그 안에 있다).
    expect(sources.map((s) => s.file)).toContain(SCREEN_REL);
    // 부정 — 소요시간 문자열 0건.
    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
