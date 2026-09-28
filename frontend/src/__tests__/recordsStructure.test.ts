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
 *  - **G4 testID**: record-trip-visit-card · record-trip-spontaneous-add 실재, 옛 일자 탭·뒤로 testID 0건
 *    (TRIP-1085 — 셸 `sheet-daychip-*` 로 이전).
 *  - **G5 ★새 HTTP 함수 금지**: features/record 에 customInstance·axios 0 + 재사용 4함수 참조.
 *  - **G6 INV-3**: features/record/ui + pages/trip-records/ui 에 소요시간 문자열 0(거리만).
 *  - **G7 풀 지도 전환**(TRIP-1085): 옛 세로 컬럼 화면(TripRecordsScreen) 부재 · features/record 에 지도 태그
 *    0 · 뷰·페이지에 하단 탭바 0.
 *  - **G8 프리뷰**(TRIP-1085): j01 5키가 새 뷰를 렌더하고, 메모 입력(MemoInline)은 그 블록 밖에 없다.
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
  // TRIP-1085 — 옛 세로 컬럼 화면(features/record/ui/TripRecordsScreen.tsx)은 셸 조립 순수 뷰로 대체됐다.
  'pages/trip-records/ui/TripRecordsView.tsx',
  'features/record/ui/VisitRecordCard.tsx',
  'features/record/ui/SpontaneousVisitButton.tsx',
  'pages/trip-records/index.ts',
  'pages/trip-records/ui/TripRecordsPage.tsx',
  'app/trips/[tripId]/records/index.tsx',
];

const RECORD_FEATURE_DIR_REL = 'features/record';
const RECORD_UI_DIR_REL = 'features/record/ui';
/** TRIP-1085 — 삭제돼야 하는 옛 세로 컬럼 화면(G7 부재 단언). */
const OLD_SCREEN_REL = 'features/record/ui/TripRecordsScreen.tsx';
const VIEW_REL = 'pages/trip-records/ui/TripRecordsView.tsx';
const PAGES_UI_DIR_REL = 'pages/trip-records/ui';
const CONTAINER_REL = 'features/record/ui/VisitRecordCardContainer.tsx';
const PREVIEW_REL = 'app/_dev/preview.tsx';
/** j01 프리뷰 키 — TRIP-1085 에서 records-empty(Figma 4705:4054) 신설. */
const J01_PREVIEW_KEYS = [
  'records-default',
  'records-error',
  'records-manual-checkin',
  'records-visit-time-sheet',
  'records-empty',
];
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

/** `key: '…'` 프리뷰 항목 하나를 다음 `key: '` 직전까지 떼어낸다(못 찾으면 빈 문자열). */
function fixtureBlock(source: string, key: string): string {
  const start = source.indexOf(`key: '${key}'`);
  if (start === -1) return '';
  const next = source.indexOf("key: '", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

function countOf(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
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

    // 긍정 앵커 — 모집단이 비어있지 않고 카드 컨테이너가 그 안에 있다(TRIP-1085 — 옛 화면 파일 대신).
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain(CONTAINER_REL);

    // 부정 — 타 feature import 0건(특히 execution — 01b Q2). 자기 record 는 상대경로라 대상 아님.
    const offenders = sources
      .filter(({ source }) =>
        [...source.matchAll(FEATURE_IMPORT)].some((m) => m[1] !== 'record')
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);

    // 긍정 짝 — feature 가 실제로 공용 층을 소비한다.
    expect(readOne(CONTAINER_REL)).toContain('@/shared/');
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

  it('페이지가 뷰·조회훅·체크훅을 물어 배선한다', () => {
    const page = readOne(PAGE_REL);
    expect(page).toContain('@/features/record');
    expect(page).toContain('useTripRecords');
    expect(page).toContain('useVisitCheck');
    expect(page).toContain('TripRecordsView');
  });

  it('🔴 TRIP-1085 · 뷰는 셸을 조립하고 네트워크 계층을 모른다(프리뷰 격리 렌더)', () => {
    const view = readOne(VIEW_REL);
    // 긍정 — 셸 위젯을 물어 조립한다.
    expect(view).toContain('@/widgets/map-sheet-shell');
    expect(view).toContain('MapSheetShell');
    // 부정 — 조회·API 를 직접 물지 않는다(그건 페이지 몫. 물면 프리뷰가 네트워크 계층을 전이 로드한다).
    expect(view).not.toContain('@/shared/api');
    expect(view).not.toMatch(/@\/features\/record\/model\/use/);
    expect(view).not.toContain('VisitRecordCardContainer');
  });
});

describe('🔴 G4 · testID — 카드·즉석 추가는 실재, 옛 일자 탭·뒤로는 셸로 이전 (TRIP-1085)', () => {
  it('record-trip-visit-card · record-trip-spontaneous-add 가 있고, record-trip-day-tab · record-trip-back 은 0건이다', () => {
    const sources = [
      ...scanDir(RECORD_FEATURE_DIR_REL),
      ...scanDir(PAGES_UI_DIR_REL),
    ];
    // 긍정 앵커 — 카드·버튼이 각자 testID 를 소유하고, 뷰가 모집단 안에 있다(빈 스캔 공허 통과 차단).
    expect(readOne(CARD_REL)).toContain('record-trip-visit-card');
    expect(readOne(BUTTON_REL)).toContain('record-trip-spontaneous-add');
    expect(sources.map((s) => s.file)).toContain(VIEW_REL);

    // 부정 — 옛 testID 는 셸 `sheet-daychip-{index}`·`sheet-daychip-back` 으로 옮겨 가 0건.
    const offenders = sources
      .filter(
        ({ source }) =>
          source.includes('record-trip-day-tab') ||
          source.includes('record-trip-back')
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
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

describe('🔴 G6 · INV-3 — features/record/ui · pages/trip-records/ui 에 소요시간 문자열 0(거리만)', () => {
  it('두 디렉토리 재귀 스캔에 소요시간 표기 0건 + 모집단 앵커', () => {
    // TRIP-1085 — 시트 헤더를 조립하는 새 뷰는 pages 층이라 옛 사정거리(features/record/ui) 밖이었다.
    const sources = [
      ...scanDir(RECORD_UI_DIR_REL),
      ...scanDir(PAGES_UI_DIR_REL),
    ];
    // 긍정 앵커 — 모집단이 실제로 채워졌다(카드·새 뷰가 그 안에 있다).
    expect(sources.map((s) => s.file)).toContain(CARD_REL);
    expect(sources.map((s) => s.file)).toContain(VIEW_REL);
    // 부정 — 소요시간 문자열 0건.
    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G7 · TRIP-1085 풀 지도 전환 — 옛 세로 컬럼·히어로 지도·탭바가 남지 않는다', () => {
  it('옛 화면 파일·식별자가 없고, features/record 에 지도 태그 0 · 뷰·페이지에 BottomTabBar 0', () => {
    // 긍정 앵커 — 새 뷰가 실재하고 셸을 문다(아래 부재 단언이 빈 트리에서 공허 통과하지 않게).
    expect(readOne(VIEW_REL)).toContain('MapSheetShell');

    // 옛 세로 컬럼 화면 파일이 지워졌고, src 비테스트 코드 어디에도 그 식별자가 없다(주석 제외).
    expect(fs.existsSync(path.join(ROOT, OLD_SCREEN_REL))).toBe(false);
    const oldNameUsers = listSourceFiles(ROOT)
      .filter((full) =>
        stripComments(fs.readFileSync(full, 'utf8')).includes(
          'TripRecordsScreen'
        )
      )
      .map(relOf);
    expect(oldNameUsers).toEqual([]);

    // 지도는 셸만 그린다 — features/record 에 `<MapView` 0건(250px 히어로 부재).
    const mapOwners = scanDir(RECORD_FEATURE_DIR_REL)
      .filter(({ source }) => /<MapView\b/.test(source))
      .map(({ file }) => file);
    expect(mapOwners).toEqual([]);

    // 결정 1(b) — 탭바 없음.
    expect(readOne(VIEW_REL)).not.toContain('BottomTabBar');
    expect(readOne(PAGE_REL)).not.toContain('BottomTabBar');
  });
});

describe('🔴 G8 · TRIP-1085 프리뷰 j01 — 새 뷰(시트 안)로만 렌더한다', () => {
  it('j01 5키가 <TripRecordsView 를 그리고, <MemoInline 은 그 블록들 밖에 없다', () => {
    const preview = readOne(PREVIEW_REL);
    const blocks = J01_PREVIEW_KEYS.map((key) => fixtureBlock(preview, key));

    // 긍정 — 다섯 블록을 전부 찾았고 각자 새 뷰를 그린다.
    blocks.forEach((block, index) => {
      expect({
        key: J01_PREVIEW_KEYS[index],
        view: block.includes('<TripRecordsView'),
      }).toEqual({
        key: J01_PREVIEW_KEYS[index],
        view: true,
      });
    });

    // 메모 입력(BottomSheetTextInput)은 실기에서 시트 밖이면 throw 한다 — 프리뷰의 <MemoInline 은 전부
    // j01 뷰 블록 안(= 셸 시트 안 renderCard)이어야 한다. 앵커: 1개 이상 실재.
    const inBlocks = blocks.reduce(
      (sum, block) => sum + countOf(block, /<MemoInline\b/g),
      0
    );
    expect(inBlocks).toBeGreaterThan(0);
    expect(countOf(preview, /<MemoInline\b/g)).toBe(inBlocks);
  });

  it('records-empty(Figma 4705:4054)는 방문 카드 0 + 계획 행으로 그린다', () => {
    const block = fixtureBlock(readOne(PREVIEW_REL), 'records-empty');

    expect(block).toContain('<TripRecordsView');
    expect(block).toMatch(/cards=\{\[\]\}/);
    expect(block).toContain('planRows=');
  });
});
