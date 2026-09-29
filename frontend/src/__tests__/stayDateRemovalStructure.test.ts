/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1052 — e05 숙소 등록에서 체크인·체크아웃 입력이 사라진 뒤 **죽은 코드가 남지 않는다**.
 *
 * 무엇을 보장하나:
 *  - R1(AC-1 소스 짝) 등록 표면 소스에 `stay-register-date` testID가 0건 — 렌더 테스트는 "이번
 *    렌더에 나온 것"만 보므로, 조건부로 남은 달력은 여기서 잡는다.
 *  - R2(AC-4) 날짜 헬퍼 파일 둘(`stayDates.ts`·`stayDateImport.ts`)이 없다.
 *  - R3(AC-4) 비테스트 `src` 어디에서도 그 두 모듈을 import하지 않는다.
 *  - R4(AC-4) 날짜 판정·전이·옛 포맷터(`nightsBetween`…`formatStayDateRange`·`resolveStayImport`)의
 *    정의가 0건 — 파일만 지우고 함수를 다른 곳으로 옮기는 것도 잡는다.
 *  - R5(AC-4) 등록 표면 세 파일(화면·페이지·폼)에 날짜 입력 식별자가 0건 — optional prop으로
 *    남긴 죽은 배선은 tsc가 못 잡는다.
 *  - R6(01b Q1(a)) e04 배선이 날짜 라벨(`dateLabel`)을 더는 조립하지 않는다 — 화면이 원래 안
 *    그리던 죽은 VM 필드였다(`SavedStayListScreen.test.tsx` F-10).
 *
 * 탐지기는 **from 절·정의·식별자 형태**로만 잡는다 — 파일 이름 문자열로 훑으면 `baseSections.ts`
 * 머리말처럼 이름을 언급만 하는 주석·산문에 오탐한다. 소스는 주석을 걷고 스캔한다(`:` 뒤 `//`는
 * URL이라 남긴다). R0이 이 전처리와 탐지기를 함께 태워 본다.
 *
 * 가짜 통과 방지(리포 관례): 모든 "없어야 한다"는 같은 it 안 "있어야 한다" 앵커와 짝을 이룬다.
 */

const SRC = path.resolve('src');

const STAY_DATES = 'features/stay/model/stayDates.ts';
const STAY_DATE_IMPORT = 'features/trip/model/stayDateImport.ts';
const SCREEN = 'features/stay/ui/StayRegisterScreen.tsx';
const PAGE = 'pages/stay-register/ui/StayRegisterPage.tsx';
const FORM = 'features/stay/model/stayRegisterForm.ts';
const SAVED_PAGE = 'pages/stay-saved/ui/SavedStayPage.tsx';

/** 등록 표면 — `stayRegisterStructure.test.ts`의 TOKEN_SCAN_DIRS와 같은 두 폴더. */
const REGISTER_SURFACE_DIRS = ['features/stay/ui', 'pages/stay-register/ui'];

const DEAD_FROM = /from\s*['"][^'"]*\/(stayDates|stayDateImport)['"]/;
const GRID_FROM = /from\s*['"]@\/shared\/date\/monthGrid['"]/;
const DEAD_SYMBOLS = [
  'nightsBetween',
  'isStayRangeValid',
  'applyDatePick',
  'commitDateRange',
  'formatStayDateRange',
  'resolveStayImport',
];
const DATE_INPUT_IDENT =
  /checkIn|checkOut|dateSheet|DateSheet|calendarMonth|CalendarSheet|PickDate|minDate|maxDate/;

/** 블록 주석 먼저 → 줄 주석(콜론 예외). 순서를 바꾸면 한 줄 안 코드가 소실된다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function defines(source: string, name: string): boolean {
  return new RegExp(`\\b(?:function|const|let|var)\\s+${name}\\b`).test(source);
}

function read(rel: string): string {
  return stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8'));
}

/** 비테스트 소스 전수(`src` 기준 상대경로). 테스트는 뺀다 — 지워진 모듈을 import하는 테스트는
 *  모듈 해석 실패로 어차피 red이고, 다른 구조 가드의 자가검사 샘플 문자열이 거짓 red를 낸다. */
function nonTestSources(dir: string): string[] {
  const root = path.join(SRC, dir);
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) {
      out.push(...nonTestSources(rel));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      out.push(rel);
    }
  }
  return out;
}

describe('R0 · 탐지기 자가검사 — 이게 통과해야 아래 단언들이 의미를 갖는다', () => {
  it('URL 줄의 from 절은 살아남고, 주석 속 from·정의·식별자는 걷히며, 여러 줄 import도 잡힌다', () => {
    // 방향 ① — URL의 `//`를 주석으로 오인해 같은 줄 import를 날리지 않는다.
    const urlLine = stripComments(
      "const doc = 'https://figma.com/x'; import { a } from '@/features/stay/model/stayDates';"
    );
    expect(DEAD_FROM.test(urlLine)).toBe(true);

    // 방향 ② — 주석 속 문자열은 부정 단언을 거짓 red로 만들지 않는다.
    const commented = stripComments(
      [
        "// import { a } from '../model/stayDateImport';",
        '/** export function nightsBetween() {} */',
        '// checkIn 은 싣지 않는다',
        'const keep = 1;',
      ].join('\n')
    );
    expect(DEAD_FROM.test(commented)).toBe(false);
    expect(DEAD_SYMBOLS.filter((name) => defines(commented, name))).toEqual([]);
    expect(DATE_INPUT_IDENT.test(commented)).toBe(false);
    expect(commented).toContain('const keep = 1;');

    // 방향 ③ — 여러 줄 import의 from 절(`}` 뒤 한 줄)과 코드 줄의 정의·식별자·testID는 잡힌다.
    const multi = stripComments(
      "import {\n  formatStayDateRange,\n} from '../model/stayDateImport';"
    );
    expect(DEAD_FROM.test(multi)).toBe(true);
    expect(
      defines('export function resolveStayImport({', 'resolveStayImport')
    ).toBe(true);
    expect(DATE_INPUT_IDENT.test('  onOpenDateSheet: () => void;')).toBe(true);
    expect(
      stripComments('<Pressable testID="stay-register-date-field" />')
    ).toContain('stay-register-date');
  });
});

describe('🔴 R1 · AC-1 소스 짝 — 등록 표면에 날짜 testID가 없다', () => {
  it('features/stay/ui·pages/stay-register/ui 비테스트 소스에 stay-register-date 가 0건이다', () => {
    const combined = REGISTER_SURFACE_DIRS.flatMap((dir) => nonTestSources(dir))
      .map((rel) => read(rel))
      .join('\n');

    // 앵커 — 모집단이 실제 등록 화면을 담았다(비어서 0건이 되는 공허 통과 차단).
    expect(combined).toContain('stay-register-submit');

    expect(combined).not.toContain('stay-register-date');
  });
});

describe('🔴 R2 · AC-4 — 날짜 헬퍼 파일 둘이 없다', () => {
  it('stayDates.ts·stayDateImport.ts 가 없고, 같은 폴더의 이웃 파일은 있다', () => {
    const exists = (rel: string) => ({
      file: rel,
      exists: fs.existsSync(path.join(SRC, rel)),
    });

    // 앵커 — 폴더가 통째로 사라져서 부재가 참이 된 게 아니다.
    expect(exists(FORM)).toEqual({ file: FORM, exists: true });
    expect(exists('features/trip/model/useSavedStays.ts')).toEqual({
      file: 'features/trip/model/useSavedStays.ts',
      exists: true,
    });

    expect(exists(STAY_DATES)).toEqual({ file: STAY_DATES, exists: false });
    expect(exists(STAY_DATE_IMPORT)).toEqual({
      file: STAY_DATE_IMPORT,
      exists: false,
    });
  });
});

describe('🔴 R3 · AC-4 — 비테스트 src 어디에서도 두 모듈을 import하지 않는다', () => {
  it('from 절 전수에서 …/stayDates·…/stayDateImport 가 0건이다', () => {
    const sources = nonTestSources('.');

    // 앵커 — 스캔이 실제 소스를 훑었고(빈 목록 공허 통과 차단), 같은 형태의 from 절을 실제로 찾는다.
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some((rel) => GRID_FROM.test(read(rel)))).toBe(true);

    const offenders = sources.filter((rel) => DEAD_FROM.test(read(rel)));
    expect(offenders).toEqual([]);
  });
});

describe('🔴 R4 · AC-4 — 날짜 판정·전이·옛 포맷터 정의가 0건이다', () => {
  it('nightsBetween·isStayRangeValid·applyDatePick·commitDateRange·formatStayDateRange·resolveStayImport 를 정의한 비테스트 소스가 없다', () => {
    const sources = nonTestSources('.').map((rel) => ({
      rel,
      source: read(rel),
    }));

    // 앵커 — 같은 탐지기가 살아 있어야 할 이웃(g02 옛 데이터 표시용 포맷터) 정의는 찾는다.
    expect(
      sources.some(({ source }) => defines(source, 'formatBaseNightRange'))
    ).toBe(true);

    const offenders = sources.flatMap(({ rel, source }) =>
      DEAD_SYMBOLS.filter((name) => defines(source, name)).map(
        (name) => `${rel}:${name}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 R5 · AC-4 — 등록 표면 세 파일에 날짜 입력 식별자가 없다', () => {
  it.each([
    { rel: SCREEN, anchor: /export function StayRegisterScreen\b/ },
    { rel: PAGE, anchor: /StayRegisterScreen/ },
    { rel: FORM, anchor: /export function canSubmitStayRegister\b/ },
  ])(
    '$rel 에 checkIn·checkOut·dateSheet·calendarMonth·CalendarSheet·PickDate·minDate·maxDate 가 0건이다',
    ({ rel, anchor }) => {
      const source = read(rel);

      // 앵커 — 파일이 비었거나 껍데기라서 0건이 된 게 아니다.
      expect(source).toMatch(anchor);

      expect(source.match(DATE_INPUT_IDENT)?.[0] ?? null).toBeNull();
    }
  );
});

describe('🔴 R6 · 01b Q1(a) — e04 배선이 날짜 라벨을 조립하지 않는다', () => {
  it('SavedStayPage.tsx 에 dateLabel 이 없고, 화면 배선은 남아 있다', () => {
    const source = read(SAVED_PAGE);

    // 앵커 — 배선 페이지가 여전히 e04 화면을 그린다.
    expect(source).toContain('SavedStayListScreen');

    expect(source).not.toContain('dateLabel');
  });
});
