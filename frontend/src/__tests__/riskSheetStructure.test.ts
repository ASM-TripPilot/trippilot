/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-749 · AC-8 — 옛 i09 감시 목록 페이지가 i03 위험 상세 시트로 **흡수**된 뒤의 삭제 가드.
 *
 * 무엇을 보장하나:
 *  - R1 감시 목록 화면·데이터 훅·페이지·라우트와 그 테스트가 없다. 짝: 새 시트·조인 함수가 있고,
 *    배지 데이터가 되는 사영(`triggerWatchlist.ts`)은 **남는다**.
 *  - R2 삭제한 모듈을 import·jest.mock·require 하는 곳이 src 전수(테스트 포함)에서 0이다.
 *  - R3 티켓 완료 조건 "옛 testID·라우트가 리포에 없음" — 옛 testID 접두어와 라우트 경로 문자열이
 *    src 원문(주석 포함) 어디에도 없다.
 *  - R4 감시 목록 화면만 쓰던 글리프 3종(구름·시계·가게)이 `PlanbGlyphs.tsx` 에서 사라졌다(이 변경이
 *    만든 고아).
 *
 * **자기 참조 회피(02a ★8)**: R3 이 찾는 두 문자열은 이 파일 안에서 **조립**한다. 리터럴로 적으면
 * 이 가드가 자기 자신을 잡아 영원히 red 다. 조립 덕분에 R3 은 이 파일을 빼지 않고 전수를 본다.
 * R2 는 R0 표본의 import 문이 추출기에 걸리므로 이 파일만 뺀다(`liveHubStructure` H6 과 같은 처리).
 *
 * **census 순서 — `from` 절(·`jest.mock(`·`require(`)을 먼저 뽑고 그 경로 안에서 삭제 모듈을 판정한다**
 * (심볼명으로 먼저 훑으면 주석·문자열·동명 이심볼에 걸린다, 하네스 규칙). R0 이 그 조합을 실제 문자열로 잠근다.
 * "없어야 한다" 단언은 같은 it 안의 "있어야 한다" 앵커와 짝을 이룬다.
 */

const ROOT = path.resolve('src');
const SELF = '__tests__/riskSheetStructure.test.ts';

/** 옛 testID 접두어·페이지 폴더명과 라우트 경로 — 조립해서 이 파일에 리터럴이 없게 한다(★8). */
const OLD_ID = ['planb', 'triggers'].join('-');
const OLD_ROUTE = ['planb', 'triggers'].join('/');

const DELETED = [
  'features/planb/ui/TriggerWatchlistScreen.tsx',
  'features/planb/ui/TriggerWatchlistScreen.test.tsx',
  'features/planb/ui/TriggerWatchlistScreen.labelSource.test.ts',
  'features/planb/model/useTriggerWatchlist.ts',
  'features/planb/model/useTriggerWatchlist.test.ts',
  `pages/${OLD_ID}/index.ts`,
  `pages/${OLD_ID}/ui/PlanbTriggersPage.tsx`,
  `pages/${OLD_ID}/ui/PlanbTriggersPage.integration.test.tsx`,
  `app/trips/[tripId]/${OLD_ROUTE}.tsx`,
  '__tests__/planbTriggersRoute.test.tsx',
];
const DELETED_DIR = `pages/${OLD_ID}`;
const ANCHORS = [
  'features/planb/ui/RiskDetailSheet.tsx',
  'features/planb/model/riskAffectedRow.ts',
  'features/planb/model/triggerWatchlist.ts',
];
/** import 경로의 마지막 조각이 정확히 이 이름이면 삭제 모듈이다. */
const DELETED_MODULES = [
  'TriggerWatchlistScreen',
  'useTriggerWatchlist',
  'PlanbTriggersPage',
  OLD_ID,
];
const GLYPHS_REL = 'features/planb/ui/PlanbGlyphs.tsx';
const ORPHAN_GLYPHS = ['WeatherCloudGlyph', 'ClockGlyph', 'ShopGlyph'];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 테스트 파일도 포함한다(옛 목·import 가 남지 않게). */
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

/** ② 그 경로 안에서 판정 — 마지막 조각 정확 일치, 또는 라우트 경로로 끝남. */
function isDeletedModule(spec: string): boolean {
  const last = spec.split('/').pop() ?? '';
  return DELETED_MODULES.includes(last) || spec.endsWith(`/${OLD_ROUTE}`);
}

describe('R0 · 조합 자가검사 — 주석 제거 + import 추출 + 판정이 서로를 지우지 않는다', () => {
  it('주석 속 import 는 걷히고, URL 줄은 추출되지 않으며, 실제 import·jest.mock·require 는 잡힌다', () => {
    const sample = [
      "// import { TriggerWatchlistScreen } from './TriggerWatchlistScreen';",
      "/* jest.mock('../model/useTriggerWatchlist') */",
      "const url = 'https://x.dev/useTriggerWatchlist';",
      "import { TriggerWatchlistScreen } from '@/features/planb/ui/TriggerWatchlistScreen';",
      `jest.mock('@/pages/${OLD_ID}', () => ({}));`,
      `const Route = require('@/app/trips/[tripId]/${OLD_ROUTE}');`,
      "import { triggerWatchlist } from '../model/triggerWatchlist';",
      "import { Like } from './TriggerWatchlistScreenLike';",
      `import { Other } from '@/app/x/${OLD_ROUTE}Like';`,
    ].join('\n');

    const specs = importSpecs(sample);
    // 주석 두 줄은 걷혀 추출되지 않는다.
    expect(specs).not.toContain('./TriggerWatchlistScreen');
    expect(specs).not.toContain('../model/useTriggerWatchlist');
    // URL 문자열 줄은 코드로 살아남되 import 가 아니라 추출 대상이 아니다.
    expect(stripComments(sample)).toContain(
      'https://x.dev/useTriggerWatchlist'
    );
    // 실제 import·jest.mock·require 3건이 잡히고 삭제 모듈로 판정된다.
    expect(specs.filter(isDeletedModule)).toEqual([
      '@/features/planb/ui/TriggerWatchlistScreen',
      `@/pages/${OLD_ID}`,
      `@/app/trips/[tripId]/${OLD_ROUTE}`,
    ]);
    // 남기는 사영·이름이 비슷한 다른 모듈은 판정되지 않는다.
    expect(isDeletedModule('../model/triggerWatchlist')).toBe(false);
    expect(isDeletedModule('./TriggerWatchlistScreenLike')).toBe(false);
    expect(isDeletedModule(`@/app/x/${OLD_ROUTE}Like`)).toBe(false);
  });
});

describe('🔴 R1 · 감시 목록 페이지·화면·훅·라우트가 사라졌고, 새 시트와 사영은 있다', () => {
  it('삭제 10경로·페이지 폴더 부재 + 시트·조인·사영 3파일 존재', () => {
    const missingAnchors = ANCHORS.filter(
      (rel) => !fs.existsSync(path.join(ROOT, rel))
    );
    expect(missingAnchors).toEqual([]);

    const remaining = DELETED.filter((rel) =>
      fs.existsSync(path.join(ROOT, rel))
    );
    expect(remaining).toEqual([]);
    expect(fs.existsSync(path.join(ROOT, DELETED_DIR))).toBe(false);
  });
});

describe('🔴 R2 · 삭제 모듈을 무는 import·jest.mock·require 가 0건이다', () => {
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

describe('🔴 R3 · 옛 testID 접두어·라우트 경로 문자열이 src 어디에도 없다 (티켓 완료 조건)', () => {
  it('src 전수 원문(주석 포함 · 이 파일 포함)에 두 문자열이 0건이다', () => {
    // 이 파일도 스캔에 들어간다 — 두 문자열을 조립해 두었으므로 자기 자신은 걸리지 않는다(★8).
    const files = listAllSources(ROOT);
    expect(files.map(relOf)).toContain(SELF);

    const offenders = files.flatMap((full) => {
      const source = fs.readFileSync(full, 'utf8');
      return [OLD_ID, OLD_ROUTE]
        .filter((needle) => source.includes(needle))
        .map((needle) => `${relOf(full)} ⊃ ${needle}`);
    });
    expect(offenders).toEqual([]);
  });
});

describe('🔴 R4 · 감시 목록 전용 글리프 3종이 PlanbGlyphs 에서 사라졌다', () => {
  it('구름·시계·가게 글리프 선언 0건 + 다른 화면이 쓰는 AppliedAlertGlyph 는 남는다', () => {
    const source = stripComments(
      fs.readFileSync(path.join(ROOT, GLYPHS_REL), 'utf8')
    );

    // 짝 앵커 — 파일이 비지 않았고 남길 글리프는 있다(NoAlternativeScreen·PlanbDiffPage 소비).
    expect(source).toMatch(/export function AppliedAlertGlyph\b/);
    const declared = ORPHAN_GLYPHS.filter((name) =>
      new RegExp(`\\bfunction ${name}\\b|\\bconst ${name}\\b`).test(source)
    );
    expect(declared).toEqual([]);
  });
});
