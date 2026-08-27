/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-443 · i15·i22 수동 편집 **소스 층 가드**(AC-6 INV-3 · 편입 앵커 · features 경계).
 *
 * 무엇을 보장하나:
 *  - G1 detector 자가검사(★조합 실검증) — stripComments × DURATION_TEXT 가 서로를 안 지운다.
 *  - G2 편입 앵커 — 신규 8파일이 정본 경로에 실재하고, `ManualEditScreen.tsx` 가
 *    `features/planb/ui` 재귀 모집단(=`executionDurationStructure` 사정거리)에 든다(AC-6 자동 편입).
 *  - G3 INV-3 — 신규 화면·셸·순수함수 소스에 소요시간 표기 0건. ★`shared/itinerary-edit/**` 는
 *    `executionDurationStructure` 사각이라 이 파일이 유일 그물(gap-filler).
 *  - G4 features 경계 — planb 화면·페이지가 `@/features/itinerary` 를 직접 import 하지 않는다
 *    (eslint FEATURES 배열에 planb 없어 lint 강제 없음, 소스 스캔이 대신 잠금) + shared 셸 소비 긍정 짝.
 *
 * **detector 를 복제하지 않는다** — `executionDurationStructure`·`itineraryEditStructure` 선례처럼
 * (a) 편입 앵커 (b) 신규 파일 한정 clean 재스캔만 둔다. **전제**: 모든 스캔은 주석을 걷은 소스를 본다.
 * **가짜 통과 방지**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const NEW_FILES = [
  'shared/itinerary-edit/model/mergeValidationFlags.ts',
  'shared/itinerary-edit/model/reorderKeepingFixed.ts',
  'shared/itinerary-edit/ui/ManualEditShell.tsx',
  'shared/itinerary-edit/index.ts',
  'features/planb/ui/ManualEditScreen.tsx',
  'pages/planb-manual/ui/PlanbManualPage.tsx',
  'pages/planb-manual/index.ts',
  'app/trips/[tripId]/planb/manual.tsx',
];

const SCREEN_REL = 'features/planb/ui/ManualEditScreen.tsx';
const PAGE_REL = 'pages/planb-manual/ui/PlanbManualPage.tsx';
const PLANB_UI_DIR_REL = 'features/planb/ui';
const SHARED_UI_DIR_REL = 'shared/itinerary-edit/ui';
const SHARED_MODEL_DIR_REL = 'shared/itinerary-edit/model';

/** 소요시간 **표기** 탐지기(동결 가드 DURATION_TEXT 와 같은 것). `HH:mm`(09:30)은 숫자 뒤가 `:` 라
 * 안 걸리고, 숫자 없는 "이동시간"("이동시간 미상")도 안 걸린다. '시각'(U+AC01)≠'시간'(U+AC04). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

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
      if (/Glyphs\.tsx$/.test(entry.name)) return [];
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

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 먼저 막는다(리포 규약). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G1 · detector 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 소요시간은 걷히고, 시각칩·URL·"이동시간 미상" 은 살아남되 안 걸린다', () => {
    // ★ 조합 검증 — 전처리와 탐지기가 서로를 지우는지 실제 문자열로 본다(2026-07-31 URL 사고 계열).
    const sample = [
      '// INV-3 · 소요시간(30분) 표기 금지 — 수호 주석.',
      "const chip = '13:00–14:30';",
      "const note = '이동시간 미상';",
      "const guide = '이동시간 직접 입력 (자동 계산 불가)';",
      "const thumb = 'https://cdn.example.com/p.jpg';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다.
    expect(stripped).not.toContain('소요');
    expect(stripped).not.toContain('30분');

    // ② ★ 코드의 시각칩·"이동시간" 어휘는 살아남고 탐지기에 **안 걸린다**(숫자 없는 "이동시간"은 안전).
    expect(stripped).toContain("const chip = '13:00–14:30';");
    expect(stripped).toContain("const note = '이동시간 미상';");
    expect(stripped).toContain(
      "const guide = '이동시간 직접 입력 (자동 계산 불가)';"
    );
    expect(DURATION_TEXT.test(stripped)).toBe(false);

    // ③ 순진한 `//.*` 제거는 URL 을 자른다 — 콜론 예외로 산다.
    expect(stripped).toContain(
      "const thumb = 'https://cdn.example.com/p.jpg';"
    );
    expect(/https?:\/\//.test(stripped)).toBe(true);

    // ④ 짝 — 진짜 소요시간은 검출.
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
    expect(DURATION_TEXT.test('소요 2시간')).toBe(true);
    expect(DURATION_TEXT.test('시각 조정')).toBe(false);
  });
});

describe('G2 · 편입 앵커 — 신규 파일이 정본 경로 + 재귀 사정거리에 실재한다', () => {
  it('신규 8파일이 실재하고, ManualEditScreen 이 features/planb/ui 재귀 모집단에 든다', () => {
    NEW_FILES.forEach((rel) =>
      expect({
        file: rel,
        exists: fs.existsSync(path.join(ROOT, rel)),
      }).toEqual({
        file: rel,
        exists: true,
      })
    );

    // AC-6 자동 편입 — ManualEditScreen 이 executionDurationStructure 의 features/planb/ui 재귀에 잡힌다.
    expect(scanDir(PLANB_UI_DIR_REL).map((s) => s.file)).toContain(SCREEN_REL);
  });
});

describe('G3 · INV-3 — 신규 화면·셸·순수함수에 소요시간 표기 0건', () => {
  it('features/planb/ui + shared/itinerary-edit(ui·model) 소스에 분·시간·소요가 없다', () => {
    // shared 는 executionDurationStructure 사각 — 여기서 직접 스캔(gap-filler).
    const sources = [
      ...scanDir(PLANB_UI_DIR_REL),
      ...scanDir(SHARED_UI_DIR_REL),
      ...scanDir(SHARED_MODEL_DIR_REL),
    ];

    // 긍정 앵커 — 모집단이 비어 있지 않고 새 파일이 그 안에 있다.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain(SCREEN_REL);
    expect(sources.map((s) => s.file)).toContain(
      'shared/itinerary-edit/ui/ManualEditShell.tsx'
    );

    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G4 · features 경계 — planb 는 features/itinerary 를 직접 import 하지 않는다', () => {
  it('화면·페이지에 @/features/itinerary 0건이고, 화면은 @/shared/itinerary-edit 를 문다', () => {
    const screen = readOne(SCREEN_REL);
    const page = readOne(PAGE_REL);

    // 부정 — planb 는 U3 를 직접 못 끈다(shared 셸이 유일 다리).
    expect(screen).not.toContain('@/features/itinerary');
    expect(page).not.toContain('@/features/itinerary');

    // 긍정 짝(🔴 red-first) — 화면이 실제로 공용 셸을 소비한다(스텁은 아직 미import → 구현 후 green).
    expect(screen).toContain('@/shared/itinerary-edit');
  });
});
