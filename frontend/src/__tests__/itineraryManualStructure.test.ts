/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-338 · h19·h20 직접 짜기(MANUAL) **소스 층 가드**(AC-7 · INV-3 · BR-U3-08).
 * `itineraryEditStructure.test.ts` 패턴 — 탐지기를 복제하지 않고 (a) 신규 파일 실재 (b) 기존 재귀
 * 스캔 자동 편입 (c) INV-3 타겟 가드만 얹는다.
 *
 * 무엇을 보장하나:
 *  - **G1** 전처리(stripComments)×탐지기가 서로를 지우지 않는다(조합 자가검사).
 *  - **G2** 신규 화면 3파일이 `features/itinerary/ui` **재귀 모집단**에 실제로 든다 — 이게 곧 기존
 *    `itineraryTimeStructure.test.ts` G2(소요시간 표기 0건 전수)의 사정거리 편입 증명.
 *  - **G3** 신규 파일(화면 2·카드 1·페이지 2·배럴 1·라우트 2)이 정본 경로에 실재.
 *  - **G4** 신규 ui 파일에 소요시간 표기 0건 **+ "이동시간" 0건**(디짓 갭 봉합, 아래 참조).
 *
 * ── 왜 타겟 가드 `TRAVEL_TIME` 을 새로 두나 (디짓 게이트 함정) ───────────────
 * 기존 스캔의 `DURATION_TEXT=/(\d+\s*분|\d+\s*시간|소요)/` 은 **숫자 앞자리를 요구**해 `'3시간'`은
 * 잡지만 숫자 없는 `'이동시간'`은 **못 잡는다**(02a §5-C 실측). 그런데 §8③ 각색 대상인 Figma hero
 * 부제 "이동시간을 AI가 맞춰드려요"가 바로 그 형태다 — 기존 스캔만으론 각색 안 해도 통과한다.
 * 그래서 `TRAVEL_TIME=/이동\s*시간|이동시각/` 로 그 문맥만 봉합한다. 밴드 카피 "이 시간에 장소
 * 추가"의 정당한 "시간"과 기존 "이동 거리"·"이동수단" 은 **안 잡는다**(02a §5-C 정밀도 실측).
 *
 * ── 졸업 조건 ────────────────────────────────────────────────
 * **A. 영구** G1·G4 는 INV-3 를 잠그므로 슬라이스가 늘어도 갱신 불필요(재귀 자동 편입).
 * **B. 한시(카운터 0)** G2·G3 의 경로·편입 앵커는 이 칸 계약 스냅숏이라 정당한 리네임에 red 를
 * 낸다. 정당 작업이 이 절 때문에 red 를 낸 것이 2회 누적되면 경로 존재 앵커만 남기고 나머지를 뗀다.
 *
 * **전제**: 모든 부정("없어야 한다") 단언은 같은 it 안에서 긍정("있어야 한다") 짝과 이룬다(리포 규약).
 */

const ROOT = path.resolve('src');

const UI_DIR_REL = 'features/itinerary/ui';

/** 이 칸이 새로 그리는 화면/카드(재귀 스캔 자동 편입 + INV-3 타겟 가드 대상). */
const NEW_UI_FILES = [
  'features/itinerary/ui/ManualPlanScreen.tsx',
  'features/itinerary/ui/PlaceAddScreen.tsx',
  'features/itinerary/ui/PlaceAddCard.tsx',
];

/** 이 칸이 새로 만드는 전 파일(경로 계약 스냅숏). */
const NEW_PATHS = [
  ...NEW_UI_FILES,
  'pages/itinerary-manual/ui/ManualPlanPage.tsx',
  'pages/itinerary-manual/ui/PlaceAddPage.tsx',
  'pages/itinerary-manual/index.ts',
  'app/trips/[tripId]/itinerary/manual/index.tsx',
  'app/trips/[tripId]/itinerary/manual/add.tsx',
];

/** 소요시간 **표기** 탐지기 — 화면에 나갈 문자열 형태(식별자가 아니다). `HH:mm` 은 숫자 뒤가 `:`
 * 이라 안 걸린다. `itineraryTimeStructure.test.ts` 와 같은 것(복제가 아니라 자가검사용 로컬 사본). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 타겟 가드 — 숫자 없는 "이동시간/이동시각" 문맥. DURATION_TEXT 의 디짓 갭을 봉합한다. */
const TRAVEL_TIME = /이동\s*시간|이동시각/;

/**
 * 주석 제거 — 블록 먼저(순서 바꾸면 한 줄 안 코드가 소실). 줄 주석은 **바로 앞이 `:` 이면**
 * 주석으로 안 본다(`'https://…'` 의 슬래시 오인 방지, 동결 가드들과 같은 규칙, 2026-07-31 사고 계열).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 생성물·테스트·글리프는 제외(동결 가드들과 같은 규칙). 디렉토리 없으면 빈 배열(방어). */
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

/** 없는 파일은 빈 문자열 — ENOENT 로 죽으면 무엇이 없는지 diff 에 안 남는다. 빈 문자열이 부정
 * 단언을 공짜로 통과시키는 것은 같은 it 안 긍정 짝(존재 단언)이 먼저 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: fs.existsSync(path.join(ROOT, rel)) };
}

describe('G1 · 조합 자가검사 — 전처리와 탐지기가 서로를 지우지 않는다', () => {
  it('주석 속 소요시간은 걷히고, 코드 시각·URL 은 살아남되 두 탐지기는 정밀하다', () => {
    // ★ 조합 검증 — 실제 문자열로(문제로그 2026-08-08 · 2026-07-31 계열).
    const sample = [
      '// INV-3 · 이동시간 30분 소요 표기 금지.',
      "const time = '09:30';",
      "const u = 'https://cdn.example.com/a.png';",
    ].join('\n');
    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 안 걷으면 수호 주석이 아래 부정 단언을 통과 불가로 만든다.
    expect(stripped).not.toContain('소요');
    expect(stripped).not.toContain('30분');
    expect(stripped).not.toContain('이동시간');

    // ② 코드 시각·URL 은 살아남고, 시각은 DURATION_TEXT 에 안 걸린다(HH:mm 은 정당).
    expect(stripped).toContain("const time = '09:30';");
    expect(stripped).toContain("const u = 'https://cdn.example.com/a.png';");
    expect(DURATION_TEXT.test(stripped)).toBe(false);

    // ③ DURATION_TEXT 의 디짓 게이트 함정 — 숫자 없는 '이동시간' 은 **못 잡는다**(그래서 TRAVEL_TIME
    //    이 필요). 진짜 소요표기·밴드 카피는 각각 잡거나 안 잡는다.
    expect(DURATION_TEXT.test('이동시간을 AI가 맞춰드려요')).toBe(false);
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
    expect(DURATION_TEXT.test('소요 2시간')).toBe(true);
    expect(DURATION_TEXT.test('이 시간에 장소 추가')).toBe(false);

    // ④ TRAVEL_TIME 정밀도 — 이동시간/이동 시간만 잡고, 밴드 "이 시간에"·기존 "이동 거리"·"이동수단"
    //    은 안 잡는다(정당한 문구를 red 로 만들지 않는다).
    expect(TRAVEL_TIME.test('이동시간을 AI가 맞춰드려요')).toBe(true);
    expect(TRAVEL_TIME.test('이동 시간을 계산')).toBe(true);
    expect(TRAVEL_TIME.test('이 시간에 장소 추가')).toBe(false);
    expect(TRAVEL_TIME.test('동선·이동 거리를 계산 중')).toBe(false);
    expect(TRAVEL_TIME.test('이동수단 아이콘')).toBe(false);
  });
});

describe('🔴 G2 · 편입 앵커 — 신규 화면 3파일이 features/itinerary/ui 재귀 스캔에 든다', () => {
  it('세 화면 경로가 재귀 모집단에 실제로 있다 (기존 소요시간 전수의 사정거리 편입)', () => {
    const population = listSourceFiles(path.join(ROOT, UI_DIR_REL)).map(relOf);

    // 긍정 앵커 — 모집단이 비어 있지 않다.
    expect(population.length).toBeGreaterThan(0);

    // 세 화면이 그 안에 있다 — 이게 곧 기존 DURATION 전수 스캔이 이들을 자동으로 잡는다는 증명.
    NEW_UI_FILES.forEach((rel) => expect(population).toContain(rel));
  });
});

describe('🔴 G3 · 경로 계약 — 신규 파일이 정본 경로에 실재한다', () => {
  it('화면 2·카드 1·페이지 2·배럴 1·라우트 2 가 실재하고 배럴이 두 페이지를 재수출한다', () => {
    NEW_PATHS.forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    // 배럴이 빈 스텁이 아니라 실제로 두 페이지를 재수출한다.
    const barrel = readOne('pages/itinerary-manual/index.ts');
    expect(barrel).toContain('ManualPlanPage');
    expect(barrel).toContain('PlaceAddPage');
  });
});

describe('🔴 G4 · AC-7 — 신규 ui 파일에 소요시간·이동시간 표기가 0건이다 (INV-3)', () => {
  it('세 화면 각각 실재하고(짝) 주석 제외 소스에 소요시간·이동시간 문자열이 없다', () => {
    NEW_UI_FILES.forEach((rel) => {
      // 긍정 짝 — 파일이 실재해야 아래 부정이 의미를 갖는다(없으면 여기서 red).
      expect(existsPair(rel)).toEqual({ file: rel, exists: true });

      const source = readOne(rel);
      // 부정 — 소요시간 표기 0(prop 문자열 accessibilityLabel 까지 잡힘).
      expect(DURATION_TEXT.test(source)).toBe(false);
      // 부정 — 각색 안 한 "이동시간" 이 안 남는다(디짓 갭 봉합, §8③).
      expect(TRAVEL_TIME.test(source)).toBe(false);
    });
  });
});
