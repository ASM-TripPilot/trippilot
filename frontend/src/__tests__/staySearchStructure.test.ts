/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * AC-5(소스 절반) · AC-6(단일 출처) · AC-7(소스 절반) · AC-8 · AC-9(소스 절반) · V1(01b Seed) —
 * 숙소 검색 결과 소스 스캔 가드.
 *
 * 왜 소스 스캔인가 — 두 층은 사정거리가 다르다. `StaySearchScreen.test.tsx`의 렌더 단언은
 * "이번 렌더에서 실제로 나온 출력"만 본다. 여기(소스 스캔)는 **조건부로만 렌더되는 코드·아예
 * 렌더되지 않는 import**까지 본다 — INV-3처럼 "어떤 경로로도 나오면 안 되는 것"과, FSD 층
 * 경계처럼 "출력에 안 보이는 것"은 소스 층이라야 잡힌다(선례: `homeStructure.test.ts`가 같은
 * INV-3을 소스(D-2)와 렌더(HomeScreen A-5) 양쪽에서 잡는다).
 *
 * **전제 — 이 파일의 모든 it은 주석을 걷어낸 소스를 스캔한다**(`stripComments`,
 * `tabbarVisual.test.ts`·`staySearchGenerated.test.ts`의 것과 동형 — 공용화하지 않고 파일마다
 * 각자 갖는 것이 리포 관례다). 걷어내지 않으면 헤더 주석의 산문("INV-3: duration 미표시" 같은
 * 문장)이 부정 단언을 대신 만족시키는 거짓 GREEN을 낸다(`tabbarVisual` 게이트①-2 실사고).
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과
 * 같은 it 안에서 짝을 이룬다.
 */

const ROOT = path.resolve('src');

/** STAY_SURFACE 모집단 — 숙소 도메인 3층 전부(테스트 파일 제외). */
const STAY_SURFACE_DIRS = [
  path.join(ROOT, 'features', 'stay'),
  path.join(ROOT, 'pages', 'stay-search'),
  path.join(ROOT, 'app', 'stays'),
];

/** V1(raw hex 0건) 모집단 — 화면 1파일 완전일치 앵커(선례: `HOME_SCREEN_SOURCE_FILES`).
 * 글리프 모듈(예: `StayGlyphs.tsx`)이 features/stay/ui에 더 생겨도 이 목록은 그대로다
 * (02a §6 판정②, `HomeGlyphs.tsx`가 `homeStructure.test.ts`의 D-3 스캔 밖인 것과 동형). */
const SCREEN_FILES = ['features/stay/ui/StaySearchScreen.tsx'];

/** 토큰으로 이미 존재하는 11색(브리프 §4-2 — 이 화면은 색 MISS가 0건이라 예외가 없다).
 * 추가 4색(surface-soft·primary-pale·muted-soft·surface-strong)은 TRIP-182 상태 변형이
 * 새로 쓰는 색이다(02a §6-1). */
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

/**
 * 스캔 전처리 — 소스에서 주석을 걷어낸다. `tabbarVisual.test.ts`의 것과 동형인 2-정규식
 * 근사이고, 완전한 파서를 만들지 않는 것이 의도다. 블록 주석을 먼저 지운다 — 순서를 바꾸면
 * `/* a // b *​/ const keep = 2;` 같은 한 줄에서 코드가 소실된다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

/** 디렉토리가 없으면 빈 배열(방어) — 구현 전에는 pages/stay-search·app/stays가 아직 없다.
 * 방어 없이 readdirSync를 걸면 예외로 죽어 "무엇이 없는가"를 읽을 diff가 안 남는다
 * (`fsdStructure.test.ts:140` 근거와 동일). */
function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSourceFiles(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return []; // 테스트 파일은 가드 대상이 아니다
      return [full];
    })
    .sort();
}

function readAll(files: string[]): { file: string; source: string }[] {
  return files.map((file) => ({
    file: path.relative(ROOT, file),
    source: stripComments(fs.readFileSync(file, 'utf8')),
  }));
}

/** 숙소 표면 전체(화면·배선·라우트·모델) — INV-3 grep 모집단. */
function staySurfaceSources() {
  return readAll(STAY_SURFACE_DIRS.flatMap((dir) => listSourceFiles(dir)));
}

/** 화면 1파일만 — V1(raw hex)·프레젠테이션 순수성 스캔 대상. */
function screenSources() {
  return readAll(SCREEN_FILES.map((rel) => path.join(ROOT, rel)));
}

describe('INV-3 · 숙소 화면 표면에 duration 식별자 없음 (AC-5 소스 절반)', () => {
  it('STAY_SURFACE 전체에 duration 식별자가 0건이고, 모집단에 화면 파일이 실제로 있다', () => {
    const sources = staySurfaceSources();

    // 긍정 짝 — 모집단이 비어 있지 않고, 화면 파일이 실제로 스캔됐다는 증거.
    expect(sources.length).toBeGreaterThan(0);
    expect(
      sources.some(
        ({ file }) => file === 'features/stay/ui/StaySearchScreen.tsx'
      )
    ).toBe(true);

    // 부정 — DTO·식별자 수준 duration 전면 금지(INV-3).
    const offenders = sources
      .filter(({ source }) => /\bduration\b/i.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('토큰 사용 — 숙소 화면 (V1)', () => {
  it('StaySearchScreen.tsx가 className으로 스타일링돼 있고, 토큰화된 7색 raw hex는 어디에도 없다', () => {
    const sources = screenSources();

    // 모집단 자기검증 — 필터가 조용히 0개/여러 개로 축소되는 것을 잡는다.
    expect(sources.map(({ file }) => file)).toEqual(SCREEN_FILES);
    sources.forEach(({ file, source }) => {
      expect({ file, styled: /className=/.test(source) }).toEqual({
        file,
        styled: true,
      });
    });

    // 부정 — 7색은 전부 tailwind 토큰에 있으므로 raw hex는 토큰 우회다. 카드 그림자
    // #000000은 이 목록에 없으므로 자동 허용된다(HomeScreen.tsx softCardShadow 관례).
    const offenders = sources.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('화면 프레젠테이션 순수성 · 스텁 정직성 (Seed §2 · AC-7 소스 절반)', () => {
  it('StaySearchScreen.tsx가 필터·저장 testID를 갖고, 네트워크·상태·타 feature import가 0건이다', () => {
    const [screenFile] = screenSources();

    // 긍정 짝
    expect(screenFile).toBeDefined();
    expect(screenFile.source).toMatch(/export function StaySearchScreen\b/);
    expect(screenFile.source).toContain('stay-search-filter-');
    expect(screenFile.source).toContain('stay-card-save-');

    // 부정 — `@/shared/api`를 통째로 금지하지 않는다(화면이 StayItem 타입 import가
    // 필요하다, T-15). 데이터를 가져오는 경로·로컬 상태·타 feature import만 막는다.
    // `useState` 금지가 AC-7의 본체다 — Seed §0 Q9(정적 미저장 하트)를 기계로 잠그는
    // 가장 직접적인 형태이고, 렌더 지문 비교(it 2-6)가 못 보는 "조건부로만 나타나는
    // 토글"까지 잡는다. 타 feature import 금지는 `eslint.config.js`의 FEATURES 배열이
    // `['onboarding','home']`뿐이라 `features/stay`에는 린트 강제가 없어서다(T-16 실측).
    const FORBIDDEN = [
      'useState',
      'useReducer',
      'zustand',
      'expo-router',
      '@tanstack/react-query',
      'axios',
      '@/shared/api/generated/stays',
      'useStaySearch',
      '@/features/home',
      '@/features/auth',
      '@/features/onboarding',
    ];
    const offenders = FORBIDDEN.filter((needle) =>
      screenFile.source.includes(needle)
    );
    expect(offenders).toEqual([]);
  });
});

describe('배선·라우트가 각자의 자리를 지킨다 (AC-8 · AC-9 소스 절반 · AC-6 단일 출처)', () => {
  it('StaySearchPage.tsx·src/app/stays/index.tsx·StaySearchScreen.tsx가 각자의 책임만 진다', () => {
    const pagePath = path.join(
      ROOT,
      'pages',
      'stay-search',
      'ui',
      'StaySearchPage.tsx'
    );
    const routePath = path.join(ROOT, 'app', 'stays', 'index.tsx');
    const screenPath = path.join(
      ROOT,
      'features',
      'stay',
      'ui',
      'StaySearchScreen.tsx'
    );

    // 긍정 짝 — 파일이 실재해야 아래 읽기가 의미를 갖는다.
    expect(fs.existsSync(pagePath)).toBe(true);
    expect(fs.existsSync(routePath)).toBe(true);

    const pageSource = stripComments(fs.readFileSync(pagePath, 'utf8'));
    // 배선(pages)은 훅을 부르고 폴백값을 갖되, 마크업(FlatList)은 모른다.
    expect(pageSource).toContain('useLocalSearchParams');
    expect(pageSource).toContain('useStaySearch');
    expect(pageSource).toContain("'부산'");
    expect(pageSource).not.toContain('FlatList');

    const routeSource = stripComments(fs.readFileSync(routePath, 'utf8'));
    // 라우트는 얇은 래퍼 한 줄 — 훅도 마크업도 직접 만지지 않는다(AC-8 마지막 문장).
    expect(routeSource).toContain('@/pages/stay-search');
    expect(routeSource).not.toContain('useStaySearch');
    expect(routeSource).not.toContain('useLocalSearchParams');
    expect(routeSource).not.toContain('FlatList');

    const screenSource = stripComments(fs.readFileSync(screenPath, 'utf8'));
    // React의 key는 렌더 트리에서 관찰할 수 없다 — 반대로 증명한다. 화면이 stayKey
    // 말고는 키를 만들 재료(externalId)를 아예 안 만진다면, keyExtractor도 testID도
    // stayKey에서 나올 수밖에 없다(testID 쪽은 StaySearchScreen.test.tsx it 2-2가 이미
    // stayKey(item)으로 기대값을 계산해 확인했다).
    expect(screenSource).toContain('stayKey');
    expect(screenSource).toContain('keyExtractor');
    expect(screenSource).not.toContain('externalId');
  });
});

// ── TRIP-182 확장(02a §6-2) — 아래부터는 신규 describe 3개다. 위 4개 describe의 it 본문은
// 한 글자도 바뀌지 않았다(TOKENIZED_HEX 상수 확장만 위에서 했다).

/** `features/stay/ui` 디렉토리를 동적으로 훑는다(`*Glyphs.tsx` 제외) — `SCREEN_FILES`
 * 배열을 늘리지 않고도 상태 부품 파일을 사정거리에 넣는 방식이다(02a §6-2 판정②).
 * `Glyphs.tsx`를 빼는 이유는 SCREEN_FILES 주석과 동일 — SVG stroke/fill 색은 className으로
 * 줄 수 없어 raw hex가 정당하다. */
function stayUiSources() {
  return readAll(
    listSourceFiles(path.join(ROOT, 'features', 'stay', 'ui')).filter(
      (file) => !/Glyphs\.tsx$/.test(file)
    )
  );
}

describe('상태 부품 파일도 토큰·경계를 지킨다 (V1 사정거리 확장 · 02a §6-2)', () => {
  it('features/stay/ui 전체가 className 스타일링이고, 토큰화된 11색 raw hex·FORBIDDEN 문자열이 0건이다', () => {
    const sources = stayUiSources();

    // 긍정 짝 ① — 모집단에 화면 파일이 실제로 있다.
    expect(sources.map((s) => s.file)).toContain(
      'features/stay/ui/StaySearchScreen.tsx'
    );
    // 긍정 짝 ② — 상태 부품이 별도 파일로 분해됐다는 증거. 전부 인라인이면 이 숫자가
    // 1로 멈춰 아래 부정 단언들이 조용히 공허해진다.
    expect(sources.length).toBeGreaterThan(1);
    // 긍정 짝 ③
    sources.forEach(({ file, source }) => {
      expect({ file, styled: /className=/.test(source) }).toEqual({
        file,
        styled: true,
      });
    });

    // 부정 ① — 11색 raw hex 0건(기존 V1 describe와 동형).
    const hexOffenders = sources.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(hexOffenders).toEqual([]);

    // 부정 ② — 이번 확장의 실질. 화면 1파일 스캔으로는 features/stay가 eslint FEATURES
    // 배열 밖이라 `@/features/auth` 같은 타 feature 직접 import를 아무도 못 잡는다.
    const FORBIDDEN_IN_STAY_UI = [
      'useState',
      'useReducer',
      'zustand',
      'expo-router',
      '@tanstack/react-query',
      'axios',
      '@/shared/api/generated/stays',
      'useStaySearch',
      '@/features/home',
      '@/features/auth',
      '@/features/onboarding',
    ];
    const forbiddenOffenders = sources.flatMap(({ file, source }) =>
      FORBIDDEN_IN_STAY_UI.filter((needle) => source.includes(needle)).map(
        (needle) => `${file}: ${needle}`
      )
    );
    expect(forbiddenOffenders).toEqual([]);
  });
});

describe('SafeArea 구조 가드 (AC-13)', () => {
  it('StaySearchScreen.tsx 루트가 SafeAreaView이고 edges에 top이 있으며, stay-search-root가 유지된다', () => {
    const screenPath = path.join(
      ROOT,
      'features',
      'stay',
      'ui',
      'StaySearchScreen.tsx'
    );
    const source = stripComments(fs.readFileSync(screenPath, 'utf8'));

    expect(source).toContain('react-native-safe-area-context');
    expect(source).toContain('SafeAreaView');
    expect(source).toMatch(/edges=\{\[[^\]]*'top'/);
    expect(source).toContain('stay-search-root');

    // 잠그지 않는 것 — 안전영역의 실제 겹침은 기기의 물리적 형상값이라 렌더 트리에 없다.
    // jest가 잴 수 있는 것은 여기까지고, 겹침 여부는 [검증] 6-b 실기 스모크 소관이다.
  });
});

describe('AC-8 배선: 판정의 단일 출처', () => {
  it('resolveStaySearchState는 StaySearchPage만 부르고, StaySearchScreen은 다시 부르지 않는다', () => {
    const pagePath = path.join(
      ROOT,
      'pages',
      'stay-search',
      'ui',
      'StaySearchPage.tsx'
    );
    const screenPath = path.join(
      ROOT,
      'features',
      'stay',
      'ui',
      'StaySearchScreen.tsx'
    );
    const pageSource = stripComments(fs.readFileSync(pagePath, 'utf8'));
    const screenSource = stripComments(fs.readFileSync(screenPath, 'utf8'));

    expect(pageSource).toContain('resolveStaySearchState');
    // 화면이 판정을 다시 유도하면 진실이 두 곳에 생긴다(Seed §2-1) — 짝은 위 긍정 단언.
    expect(screenSource).not.toContain('resolveStaySearchState');
  });
});

// ── TRIP-413 확장 — 하단 탭바 복구. 위 describe 들의 it 본문은 한 글자도 바뀌지 않았다.
describe('탭바 배선(TRIP-413): 죽은 빈 함수가 남지 않는다', () => {
  it('StaySearchScreen 이 BottomTabBar 를 onPressTab prop 으로 잇고, 빈 함수 스텁이 없다', () => {
    const screenPath = path.join(
      ROOT,
      'features',
      'stay',
      'ui',
      'StaySearchScreen.tsx'
    );
    const source = stripComments(fs.readFileSync(screenPath, 'utf8'));

    // 긍정 짝 — 탭바가 실재하고 onPressTab 배선이 있다.
    expect(source).toContain('BottomTabBar');
    expect(source).toContain('onPressTab');

    // 부정 — 죽은 빈 함수 스텁(눌러도 무동작)이 남지 않는다(금지 AC). 공백 유무만 다른
    // 두 형태를 다 막는다.
    expect(source).not.toMatch(/onPressTab=\{\(\)\s*=>\s*\{\s*\}\}/);
  });
});

// ── TRIP-414 확장 — FAB 배선. 위 describe 들의 it 본문은 한 글자도 바뀌지 않았다.
describe('FAB 배선(TRIP-414): 죽은 undefined onPress 가 남지 않는다', () => {
  it('stay-search-fab 이 onPress 콜백을 잇고, onPress={undefined} 스텁이 없다', () => {
    const screenPath = path.join(
      ROOT,
      'features',
      'stay',
      'ui',
      'StaySearchScreen.tsx'
    );
    const source = stripComments(fs.readFileSync(screenPath, 'utf8'));

    // 긍정 짝 — FAB 이 실재하고 콜백 prop 을 잇는다.
    expect(source).toContain('stay-search-fab');
    expect(source).toContain('onPressCreateTrip');

    // 부정 — FAB 블록에 onPress={undefined} 죽은 스텁이 남지 않는다(금지 AC). FAB Pressable
    // 여는 태그부터 닫는 태그까지 잘라 그 안만 본다(저장 하트의 onPress={undefined}는 범위 밖).
    const fabStart = source.indexOf('stay-search-fab');
    const fabBlock = source.slice(fabStart, fabStart + 400);
    expect(fabBlock).not.toMatch(/onPress=\{undefined\}/);
  });
});
