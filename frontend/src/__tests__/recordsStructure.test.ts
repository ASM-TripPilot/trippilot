/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-565 · AC-6 — j01 방문 기록 3층 배선·경계·testID·INV-3 소스 층 가드.
 *
 * 무엇을 보장하나:
 *  - **G1 편입 앵커**: 신규 9파일이 정본 경로에 실재한다.
 *  - **G2 ★features 경계(유일한 그물)**: `features/record/**` 가 다른 feature(특히 execution)를 직접
 *    import 하지 않는다 — 01b Q2 "execution useVisitCheck 재사용/ import 금지"의 유일한 기계 심판.
 *  - **G3 3층 책임**: 라우트→페이지→화면/훅 이 각자 몫만 진다.
 *  - **G4 testID 3종**: record-trip-day-tab · record-trip-visit-card · record-trip-spontaneous-add 실재.
 *  - **G5 ★새 HTTP 함수 금지**: features/record 에 customInstance·axios 0 + 재사용 4함수 참조.
 *  - **G6 INV-3**: features/record/ui 에 소요시간 문자열 0(거리만).
 *
 * 왜 소스 스캔인가:
 *  - **G2** — `eslint.config.js` 의 `FEATURES` 배열이 `['onboarding','home']` 뿐이라 record·execution 경계는
 *    lint 무강제(repo-traps 실측). 이 파일이 그 유일한 그물이다.
 *  - **G6** — `executionDurationStructure`(features/{execution,planb}/ui)·`notificationDurationStructure`·
 *    `pagesLayerStructure`(pages) 어느 재귀 스캔도 `features/record/ui` 를 안 훑는다 — 이 축의 유일 그물.
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론 예외로 URL·경로 보존).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const NEW_FILES = [
  'features/record/model/visitStatus.ts',
  'features/record/model/useVisitCheck.ts',
  'features/record/model/useTripRecords.ts',
  'features/record/ui/TripRecordsScreen.tsx',
  'features/record/ui/VisitRecordCard.tsx',
  'features/record/ui/SpontaneousVisitButton.tsx',
  'pages/trip-records/index.ts',
  'pages/trip-records/ui/TripRecordsPage.tsx',
  'app/trips/[tripId]/records/index.tsx',
];

const RECORD_FEATURE_DIR_REL = 'features/record';
const RECORD_UI_DIR_REL = 'features/record/ui';
const SCREEN_REL = 'features/record/ui/TripRecordsScreen.tsx';
const CARD_REL = 'features/record/ui/VisitRecordCard.tsx';
const BUTTON_REL = 'features/record/ui/SpontaneousVisitButton.tsx';
const HOOK_REL = 'features/record/model/useVisitCheck.ts';
const ROUTE_REL = 'app/trips/[tripId]/records/index.tsx';
const PAGE_REL = 'pages/trip-records/ui/TripRecordsPage.tsx';

/** 다른 feature 를 가리키는 import(자기 record 는 상대경로라 여기 안 걸린다). */
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
      ' * 소요시간·@/features/execution 을 산문으로 적어도 걷힌다.',
      ' * 참조: https://figma.com/design/x',
      ' */',
      "const url = 'https://example.com/a'; // 15분",
      "const label = '14:20 도착';",
      "import { deriveVisitProgress } from '@/features/execution/model/visitProgress';",
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
      [...stripped.matchAll(FEATURE_IMPORT)].some((m) => m[1] === 'execution')
    ).toBe(true);
    expect(DURATION_TEXT.test('const t = "15분";')).toBe(true);
  });
});

describe('G1 · 편입 앵커 — 신규 9파일이 정본 경로에 실재한다', () => {
  it.each(NEW_FILES)('%s 가 존재한다', (rel) => {
    expect({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
      file: rel,
      exists: true,
    });
  });
});

describe('G2 · ★features 경계 — record 는 다른 feature 를 직접 import 하지 않는다', () => {
  it('features/record/** 에 타 feature import 0건이고, 화면은 @/shared 를 문다', () => {
    const sources = scanDir(RECORD_FEATURE_DIR_REL);

    // 긍정 앵커 — 모집단이 비어있지 않고 이 칸의 화면이 그 안에 있다.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain(SCREEN_REL);

    // 부정 — 타 feature import 0건(특히 execution — 01b Q2). 자기 record 는 상대경로라 대상 아님.
    const offenders = sources
      .filter(({ source }) =>
        [...source.matchAll(FEATURE_IMPORT)].some((m) => m[1] !== 'record')
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
    expect(route).toContain('@/pages/trip-records');
    // 부정 — 라우트가 feature·조회훅을 직접 물지 않는다.
    expect(route).not.toContain('@/features/record');
    expect(route).not.toContain('useGetTripsTripIdVisitsDaysDay');
  });

  it('페이지가 화면·조회훅·체크훅을 물어 배선한다', () => {
    const page = readOne(PAGE_REL);
    expect(page).toContain('@/features/record');
    expect(page).toContain('useTripRecords');
    expect(page).toContain('useVisitCheck');
    expect(page).toContain('TripRecordsScreen');
  });
});

describe('🔴 G4 · testID 3종이 feature 소스에 실재한다', () => {
  it('record-trip-day-tab · record-trip-visit-card · record-trip-spontaneous-add', () => {
    const feature = scanDir(RECORD_FEATURE_DIR_REL)
      .map((s) => s.source)
      .join('\n');
    expect(feature).toContain('record-trip-day-tab');
    expect(feature).toContain('record-trip-visit-card');
    expect(feature).toContain('record-trip-spontaneous-add');
    // 긍정 앵커 — 셋은 각각 화면·카드·버튼이 소유한다(빈 파일 공허 통과 차단).
    expect(readOne(SCREEN_REL)).toContain('record-trip-day-tab');
    expect(readOne(CARD_REL)).toContain('record-trip-visit-card');
    expect(readOne(BUTTON_REL)).toContain('record-trip-spontaneous-add');
  });
});

describe('🔴 G5 · ★새 HTTP 함수 금지 — 재사용만', () => {
  it('features/record/** 에 customInstance·axios 0 + 훅이 재사용 4함수를 참조한다', () => {
    const sources = scanDir(RECORD_FEATURE_DIR_REL);
    // 부정 — raw HTTP 를 새로 만들지 않는다.
    const offenders = sources
      .filter(
        ({ source }) =>
          source.includes('customInstance') || /from ['"]axios['"]/.test(source)
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);

    // 긍정 짝 — 체크훅이 생성 클라이언트의 재사용 4함수를 실제로 문다(새 함수 금지의 증거).
    const hook = readOne(HOOK_REL);
    expect(hook).toContain('postTripsTripIdVisits');
    expect(hook).toContain('postTripsTripIdVisitsVisitCheckIdComplete');
    expect(hook).toContain('postTripsTripIdVisitsVisitCheckIdSkip');
    expect(hook).toContain('getGetTripsTripIdVisitsDaysDayQueryKey');
  });
});

describe('🔴 G6 · INV-3 — features/record/ui 에 소요시간 문자열 0(거리만)', () => {
  it('record/ui 재귀 스캔에 소요시간 표기 0건 + 모집단 앵커', () => {
    const sources = scanDir(RECORD_UI_DIR_REL);
    // 긍정 앵커 — 모집단이 실제로 채워졌다(카드가 그 안에 있다).
    expect(sources.map((s) => s.file)).toContain(CARD_REL);
    // 부정 — 소요시간 문자열 0건.
    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
