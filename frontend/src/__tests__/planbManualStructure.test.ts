/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-443 신설 → **TRIP-805 재앵커**. i15·i22 수동 편집 **소스 층 가드**(INV-3 · 편입 앵커 · 경계).
 *
 * TRIP-805 이동으로 경로가 옮겨졌다(내용 계약은 무변경, 앵커 경로만 재조준 — 개념 [[선재 가드 재조준]]):
 *  - `shared/itinerary-edit/**` → `widgets/itinerary-edit/**`(shared→widgets 승격, 배럴 유지)
 *  - `features/planb/ui/ManualEditScreen.tsx` → `pages/planb-manual/ui/ManualEditScreen.tsx`
 *  - `ManualTimeSheet` 삭제 → 공용 `widgets/time-sheet/ui/TimeSheet.tsx` 로 흡수
 *
 * 무엇을 보장하나:
 *  - G1 detector 자가검사(★조합 실검증) — stripComments × DURATION_TEXT 가 서로를 안 지운다.
 *  - G2 편입 앵커 — 새 정본 경로 파일이 실재하고, ManualEditScreen 이 `pages/planb-manual` 재귀
 *    모집단(=`pagesLayerStructure` 사정거리)에 든다(INV-3 자동 편입 소재가 features→pages 로 이동).
 *  - G3 INV-3 — 공용 편집 위젯 소스(`widgets/itinerary-edit/**` + `widgets/time-sheet/**`)에 소요시간
 *    표기 0건. ★ widgets 는 `executionDurationStructure`·`itineraryTimeStructure` 사각이라 이 파일이
 *    유일 그물(gap-filler — 옛 shared 그물이 widgets 로 이동).
 *  - G4 경계 — planb 화면·페이지가 `@/features/itinerary` 를 직접 import 하지 않고 공용 위젯을 쓴다
 *    (★ 하드 경계에서 "위젯을 쓰지 features/itinerary 직참 안 함" 관례 앵커로 성격 이동 — 02a ★5:
 *    ManualEditScreen 이 pages 로 가며 pages→features 는 층 규칙상 허용이라 하드 금지가 아니게 됨).
 *
 * **detector 를 복제하지 않는다** — 편입 앵커 + 신규 파일 한정 clean 재스캔만 둔다.
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다. **가짜 통과 방지**: "없어야 한다"는 같은 it 안 "있어야 한다"와 짝.
 */

const ROOT = path.resolve('src');

// 이동 후 정본 경로(TRIP-805). ManualTimeSheet 는 TimeSheet 위젯에 흡수돼 목록에서 빠진다.
const NEW_FILES = [
  'widgets/itinerary-edit/model/mergeValidationFlags.ts',
  'widgets/itinerary-edit/model/reorderKeepingFixed.ts',
  'widgets/itinerary-edit/ui/ManualEditShell.tsx',
  'widgets/itinerary-edit/index.ts',
  'widgets/time-sheet/ui/TimeSheet.tsx',
  'pages/planb-manual/ui/ManualEditScreen.tsx',
  'pages/planb-manual/ui/PlanbManualPage.tsx',
  'pages/planb-manual/index.ts',
  'app/trips/[tripId]/planb/manual.tsx',
];

const SCREEN_REL = 'pages/planb-manual/ui/ManualEditScreen.tsx';
const PAGE_REL = 'pages/planb-manual/ui/PlanbManualPage.tsx';
const SHELL_REL = 'widgets/itinerary-edit/ui/ManualEditShell.tsx';
const TIMESHEET_REL = 'widgets/time-sheet/ui/TimeSheet.tsx';
const PLANB_MANUAL_UI_DIR_REL = 'pages/planb-manual/ui';
// INV-3 gap-filler 모집단 — widgets 는 execution/itinerary 재귀 스캔 밖이라 여기가 유일 그물.
const WIDGET_EDIT_UI_DIR_REL = 'widgets/itinerary-edit/ui';
const WIDGET_EDIT_MODEL_DIR_REL = 'widgets/itinerary-edit/model';
const WIDGET_TIME_UI_DIR_REL = 'widgets/time-sheet/ui';

/** 소요시간 **표기** 탐지기. `HH:mm`(09:30)은 숫자 뒤가 `:` 라 안 걸리고, 숫자 없는 "이동시간"도 안 걸린다.
 * '시각'(U+AC01)≠'시간'(U+AC04). */
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

describe('🔴 G2 · 편입 앵커 — 새 정본 경로 실재 + ManualEditScreen 이 pages 재귀 사정거리에 든다', () => {
  it('이동 후 9파일이 실재하고, ManualEditScreen 이 pages/planb-manual 재귀 모집단에 든다', () => {
    NEW_FILES.forEach((rel) =>
      expect({
        file: rel,
        exists: fs.existsSync(path.join(ROOT, rel)),
      }).toEqual({
        file: rel,
        exists: true,
      })
    );

    // INV-3 자동 편입 소재 이동 — ManualEditScreen 이 pagesLayerStructure 의 pages 재귀에 잡힌다
    // (features/planb 재귀에서 빠지는 대신 pages 재귀로 편입, 개념 [[선재 가드 재조준]]).
    expect(scanDir(PLANB_MANUAL_UI_DIR_REL).map((s) => s.file)).toContain(
      SCREEN_REL
    );
  });
});

describe('🔴 G3 · INV-3 — 공용 편집 위젯 소스에 소요시간 표기 0건 (gap-filler)', () => {
  it('widgets/itinerary-edit(ui·model) + widgets/time-sheet(ui) 소스에 분·시간·소요가 없다', () => {
    // widgets 는 executionDurationStructure·itineraryTimeStructure 사각 — 여기서 직접 스캔(gap-filler).
    const sources = [
      ...scanDir(WIDGET_EDIT_UI_DIR_REL),
      ...scanDir(WIDGET_EDIT_MODEL_DIR_REL),
      ...scanDir(WIDGET_TIME_UI_DIR_REL),
    ];

    // 긍정 앵커 — 모집단이 비어 있지 않고 셸·시트가 그 안에 있다(공허 통과 방지).
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain(SHELL_REL);
    expect(sources.map((s) => s.file)).toContain(TIMESHEET_REL);

    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G4 · 경계 — planb 는 features/itinerary 직참 없이 공용 위젯을 쓴다', () => {
  it('화면·페이지에 @/features/itinerary 0건이고, 화면은 @/widgets/itinerary-edit 를 문다', () => {
    const screen = readOne(SCREEN_REL);
    const page = readOne(PAGE_REL);

    // 부정 — planb 는 U3(features/itinerary) 편집 기계를 직접 안 끈다(공용 위젯이 유일 다리, 02a ★5).
    expect(screen).not.toContain('@/features/itinerary');
    expect(page).not.toContain('@/features/itinerary');

    // 긍정 짝(🔴 red-first) — 화면이 실제로 공용 셸 위젯을 소비한다(구현 후 green).
    expect(screen).toContain('@/widgets/itinerary-edit');
  });
});
