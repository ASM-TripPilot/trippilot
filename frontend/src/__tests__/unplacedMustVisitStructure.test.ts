import fs from 'node:fs';
import path from 'node:path';

/**
 * TRIP-1094 · 미배치 필수 방문지 표시의 **소스 가드** — 렌더 테스트가 못 보는 것만 잰다.
 *
 * 무엇을 보장하나:
 *  - 🔴 G1 · AC-8 — 이 칸의 네 파일(순수 함수·표시 컴포넌트·두 페이지) 어디에도 `reasonCode` 가 없다.
 *    FE 가 사유 코드로 분기하면 문구를 지어낼 통로가 생긴다 — 서버 `message` 만 쓴다.
 *  - 🔴 G2 — 표시 컴포넌트는 순수 표시다(훅 호출·라우터·조회 0). 두 페이지가 공유하고 프리뷰가 네트워크
 *    계층 없이 가져다 쓰려면 이래야 한다(`DraftFallbackBanner`·`NoBaseNoticeCard` 선례).
 *  - G3 · AC-6 — h02 필수 방문지 목록(페이지·화면)에는 미배치 표식이 없다(결정 1 · 무회귀 트립와이어).
 *
 * 경계(순수 함수가 `features/explore` 를 안 문다)는 `itineraryMustVisitStructure` C38 이 이미
 * `features/itinerary/**` 전수로 잰다 — 여기서 중복하지 않는다. 소스의 소요시간 표기는
 * `itineraryTimeStructure` G2 가 `features/itinerary/ui` 전수로 잰다.
 *
 * 3동작 뼈대: 준비=소스 읽고 주석 걷기 → 실행=탐지 → 단언=걸린 파일 목록.
 */

const ROOT = path.resolve('src');

const MODEL_REL = 'features/itinerary/model/unplacedMustVisits.ts';
const NOTICE_REL = 'features/itinerary/ui/UnplacedMustVisitNotice.tsx';
const DRAFT_PAGE_REL = 'pages/itinerary-draft/ui/DraftPage.tsx';
const PLAN_PAGE_REL = 'pages/itinerary-plan/ui/ItineraryPlanPage.tsx';
const H02_PAGE_REL = 'pages/itinerary-mustvisit/ui/MustVisitListPage.tsx';
const H02_SCREEN_REL = 'features/itinerary/ui/MustVisitPickerScreen.tsx';

/** 블록 주석을 먼저 지운다. 줄 주석은 바로 앞 글자가 `:` 가 아닐 때만 — `'https://…'` 보존(동결 가드 규칙). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

/** 없는 파일은 빈 문자열 — 빈 문자열이 부정 단언을 공짜로 통과시키는 것은 같은 it 의 실재 단언이 막는다. */
function readStripped(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const UNPLACED_WORD = /unplaced/i;
/** 훅 호출 — `useState(`·`useSavedPlaces(`·`useRouter(` 등. 순수 표시 컴포넌트엔 0이어야 한다. */
const HOOK_CALL = /\buse[A-Z]\w*\s*\(/;

describe('G0 · 탐지기 자가검사 — 주석 걷기와 탐지를 함께 태운다 (02a ★15)', () => {
  it('주석 속 reasonCode·unplaced 는 걷히고, 코드와 URL 은 살아남는다', () => {
    const sample = [
      '// reasonCode 로 분기하지 않는다',
      '/* reasonCode 는 행에 싣지 않는다 */',
      '{/* JSX 주석의 reasonCode · unplaced */}',
      'const x = item.reasonCode;',
      "const u = 'https://example.com/unplaced';",
      'const hook = useSavedPlaces({ isAuthed });',
    ].join('\n');

    const stripped = stripComments(sample);

    // 표본의 reasonCode 4개(주석 3 + 코드 1) 중 코드 1개만 남는다.
    expect(count(stripped, 'reasonCode')).toBe(1);
    // URL 은 줄 주석으로 오인되지 않는다 — 그 안의 unplaced 가 탐지기에 그대로 보인다.
    expect(stripped).toContain('https://example.com/unplaced');
    expect(UNPLACED_WORD.test(stripped)).toBe(true);
    expect(UNPLACED_WORD.test(stripComments('// unplaced 표식 없음'))).toBe(
      false
    );
    // 훅 탐지기 — 호출은 잡고 이름 언급(식별자 아닌 글자)은 안 잡는다.
    expect(HOOK_CALL.test(stripped)).toBe(true);
    expect(HOOK_CALL.test("const label = 'useful text';")).toBe(false);
  });
});

describe('🔴 G1 · AC-8 — 네 파일 어디에도 reasonCode 가 없다 (문구 무발명)', () => {
  it('파일이 모두 있고, 주석을 걷은 본문에 reasonCode 가 0건이다', () => {
    const files = [MODEL_REL, NOTICE_REL, DRAFT_PAGE_REL, PLAN_PAGE_REL];

    // 긍정 짝 — 모집단 전부 실재(없는 파일은 빈 문자열이라 부정 단언이 공짜로 통과한다).
    expect(files.filter((rel) => !exists(rel))).toEqual([]);

    const offenders = files.filter((rel) =>
      readStripped(rel).includes('reasonCode')
    );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G2 · 표시 컴포넌트는 순수 표시다 (프리뷰 재사용 · layer-pages)', () => {
  it('파일이 있고 무언가를 export 하며, 훅 호출·라우터·조회 import 가 0건이다', () => {
    expect(exists(NOTICE_REL)).toBe(true);
    const source = readStripped(NOTICE_REL);
    expect(source).toMatch(/export (function|const) UnplacedMustVisitNotice\b/);

    const forbidden = [
      HOOK_CALL.test(source) ? 'hook call' : null,
      source.includes('expo-router') ? 'expo-router' : null,
      source.includes('@tanstack/react-query') ? '@tanstack/react-query' : null,
    ].filter((hit) => hit !== null);
    expect(forbidden).toEqual([]);
  });
});

describe('G3 · AC-6 — h02 필수 방문지 목록에는 미배치 표식이 없다 (결정 1 · 선제 green 트립와이어)', () => {
  it('두 파일이 있고, 주석을 걷은 본문에 unplaced 가 0건이다', () => {
    const files = [H02_PAGE_REL, H02_SCREEN_REL];

    expect(files.filter((rel) => !exists(rel))).toEqual([]);

    const offenders = files.filter((rel) =>
      UNPLACED_WORD.test(readStripped(rel))
    );
    expect(offenders).toEqual([]);
  });
});
