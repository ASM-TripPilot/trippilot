/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-461 AC-1(라우트·진입) · AC-8(화면 순수성 — cross-feature 사각) · AC-V3(화면 raw hex 0) —
 * e04 저장한 숙소 3층(라우트·배선·화면) 소스 스캔 가드.
 *
 * 왜 소스 스캔인가 — 렌더 단언과 사정거리가 다르다. `SavedStayListScreen.test.tsx`는 "이번
 * 렌더에서 나온 출력"만 본다. 여기는 **아예 렌더되지 않는 import**(예: 화면이 explore 판정
 * 함수를 몰래 당겨오는 것)까지 본다.
 *
 * ★ 이 파일이 메우는 구멍: `staySearchStructure.test.ts`의 `features/stay/ui` 디렉토리 스캔이
 * 이 화면을 raw hex·`useState`·query 등으로 이미 자동 편입해 잡지만, 그 스캔의 FORBIDDEN
 * 목록에 **`@/features/explore`·`@/features/trip`·`resolvePlaceListState`가 없다**(그 파일은
 * 게이트① 동결이라 못 고친다). e04의 핵심 함정은 바로 그 cross-feature import다 —
 * `resolvePlaceListState`(explore 소유)는 **페이지에서만** 부르고 화면이 직접 당기면 경계
 * 위반인데(repo-trap: eslint FEATURES 배열에 stay·explore 둘 다 없어 린트 강제가 0), 그걸
 * 잡는 스캔이 어디에도 없다. 여기서 그 축만 새로 잠근다(나머지는 위 스캔이 이중으로 방어).
 *
 * **전제 — 모든 it은 주석을 걷어낸 소스를 스캔한다**(`stripComments`). 걷어내지 않으면 머리말
 * 산문이 부정 단언을 대신 만족시키는 거짓 GREEN을 낸다. 줄 주석 규칙은 **바로 앞 글자가 `:`이면
 * 주석으로 보지 않는다** — `'https://…'`의 슬래시를 주석 시작으로 오인하지 않기 위함
 * (`pagesLayerStructure.test.ts` 동형, 2026-07-31 실사고 회귀 가드).
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은
 * it 안에서 짝을 이룬다 — 구현 전 빈 문자열이 부정 단언을 공짜로 통과시키는 것을 막는다.
 */

const ROOT = path.resolve('src');

const ROUTE_REL = 'app/stays/saved.tsx';
const PAGE_REL = 'pages/stay-saved/ui/SavedStayPage.tsx';
const BARREL_REL = 'pages/stay-saved/index.ts';
const SCREEN_REL = 'features/stay/ui/SavedStayListScreen.tsx';

/** 토큰으로 이미 존재하는 색 — raw hex로 적으면 토큰 우회다(`staySearchStructure`와 같은 목록).
 * 카드 그림자 #000000은 이 목록에 없으므로 자동 허용(HomeScreen softCardShadow 관례). */
const TOKENIZED_HEX = [
  '#ffffff',
  '#222222',
  '#6a6a6a',
  '#3f3f3f',
  '#dddddd',
  '#ededed',
  '#ff385c',
  '#f7f7f7',
  '#ffe4e9',
  '#9aa1ab',
  '#f2f2f2',
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — 구현 전에도 "무엇이 없는가"를 읽을 assertion diff로 남기기 위함
 * (ENOENT 예외로 죽으면 diff가 안 남는다). 빈 문자열이 부정 단언을 공짜로 통과시키는 것은 같은
 * it 안의 긍정 짝이 먼저 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('주석은 걷히고, 코드의 라우트 리터럴·식별자는 살아남는다', () => {
    const sample = [
      '/**',
      ' * e04 저장한 숙소 — https://www.figma.com/design/x 의 1701:1183.',
      ' * 이 화면은 resolvePlaceListState 를 부르지 않는다(경계).',
      ' */',
      '// const dead = resolvePlaceListState();',
      "const href = '/stays/register';",
      "const bad = 'https://cdn.example.com/x.jpg';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석·산문 속 금칙어는 걷힌다 — 걷지 않으면 머리말이 스스로 red를 낸다.
    expect(stripped).not.toContain('resolvePlaceListState');
    expect(stripped).not.toContain('figma.com');
    // ② ★ 조합 — 전처리를 태운 뒤에도 코드의 URL·라우트 리터럴은 살아남아야 한다. 순진한
    //    `//.*` 제거는 URL 줄을 `const bad = 'https:` 로 잘라 단언을 공짜로 통과시킨다(실사고).
    expect(stripped).toContain("const bad = 'https://cdn.example.com/x.jpg';");
    expect(stripped).toContain("const href = '/stays/register';");
  });
});

describe('AC-1 · 라우트·배선·화면 3층이 각자의 책임만 진다', () => {
  it('네 파일이 실재하고, 라우트는 얇은 래퍼이며, 배선은 훅을 지되 마크업을 모른다', () => {
    // 긍정 짝 — 파일이 실재해야 아래 읽기가 의미를 갖는다(없으면 빈 문자열 → 아래 긍정 단언이 red).
    [ROUTE_REL, PAGE_REL, BARREL_REL, SCREEN_REL].forEach((rel) =>
      expect({
        file: rel,
        exists: fs.existsSync(path.join(ROOT, rel)),
      }).toEqual({ file: rel, exists: true })
    );

    // 라우트는 얇은 래퍼 — 페이지 배럴만 가리키고 조회·마크업은 직접 안 만진다.
    const routeSource = readOne(ROUTE_REL);
    expect(routeSource).toContain('@/pages/stay-saved');
    expect(routeSource).not.toContain('useSavedStays');
    expect(routeSource).not.toContain('FlatList');

    // 배럴이 빈 스텁이 아니라 실제로 심볼을 재수출한다.
    expect(readOne(BARREL_REL)).toContain('SavedStayPage');

    // 배선(페이지)은 조회·인증 판정·상태 판정·라우팅을 갖되 마크업(FlatList)은 모른다.
    const pageSource = readOne(PAGE_REL);
    expect(pageSource).toContain('useSavedStays');
    expect(pageSource).toContain('resolvePlaceListState');
    expect(pageSource).toContain('getAccessToken');
    expect(pageSource).not.toContain('FlatList');
  });
});

describe('AC-8 · 화면 순수성 — cross-feature 판정 함수를 직접 당기지 않는다 (★6)', () => {
  it('SavedStayListScreen이 props만 받고, 판정·조회·라우팅·타 feature import가 0건이다', () => {
    const screenSource = readOne(SCREEN_REL);

    // 긍정 짝 — 읽은 것이 정말 그 화면이고, className으로 스타일링돼 있다(빈 문자열 방어).
    expect(screenSource).toMatch(/export function SavedStayListScreen\b/);
    expect(/className=/.test(screenSource)).toBe(true);
    expect(screenSource).toContain('saved-stay-root');
    expect(screenSource).toContain('saved-stay-card-');

    // 부정 — 화면이 데이터·상태·라우팅·판정·타 feature를 직접 만지면 진실이 두 층으로 갈린다.
    // ★ `@/features/explore`·`@/features/trip`·`resolvePlaceListState`가 이 목록의 핵심 —
    // staySearchStructure의 동결 FORBIDDEN에는 없어서, 여기서만 잠긴다(repo-trap).
    const FORBIDDEN = [
      'useState',
      'useReducer',
      'zustand',
      'expo-router',
      '@tanstack/react-query',
      'axios',
      '@/shared/api/generated/saved-stays',
      'useSavedStays',
      'resolvePlaceListState',
      '@/features/explore',
      '@/features/trip',
      '@/features/home',
      '@/features/auth',
      '@/features/onboarding',
    ];
    expect(FORBIDDEN.filter((needle) => screenSource.includes(needle))).toEqual(
      []
    );
  });
});

describe('AC-V3 · 화면 raw hex 0 (`*Glyphs.tsx` 제외 — 이 화면은 글리프가 아니다)', () => {
  it('SavedStayListScreen이 className 스타일링이고, 토큰화된 색 raw hex가 없다', () => {
    const screenSource = readOne(SCREEN_REL);

    // 긍정 짝 — 화면이 실재하고 className으로 스타일링돼 있다. 없으면 아래 "raw hex 0"이
    // 빈 문자열에서 공허 통과한다(빈 화면도 통과하는 함정 차단).
    expect(screenSource).toMatch(/export function SavedStayListScreen\b/);
    expect(/className=/.test(screenSource)).toBe(true);

    // 부정 — 토큰화된 색은 전부 tailwind 토큰에 있으므로 raw hex는 우회다.
    const offenders = TOKENIZED_HEX.filter((hex) =>
      screenSource.toLowerCase().includes(hex)
    );
    expect(offenders).toEqual([]);
  });
});
