/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * G-2(신설 심판) · G-1·G-3·G-4·G-5 — **`src/pages` 층 전수 재귀 스캔**과 d02 3층 책임.
 *
 * ★ 왜 이 파일이 이 칸의 필수 산출인가: **새 page 슬라이스를 보는 디렉토리 스캔이 리포에
 * 하나도 없다.** `features/explore`·`app/explore` 에 파일을 두면 동결 가드
 * (`placeExploreStructure.test.ts` · `placeExploreStateStructure.test.ts`)의 **디렉토리 재귀**가
 * 자동으로 잡지만, pages 층 쪽 모집단은 `pages/place-explore` **완전일치**라 새 슬라이스가
 * 사정거리 밖이다. TRIP-222 가 `StateNotice` 를 `shared/ui` 로 승격하면서 검사 5항목을
 * 잃었던 것과 **같은 계열의 구멍**이고, 그때는 03b 가 뮤테이션으로 실측해서야 드러났다.
 *
 * 그래서 `pages/saved-places` 완전일치가 아니라 **`src/pages` 층 재귀**로 신설한다 — 같은
 * 구멍이 다음 슬라이스에서 또 열리지 않는다(모집단 자동 편입). 지금 남의 빚을 떠안지도
 * 않는다: 실측상 기존 20파일 전부 아래 부정 단언을 이미 만족한다.
 *
 * 무엇을 보장하나 — `src/pages` 전체가
 *  - `duration` 식별자를 갖지 않는다(INV-3 · 소요 시간은 솔버 검증값만 쓴다)
 *  - 서버 상태를 Zustand 로 복사하지 않는다(`frontend/README.md` §66)
 *  - URL 리터럴을 만들지 않는다(INV-1 — 클라가 이미지·엔드포인트를 지어내지 않는다)
 *  - 타이머를 쓰지 않는다(01b Seed Q9 — 안내는 **다음 조작 시** 사라진다)
 *  - 토큰화된 색을 raw hex 로 우회하지 않는다
 *  + d02 의 라우트·배럴·배선·화면이 각자의 책임만 진다
 *
 * **`className=` 긍정 단언은 두지 않는다.** pages 는 배선 층이라 마크업이 없는 것이 정상이고
 * (실측: 20파일 전부 `className` 부재), 넣으면 층 전체가 즉시 red 다.
 *
 * **전제 — 모든 it 은 주석을 걷어낸 소스를 스캔한다**(`stripComments`, 파일마다 각자 갖는 것이
 * 리포 관례). 걷어내지 않으면 머리말 산문이 부정 단언을 대신 만족시키는 거짓 GREEN 을 낸다.
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은
 * it 안에서 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 잠그는 것이 층 규칙(README §59·§66)·INV-1·INV-3·타이머 금지라
 * 슬라이스가 늘어도 갱신이 필요 없다 — 모집단이 디렉토리 재귀라 새 파일이 자동 편입된다.
 * **B. 이행 체크포인트 — 한시적.** d02 3층 책임 절(아래 두 describe)의 심볼 이름은 이번 칸의
 * 계약 스냅숏이라 정당한 리네임에 red 를 낸다. **B 카운터 = 0.** 정당한 작업이 이 절 때문에
 * red 를 낸 것이 2회 누적되면 즉시 "라우트가 pages 를 가리킨다 + 배럴이 비어 있지 않다"만
 * 남기고 심볼 단언을 뗀다.
 */

const ROOT = path.resolve('src');
const PAGES_DIR = path.join(ROOT, 'pages');

const SAVED_PAGE_REL = 'pages/saved-places/ui/SavedPlacesPage.tsx';
const EXPLORE_PAGE_REL = 'pages/place-explore/ui/PlaceExplorePage.tsx';
const SAVED_SCREEN_REL = 'features/explore/ui/SavedPlaceListScreen.tsx';
const SAVED_ROUTE_REL = 'app/explore/saved-places.tsx';
const SAVED_BARREL_REL = 'pages/saved-places/index.ts';
const HOOK_REL = 'features/explore/model/savedPlaces.ts';
const STATE_NOTICE_REL = 'shared/ui/StateNotice.tsx';

/** 토큰으로 이미 존재하는 9색 — raw hex 로 적으면 토큰 우회다(동결 가드들과 같은 목록). */
const TOKENIZED_HEX = [
  '#ffffff',
  '#222222',
  '#6a6a6a',
  '#9aa1ab',
  '#dddddd',
  '#ededed',
  '#ff385c',
  '#f7f7f7',
  '#ffe4e9',
];

/**
 * 스캔 전처리 — 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가
 * 소실된다). 줄 주석 규칙에서 **바로 앞 글자가 `:` 이면 주석으로 보지 않는다** —
 * `'https://…'` 의 슬래시를 주석 시작으로 오인하지 않기 위한 것이다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 생성물과 테스트 파일은 가드 대상이 아니다 — 전자는 도구가 쓰고, 후자는 이 규칙의 심판이다.
 * 디렉토리가 없으면 빈 배열(방어) — 구현 전에는 pages/saved-places 가 아직 없다. */
function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'generated' ? [] : listSourceFiles(full);
      }
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function readAll(files: string[]): { file: string; source: string }[] {
  return files.map((full) => ({
    file: path.relative(ROOT, full).split(path.sep).join('/'),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

/** 없는 파일은 빈 문자열 — 구현 전에도 "무엇이 없는가"를 읽을 수 있는 assertion diff 로
 * 남기기 위해서다(ENOENT 예외로 죽으면 diff 가 안 남는다). 빈 문자열이 부정 단언을 공짜로
 * 통과시키는 것은 같은 it 안의 긍정 짝이 먼저 막는다 — 리포 확립 규약. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: fs.existsSync(path.join(ROOT, rel)) };
}

function pagesSources() {
  return readAll(listSourceFiles(PAGES_DIR));
}

describe('탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('주석은 걷히고, 코드의 URL·라우트·낙관 표식·타이머는 살아남는다', () => {
    const sample = [
      '/**',
      ' * d02 담은 장소 — https://www.figma.com/design/x 의 1693:1183.',
      ' * duration 을 그리지 않는다(INV-3). setTimeout 도 쓰지 않는다.',
      ' */',
      '// const dead = setTimeout(hide, 3000);',
      "router.push('/trips/new/step1'); // 주석 속 duration",
      'const id = `optimistic:${poiId}`;',
      'const t = setTimeout(hide, 3000);',
      "const bad = 'https://cdn.example.com/x.jpg';",
      "const href = '/explore/places';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 걷지 않으면 "타이머를 쓰지 않는다"고 적은 주석 자체가
    //    부정 단언을 red 로 만든다(거짓 RED). 표본의 `setTimeout` 3개 중 2개가 주석이므로
    //    걷고 나면 **정확히 1개**(코드)만 남아야 한다.
    expect(/\bduration\b/.test(stripped)).toBe(false);
    expect(stripped).not.toContain('figma.com');
    expect(stripped.split('setTimeout').length - 1).toBe(1);

    // ② ★ 조합 검증 — 전처리를 태운 **뒤에도** 탐지 대상이 살아 있어야 한다. 순진한 `//.*`
    //    제거는 URL 줄을 `const bad = 'https:` 로 잘라 URL 단언을 공짜로 통과시키고, 같은
    //    사고가 라우트 리터럴에도 난다(2026-07-31 실사고).
    expect(stripped).toContain("const bad = 'https://cdn.example.com/x.jpg';");
    expect(/https?:\/\//.test(stripped)).toBe(true);
    expect(stripped).toContain("router.push('/trips/new/step1');");
    expect(stripped).toContain("const href = '/explore/places';");
    // ③ 이 칸에서 처음 태우는 문자열 — 콜론이 든 낙관 표식이 잘리지 않는다(01b Seed Q11).
    expect(stripped).toContain('const id = `optimistic:${poiId}`;');
  });
});

describe('G-2 · pages 층 모집단 — 스캔이 실제로 층 전체를 훑는가', () => {
  it('재귀 스캔에 새 슬라이스와 기존 슬라이스가 함께 잡힌다', () => {
    const files = pagesSources().map(({ file }) => file);

    // 이 칸이 만드는 슬라이스가 실제로 사정거리 안에 들어왔다 — 신설의 유일한 기계 심판.
    expect(files).toContain(SAVED_PAGE_REL);
    // 기존 거주자도 함께 잡힌다 — 구멍이 d02 전용이 아니라 **층 전체**로 메워졌다는 증거이자,
    // 모집단이 한 파일로 쪼그라들면 아래 스캔이 공허해지는 것을 막는 앵커다.
    expect(files).toContain(EXPLORE_PAGE_REL);
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});

describe('G-3·G-4 · pages 층 전수 — 층 규칙과 불변식', () => {
  it('duration·zustand·URL 리터럴·타이머·raw hex 가 층 전체에 0건이다', () => {
    const sources = pagesSources();

    // 긍정 짝 — 모집단이 채워졌고, 새 배선이 실제로 담기 훅 위에 서 있다. 없으면 아래
    // "위반 0건"이 빈 디렉토리에서도 공허하게 통과한다.
    const savedPage = sources.find(({ file }) => file === SAVED_PAGE_REL);
    expect(savedPage).toBeDefined();
    expect(savedPage?.source).toContain('useSavedPlaces');

    const durationOffenders = sources
      .filter(({ source }) => /\bduration\b/i.test(source))
      .map(({ file }) => file);
    expect(durationOffenders).toEqual([]);

    // 서버 데이터의 단일 소유자는 TanStack Query 캐시다(README §66). 정본 문서 한쪽이
    // "Zustand: 담기 낙관적 업데이트"로 반대로 적혀 있어 기계 가드가 필요하다.
    const storeOffenders = sources
      .filter(({ source }) => source.includes('zustand'))
      .map(({ file }) => file);
    expect(storeOffenders).toEqual([]);

    const urlOffenders = sources
      .filter(({ source }) => /https?:\/\//.test(source))
      .map(({ file }) => file);
    expect(urlOffenders).toEqual([]);

    // 배너·안내는 **다음 조작 시** 사라진다(01b Seed Q9). 타이머로 지우면 테스트에 가짜
    // 타이머가 들어오고, 그 순간 상태 판정 전부가 타이밍 의존이 된다.
    const timerOffenders = sources.flatMap(({ file, source }) =>
      ['setTimeout', 'setInterval']
        .filter((needle) => source.includes(needle))
        .map((needle) => `${file}: ${needle}`)
    );
    expect(timerOffenders).toEqual([]);

    const hexOffenders = sources.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(hexOffenders).toEqual([]);
  });
});

describe('G-5 · d02 층 책임 — 라우트 · 배럴 · 배선 · 화면', () => {
  it('네 파일이 실재하고 각자의 책임만 진다', () => {
    // 긍정 짝 — 파일이 실재해야 아래 읽기가 의미를 갖는다(없으면 ENOENT 예외 대신 깨끗한
    // assertion diff 로 남는다).
    [
      SAVED_ROUTE_REL,
      SAVED_BARREL_REL,
      SAVED_PAGE_REL,
      SAVED_SCREEN_REL,
    ].forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    // 라우트는 얇은 래퍼 — 조회도 마크업도 직접 만지지 않는다(정본 §1 의 라우트 골격).
    const routeSource = readOne(SAVED_ROUTE_REL);
    expect(routeSource).toContain('@/pages/saved-places');
    expect(routeSource).not.toContain('FlatList');
    expect(routeSource).not.toContain('useSavedPlaces');

    // 배럴이 빈 스텁이 아니라 실제로 심볼을 재수출한다(fsdStructure AC-2 규약).
    expect(readOne(SAVED_BARREL_REL)).toContain('SavedPlacesPage');

    // 배선은 조회·인증 판정·정렬·라우팅을 갖되 마크업은 모른다.
    const pageSource = readOne(SAVED_PAGE_REL);
    expect(pageSource).toContain('useSavedPlaces');
    expect(pageSource).toContain('orderSavedPlaces');
    expect(pageSource).toContain('getAccessToken');
    expect(pageSource).not.toContain('FlatList');
  });

  it('화면은 props 만 받고, 정렬을 다시 하지 않는다', () => {
    const screenSource = readOne(SAVED_SCREEN_REL);

    // 긍정 짝 — 읽은 것이 정말 그 화면이고, 승격한 안내 블록을 가져다 쓴다(README §60).
    expect(screenSource).toMatch(/export function SavedPlaceListScreen\b/);
    expect(screenSource).toContain('@/shared/ui/StateNotice');

    // 부정 — 화면이 정렬·조회·라우팅·로컬 상태를 가지면 진실이 두 층으로 갈린다.
    // (`features/explore` 재귀를 도는 동결 가드는 이 파일의 duration·zustand·URL·타 feature
    //  import 를 이미 본다 — 여기서는 그 가드에 **없는** 것만 세운다.)
    const FORBIDDEN = [
      'orderSavedPlaces',
      'useState',
      'useReducer',
      'expo-router',
      '@tanstack/react-query',
      'useSavedPlaces',
      '@/shared/api/generated/places',
    ];
    expect(FORBIDDEN.filter((needle) => screenSource.includes(needle))).toEqual(
      []
    );
  });
});

describe('01b Seed Q1 · 담기 훅이 목록 원본을 함께 준다', () => {
  it('반환에 savedPlaces 가 늘고, 기존 savedPoiIds 는 그대로 남아 있다', () => {
    const hookSource = readOne(HOOK_REL);

    // 긍정 — d02 가 `savedPlaceId`·`savedAt` 을 쓰려면 원본이 필요하다. 페이지가
    // `useGetSavedPlaces` 를 따로 부르면 `enabled: isAuthed` 가드가 두 곳으로 복제된다
    // (TRIP-220 W-3 이 났던 자리).
    expect(hookSource).toMatch(/return\s*\{[^}]*\bsavedPlaces\b/);
    // 긍정 짝 — **추가지 교체가 아니다.** d04(TRIP-221·222)가 이 값에 매달려 있어, 이름을
    // 갈아치우면 동결 37케이스가 통째로 깨진다.
    expect(hookSource).toMatch(/return\s*\{[^}]*\bsavedPoiIds\b/);
    // 01b Seed Q6(네 얼굴)을 그리려면 조회 상태도 같은 소유자에게서 와야 한다.
    expect(hookSource).toMatch(/return\s*\{[^}]*\brefetch\b/);
  });
});

describe('01b Seed Q5 · StateNotice 삽화 슬롯', () => {
  it('옵셔널 슬롯이 생기고, titleSize 는 들어오지 않는다', () => {
    const noticeSource = readOne(STATE_NOTICE_REL);
    const screenSource = readOne(SAVED_SCREEN_REL);

    // 긍정 — 슬롯이 실재하고, d02 가 실제로 그것을 쓴다. 슬롯만 만들고 안 쓰면 공용 부품만
    // 굵어진 셈이 된다.
    expect(noticeSource).toMatch(/\billustration\?:/);
    expect(noticeSource).toMatch(/export function StateNotice\b/);
    expect(screenSource).toContain('illustration=');

    // 부정 — 01b Seed Q5 가 명시적으로 거부한 확장이 슬쩍 따라 들어오지 않는다.
    expect(noticeSource).not.toContain('titleSize');
  });
});
