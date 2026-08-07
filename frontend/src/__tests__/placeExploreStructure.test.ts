/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * AC-G2(INV-3) · AC-G3(상태 소유권) · AC-G4(이미지 URL 발명 금지) · AC-G5(화면 순수성) ·
 * AC-G6(feature 경계) · AC-G7(토큰 우회) · AC-V2(SafeArea) — d04 소스 스캔 가드.
 *
 * 왜 소스 스캔인가 — 렌더 단언과 사정거리가 다르다. `PlaceExploreScreen.test.tsx` 는 "이번
 * 렌더에서 실제로 나온 출력"만 본다. 여기는 **조건부로만 렌더되는 코드·아예 렌더되지 않는
 * import** 까지 본다. 특히 상태 소유권(Query 냐 Zustand 냐)은 **화면 출력이 똑같아서**
 * 어떤 렌더 테스트로도 원리적으로 볼 수 없다.
 *
 * ★ 이 칸에서 이 가드가 특히 필요한 이유: 정본 문서가 반대로 적혀 있다.
 *   `aidlc/.../frontend-components.md` §2 PlaceExplorer 행의 state 칸 = "Zustand: 담기 낙관적
 *   업데이트" ↔ `frontend/README.md` §66 = "서버 응답을 Zustand 스토어에 복사하지 않는다".
 *   루트 CLAUDE.md 「When docs conflict」상 README 가 이기지만, **문서를 그대로 따르는 구현이
 *   기존 가드(`savedPlacesStructure.test.ts`)를 빠져나갈 수 있다** — 그 가드는 *서버 DTO
 *   식별자를 쓰는* 스토어만 잡아서 `savedByPoiId: Record<string, boolean>` 같은 파생값 스토어를
 *   놓친다(그 파일이 스스로 한계로 적어 뒀다). 여기서는 이 칸의 모집단에 한해 **zustand import
 *   자체**를 0건으로 잠근다.
 *
 * **전제 — 모든 it 은 주석을 걷어낸 소스를 스캔한다**(`stripComments`, 파일마다 각자 갖는 것이
 * 리포 관례). 걷어내지 않으면 머리말 산문("INV-3: duration 미표시")이 부정 단언을 대신
 * 만족시키는 거짓 GREEN 을 낸다.
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과
 * 같은 it 안에서 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** INV-3(소요시간 미표시) · 서버 상태 소유권(README §66) ·
 * FSD 층 경계 · 디자인 토큰 규칙이 유지되는 한 유효하다. 정본 문서의 Zustand 오기가
 * 정정되어도 이 가드는 그대로 둔다 — 규칙이 사라진 것이 아니라 문서가 규칙을 따라온 것이다.
 */

const ROOT = path.resolve('src');

/** 이 칸이 만드는 d04 표면 3층 + 담기 모델(스토어가 생긴다면 여기 생긴다). */
const EXPLORE_SURFACE_DIRS = [
  path.join(ROOT, 'features', 'explore'),
  path.join(ROOT, 'pages', 'place-explore'),
  path.join(ROOT, 'app', 'explore'),
];

const SCREEN_REL = 'features/explore/ui/PlaceExploreScreen.tsx';
const PAGE_REL = 'pages/place-explore/ui/PlaceExplorePage.tsx';
const ROUTE_REL = 'app/explore/places.tsx';

/** V1 모집단 — 화면 1파일 완전일치(`staySearchStructure.test.ts` SCREEN_FILES 선례).
 * 넓히면 안 된다: 이 칸이 만들지 않은 `RegionPickerScreen.tsx`(지역 틴트 그라디언트 ·
 * `placeholderTextColor="#9AA1AB"`)와 `ExploreGlyphs.tsx`(SVG 색 3종)가 즉시 offender 가 된다. */
const SCREEN_FILES = [SCREEN_REL];

/** 브리프 §4-4 의 OK 9색 — 전부 tailwind 토큰에 있으므로 raw hex 는 토큰 우회다. */
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
 * `'https://…'` 의 슬래시를 주석 시작으로 오인하지 않기 위한 것이다
 * (`savedPlacesStructure.test.ts` 의 것과 동형 · 완전한 파서를 만들지 않는 것이 의도다).
 * ★ 이 칸에서는 이게 장식이 아니다: 순진한 `//.*` 제거를 쓰면 `'https://cdn…'` 이 잘려
 * AC-G4(이미지 URL 발명 금지) 단언이 **거짓 green** 을 낸다(실측).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 생성물과 테스트 파일은 가드 대상이 아니다 — 전자는 도구가 쓰고, 후자는 이 규칙의 심판이다.
 * 디렉토리가 없으면 빈 배열(방어) — 구현 전에는 pages/place-explore 가 아직 없다. 방어 없이
 * readdirSync 를 걸면 예외로 죽어 "무엇이 없는가"를 읽을 diff 가 안 남는다. */
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

function exploreSurfaceSources() {
  return readAll(EXPLORE_SURFACE_DIRS.flatMap((dir) => listSourceFiles(dir)));
}

/** 없는 파일은 걸러 낸다 — 그래야 구현 전에도 "모집단이 비었다"는 읽을 수 있는 diff 가 남고,
 * readFileSync 의 ENOENT 예외로 죽지 않는다(`fsdStructure.test.ts` 방어와 같은 근거). */
function screenSources() {
  return readAll(
    SCREEN_FILES.map((rel) => path.join(ROOT, rel)).filter((full) =>
      fs.existsSync(full)
    )
  );
}

describe('탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('주석은 걷히고, 코드의 URL·식별자는 살아남는다', () => {
    const sample = [
      '/**',
      ' * Figma d04 1692:1183 — https://www.figma.com/design/x',
      ' * 이 화면은 duration 을 그리지 않는다(INV-3).',
      ' */',
      '// const dead = duration;',
      "const bad = 'https://cdn.example.com/' + place.poiId + '.jpg';",
      'const uri = place.imageUrl ?? null; // 주석 속 duration',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 산문·주석으로 적은 금칙어는 걸리지 않는다 — 걷지 않으면 이 파일들의 머리말이 스스로
    //    red 를 낸다(새 모듈이 INV-3 을 주석에 인용하는 것은 이 리포 관례다).
    expect(/\bduration\b/.test(stripped)).toBe(false);
    expect(stripped).not.toContain('figma.com');

    // ② ★ 가장 중요한 짝 — 코드의 URL 리터럴은 **살아남아야** 한다. 순진한 `//.*` 제거는
    //    이 줄을 `const bad = 'https:` 로 잘라 AC-G4 단언을 공짜로 통과시킨다(실측).
    expect(stripped).toContain(
      "const bad = 'https://cdn.example.com/' + place.poiId + '.jpg';"
    );
    expect(/https?:\/\//.test(stripped)).toBe(true);

    // ③ 코드의 식별자도 살아남는다 — 전처리가 다 지우면 아래 부정 단언 전부가 공허해진다.
    expect(stripped).toContain('place.imageUrl');
    expect(stripComments('const d = { duration: 1 };')).toContain('duration');
  });
});

describe('AC-G2 · INV-3 — d04 표면에 duration 식별자가 없다', () => {
  it('탐색 표면 전체에 duration 이 0건이고, 모집단에 화면 파일이 실제로 있다', () => {
    const sources = exploreSurfaceSources();

    // 긍정 짝 — 모집단이 비어 있지 않고 이 칸의 화면이 실제로 스캔됐다.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map(({ file }) => file)).toContain(SCREEN_REL);

    const offenders = sources
      .filter(({ source }) => /\bduration\b/i.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('AC-G3 · 담기·정렬·검색 상태를 Zustand 에 담지 않는다', () => {
  it('탐색 표면 어디에도 zustand import 가 없고, 담기 훅은 Query 위에 서 있다', () => {
    const sources = exploreSurfaceSources();

    // 긍정 짝 — 모집단에 화면·배선·담기 훅이 다 들어 있다.
    const files = sources.map(({ file }) => file);
    expect(files).toContain(SCREEN_REL);
    expect(files).toContain(PAGE_REL);
    expect(files).toContain('features/explore/model/savedPlaces.ts');

    // 부정 — 정본 문서(§2 PlaceExplorer "Zustand: 담기 낙관적 업데이트")를 따라가면 여기서
    // 걸린다. 서버 상태의 단일 소유자는 TanStack Query 캐시다(README §66).
    const offenders = sources
      .filter(({ source }) => source.includes('zustand'))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('AC-G4 · 이미지 URL 을 발명하지 않는다 (INV-1)', () => {
  it('화면이 계약의 imageUrl 을 쓰고, 표면 어디에도 URL 리터럴이 없다', () => {
    const sources = exploreSurfaceSources();
    const screen = sources.find(({ file }) => file === SCREEN_REL);

    // 긍정 짝 — 계약이 준 값을 **실제로 쓰고 있다**. 이게 없으면 "URL 0건"은 사진 자리를
    // 아예 안 만든 구현에서도 공허하게 통과한다.
    expect(screen).toBeDefined();
    expect(screen?.source).toContain('imageUrl');

    // 부정 — `Place.imageUrl` 이 NULL 인데 클라가 CDN 경로를 조립하면 INV-1 위반이다
    // (TRIP-219 커밋이 막으려던 바로 그 경로: "가짜 URL 은 클라에 깨진 이미지를 그린다").
    const offenders = sources
      .filter(({ source }) => /https?:\/\//.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('AC-G5 · 화면 프레젠테이션 순수성 · AC-G6 · feature 경계', () => {
  it('PlaceExploreScreen 이 props 만 받고, 네트워크·상태·라우팅·타 feature import 가 0건이다', () => {
    const [screenFile] = screenSources();

    // 긍정 짝
    expect(screenFile).toBeDefined();
    expect(screenFile.source).toMatch(/export function PlaceExploreScreen\b/);
    expect(screenFile.source).toContain('explore-places-card-');
    expect(screenFile.source).toContain('explore-places-save-');

    // 부정 — `@/shared/api` 를 통째로 금지하지 않는다(화면이 `Place` 타입 import 가 필요하다).
    // 데이터를 가져오는 경로·로컬 상태·라우팅·타 feature import 만 막는다.
    // `useState` 금지가 prop 계약의 기계 강제다: 검색어·카테고리의 주인이 페이지 하나여야
    // 진실이 한 곳에 남는다(`staySearchStructure.test.ts` 의 단일 출처 절과 같은 논리).
    // 타 feature import 금지는 `eslint.config.js` 의 FEATURES 배열이 `['onboarding','home']`
    // 뿐이라 `features/explore` 에 린트 강제가 아예 없어서다.
    const FORBIDDEN = [
      'useState',
      'useReducer',
      'zustand',
      'expo-router',
      '@tanstack/react-query',
      'axios',
      '@/shared/api/generated/places',
      'useGetPlaces',
      'useSavedPlaces',
      '@/features/stay',
      '@/features/trip',
      '@/features/home',
      '@/features/auth',
      '@/features/onboarding',
    ];
    const offenders = FORBIDDEN.filter((needle) =>
      screenFile.source.includes(needle)
    );
    expect(offenders).toEqual([]);
  });

  it('탐색 표면 어디에도 다른 feature 를 직접 import 하지 않는다', () => {
    const sources = exploreSurfaceSources();

    expect(sources.map(({ file }) => file)).toContain(PAGE_REL);

    const OTHER_FEATURES = [
      '@/features/stay',
      '@/features/trip',
      '@/features/home',
      '@/features/auth',
      '@/features/onboarding',
    ];
    const offenders = sources.flatMap(({ file, source }) =>
      OTHER_FEATURES.filter((needle) => source.includes(needle)).map(
        (needle) => `${file}: ${needle}`
      )
    );
    // StateNotice·SkeletonList 가 `features/stay/ui` 에 있지만 이 칸은 쓰지 않는다 —
    // 정답은 "explore 가 stay 를 import" 가 아니라 `shared/ui` 승격이고, 그 결정은 TRIP-222 다.
    expect(offenders).toEqual([]);
  });
});

describe('AC-G7 · 토큰 우회 금지', () => {
  it('PlaceExploreScreen 이 className 으로 스타일링되고, 토큰화된 9색 raw hex 가 없다', () => {
    const sources = screenSources();

    // 모집단 자기검증 — 필터가 조용히 0개/여러 개로 축소되는 것을 잡는다.
    expect(sources.map(({ file }) => file)).toEqual(SCREEN_FILES);
    sources.forEach(({ file, source }) => {
      expect({ file, styled: /className=/.test(source) }).toEqual({
        file,
        styled: true,
      });
    });

    // 부정 — 9색은 전부 tailwind 토큰에 있다. 그림자 #000000·사진 자리 대체 틴트처럼 토큰
    // 밖 색은 이 목록에 없으므로 자동 허용된다(`HomeScreen.tsx` 관례).
    const offenders = sources.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('AC-V2 · SafeArea 구조 가드', () => {
  it('화면 루트가 SafeAreaView 이고 edges 에 top 이 있으며, explore-places-root 를 갖는다', () => {
    const [screenFile] = screenSources();

    expect(screenFile).toBeDefined();
    expect(screenFile.source).toContain('react-native-safe-area-context');
    expect(screenFile.source).toContain('SafeAreaView');
    expect(screenFile.source).toMatch(/edges=\{\[[^\]]*'top'/);
    expect(screenFile.source).toContain('explore-places-root');

    // 잠그지 않는 것 — 안전영역의 실제 겹침은 기기의 물리적 형상값이라 렌더 트리에 없다.
    // 하단 CTA 바가 스크롤 영역 밖에 고정되는지도 여기서는 못 잰다([검증] 6-b 몫).
  });
});

describe('층 책임 분리 — 라우트 · 배선 · 화면', () => {
  it('세 파일이 각자의 책임만 지고, 정렬·검색 판정의 출처가 하나다', () => {
    const routePath = path.join(ROOT, ROUTE_REL);
    const pagePath = path.join(ROOT, PAGE_REL);
    const screenPath = path.join(ROOT, SCREEN_REL);

    // 긍정 짝 — 파일이 실재해야 아래 읽기가 의미를 갖는다.
    expect({
      route: fs.existsSync(routePath),
      page: fs.existsSync(pagePath),
      screen: fs.existsSync(screenPath),
    }).toEqual({ route: true, page: true, screen: true });

    const routeSource = stripComments(fs.readFileSync(routePath, 'utf8'));
    // 라우트는 얇은 래퍼 — 조회도 마크업도 직접 만지지 않는다.
    expect(routeSource).toContain('@/pages/place-explore');
    expect(routeSource).not.toContain('useGetPlaces');
    expect(routeSource).not.toContain('FlatList');

    const pageSource = stripComments(fs.readFileSync(pagePath, 'utf8'));
    // 배선은 조회·인증 판정·가공·라우팅을 갖되 마크업은 모른다.
    expect(pageSource).toContain('useGetPlaces');
    expect(pageSource).toContain('useSavedPlaces');
    expect(pageSource).toContain('visiblePlaces');
    expect(pageSource).toContain('getAccessToken');
    expect(pageSource).not.toContain('FlatList');

    const screenSource = stripComments(fs.readFileSync(screenPath, 'utf8'));
    // 화면이 정렬·검색을 다시 하면 진실이 두 곳에 생긴다(단일 출처).
    expect(screenSource).not.toContain('visiblePlaces');
  });
});
