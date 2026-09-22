/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-746 · AC-9 (+ G7 에셋) — i01 허브 재작성의 **삭제·이관 소스 층 가드**.
 *
 * 무엇을 보장하나:
 *  - H1 사라지는 표면(지도 세그먼트·peek·실제 경로·세그먼트 스토어·옛 화면/카드)의 소스 파일이 없다.
 *    짝: 새 자리 3파일이 있고, 다음 예정지 모델 `nextNav.ts` 는 **남는다**(Seed Q5 — TRIP-755 소비 예정).
 *  - H2 방패 FAB 글리프(`ShieldGlyph`)가 사라졌다(감시 목록 FAB 삭제).
 *  - H3 삭제한 모듈을 import·jest.mock 하는 곳이 0이다(테스트 포함 — 옛 경로를 무는 목이 남지 않게).
 *  - H4 프리뷰 사진 에셋이 `src/assets/execution/` 에 실재하고 CREDITS.md 가 각 파일을 적는다(G7).
 *  - H5 (TRIP-747 AC-7) 허브 뷰는 SVG 를 직접 그리지 않는다 — 수정 알약의 ✦·×·연필은 `*Glyphs.tsx` 에서
 *    가져온다(raw hex 는 `pagesLayerStructure` 가, SVG 소재는 이 절이 잠근다).
 *
 * **전제 — 주석을 걷어낸 소스를 스캔한다**(`stripComments`, 콜론 예외로 `https://` 보존 — 리포 관례).
 * **census 순서 — `from` 절(·`jest.mock(` 줄)을 먼저 뽑고 그 줄 안에서 삭제 모듈 경로를 찾는다**
 * (심볼명으로 먼저 훑으면 주석·문자열·동명 이심볼에 걸린다, 하네스 규칙). G0 이 그 조합을 실제 문자열로 잠근다.
 * "없어야 한다" 단언은 같은 it 안의 "있어야 한다" 앵커와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const DELETED = [
  'features/execution/ui/LiveMapScreen.tsx',
  'features/execution/ui/LiveItineraryScreen.tsx',
  'features/execution/ui/LiveSlotCard.tsx',
  'features/execution/model/mapPeek.ts',
  'features/execution/model/actualDistance.ts',
  'features/execution/model/useActualRoute.ts',
  'features/execution/model/liveViewStore.ts',
];

/** import 경로 끝 조각(확장자 없음) — 상대·별칭 경로 어느 쪽이든 이 이름으로 끝나면 삭제 모듈이다. */
const DELETED_MODULES = DELETED.map((rel) =>
  path.basename(rel).replace(/\.tsx?$/, '')
);

const NEW_FILES = [
  'pages/live-itinerary/ui/LiveHubView.tsx',
  'entities/itinerary-slot/ui/SlotProgressCard.tsx',
  'entities/itinerary-slot/lib/openingHoursLabel.ts',
];
const KEPT = 'features/execution/model/nextNav.ts';
const GLYPHS_REL = 'features/execution/ui/ExecutionGlyphs.tsx';
const ASSET_DIR = 'assets/execution';

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 테스트 파일도 포함한다(H3 — 삭제 모듈을 무는 옛 목·import 가 남지 않게). */
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

/** ① `from '…'`·`jest.mock('…'`·`require('…')` 줄의 모듈 경로를 먼저 뽑는다. */
const IMPORT_SPEC =
  /(?:\bfrom\s+|\bjest\.mock\(\s*|\brequire\(\s*)['"]([^'"]+)['"]/g;

function importSpecs(source: string): string[] {
  return [...stripComments(source).matchAll(IMPORT_SPEC)].map((m) => m[1]);
}

/** ② 그 경로 안에서 삭제 모듈인지 판정 — 마지막 경로 조각이 정확히 그 이름이어야 한다. */
function isDeletedModule(spec: string): boolean {
  const last = spec.split('/').pop() ?? '';
  return DELETED_MODULES.includes(last);
}

describe('G0 · 조합 자가검사 — 주석 제거 + import 추출 + 모듈 판정이 서로를 지우지 않는다', () => {
  it('주석 속 import 는 걷히고, URL 줄은 살아남으며, 실제 import·jest.mock 은 잡힌다', () => {
    const sample = [
      "// import { LiveMapScreen } from './LiveMapScreen';",
      "/* jest.mock('../model/mapPeek') */",
      "const url = 'https://example.com/liveViewStore';",
      "import { LiveItineraryScreen } from '@/features/execution/ui/LiveItineraryScreen';",
      "jest.mock('../model/useActualRoute');",
      "import { resolveNextDest } from '../model/nextNav';",
      "import { mapPeekLike } from './mapPeekHelpers';",
    ].join('\n');

    const specs = importSpecs(sample);
    // 주석 두 줄은 걷혀 추출되지 않는다.
    expect(specs).not.toContain('./LiveMapScreen');
    expect(specs).not.toContain('../model/mapPeek');
    // URL 문자열 줄은 코드로 살아남되 import 가 아니라 추출 대상이 아니다.
    expect(stripComments(sample)).toContain(
      'https://example.com/liveViewStore'
    );
    // 실제 import·jest.mock 은 잡히고 삭제 모듈로 판정된다.
    expect(specs.filter(isDeletedModule)).toEqual([
      '@/features/execution/ui/LiveItineraryScreen',
      '../model/useActualRoute',
    ]);
    // 남기는 모듈·이름이 비슷한 다른 모듈은 판정되지 않는다(마지막 조각 정확 일치).
    expect(isDeletedModule('../model/nextNav')).toBe(false);
    expect(isDeletedModule('./mapPeekHelpers')).toBe(false);
  });
});

describe('🔴 H1 · AC-9 — 사라지는 표면의 소스가 없고, 새 자리와 nextNav 는 있다', () => {
  it('삭제 7파일 부재 + 신규 3파일·nextNav.ts 존재', () => {
    // 짝 앵커 — 새 자리가 실재한다(구현 전 red).
    NEW_FILES.forEach((rel) =>
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true)
    );
    // Seed Q5 — 다음 예정지 모델은 남긴다(요구가 사라진 것이 아님, TRIP-755 소비 예정).
    expect(fs.existsSync(path.join(ROOT, KEPT))).toBe(true);

    const remaining = DELETED.filter((rel) =>
      fs.existsSync(path.join(ROOT, rel))
    );
    expect(remaining).toEqual([]);
  });
});

describe('🔴 H2 · AC-9 — 방패 FAB 글리프가 사라졌다', () => {
  it('ExecutionGlyphs.tsx 에 ShieldGlyph 가 0건이다', () => {
    const source = stripComments(
      fs.readFileSync(path.join(ROOT, GLYPHS_REL), 'utf8')
    );
    // 짝 — 파일이 비지 않았다(다른 글리프 export 가 남아 있다).
    expect(source).toMatch(/export function \w+Glyph/);
    expect(source).not.toMatch(/\bShieldGlyph\b/);
  });
});

describe('🔴 H3 · AC-9 — 삭제 모듈을 무는 import·jest.mock 이 0건이다', () => {
  it('src 전수(테스트 포함)에서 삭제 모듈 경로를 가리키는 import·jest.mock·require 가 없다', () => {
    const files = listAllSources(ROOT);
    // 앵커 — 모집단이 실재하고, 추출기가 실제 파일에서 import 를 뽑는다.
    expect(files.length).toBeGreaterThan(100);
    const hubPage = path.join(
      ROOT,
      'pages/live-itinerary/ui/LiveItineraryPage.tsx'
    );
    expect(
      importSpecs(fs.readFileSync(hubPage, 'utf8')).length
    ).toBeGreaterThan(0);

    // 이 파일 자신은 뺀다 — G0 표본 문자열 안의 import 문이 추출기에 걸린다(자기 참조 오탐).
    const offenders = files
      .filter((full) => relOf(full) !== '__tests__/liveHubStructure.test.ts')
      .flatMap((full) =>
        importSpecs(fs.readFileSync(full, 'utf8'))
          .filter(isDeletedModule)
          .map((spec) => `${relOf(full)} → ${spec}`)
      );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 H4 · G7 — 프리뷰 사진 에셋이 실재하고 출처가 적혀 있다', () => {
  it('src/assets/execution 에 jpg 4장 이상 + CREDITS.md 가 각 파일명을 적는다', () => {
    const dir = path.join(ROOT, ASSET_DIR);
    const jpgs = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((name) => /\.jpe?g$/.test(name))
      : [];
    expect(jpgs.length).toBeGreaterThanOrEqual(4);

    const creditsPath = path.join(dir, 'CREDITS.md');
    expect(fs.existsSync(creditsPath)).toBe(true);
    const credits = fs.readFileSync(creditsPath, 'utf8');
    const unlisted = jpgs.filter((name) => !credits.includes(name));
    expect(unlisted).toEqual([]);
  });
});

const HUB_VIEW_REL = 'pages/live-itinerary/ui/LiveHubView.tsx';
const SVG_MODULE = 'react-native-svg';

describe('H5-0 · 조합 자가검사 — 주석 제거 + import 추출이 svg import 를 지우지도 지어내지도 않는다', () => {
  it('주석 속 svg import 는 걷히고, URL 줄은 추출되지 않으며, 실제 svg import 는 잡힌다', () => {
    const sample = [
      "// import Svg from 'react-native-svg';",
      "const u = 'https://x.dev/react-native-svg';",
      "import Svg, { Path } from 'react-native-svg';",
    ].join('\n');

    expect(stripComments(sample)).toContain('https://x.dev/react-native-svg');
    expect(importSpecs(sample).filter((spec) => spec === SVG_MODULE)).toEqual([
      SVG_MODULE,
    ]);
    expect(importSpecs(sample.split('\n')[0] ?? '')).toEqual([]);
  });
});

describe('H5 · TRIP-747 AC-7 — 허브 뷰는 react-native-svg 를 직접 import 하지 않는다(글리프는 *Glyphs.tsx)', () => {
  it('LiveHubView.tsx 의 import 경로에 react-native-svg 가 0건이다', () => {
    const specs = importSpecs(
      fs.readFileSync(path.join(ROOT, HUB_VIEW_REL), 'utf8')
    );
    // 짝 앵커 — 추출기가 이 파일에서 실제 import 를 뽑는다(셸).
    expect(specs).toContain('@/widgets/map-sheet-shell/ui/MapSheetShell');
    expect(specs.filter((spec) => spec === SVG_MODULE)).toEqual([]);
  });
});
