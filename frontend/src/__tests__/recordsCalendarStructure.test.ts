/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-575 · j07 여행 캘린더(기록 탭 허브) — 슬라이스 소스 층 가드
 * (`recordsCompareStructure.test.ts` 미러·연장).
 *
 * 무엇을 보장하나:
 *  - **G0 자가검사(★ 전처리×탐지기 조합)**: `stripComments` × {DURATION_TEXT, MUTATION_SYMBOL,
 *    FEATURE_IMPORT} 가 서로를 안 지운다 — 주석 속 금칙어는 걷히고, 코드 속 진짜는 살아 검출되며,
 *    `://`·`14:30`·읽기 허용 `useGetTrips` 는 살아남되 오검출되지 않는다.
 *  - **G1 편입 앵커**: 신규 9파일이 정본 경로에 실재(셸 교체 대상 records.tsx 포함).
 *  - **G2 3층 책임 + ★셸 교체**: 라우트→페이지→화면 배선 + `(tabs)/records.tsx` 가 placeholder
 *    (`shell-tab-placeholder-records`)를 버리고 `@/pages/records-calendar` 로 위임한다.
 *  - **G3 testID 2종**: record-calendar-month(월)·record-calendar-past-trip(카드) 실재.
 *  - **G4 ★경계(맹점②)**: 신규 record 파일에 `@/features/stay`·`@/features/trip` import 0
 *    (월 그리드를 stay/trip 두 벌에서 직접 안 가져오고 `@/shared/date` 경유) + monthGrid 순수.
 *  - **G5 ★읽기전용(INV-U5)**: useRecordsCalendar·페이지·모델에 mutation 훅·customInstance·axios 0.
 *  - **G6 INV-3(gap-filler)**: recordsCalendar·monthGrid 에 소요시간 문자열 0
 *    (`shared/date/monthGrid` 는 선재 recordsStructure/recordsDuration 스캔 밖이라 이 파일이 유일 그물).
 *  - **G7 recordsCalendar 순수**: 쿼리 훅·react·라우터·타 feature import 0.
 *
 * 위임(중복 신설 안 함, ponytail lite / `recordsCompareStructure` 선례):
 *  - features 경계(record→reflection/execution/stay/trip import 0)·`features/record/ui` 재귀 INV-3·
 *    재귀 customInstance/axios 는 선재 `recordsStructure`(G2·G5·G6)·`recordsDurationStructure`(G2)가
 *    신규 record ui 파일을 **재귀 자동 편입**해 이중 방어(개념 [[소스 스캔 가드의 폴더 전수와 자동 편입]]).
 *  - 이 파일은 j07 전용 신규 사각만 명시: ①shared/date 신설·monthGrid 순수 ②맹점② stay/trip 우회
 *    금지 ③읽기전용 훅 ④shared/date INV-3(선재 스캔 밖) ⑤3층+셸교체 ⑥testID.
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론 예외로 URL·경로 보존).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const NEW_FILES = [
  'shared/date/monthGrid.ts',
  'features/record/model/recordsCalendar.ts',
  'features/record/model/useRecordsCalendar.ts',
  'features/record/ui/RecordsCalendarScreen.tsx',
  'features/record/ui/TripCalendarMonth.tsx',
  'features/record/ui/PastTripList.tsx',
  'pages/records-calendar/index.ts',
  'pages/records-calendar/ui/RecordsCalendarPage.tsx',
  'app/(tabs)/records.tsx',
];

const GRID_REL = 'shared/date/monthGrid.ts';
const MODEL_REL = 'features/record/model/recordsCalendar.ts';
const HOOK_REL = 'features/record/model/useRecordsCalendar.ts';
const SCREEN_REL = 'features/record/ui/RecordsCalendarScreen.tsx';
const MONTH_REL = 'features/record/ui/TripCalendarMonth.tsx';
const PASTLIST_REL = 'features/record/ui/PastTripList.tsx';
const ROUTE_REL = 'app/(tabs)/records.tsx';
const PAGE_REL = 'pages/records-calendar/ui/RecordsCalendarPage.tsx';

/** 신규 record 파일(경계·읽기전용·INV-3 스캔 대상). */
const RECORD_NEW = [MODEL_REL, HOOK_REL, SCREEN_REL, MONTH_REL, PASTLIST_REL];

/** 소요시간 표기 탐지기(INV-3) — `HH:mm`(14:30)은 숫자 뒤가 `:` 라 안 걸린다. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;
/** 다른 feature 를 가리키는 import(자기 record 는 상대경로라 여기 안 걸린다). */
const FEATURE_IMPORT = /@\/features\/([a-z][a-z-]*)/g;
/** 쓰기(mutation) 훅 탐지기 — 읽기 `useGet*`/`useQuery`는 안 걸린다(조회 화면이라 GET 은 허용). */
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
      "import { useGetTrips } from '@/shared/api/generated/trips/trips';",
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
    expect(stripped).toContain('useGetTrips');
    expect(MUTATION_SYMBOL.test('const q = useGetTrips();')).toBe(false);
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

describe('G1 · 편입 앵커 — 신규 9파일이 정본 경로에 실재한다', () => {
  it.each(NEW_FILES)('%s 가 존재한다', (rel) => {
    expect({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
      file: rel,
      exists: true,
    });
  });
});

describe('🔴 G2 · 3층 책임 + ★셸 교체 — 라우트→페이지→화면', () => {
  it('라우트는 페이지에 위임하고, placeholder 를 버린다(셸 교체)', () => {
    const route = readOne(ROUTE_REL);
    // 긍정 — 페이지로 위임.
    expect(route).toContain('@/pages/records-calendar');
    // 부정(셸 교체) — placeholder testID 소멸 + feature·조회훅 직접 참조 0.
    expect(route).not.toContain('shell-tab-placeholder-records');
    expect(route).not.toContain('@/features/record');
    expect(route).not.toContain('useGetTrips');
  });

  it('페이지가 조회훅·조립함수·화면을 물어 배선한다', () => {
    const page = readOne(PAGE_REL);
    expect(page).toContain('@/features/record');
    expect(page).toContain('useRecordsCalendar');
    expect(page).toContain('buildPastTripCards');
    expect(page).toContain('RecordsCalendarScreen');
  });
});

describe('🔴 G3 · testID 2종이 캘린더 표면에 실재한다', () => {
  it('record-calendar-month(월) · record-calendar-past-trip(카드)', () => {
    // 긍정 앵커 — 각 testID 를 소유하는 파일이 실제로 그 문자열을 갖는다(빈 파일 공허 통과 차단).
    expect(readOne(MONTH_REL)).toContain('record-calendar-month');
    expect(readOne(PASTLIST_REL)).toContain('record-calendar-past-trip');
  });
});

describe('🔴 G4 · ★경계(맹점②) — 월 그리드는 shared/date 경유, stay/trip 직접 import 0', () => {
  it('신규 record 파일에 @/features/stay·@/features/trip 0건 + recordsCalendar 가 @/shared/date 참조', () => {
    // 부정 — record 가 월 그리드 두 벌(stay/trip)을 직접 안 가져온다(경계 위반 방지, 세 벌째 금지).
    const offenders = RECORD_NEW.filter((rel) => {
      const src = readOne(rel);
      return src.includes('@/features/stay') || src.includes('@/features/trip');
    });
    expect(offenders).toEqual([]);

    // 긍정 짝(🔴 red-first) — 마킹 계산이 shared/date 를 실제로 문다(승격 경유 증거).
    expect(readOne(MODEL_REL)).toContain('@/shared/date');
  });

  it('monthGrid 는 순수(타 feature·react·expo-router import 0) + buildMonthGrid export 앵커', () => {
    const grid = readOne(GRID_REL);
    expect([...grid.matchAll(FEATURE_IMPORT)]).toHaveLength(0);
    expect(grid).not.toMatch(/from ['"]react['"]/);
    expect(grid).not.toContain('expo-router');
    // 긍정 앵커 — 그리드 조립 함수가 실재(빈 파일 공허 통과 차단).
    expect(grid).toContain('export function buildMonthGrid');
  });
});

describe('🔴 G5 · ★읽기전용(INV-U5) — 훅·페이지·모델에 mutation 훅·customInstance·axios 0', () => {
  it('쓰기 심볼 0건 + useRecordsCalendar 가 useGetTrips 를 재사용한다(긍정 짝)', () => {
    const scanned = [HOOK_REL, PAGE_REL, MODEL_REL];
    const offenders = scanned.filter((rel) => {
      const src = readOne(rel);
      return (
        MUTATION_SYMBOL.test(src) ||
        src.includes('customInstance') ||
        /from ['"]axios['"]/.test(src)
      );
    });
    // 부정 — 이 화면은 조회만(쓰기 경로를 새로 열지 않는다).
    expect(offenders).toEqual([]);

    // 긍정 짝 — 조회 훅이 생성 GET 훅을 실제로 감싼다(읽기 경로 실재 증거).
    expect(readOne(HOOK_REL)).toContain('useGetTrips');
  });
});

describe('🔴 G6 · INV-3(gap-filler) — recordsCalendar·monthGrid 에 소요시간 문자열 0', () => {
  it('두 순수 모듈에 분·시간·소요 표기 0건 + 조립 함수 export 앵커', () => {
    const modelFiles = [MODEL_REL, GRID_REL];
    const offenders = modelFiles.filter((rel) =>
      DURATION_TEXT.test(readOne(rel))
    );
    // 부정 — shared/date/monthGrid 는 선재 record 스캔 밖이라 이 파일이 유일 그물.
    expect(offenders).toEqual([]);
    // 긍정 앵커 — 모집단이 실제로 채워졌다(recordsCalendar 가 조립 함수를 export).
    expect(readOne(MODEL_REL)).toContain('export function markedDaysOfMonth');
  });
});

describe('🔴 G7 · recordsCalendar 순수 — 쿼리 훅·react·라우터·타 feature import 0', () => {
  it('recordsCalendar 에 부수효과 import 0건 + markedDaysOfMonth 정의 앵커', () => {
    const src = readOne(MODEL_REL);
    // 부정 — 순수 조립 함수라 조회·렌더·항법을 모른다.
    expect(src).not.toMatch(/\buseGet[A-Za-z]/);
    expect(src).not.toMatch(/\buseQuery\b/);
    expect(src).not.toMatch(/from ['"]react['"]/);
    expect(src).not.toContain('expo-router');
    expect([...src.matchAll(FEATURE_IMPORT)]).toHaveLength(0);
    // 긍정 짝 — 조립 함수가 실재한다(빈 파일 공허 통과 차단).
    expect(src).toContain('export function markedDaysOfMonth');
  });
});
