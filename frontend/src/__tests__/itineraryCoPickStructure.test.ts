/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-335 슬라이스2 · 같이 고르기 위저드 소스 층 편입 앵커 + 고유 규칙.
 * → **TRIP-796 마이그레이션**: h11 같이 결과(CoPick 완료)를 공용 지도+시트 셸로 재작성하며 **허브
 *   폭발 반경**을 반영한다. 삭제: `CoPickHubScreen`·`CoPickHubPage`·`coPickProgress`(orphan)·
 *   허브 라우트(`copick/index.tsx`) + `CoPickCompleteScreen`(features — 셸 소비는 페이지가 지므로
 *   화면이 orphan, 01b D1). 남는 CoPick 흐름(generating→[slotKey]→complete)은 무회귀.
 *
 * 무엇을 보장하나:
 *  - G1: 생존 파일(model 1·화면 2·페이지 2·배럴 1)이 정본 경로에 실재 + 기존 동결 재귀 가드의
 *        사정거리(`features/itinerary/ui`·`src/pages`)에 자동 편입.
 *  - G3: `pages/itinerary-copick` 재귀에 디버그 프로브(`console.log(`·`PROBE_`) 0건.
 *  - G4: 배럴이 생존 2 Page(SlotFillPage·CoPickCompletePage)만 재수출하고 **CoPickHubPage 는 안 한다**.
 *  - G5(신규 · 삭제 teeth): 삭제 대상 5 소스가 부재하고, 생존 CoPick 라우트(complete·[slotKey])는 존재.
 *
 * (구 G2 "coPickProgress 단일 출처"는 coPickProgress 삭제로 폐기 — 05 삭제 반영.)
 *
 * **detector 를 복제하지 않는다** — INV-3·zustand·URL·타이머·raw hex 는 `itineraryTimeStructure`
 * (ui 재귀)·`pagesLayerStructure`(pages 재귀)가 이미 갖고 있고, G1 이 그 재귀에 새 파일이 도달함을
 * 확인한다. h11 "검증 시각" 계약은 소스 스캔으로 표현 불가(고정 블록이 startAt 을 정당하게 쓴다) →
 * 렌더 층(CoPickCompletePage 통합 테스트)이 잠근다.
 *
 * **전제 — 모든 스캔은 주석을 걷어낸 소스를 본다**(`stripComments`, 동결 가드와 같은 규칙).
 * **가짜 통과 방지**: 모든 "없어야 한다"는 같은 it 안의 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const UI_DIR_REL = 'features/itinerary/ui';
const MODEL_DIR_REL = 'features/itinerary/model';
const PAGES_DIR_REL = 'pages';
const COPICK_PAGES_DIR_REL = 'pages/itinerary-copick';

const MODEL_FILES = ['features/itinerary/model/radiusUsedLabel.ts'];
const SCREEN_FILES = [
  'features/itinerary/ui/ConceptPickerScreen.tsx',
  'features/itinerary/ui/SlotFillScreen.tsx',
];
const PAGE_FILES = [
  'pages/itinerary-copick/ui/SlotFillPage.tsx',
  'pages/itinerary-copick/ui/CoPickCompletePage.tsx',
];
const BARREL_REL = 'pages/itinerary-copick/index.ts';

// TRIP-796 허브 폭발 반경 — 삭제될 프로덕션 소스(implementer 삭제 전엔 실재라 RED).
const DELETED_SOURCE_FILES = [
  'features/itinerary/ui/CoPickHubScreen.tsx',
  'features/itinerary/ui/CoPickCompleteScreen.tsx',
  'pages/itinerary-copick/ui/CoPickHubPage.tsx',
  'features/itinerary/model/coPickProgress.ts',
  'app/trips/[tripId]/itinerary/copick/index.tsx',
];
// 무회귀 앵커 — 남는 CoPick 흐름 라우트(complete·[slotKey])는 그대로 있어야 한다.
const SURVIVING_ROUTES = [
  'app/trips/[tripId]/itinerary/copick/complete.tsx',
  'app/trips/[tripId]/itinerary/copick/[slotKey].tsx',
];

/** 주석을 걷는다 — 블록 먼저, 줄 주석은 앞 글자가 `:` 이면(URL 슬래시) 제외(동결 가드와 같은 규칙). */
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
      if (/Glyphs\.tsx$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function scan(dirRel: string): { file: string; source: string }[] {
  return listSourceFiles(path.join(ROOT, dirRel)).map((full) => ({
    file: relOf(full),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

/** 없는 파일은 빈 문자열 — 부정 단언의 공짜 통과는 같은 it 의 긍정 짝이 막는다(리포 확립 규약). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: fs.existsSync(path.join(ROOT, rel)) };
}

describe('E0 · detector 자가검사', () => {
  it('stripComments 는 주석 속 console.log/PROBE 를 걷고 코드·URL 은 남긴다', () => {
    const sample = [
      '// 배선을 복사하면 console.log(PROBE_CAND) 프로브가 딸려온다 — 수호 주석.',
      "const url = 'https://cdn.example.com/x.jpg';",
      "const real = 'kept';",
    ].join('\n');
    const stripped = stripComments(sample);

    expect(stripped).not.toContain('console.log(');
    expect(stripped).not.toContain('PROBE_');
    expect(stripped).toContain("const real = 'kept';");
    expect(/https?:\/\//.test(stripped)).toBe(true);
  });
});

describe('🔴 G1 · 생존 파일 실재 + 재귀 가드 자동 편입', () => {
  it('생존 model 1·화면 2·페이지 2·배럴 1 이 실재하고 재귀 모집단에 잡힌다', () => {
    [...MODEL_FILES, ...SCREEN_FILES, ...PAGE_FILES, BARREL_REL].forEach(
      (rel) => expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    const uiFiles = scan(UI_DIR_REL).map((s) => s.file);
    const modelFiles = scan(MODEL_DIR_REL).map((s) => s.file);
    const pageFiles = scan(PAGES_DIR_REL).map((s) => s.file);
    SCREEN_FILES.forEach((rel) => expect(uiFiles).toContain(rel));
    MODEL_FILES.forEach((rel) => expect(modelFiles).toContain(rel));
    PAGE_FILES.forEach((rel) => expect(pageFiles).toContain(rel));
  });
});

describe('🔴 G3 · 디버그 프로브 잔존 0(브리프 §3-주의3)', () => {
  it('pages/itinerary-copick 재귀에 console.log·PROBE_ 가 없다', () => {
    const sources = scan(COPICK_PAGES_DIR_REL);
    // 긍정 짝 — 스캔이 실제로 페이지에 닿았다(공집합 공허 통과 방지).
    expect(sources.map((s) => s.file)).toEqual(
      expect.arrayContaining(PAGE_FILES)
    );

    const offenders = sources
      .filter(
        (s) => s.source.includes('console.log(') || s.source.includes('PROBE_')
      )
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G4 · 배럴 두께 (허브 재수출 제거)', () => {
  it('배럴이 SlotFillPage·CoPickCompletePage 를 재수출하고 CoPickHubPage 는 안 한다', () => {
    expect(existsPair(BARREL_REL)).toEqual({ file: BARREL_REL, exists: true });
    const barrel = readOne(BARREL_REL);
    // 긍정 — 생존 2 Page.
    expect(barrel).toContain('SlotFillPage');
    expect(barrel).toContain('CoPickCompletePage');
    // 부정 — 삭제된 CoPickHubPage 재수출이 남으면 red(소스 삭제와 배럴이 함께 가야 tsc 도 성립).
    expect(barrel).not.toContain('CoPickHubPage');
  });
});

describe('🔴 G5 · 허브 폭발 반경 — 삭제 소스 부재 + 생존 흐름 라우트 존재(AC-9)', () => {
  it('삭제 대상 5 소스가 없다 (implementer 삭제 전엔 실재라 RED)', () => {
    DELETED_SOURCE_FILES.forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: false })
    );
  });

  it('남는 CoPick 흐름 라우트(complete·[slotKey])는 그대로 있다 (무회귀 앵커)', () => {
    SURVIVING_ROUTES.forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );
  });
});
