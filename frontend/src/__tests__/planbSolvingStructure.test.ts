/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-752 · AC-1·5·12·13 · Seed Q3·Q5 — i05 "다시 짜는 중" 소스 층 가드(앱을 안 돌리고 소스를 글자로 읽는다).
 *
 * 무엇을 보장하나:
 *  - G2 새 뷰·페이지·시각 헬퍼가 있고, 옛 i12 화면(features)·그 테스트·옛 FAILED 폴백 테스트는 없다.
 *  - G3 뷰는 조회·판정·라우팅·네트워크를 모르고 셸 부품(진행 카드·헤더·행·커넥터)을 조립한다.
 *  - G4 옛 화면만 쓰던 체크리스트 글리프 3종이 지워졌다.
 *  - G5 옛 표면(백그라운드로·부제·체크리스트·안심 노트·옛 testID)과 FAILED→수동 편집 경로 문자열이 없다.
 *  - G6 옛 화면을 무는 import·jest.mock·require 가 0 + 프리뷰는 뷰를 **파일 경로**로 import 한다(배럴은
 *    페이지 → 훅 → shared/api 를 끌고 온다, TRIP-610).
 *  - G7 시각 헬퍼가 기기 시간대(로컬 시계)를 읽지 않는다 — 이 기계는 KST 라 로컬 시계로 구현해도 테스트가
 *    여기선 통과하고 UTC 로 도는 CI 에서만 깨진다(02a ★6).
 *
 * 전처리×탐지기 조합(★): 부정 단언은 전부 stripComments(콜론 예외로 URL 보존) 뒤 소스에 건다. G1 이 그 조합을
 * 실제 문자열로 잠근다(문제로그 [[2026-07-31 stripComments가 URL의 슬래시를 주석으로 오인]] 계열).
 * census 는 `from` 절(·jest.mock·require)을 먼저 뽑고 그 경로의 끝 조각을 판정한다(하네스 규칙).
 */

const ROOT = path.resolve('src');
const SELF = '__tests__/planbSolvingStructure.test.ts';

/** 주석 제거 — `:` 뒤 `//`(URL)은 주석으로 오인하지 않는다(리포 확립 룩비하인드). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 '' — ENOENT 로 죽으면 assertion diff 가 안 남는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
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

/** ① `from '…'`·`jest.mock('…'`·`require('…')` 의 모듈 경로를 먼저 뽑는다. */
const IMPORT_SPEC =
  /(?:\bfrom\s+|\bjest\.mock\(\s*|\brequire\(\s*)['"]([^'"]+)['"]/g;

function importSpecs(source: string): string[] {
  return [...stripComments(source).matchAll(IMPORT_SPEC)].map((m) => m[1]);
}

/** ② 그 경로의 마지막 조각이 옛 화면 이름과 **정확히** 같은가. */
function isDeletedModule(spec: string): boolean {
  return (spec.split('/').pop() ?? '') === 'ReplanSolvingScreen';
}

/** 기기 시간대를 읽는 Date getter(UTC 판은 `getUTC…` 라 안 걸린다). */
const LOCAL_CLOCK = /\.get(Hours|Date|Day|Month|FullYear)\(/;

const VIEW_REL = 'pages/planb-draft/ui/ReplanSolvingView.tsx';
const PAGE_REL = 'pages/planb-draft/ui/PlanbSolvingPage.tsx';
const HELPER_REL = 'features/planb/model/replanFromInstant.ts';
const CARD_REL = 'widgets/map-sheet-shell/ui/GenerationProgressCard.tsx';
const GLYPHS_REL = 'features/planb/ui/PlanbGlyphs.tsx';
const PREVIEW_REL = 'app/_dev/preview.tsx';
const DELETED_FILES = [
  'features/planb/ui/ReplanSolvingScreen.tsx',
  'features/planb/ui/ReplanSolvingScreen.test.tsx',
  'pages/planb-draft/ui/PlanbSolvingPage.fallback.integration.test.tsx',
];

const CHECKLIST_GLYPHS = [
  'ChecklistDoneGlyph',
  'ChecklistActiveGlyph',
  'ChecklistWaitingGlyph',
];

/** 옛 i12 표면 + FAILED→수동 편집 경로(AC-5·AC-8). */
const REMOVED_SURFACE = [
  'planb-solving-background',
  'planb-solving-progress',
  'planb-solving-cancel',
  '백그라운드로',
  '5초쯤',
  '비 예보·남은 시간 반영',
  '대안 후보 거리·동선 계산',
  '대안 영업시간 확인 중',
  '새 동선 완성',
  '바뀌는 건 남은 일정 뿐',
  'planb/manual',
];

describe('G1 · 전처리×탐지기 자가검사 (★ 조합)', () => {
  it('주석 속 로컬 시계·옛 표면은 걷히고, 코드 getUTC*·URL·옛 표면 리터럴은 살아남는다', () => {
    const sample = [
      '// 로컬 시계 getHours() 는 쓰지 않는다 · 옛 planb/manual 전환 제거',
      '{/* 옛 백그라운드로 버튼 자리 */}',
      "const url = 'https://x.dev/a';",
      'const hour = shifted.getUTCHours();',
      'const date = shifted.getUTCDate();',
      "const label = '백그라운드로';",
    ].join('\n');
    const stripped = stripComments(sample);

    expect(stripped).not.toContain('planb/manual');
    expect(stripped).not.toContain('버튼 자리');
    expect(LOCAL_CLOCK.test(stripped)).toBe(false);
    expect(stripped).toContain('https://x.dev/a');
    expect(stripped).toContain('getUTCHours()');
    expect(stripped).toContain("'백그라운드로'");

    expect(LOCAL_CLOCK.test(stripComments('const h = at.getHours();'))).toBe(
      true
    );
    expect(
      LOCAL_CLOCK.test(stripComments('const d = new Date(x).getDate();'))
    ).toBe(true);
  });

  it('census — 주석 속 import 는 걷히고, 실제 import·jest.mock 은 잡히며, 이름이 비슷한 모듈은 판정되지 않는다', () => {
    const sample = [
      "// import { ReplanSolvingScreen } from '@/features/planb/ui/ReplanSolvingScreen';",
      "import { ReplanSolvingScreen } from '@/features/planb/ui/ReplanSolvingScreen';",
      "jest.mock('./ReplanSolvingScreen', () => ({}));",
      "import { ReplanSolvingView } from '@/pages/planb-draft/ui/ReplanSolvingView';",
      "import { Like } from './ReplanSolvingScreenLike';",
    ].join('\n');

    const specs = importSpecs(sample);
    expect(specs.filter(isDeletedModule)).toEqual([
      '@/features/planb/ui/ReplanSolvingScreen',
      './ReplanSolvingScreen',
    ]);
    expect(specs).toContain('@/pages/planb-draft/ui/ReplanSolvingView');
    expect(isDeletedModule('./ReplanSolvingScreenLike')).toBe(false);
  });
});

describe('🔴 G2 · AC-1 — 새 파일이 있고 옛 i12 화면·테스트는 없다', () => {
  it('뷰·페이지·시각 헬퍼 실재 + 옛 화면·그 테스트·옛 FAILED 폴백 테스트 부재', () => {
    for (const rel of [VIEW_REL, PAGE_REL, HELPER_REL]) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    }
    const remaining = DELETED_FILES.filter((rel) =>
      fs.existsSync(path.join(ROOT, rel))
    );
    expect(remaining).toEqual([]);
  });
});

describe('🔴 G3 · AC-1 — 뷰 순수성 + 셸 조립', () => {
  it('뷰가 조회·판정·라우팅·네트워크 심볼을 모르고, 셸·진행 카드·헤더·행·커넥터를 조립한다', () => {
    const view = readOne(VIEW_REL);
    const FORBIDDEN = [
      'expo-router',
      '@tanstack/react-query',
      '@/shared/api',
      'useReplanSession',
      'useLiveItinerary',
      'resolveReplanState',
    ];
    for (const part of [
      '<MapSheetShell',
      'GenerationProgressCard',
      'SheetHeader',
      'ReplanSlotRow',
      'DistanceConnector',
    ]) {
      expect(view).toContain(part);
    }
    for (const token of FORBIDDEN) {
      expect(view).not.toContain(token);
    }
  });
});

describe('🔴 G4 · AC-1 — 옛 화면만 쓰던 체크리스트 글리프 3종이 지워졌다', () => {
  it('PlanbGlyphs(주석 제외)에 3종 이름이 0건이고, 다른 글리프는 남아 있다', () => {
    const glyphs = readOne(GLYPHS_REL);
    expect(glyphs).toContain('AppliedCheckGlyph');
    for (const name of CHECKLIST_GLYPHS) {
      expect(glyphs).not.toContain(name);
    }
  });
});

describe('🔴 G5 · AC-5·AC-8 — 옛 표면 문자열이 뷰·페이지·진행 카드에 0', () => {
  it('세 파일(주석 제외)에 옛 표면이 없다 + 짝(각 파일이 자기 표면을 그린다)', () => {
    const sources = {
      [VIEW_REL]: readOne(VIEW_REL),
      [PAGE_REL]: readOne(PAGE_REL),
      [CARD_REL]: readOne(CARD_REL),
    };
    expect(sources[VIEW_REL]).toContain('GenerationProgressCard');
    expect(sources[PAGE_REL]).toContain('ReplanSolvingView');
    expect(sources[CARD_REL]).toContain('generation-progress-cancel');

    const offenders = Object.entries(sources).flatMap(([rel, source]) =>
      REMOVED_SURFACE.filter((needle) => source.includes(needle)).map(
        (needle) => `${rel} ⊃ ${needle}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G6 · AC-1·AC-13 — 옛 화면 census + 프리뷰는 뷰를 파일 경로로 import', () => {
  it('src 전수(테스트 포함, 이 파일 제외)에서 옛 화면을 무는 import·jest.mock·require 가 0건이다', () => {
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

  it('preview.tsx 는 @/pages/planb-draft/ui/ReplanSolvingView 를 import 하고 배럴 @/pages/planb-draft 는 import 하지 않는다', () => {
    const specs = importSpecs(
      fs.readFileSync(path.join(ROOT, PREVIEW_REL), 'utf8')
    );
    expect(specs).toContain('@/pages/planb-draft/ui/ReplanSolvingView');
    expect(specs).not.toContain('@/pages/planb-draft');
  });
});

describe('🔴 G7 · Q3·Q5 — 시각 헬퍼는 여행지 시간대를 계산하고 기기 시간대를 읽지 않는다', () => {
  it('헬퍼(주석 제외)에 로컬 시계 getter 가 0건이다 + 짝(readFromInstant 를 내보낸다)', () => {
    const helper = readOne(HELPER_REL);
    expect(helper).toMatch(/export (function|const) readFromInstant\b/);
    expect(LOCAL_CLOCK.test(helper)).toBe(false);
  });
});
