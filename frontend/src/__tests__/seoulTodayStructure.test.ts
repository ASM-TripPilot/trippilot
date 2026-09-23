/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-506 · AC-5·AC-7 · 01b Q1·Q2 — 앱의 "오늘"이 KST 헬퍼 `seoulDate` 한 곳으로 모였는가.
 *
 * 무엇을 보장하나:
 *  - AC-5 비테스트 `src` 어디에도 UTC 로 오늘을 만드는 `new Date().toISOString().slice(0, 10)` 이
 *    남지 않고, 오늘을 쓰는 7곳(A 5 + B 2)이 `@/shared/date/seoulDate` 를 import 해 호출한다.
 *  - 01b Q2 기기 로컬 `todayIso()` 사본 2개가 사라진다.
 *  - 01b Q1 헬퍼는 순수하다 — 시계를 스스로 읽지 않는다(시계 금지 소스 가드들은 import 를 안
 *    따라가므로, 시계를 읽는 공용 헬퍼는 그 가드들을 우회하는 통로가 된다).
 *  - AC-7 `LiveItineraryPage` 의 `today?: string` 주입 seam 은 남고, "오늘(UTC)" 문구는 없어진다.
 *
 * 탐지식은 빈 괄호 `new Date()` 만 잡는다 — 날짜 문자열을 환산하는 `new Date(time).toISOString()`
 * (draftView 계열, AC-6 제외 대상)은 버그가 아니라 걸리면 안 된다.
 * 소스는 주석을 걷고 스캔한다(리포 관례, 줄 주석은 `:` 뒤 제외). AC-7 문구 단언만 주석이 대상이라 원문을 본다.
 */

const SRC = path.resolve('src');

const A_CALL_SITES = [
  'app/(tabs)/index.tsx',
  'pages/itinerary-list/ui/TripCardContainer.tsx',
  'pages/live-itinerary/ui/LiveItineraryPage.tsx',
  'pages/my-page/ui/TripCardContainer.tsx',
  'pages/records-calendar/ui/RecordsCalendarPage.tsx',
];
const B_CALL_SITES = [
  'pages/stay-register/ui/StayRegisterPage.tsx',
  'pages/trip-new-step1/ui/TripNewStep1Page.tsx',
];
const ALL_CALL_SITES = [...A_CALL_SITES, ...B_CALL_SITES];

const HELPER_FILE = 'shared/date/seoulDate.ts';
const LIVE_PAGE = 'pages/live-itinerary/ui/LiveItineraryPage.tsx';

const UTC_TODAY =
  /new Date\(\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;
/** from 절을 먼저 잡고 그 중괄호 안에서 심볼을 본다(여러 줄 import 포함). */
const SEOUL_DATE_IMPORT =
  /import\s*\{([^}]*)\}\s*from\s*['"]@\/shared\/date\/seoulDate['"]/;
const SEOUL_DATE_CALL = /\bseoulDate\s*\(/;
const CLOCK_READ = /\bnew Date\(\s*\)|\bDate\.now\s*\(/;

/** 블록 주석 먼저 → 줄 주석(콜론 예외). 순서를 바꾸면 한 줄 안 코드가 소실된다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

/** 비테스트 소스 전수 — `src` 기준 상대경로. */
function collectNonTestSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectNonTestSources(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
    ) {
      out.push(path.relative(SRC, full).split(path.sep).join('/'));
    }
  }
  return out;
}

describe('AC-5 · 오늘 계산이 seoulDate 로 수렴한다', () => {
  it('비테스트 src 에 UTC 오늘 식(new Date().toISOString().slice(0, 10))이 0건', () => {
    const sources = collectNonTestSources(SRC);

    // 앵커 — 스캔이 실제 소스를 훑었는지(빈 목록 공허 통과 차단).
    expect(sources.length).toBeGreaterThan(100);
    expect(sources).toEqual(expect.arrayContaining(ALL_CALL_SITES));

    const offenders = sources.filter((rel) =>
      UTC_TODAY.test(stripComments(read(rel)))
    );
    expect(offenders).toEqual([]);
  });

  it.each(ALL_CALL_SITES)(
    '%s 가 @/shared/date/seoulDate 에서 seoulDate 를 import 한다',
    (rel) => {
      const match = stripComments(read(rel)).match(SEOUL_DATE_IMPORT);
      const specifiers = (match?.[1] ?? '').split(',').map((s) => s.trim());
      expect(specifiers).toContain('seoulDate');
    }
  );

  it.each(ALL_CALL_SITES)('%s 가 seoulDate(…) 를 호출한다', (rel) => {
    expect(stripComments(read(rel))).toMatch(SEOUL_DATE_CALL);
  });
});

describe('01b Q2 · 기기 로컬 todayIso() 사본 삭제', () => {
  it.each(B_CALL_SITES)(
    '%s 에 todayIso 와 기기 로컬 getFullYear() 가 없다',
    (rel) => {
      const code = stripComments(read(rel));
      expect(code).not.toMatch(/\btodayIso\b/);
      expect(code).not.toMatch(/\.getFullYear\(/);
    }
  );
});

describe('01b Q1 · 헬퍼는 순수 함수다', () => {
  it('shared/date/seoulDate.ts 가 있고 시계를 스스로 읽지 않는다(new Date()·Date.now() 0건)', () => {
    expect(fs.existsSync(path.join(SRC, HELPER_FILE))).toBe(true);
    expect(stripComments(read(HELPER_FILE))).not.toMatch(CLOCK_READ);
  });
});

describe('AC-7 · LiveItineraryPage today seam 유지', () => {
  it('today?: string prop 이 남고, "오늘(UTC)" 문구가 없다', () => {
    const raw = read(LIVE_PAGE);

    expect(raw).toMatch(/\btoday\?:\s*string\b/);
    expect(raw).not.toMatch(/오늘\s*\(?\s*UTC/);
  });
});
