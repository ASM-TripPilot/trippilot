/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-572 · j04 여행 요약 — trip-summary 슬라이스 소스 층 가드
 * (`reflectionStructure.test.ts` G0~G6 미러, 요약 슬라이스에 초점).
 *
 * 무엇을 보장하나:
 *  - **G0 자가검사**: stripComments × DURATION_TEXT 조합이 서로를 지우지 않는다(콜론예외로 URL 보존).
 *  - **G1 편입 앵커**: 신규 8파일이 정본 경로에 실재한다.
 *  - **G3 3층 책임**: 라우트→페이지→화면이 각자 몫만 진다.
 *  - **G4 testID 2종**: reflection-summary-stats(화면)·reflection-summary-day-card(카드) 실재.
 *  - **AC-4 · INV-3**: 요약 화면 표면(TripSummaryScreen·DayHighlightCard)에 소요시간 문자열 0(거리만).
 *    **예외 화이트리스트 없음** — j04 `TripSummary` DTO 에 avgDwellMinutes 부재.
 *
 * ★ 위임(중복 신설 안 함, ponytail lite): **경계(record 등 타 feature import 0)**·**새 HTTP 함수 0**·
 *   **features/reflection/ui 재귀 INV-3** 는 선재 `reflectionStructure.test.ts`(G2·G5·G6)가
 *   `features/reflection/**` 를 재귀 스캔해 신규 요약 파일을 **자동 편입**한다(개념 [[소스 스캔 가드의
 *   폴더 전수와 자동 편입]]). 이 파일의 INV-3(G6′)는 요약 표면 전용 **명시적 홈**(recordsDurationStructure
 *   가 recordsStructure G6 을 겹쳐 둔 선례 동형 — 둘 다 실 "30분"에 red, 사각은 렌더 층이 메움).
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론예외로 URL·경로 보존).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const NEW_FILES = [
  'features/reflection/model/useTripSummary.ts',
  'features/reflection/model/summaryStats.ts',
  'features/reflection/model/summaryView.ts',
  'features/reflection/ui/TripSummaryScreen.tsx',
  'features/reflection/ui/DayHighlightCard.tsx',
  'pages/trip-summary/index.ts',
  'pages/trip-summary/ui/TripSummaryPage.tsx',
  'app/trips/[tripId]/records/summary.tsx',
];

const SCREEN_REL = 'features/reflection/ui/TripSummaryScreen.tsx';
const CARD_REL = 'features/reflection/ui/DayHighlightCard.tsx';
const HOOK_REL = 'features/reflection/model/useTripSummary.ts';
const ROUTE_REL = 'app/trips/[tripId]/records/summary.tsx';
const PAGE_REL = 'pages/trip-summary/ui/TripSummaryPage.tsx';
const REFLECTION_UI_DIR_REL = 'features/reflection/ui';

/** 소요시간 표기 탐지기(INV-3) — `HH:mm`(14:30)은 숫자 뒤가 `:` 라 안 걸린다. */
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

describe('G0 · 탐지기 자가검사 — stripComments × DURATION_TEXT 조합', () => {
  it('주석 속 소요시간은 걷히고, URL·시각·거리는 살아남되 안 걸리고, 진짜 표기는 잡힌다', () => {
    const sample = [
      '// INV-3 · 소요시간 30분 비표기(수호 주석).',
      "const chip = '14:30';",
      "const dist = '840m';",
      "const url = 'https://map.kakao.com/x';",
    ].join('\n');
    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다(부정 단언을 거짓 red 로 만들지 않는다).
    expect(stripped).not.toContain('소요');
    expect(stripped).not.toContain('30분');
    expect(DURATION_TEXT.test(stripped)).toBe(false);

    // ② URL(://)은 콜론 예외로 살아남는다(전처리가 지우지 않는다).
    expect(stripped).toContain("const url = 'https://map.kakao.com/x';");
    // ③ 시각칩·거리는 살아남되 탐지기에 안 걸린다(오검출 아님).
    expect(stripped).toContain("const chip = '14:30';");
    expect(stripped).toContain("const dist = '840m';");

    // ④ 짝 — 진짜 소요시간 표기는 검출(우회 불가), 시각/거리는 미검출.
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
    expect(DURATION_TEXT.test('소요 2시간')).toBe(true);
    expect(DURATION_TEXT.test('14:30')).toBe(false);
    expect(DURATION_TEXT.test('840m')).toBe(false);
  });
});

describe('G1 · 편입 앵커 — 신규 8파일이 정본 경로에 실재한다', () => {
  it.each(NEW_FILES)('%s 가 존재한다', (rel) => {
    expect({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
      file: rel,
      exists: true,
    });
  });
});

describe('🔴 G3 · 3층 책임 — 라우트→페이지→화면', () => {
  it('라우트는 페이지에 위임하고 feature·조회를 직접 모른다', () => {
    const route = readOne(ROUTE_REL);
    // 긍정 — 페이지로 위임.
    expect(route).toContain('@/pages/trip-summary');
    // 부정 — 라우트가 feature·조회훅을 직접 물지 않는다.
    expect(route).not.toContain('@/features/reflection');
    expect(route).not.toContain('useGetTripsTripIdSummary');
  });

  it('페이지가 화면·조회훅을 물어 배선한다', () => {
    const page = readOne(PAGE_REL);
    expect(page).toContain('@/features/reflection');
    expect(page).toContain('useTripSummary');
    expect(page).toContain('TripSummaryScreen');
  });
});

describe('🔴 G4 · testID 2종이 요약 표면에 실재한다', () => {
  it('reflection-summary-stats(화면) · reflection-summary-day-card(카드)', () => {
    // 긍정 앵커 — 각 testID 를 소유하는 파일이 실제로 그 문자열을 갖는다(빈 파일 공허 통과 차단).
    expect(readOne(SCREEN_REL)).toContain('reflection-summary-stats');
    expect(readOne(CARD_REL)).toContain('reflection-summary-day-card');
  });
});

describe('🔴 G5 · ★새 HTTP 함수 금지 — 요약 조회는 재사용만', () => {
  it('useTripSummary 가 생성 훅 useGetTripsTripIdSummary 를 재사용한다(새 함수 금지 증거)', () => {
    const hook = readOne(HOOK_REL);
    // 부정 — raw HTTP 를 새로 만들지 않는다.
    expect(hook).not.toContain('customInstance');
    expect(hook).not.toMatch(/from ['"]axios['"]/);
    // 긍정 짝 — 재사용 훅을 실제로 문다.
    expect(hook).toContain('useGetTripsTripIdSummary');
  });
});

describe('🔴 AC-4 · INV-3 — 요약 화면 표면에 소요시간 표기 0(거리만)', () => {
  it('features/reflection/ui 재귀 스캔에 소요시간 0건 + 요약 화면 편입 앵커', () => {
    const sources = scanDir(REFLECTION_UI_DIR_REL);

    // 긍정 앵커 — 모집단에 이 티켓의 신규 화면·카드가 실제로 들어와 있다(구현 전 red).
    expect(sources.map((s) => s.file)).toContain(SCREEN_REL);
    expect(sources.map((s) => s.file)).toContain(CARD_REL);

    // 부정 — 소요시간 문자열 0건(avgDwellMinutes 예외 없음, j04 DTO 부재).
    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
