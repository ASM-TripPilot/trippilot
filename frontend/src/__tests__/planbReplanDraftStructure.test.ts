/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-751 · AC-1·5·6·8·11·12·13 — i06 재계획안 소스 층 가드(앱을 안 돌리고 소스를 글자로 읽는다).
 * (TRIP-563 i13/i16 골격 가드를 재조준 — 두 features 화면이 pages 순수 뷰 하나로 합쳐졌다.)
 *
 * 무엇을 보장하나:
 *  - G2 새 뷰(`pages/planb-draft/ui/ReplanDraftView.tsx`)·페이지·라우트가 있고, features 옛 두 화면과
 *    그 테스트는 없다(Seed Q1 — features 는 widgets 셸을 import 할 수 없어 뷰가 pages 로 왔다).
 *  - G3 뷰·행에 소요시간 표기 0(INV-3).
 *  - G4 쓰기 경계: **뷰는 쓰기 훅을 모르고, 페이지는 확정 seam(`useApplyReplan`)만 안다**(E1 — 확정
 *    지점이 i06 페이지로 옮겨졌다. INV-U4-05 가 허용한 유일한 쓰기 지점의 이동이지 봉인 파기가 아니다).
 *    codegen apply·itinerary PUT 직접 호출은 여전히 0.
 *  - G5 뷰 순수성: 판정·조회·확정·라우팅·쿼리·네트워크 계층을 모르고 셸 부품을 조립한다.
 *  - G6 draft 라우트는 페이지로 얇게 위임한다.
 *  - G7 사라진 표면(옛 근거·이월 안내·배지·3옵션·옛 CTA·230px 지도)의 문자열이 뷰·행·페이지에 0.
 *  - G8 옛 두 화면을 무는 import·jest.mock·require 0 + 프리뷰는 뷰를 **파일 경로**로 import 한다(배럴
 *    `@/pages/planb-draft` 는 페이지 → 훅 → shared/api 를 끌고 온다, TRIP-610).
 *
 * 전처리×탐지기 조합(★): 부정 단언은 전부 stripComments(콜론 예외로 URL 보존) 뒤 소스에 건다 — 구현자가
 * "옛 휴식 모드 버튼은 지웠다" 같은 주석을 달아도 거짓 red 가 나지 않게. G1 이 그 조합을 실제 문자열로
 * 잠근다(문제로그 [[2026-07-31 stripComments가 URL의 슬래시를 주석으로 오인]] 계열).
 * census 는 `from` 절(·jest.mock·require)을 먼저 뽑고 그 경로의 끝 조각을 판정한다(하네스 규칙).
 */

const ROOT = path.resolve('src');
const SELF = '__tests__/planbReplanDraftStructure.test.ts';

/** 소요시간 **표기** 탐지기(executionDurationStructure 와 동일). HH:mm(09:30)은 숫자 뒤가 `:`라 안 걸림. */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 주석 제거 — `:` 뒤 `//`(URL)은 주석으로 오인하지 않는다(리포 확립 룩비하인드). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 '' — ENOENT 로 죽으면 assertion diff 가 안 남는다(planbApplyStructure readOne 선례). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

/** 테스트 포함 src 전수(G8 census — 옛 경로를 무는 목·import 가 남지 않게). */
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

const DELETED_MODULES = ['ReplanDraftScreen', 'NoAlternativeScreen'];

/** ② 그 경로의 마지막 조각이 삭제 모듈 이름과 **정확히** 같은가. */
function isDeletedModule(spec: string): boolean {
  return DELETED_MODULES.includes(spec.split('/').pop() ?? '');
}

const VIEW_REL = 'pages/planb-draft/ui/ReplanDraftView.tsx';
const ROW_REL = 'entities/itinerary-slot/ui/ReplanSlotRow.tsx';
const PAGE_REL = 'pages/planb-draft/ui/PlanbDraftPage.tsx';
const ROUTE_REL = 'app/trips/[tripId]/planb/draft.tsx';
const PREVIEW_REL = 'app/_dev/preview.tsx';
const DELETED_FILES = [
  'features/planb/ui/ReplanDraftScreen.tsx',
  'features/planb/ui/ReplanDraftScreen.test.tsx',
  'features/planb/ui/NoAlternativeScreen.tsx',
  'features/planb/ui/NoAlternativeScreen.test.tsx',
];

const CODEGEN_WRITES = [
  'usePutTripsTripIdItinerary',
  'usePostTripsTripIdReplanSessionsSessionIdApply',
];
const APPLY_SEAM = 'useApplyReplan';

/** 사라진 표면 — i13 근거·이월·배지·옛 CTA·230px 지도, i16 3옵션(AC-5·AC-6·AC-8). */
const REMOVED_SURFACE = [
  '이대로 적용',
  '직접 고르기',
  'planb-draft-reason',
  'planb-draft-carryover',
  '다음으로 미룬',
  '방문함',
  '변경됨',
  'h-[230px]',
  'planb-noalt-skip',
  'planb-noalt-rest',
  '휴식 모드',
  '건너뛰기',
];

describe('G1 · 전처리×탐지기 자가검사 (★ 조합)', () => {
  it('주석(줄·JSX 블록) 속 삭제 표면·금칙 심볼은 걷히고, 코드 className·URL·라벨·실배선은 살아남는다', () => {
    const sample = [
      '// 옛 i16 의 휴식 모드·건너뛰기 버튼은 지웠다. 소요시간 30분 표기 안 함.',
      '// 뷰는 useApplyReplan 을 import 하지 않는다.',
      '{/* 옛 planb-draft-carryover 자리 */}',
      '<View className="h-[230px] w-full" />',
      "const url = 'https://x.dev/a';",
      "const label = '조건 바꿔 다시 짜기';",
      "const time = '15:00–16:30';",
      'const apply = useApplyReplan();',
    ].join('\n');
    const stripped = stripComments(sample);

    expect(stripped).not.toContain('휴식 모드');
    expect(stripped).not.toContain('건너뛰기');
    expect(stripped).not.toContain('planb-draft-carryover');
    expect(stripped).not.toContain('30분');
    expect(stripped).not.toContain('import 하지 않는다');
    expect(stripped).toContain('h-[230px]');
    expect(stripped).toContain('https://x.dev/a');
    expect(stripped).toContain('조건 바꿔 다시 짜기');
    expect(stripped).toContain('const apply = useApplyReplan();');
    expect(DURATION_TEXT.test(stripped)).toBe(false);
    expect(DURATION_TEXT.test('여유 1시간 20분')).toBe(true);
    // Figma 대안 없음 부제의 앞 절은 소요시간 표기가 아니다(★15).
    expect(DURATION_TEXT.test('17시 이후 실내 후보가 근처에 없어요')).toBe(
      false
    );
  });

  it('census — 주석 속 import 는 걷히고, 실제 import·jest.mock 은 잡히며, 이름이 비슷한 모듈은 판정되지 않는다', () => {
    const sample = [
      "// import { ReplanDraftScreen } from '@/features/planb/ui/ReplanDraftScreen';",
      "const url = 'https://x.dev/NoAlternativeScreen';",
      "import { ReplanDraftScreen } from './ReplanDraftScreen';",
      "jest.mock('@/features/planb/ui/NoAlternativeScreen', () => ({}));",
      "import { ReplanDraftView } from '@/pages/planb-draft/ui/ReplanDraftView';",
      "import { Like } from './ReplanDraftScreenLike';",
    ].join('\n');

    const specs = importSpecs(sample);
    expect(specs).not.toContain('@/features/planb/ui/ReplanDraftScreen');
    expect(stripComments(sample)).toContain(
      'https://x.dev/NoAlternativeScreen'
    );
    expect(specs.filter(isDeletedModule)).toEqual([
      './ReplanDraftScreen',
      '@/features/planb/ui/NoAlternativeScreen',
    ]);
    expect(specs).toContain('@/pages/planb-draft/ui/ReplanDraftView');
    expect(isDeletedModule('./ReplanDraftScreenLike')).toBe(false);
  });
});

describe('🔴 G2 · AC-1 — 새 뷰가 pages 에 있고 features 옛 두 화면은 없다', () => {
  it('뷰·행·페이지·라우트 실재 + 옛 두 화면과 그 테스트 4파일 부재', () => {
    for (const rel of [VIEW_REL, ROW_REL, PAGE_REL, ROUTE_REL]) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    }
    const remaining = DELETED_FILES.filter((rel) =>
      fs.existsSync(path.join(ROOT, rel))
    );
    expect(remaining).toEqual([]);
  });
});

describe('🔴 G3 · AC-13 — 뷰·행에 소요시간 표기 0 (INV-3)', () => {
  it('두 파일(주석 제외)에 분·시간·소요 표기가 없다 + 짝(파일을 실제로 읽음)', () => {
    const view = readOne(VIEW_REL);
    const row = readOne(ROW_REL);
    expect(view).toContain('MapSheetShell');
    expect(row).toContain('planb-draft-slot');

    expect(DURATION_TEXT.test(view)).toBe(false);
    expect(DURATION_TEXT.test(row)).toBe(false);
  });
});

describe('🔴 G4 · E1 · BR-U4-28 — 뷰는 쓰기를 모르고, 페이지는 확정 seam 만 안다', () => {
  it('뷰에 seam·codegen 쓰기 0, 페이지에 seam 있음·codegen 쓰기 0 + 조회·판정 배선', () => {
    const view = readOne(VIEW_REL);
    const page = readOne(PAGE_REL);
    expect(view).toContain('MapSheetShell');

    for (const hook of [APPLY_SEAM, ...CODEGEN_WRITES]) {
      expect(view).not.toContain(hook);
    }
    expect(page).toContain(APPLY_SEAM);
    for (const hook of CODEGEN_WRITES) {
      expect(page).not.toContain(hook);
    }
    expect(page).toContain('useReplanSession');
    expect(page).toContain('resolveReplanState');
  });
});

describe('🔴 G5 · AC-1 — 뷰 순수성(판정·조회·확정·라우팅·네트워크 0) + 셸 조립', () => {
  it('뷰가 금칙 심볼을 모르고, 셸·헤더·커넥터·행을 조립한다', () => {
    const view = readOne(VIEW_REL);
    const FORBIDDEN = [
      'resolveReplanState',
      'useReplanSession',
      'useApplyReplan',
      'expo-router',
      '@tanstack/react-query',
      '@/shared/api',
    ];
    for (const token of FORBIDDEN) {
      expect(view).not.toContain(token);
    }
    for (const part of [
      '<MapSheetShell',
      'SheetHeader',
      'DistanceConnector',
      'ReplanSlotRow',
    ]) {
      expect(view).toContain(part);
    }
  });
});

describe('🔴 G6 · 라우트 골격(얇은 위임)', () => {
  it('draft.tsx 가 @/pages/planb-draft·PlanbDraftPage·useLocalSearchParams 로 위임한다', () => {
    const route = readOne(ROUTE_REL);
    expect(route).toContain('@/pages/planb-draft');
    expect(route).toContain('PlanbDraftPage');
    expect(route).toContain('useLocalSearchParams');
  });
});

describe('🔴 G7 · AC-5·AC-6·AC-8 — 사라진 표면의 문자열이 뷰·행·페이지에 0', () => {
  it('세 파일(주석 제외)에 삭제 표면 12종이 없다 + 짝(각 파일이 자기 표면을 그린다)', () => {
    const sources = {
      [VIEW_REL]: readOne(VIEW_REL),
      [ROW_REL]: readOne(ROW_REL),
      [PAGE_REL]: readOne(PAGE_REL),
    };
    expect(sources[VIEW_REL]).toContain('planb-draft-notice');
    expect(sources[ROW_REL]).toContain('planb-draft-slot');
    expect(sources[PAGE_REL]).toContain('ReplanDraftView');

    const offenders = Object.entries(sources).flatMap(([rel, source]) =>
      REMOVED_SURFACE.filter((needle) => source.includes(needle)).map(
        (needle) => `${rel} ⊃ ${needle}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G8 · AC-1·AC-12 — 옛 두 화면 census + 프리뷰는 뷰를 파일 경로로 import', () => {
  it('src 전수(테스트 포함, 이 파일 제외)에서 옛 두 화면을 무는 import·jest.mock·require 가 0건이다', () => {
    const files = listAllSources(ROOT);
    expect(files.length).toBeGreaterThan(100);
    expect(
      importSpecs(fs.readFileSync(path.join(ROOT, PAGE_REL), 'utf8')).length
    ).toBeGreaterThan(0);

    const offenders = files
      .filter((full) => relOf(full) !== SELF)
      .flatMap((full) =>
        importSpecs(fs.readFileSync(full, 'utf8'))
          .filter(isDeletedModule)
          .map((spec) => `${relOf(full)} → ${spec}`)
      );
    expect(offenders).toEqual([]);
  });

  it('preview.tsx 는 @/pages/planb-draft/ui/ReplanDraftView 를 import 하고 배럴 @/pages/planb-draft 는 import 하지 않는다', () => {
    const specs = importSpecs(
      fs.readFileSync(path.join(ROOT, PREVIEW_REL), 'utf8')
    );
    expect(specs).toContain('@/pages/planb-draft/ui/ReplanDraftView');
    expect(specs).not.toContain('@/pages/planb-draft');
  });
});
