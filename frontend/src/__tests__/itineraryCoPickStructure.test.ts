/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-335 슬라이스2 · 같이 고르기 위저드(h13~h17) **소스 층 편입 앵커 + 고유 규칙**.
 *
 * 무엇을 보장하나:
 *  - G1: 신규 파일 10종(model 2·화면 4·페이지 3·배럴 1)이 정본 경로에 실재(구현 전 RED) +
 *        기존 동결 재귀 가드의 사정거리(`features/itinerary/ui`·`src/pages`)에 자동 편입(AC-9).
 *  - G2: 진행 판정 **단일 출처**(AC-6·AC-9) — `coPickProgress` 를 화면(CoPickHubScreen)이 아니라
 *        배선(CoPickHubPage)이 부른다. 화면이 카운트를 재계산하면 red.
 *  - G3: `pages/itinerary-copick` 재귀에 디버그 프로브(`console.log(`·`PROBE_`) 0건
 *        (OptionSwapPage 잔존 프로브 복사 방지, 브리프 §3-주의3).
 *  - G4: 배럴이 3 Page 를 재수출.
 *
 * **detector 를 복제하지 않는다** — INV-3 소요시간 표기 0건·zustand·URL·타이머·raw hex 는
 * `itineraryTimeStructure.test.ts`(ui 재귀)·`pagesLayerStructure.test.ts`(pages 재귀)가 이미 갖고
 * 있고, G1 이 그 재귀에 새 파일이 도달함을 확인한다. h17 "검증 시각 렌더 0"은 소스 스캔으로 표현
 * 불가(고정 블록이 startAt 을 정당하게 쓴다) → 렌더 층(CoPickCompleteScreen/Page 테스트)이 잠근다.
 *
 * **전제 — 모든 스캔은 주석을 걷어낸 소스를 본다**(`stripComments`, 동결 가드와 같은 규칙).
 * **가짜 통과 방지**: 모든 "없어야 한다"는 같은 it 안의 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const UI_DIR_REL = 'features/itinerary/ui';
const MODEL_DIR_REL = 'features/itinerary/model';
const PAGES_DIR_REL = 'pages';
const COPICK_PAGES_DIR_REL = 'pages/itinerary-copick';

const MODEL_FILES = [
  'features/itinerary/model/coPickProgress.ts',
  'features/itinerary/model/radiusUsedLabel.ts',
];
const SCREEN_FILES = [
  'features/itinerary/ui/ConceptPickerScreen.tsx',
  'features/itinerary/ui/SlotFillScreen.tsx',
  'features/itinerary/ui/CoPickHubScreen.tsx',
  'features/itinerary/ui/CoPickCompleteScreen.tsx',
];
const PAGE_FILES = [
  'pages/itinerary-copick/ui/SlotFillPage.tsx',
  'pages/itinerary-copick/ui/CoPickHubPage.tsx',
  'pages/itinerary-copick/ui/CoPickCompletePage.tsx',
];
const BARREL_REL = 'pages/itinerary-copick/index.ts';

const HUB_SCREEN_REL = 'features/itinerary/ui/CoPickHubScreen.tsx';
const HUB_PAGE_REL = 'pages/itinerary-copick/ui/CoPickHubPage.tsx';

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

    // ① 주석 속 프로브 문구는 걷힌다(안 걷으면 아래 G3 부정 단언이 통과 불가).
    expect(stripped).not.toContain('console.log(');
    expect(stripped).not.toContain('PROBE_');
    // ② 코드·URL 은 살아남는다(콜론 예외로 URL 이 안 잘린다).
    expect(stripped).toContain("const real = 'kept';");
    expect(/https?:\/\//.test(stripped)).toBe(true);
  });
});

describe('🔴 G1 · 신규 파일 실재 + 재귀 가드 자동 편입(AC-9)', () => {
  it('model 2·화면 4·페이지 3·배럴 1 이 실재하고 재귀 모집단에 잡힌다', () => {
    // 경로 실재 — 프로덕션 파일이라 구현 전 전부 RED.
    [...MODEL_FILES, ...SCREEN_FILES, ...PAGE_FILES, BARREL_REL].forEach(
      (rel) => expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    // 재귀 도달 — 새 화면이 itineraryTimeStructure(ui 재귀), 새 페이지가
    // pagesLayerStructure(pages 재귀) 의 사정거리에 실제로 들어온다(AC-9 자동 편입).
    const uiFiles = scan(UI_DIR_REL).map((s) => s.file);
    const modelFiles = scan(MODEL_DIR_REL).map((s) => s.file);
    const pageFiles = scan(PAGES_DIR_REL).map((s) => s.file);
    SCREEN_FILES.forEach((rel) => expect(uiFiles).toContain(rel));
    MODEL_FILES.forEach((rel) => expect(modelFiles).toContain(rel));
    PAGE_FILES.forEach((rel) => expect(pageFiles).toContain(rel));
  });
});

describe('🔴 G2 · 진행 판정 단일 출처(AC-6·AC-9)', () => {
  it('coPickProgress 는 배선(CoPickHubPage)이 부르고 화면(CoPickHubScreen)은 안 부른다', () => {
    // 긍정 짝 — 배선이 실제로 산출(없으면 아래 부정 단언이 공허).
    expect(readOne(HUB_PAGE_REL)).toContain('coPickProgress');
    // 부정 — 화면이 카운트를 재계산하면(재판정) red.
    expect(readOne(HUB_SCREEN_REL)).not.toContain('coPickProgress');
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

describe('🔴 G4 · 배럴 두께', () => {
  it('배럴이 3 Page 를 재수출한다', () => {
    expect(existsPair(BARREL_REL)).toEqual({ file: BARREL_REL, exists: true });
    const barrel = readOne(BARREL_REL);
    expect(barrel).toContain('SlotFillPage');
    expect(barrel).toContain('CoPickHubPage');
    expect(barrel).toContain('CoPickCompletePage');
  });
});
