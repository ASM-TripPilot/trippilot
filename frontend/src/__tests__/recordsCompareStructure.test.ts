/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-570 · j02 기록 비교 — 슬라이스 소스 층 가드
 * (`recordsStructure.test.ts` G1~G6 · `recordsDurationStructure.test.ts` 미러·연장).
 *
 * 무엇을 보장하나:
 *  - **G0 자가검사(★ 전처리×탐지기 조합)**: `stripComments` × {DURATION_TEXT, MUTATION_SYMBOL,
 *    FEATURE_IMPORT} 가 서로를 안 지운다 — 주석 속 금칙어는 걷히고, 코드 속 진짜는 살아 검출되며,
 *    `://`·`14:30`·읽기 허용 `useGetTripsTripIdRecords` 는 살아남되 오검출되지 않는다.
 *  - **G1 편입 앵커**: 신규 8파일이 정본 경로에 실재.
 *  - **G2 3층 책임**: 라우트→페이지→화면/모델 이 각자 몫만 진다.
 *  - **G3 testID 2종**: record-compare-segment(세그)·record-compare-row(행) 실재.
 *  - **G4 ★AC-5 읽기전용**: compare 5파일에 mutation 훅·customInstance·axios 0(G5 그물 연장).
 *  - **G5 ★AC-6 INV-3(model)**: compare **model**(compareRows·useCompareRecords)에 소요시간 문자열 0.
 *  - **G6 AC-7 순수함수**: compareRows.ts 에 쿼리 훅·react·라우터·타 feature import 0.
 *
 * 위임(중복 신설 안 함, ponytail lite / `reflectionSummaryStructure` 선례):
 *  - features 경계(record→reflection/execution import 0)·`features/record/ui` 재귀 INV-3·재귀
 *    customInstance/axios 는 선재 `recordsStructure`(G2·G5·G6)·`recordsDurationStructure`(G2)가
 *    신규 compare 파일을 **재귀 자동 편입**해 이중 방어(개념 [[소스 스캔 가드의 폴더 전수와 자동 편입]]).
 *  - 이 파일은 compare 전용 신규 사각만 명시: ①읽기전용 mutation-훅(선재 G5는 customInstance/axios
 *    만 봐 mutation 훅 import 를 못 잡는다 — useVisitCheck 가 그걸 써서 record 전수 스캔 불가) ②model
 *    INV-3(선재 스캔은 `/ui` 만 훑어 model 은 사정거리 밖) ③compareRows 순수성 ④3층 ⑤testID.
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론 예외로 URL·경로 보존).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const NEW_FILES = [
  'features/record/model/compareRows.ts',
  'features/record/model/useCompareRecords.ts',
  'features/record/ui/RecordsCompareScreen.tsx',
  'features/record/ui/CompareSegment.tsx',
  'features/record/ui/CompareRow.tsx',
  'pages/records-compare/index.ts',
  'pages/records-compare/ui/RecordsComparePage.tsx',
  'app/trips/[tripId]/records/compare.tsx',
];

const ROWS_REL = 'features/record/model/compareRows.ts';
const HOOK_REL = 'features/record/model/useCompareRecords.ts';
const SEGMENT_REL = 'features/record/ui/CompareSegment.tsx';
const ROW_REL = 'features/record/ui/CompareRow.tsx';
const ROUTE_REL = 'app/trips/[tripId]/records/compare.tsx';
const PAGE_REL = 'pages/records-compare/ui/RecordsComparePage.tsx';

/** compare 전용 스캔 대상(읽기전용 G4). useVisitCheck 등 record 의 mutation 훅은 여기 없다. */
const COMPARE_SOURCES = [
  ROWS_REL,
  HOOK_REL,
  ROUTE_REL,
  PAGE_REL,
  SEGMENT_REL,
  ROW_REL,
];

/** 소요시간 표기 탐지기(INV-3) — `HH:mm`(14:30)은 숫자 뒤가 `:` 라 안 걸린다. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;
/** 다른 feature 를 가리키는 import(자기 record 는 상대경로라 여기 안 걸린다). */
const FEATURE_IMPORT = /@\/features\/([a-z][a-z-]*)/g;
/** 쓰기(mutation) 훅 탐지기 — 읽기 `useGet*`/`useQuery`는 안 걸린다(읽기 화면이라 GET 은 허용). */
const MUTATION_SYMBOL =
  /\b(usePost|usePut|usePatch|useDelete|useMutation)[A-Za-z]*/;

/** 콜론(:) 뒤 // 는 주석으로 보지 않는다 — URL·경로의 `//` 를 스캔 전에 안 지우기 위함. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사 — stripComments × {DURATION_TEXT, MUTATION_SYMBOL, FEATURE_IMPORT}', () => {
  it('주석 속 금칙어는 걷히고, 코드·URL·시각·읽기훅은 살아남되 오검출/미검출을 안 낸다', () => {
    const sample = [
      '/**',
      ' * 소요시간 30분·usePostTripsTripIdVisits·@/features/execution 을 산문으로 적어도 걷힌다.',
      ' * 참조: https://figma.com/design/x',
      ' */',
      "const url = 'https://map.kakao.com/x'; // 15분",
      "const chip = '14:30 방문';",
      "import { useGetTripsTripIdRecords } from '@/shared/api/generated/trips/trips';",
      "import { deriveVisitProgress } from '@/features/execution/model/visitProgress';",
      'const mut = usePostTripsTripIdVisits();',
    ].join('\n');

    const stripped = stripComments(sample);
    const firstCommentLine = stripped.split('\n')[1] ?? '';

    // ① 산문 금칙어(소요시간·mutation 심볼·타 feature)는 주석에서 걷힌다.
    expect(DURATION_TEXT.test(firstCommentLine)).toBe(false);
    expect(MUTATION_SYMBOL.test(firstCommentLine)).toBe(false);
    // ② URL 의 // 는 주석으로 오인되지 않아 그 줄이 살아남는다(콜론 예외).
    expect(stripped).toContain("const url = 'https://map.kakao.com/x';");
    // ③ HH:mm 시각은 소요시간으로 안 걸린다(숫자 뒤가 `:`).
    expect(DURATION_TEXT.test("const chip = '14:30 방문';")).toBe(false);
    // ④ ★읽기 허용 GET 훅은 살아남되 MUTATION_SYMBOL 에 안 걸린다(읽기 오탐 방지의 핵심).
    expect(stripped).toContain('useGetTripsTripIdRecords');
    expect(MUTATION_SYMBOL.test('const q = useGetTripsTripIdRecords();')).toBe(
      false
    );
    // ⑤ 코드에 실재하는 진짜 금칙(타 feature·mutation·소요시간)은 살아 검출된다(전처리가 다 지우면 공허).
    expect(
      [...stripped.matchAll(FEATURE_IMPORT)].some((m) => m[1] === 'execution')
    ).toBe(true);
    expect(
      MUTATION_SYMBOL.test('const mut = usePostTripsTripIdVisits();')
    ).toBe(true);
    expect(DURATION_TEXT.test('const t = "15분";')).toBe(true);
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

describe('🔴 G2 · 3층 책임 — 라우트→페이지→화면/모델', () => {
  it('라우트는 페이지에 위임하고 feature·조회를 직접 모른다', () => {
    const route = readOne(ROUTE_REL);
    // 긍정 — 페이지로 위임.
    expect(route).toContain('@/pages/records-compare');
    // 부정 — 라우트가 feature·조회훅을 직접 물지 않는다.
    expect(route).not.toContain('@/features/record');
    expect(route).not.toContain('useGetTripsTripIdRecords');
  });

  it('페이지가 조회훅·조립함수·화면을 물어 배선한다', () => {
    const page = readOne(PAGE_REL);
    expect(page).toContain('@/features/record');
    expect(page).toContain('useCompareRecords');
    expect(page).toContain('buildCompareRows');
    expect(page).toContain('RecordsCompareScreen');
  });
});

describe('🔴 G3 · testID 2종이 compare 표면에 실재한다', () => {
  it('record-compare-segment(세그) · record-compare-row(행)', () => {
    // 긍정 앵커 — 각 testID 를 소유하는 파일이 실제로 그 문자열을 갖는다(빈 파일 공허 통과 차단).
    expect(readOne(SEGMENT_REL)).toContain('record-compare-segment');
    expect(readOne(ROW_REL)).toContain('record-compare-row');
  });
});

describe('🔴 G4 · ★AC-5 읽기전용 — compare 소스에 mutation 훅·customInstance·axios 0', () => {
  it('compare 5파일에 쓰기 심볼 0건 + useCompareRecords 가 GET 훅을 재사용한다(긍정 짝)', () => {
    const offenders = COMPARE_SOURCES.filter((rel) => {
      const src = readOne(rel);
      return (
        MUTATION_SYMBOL.test(src) ||
        src.includes('customInstance') ||
        /from ['"]axios['"]/.test(src)
      );
    });
    // 부정 — 어떤 compare 파일도 쓰기 경로를 새로 열지 않는다(변경 이력은 읽기만, BR-U5-29).
    expect(offenders).toEqual([]);

    // 긍정 짝(🔴 red-first) — 조회 훅이 생성 GET 훅을 실제로 감싼다(읽기 경로 실재 증거).
    expect(readOne(HOOK_REL)).toContain('useGetTripsTripIdRecords');
  });
});

describe('🔴 G5 · ★AC-6 INV-3(model) — compare 모델에 소요시간 문자열 0', () => {
  it('compareRows·useCompareRecords 에 분·시간·소요 표기 0건 + buildCompareRows export 앵커', () => {
    const modelFiles = [ROWS_REL, HOOK_REL];
    const offenders = modelFiles.filter((rel) =>
      DURATION_TEXT.test(readOne(rel))
    );
    // 부정 — model 소요시간 문자열 0건(선재 가드는 /ui 만 봐 model 은 이 파일이 유일 그물).
    expect(offenders).toEqual([]);
    // 긍정 앵커 — 모집단이 실제로 채워졌다(compareRows 가 조립 함수를 export).
    expect(readOne(ROWS_REL)).toContain('export function buildCompareRows');
  });
});

describe('🔴 G6 · AC-7 순수함수 — compareRows.ts 는 쿼리 훅·react·라우터·타 feature import 0', () => {
  it('compareRows 에 부수효과 import 0건 + buildCompareRows 정의 앵커', () => {
    const src = readOne(ROWS_REL);
    // 부정 — 순수 조립 함수라 조회·렌더·항법을 모른다.
    expect(src).not.toMatch(/\buseGet[A-Za-z]/);
    expect(src).not.toMatch(/\buseQuery\b/);
    expect(src).not.toMatch(/from ['"]react['"]/);
    expect(src).not.toContain('expo-router');
    expect([...src.matchAll(FEATURE_IMPORT)].length).toBe(0);
    // 긍정 짝 — 조립 함수가 실재한다(빈 파일 공허 통과 차단).
    expect(src).toContain('export function buildCompareRows');
  });
});
