import fs from 'fs';
import path from 'path';

/**
 * TRIP-296 h05·h07 **소스 층 가드**. 렌더로 못 보는 것(색 토큰 우회 · 셀렉터 계열 재사용 ·
 * 판정 중복 · 라우트 두께)만 본다 — 보이는 것은 화면 테스트가 맡는다.
 *
 * 무엇을 보장하나:
 *  - 토큰이 있는 색을 raw hex 로 우회하지 않는다(AC-V3). 브리프 §4-3 이 색 11종을 전부 토큰으로
 *    매핑했으므로 raw hex 0건이 달성 가능하다.
 *  - U1 위저드의 `trip-wizard-*` 셀렉터를 재사용하지 않는다(G-U3-4 — 화면이 달라 충돌한다).
 *  - 409 접기 판정이 **한 군데에만** 있다(01b D9 승격).
 *  - 라우트는 얇다 — 조회·변이는 `pages` 층 몫이다.
 *
 * ⚠️ **`duration` 식별자 스캔은 일부러 만들지 않는다.** 문제로그 `2026-08-08 INV-3 수호 주석이
 * duration 탐지기 함정이 된다` — 구현자가 `// INV-3 · duration 표시 금지` 라고 수호 주석을 다는
 * 순간 그 주석이 탐지기에 걸려 **어떤 구현으로도 통과 불가능한 심판**이 된다. INV-3 의 의무는
 * *"displayed"* 이므로 이 칸은 ① 자료형 경계(`mustVisitList.test.ts` C6) ② 렌더 결과 텍스트
 * (화면 테스트 C20·C31) 로 나눠 재고, `pages` 층 소스는 이미 `pagesLayerStructure.test.ts` G-3 이
 * `stripComments` + 자가검사를 갖춘 채 잠그고 있다(중복해서 만들지 않는다).
 *
 * ⚠️ **정정(TRIP-326)** — 원래 이 자리에는 *"`features` 간 직접 import 가드는 만들지 않는다 —
 * ESLint `import/no-restricted-paths` 가 막는다"* 고 적혀 있었다. **그 근거가 틀렸다.** 그 룰의
 * `FEATURES` 배열이 `['onboarding','home']` 뿐이라(`frontend/docs/structure.md` 경고 절 · 01b §4
 * 실측) **`itinerary` ↔ `explore` 는 실제로 안 막힌다.** `importBoundary.test.ts` 는 룰이
 * *살아 있음*만 검사하므로 그 공백을 못 본다. 근거가 틀린 채로 두면 다음 사람도 같은 이유로
 * 가드를 안 만든다 — 그래서 아래 **C38** 이 이 계열에 한해 소스로 직접 잰다(AC-19).
 */

const ROOT = path.resolve('src');

/** 스캔 모집단 두 디렉토리. `features/itinerary` 에는 TRIP-295 동결분도 함께 잡힌다(무해 —
 * 두 파일에 raw hex·`trip-wizard-` 가 0건임을 실측했다). */
const SCAN_DIRS = ['features/itinerary', 'pages/itinerary-mustvisit'];

const SCREEN_FILES = [
  'features/itinerary/ui/MustVisitPickerScreen.tsx',
  'features/itinerary/ui/MustVisitTimeScreen.tsx',
];

const LIST_ROUTE = 'app/trips/[tripId]/itinerary/must-visits/index.tsx';
const TIME_ROUTE = 'app/trips/[tripId]/itinerary/must-visits/[poiId].tsx';

const PROMOTED_409 = 'shared/api/isAlreadyRegistered.ts';
const STEP1_PAGE = 'pages/trip-new-step1/ui/TripNewStep1Page.tsx';

/** 브리프 §4-3 이 토큰으로 매핑한 11색 — 전부 `tailwind.config.js` 에 실재함을 실측했다.
 * raw hex 로 적으면 토큰 우회다(`placeExploreStructure`·`staySearchStructure` 와 같은 목록 형태). */
const TOKENIZED_HEX = [
  '#222222',
  '#6a6a6a',
  '#ededed',
  '#dddddd',
  '#ff385c',
  '#ffe4e9',
  '#c13515',
  '#f7f7f7',
  '#3f3f3f',
  '#9aa1ab',
  '#ffffff',
];

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다).
 * 줄 주석 규칙에서 **바로 앞 글자가 `:` 이면 주석으로 보지 않는다** — `'https://…'` 의 슬래시를
 * 주석 시작으로 오인하지 않기 위한 것이다(`pagesLayerStructure.test.ts` 와 같은 규칙).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 생성물·테스트 파일과 글리프 모듈은 대상이 아니다 — 앞 둘은 도구·심판이고, `*Glyphs.tsx` 는
 * SVG `stroke`/`fill` 이 className 을 못 받아 raw hex 가 정당하다(리포 전체 관례). 디렉토리가
 * 없으면 빈 배열(방어) — 구현 전에는 두 디렉토리 중 하나가 아직 없다. */
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

function scanSources(): { file: string; source: string }[] {
  return SCAN_DIRS.flatMap((rel) => listSourceFiles(path.join(ROOT, rel))).map(
    (full) => ({
      file: path.relative(ROOT, full).split(path.sep).join('/'),
      source: stripComments(fs.readFileSync(full, 'utf8')),
    })
  );
}

/** 없는 파일은 빈 문자열 — ENOENT 예외로 죽으면 "무엇이 없는가" 가 diff 에 안 남는다. 빈 문자열이
 * 부정 단언을 공짜로 통과시키는 것은 같은 it 안의 긍정 짝이 먼저 막는다(리포 확립 규약). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: fs.existsSync(path.join(ROOT, rel)) };
}

describe('C33 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 hex 는 걷히고, 코드의 hex·URL·라우트는 살아남는다', () => {
    // ★ 조합 검증 — 전처리와 탐지기가 서로를 지우는지 본다. 각 요소가 개별로 옳아도 조합이
    //   무너지면 아래 "위반 0건" 이 아무것도 안 보면서 통과한다(문제로그 2026-07-31).
    const sample = [
      '/** primary 는 #ff385c 다 — raw hex 로 적지 마라. */',
      '// bg-[#222222] 는 금지',
      'const cls = "bg-[#ff385c] text-[#222222]";',
      'const url = "https://cdn.example.com/a.png";',
      'stroke="#6a6a6a"',
      "router.push('/trips/x/itinerary/must-visits');",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석은 걷힌다 — 걷지 않으면 "raw hex 를 쓰지 마라" 고 적은 주석 자체가 red 를 만든다.
    expect(stripped).not.toContain('raw hex 로 적지 마라');
    expect(stripped).not.toContain('는 금지');

    // ② 코드의 탐지 대상은 전부 살아남는다. 순진한 `//.*` 제거는 URL 을 `"https:` 로 잘라
    //    뒤따르는 단언을 공짜로 통과시킨다.
    expect(stripped).toContain('bg-[#ff385c]');
    expect(stripped).toContain('text-[#222222]');
    expect(stripped).toContain('stroke="#6a6a6a"');
    expect(stripped).toContain('https://cdn.example.com/a.png');
    expect(stripped).toContain(
      "router.push('/trips/x/itinerary/must-visits');"
    );

    // ③ 탐지기 자체 — 걷힌 결과에서 코드 hex 3종이 실제로 검출된다.
    expect(
      TOKENIZED_HEX.filter((hex) => stripped.toLowerCase().includes(hex))
    ).toEqual(['#222222', '#6a6a6a', '#ff385c']);
  });
});

describe('C34 · AC-V3 — 토큰이 있는 색을 raw hex 로 우회하지 않는다', () => {
  it('화면 두 파일이 모집단에 있고, 토큰화된 11색이 0건이다', () => {
    const sources = scanSources();
    const files = sources.map(({ file }) => file);

    // 긍정 앵커 — 없으면 빈 디렉토리에서 아래 부정 단언이 공허하게 통과한다.
    SCREEN_FILES.forEach((rel) => expect(files).toContain(rel));

    const offenders = sources.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('C35 · AC-1 · G-U3-4 — U1 셀렉터 계열을 재사용하지 않는다', () => {
  it('itinerary-mustvisit- 접두가 실재하고, trip-wizard- 접두는 0건이다', () => {
    const sources = scanSources();

    // 긍정 — 새 계열이 실제로 쓰이고 있다.
    const withOwnPrefix = sources
      .filter(({ source }) => source.includes('itinerary-mustvisit-'))
      .map(({ file }) => file);
    expect(withOwnPrefix.length).toBeGreaterThan(0);

    // 부정 — U1 위저드 셀렉터를 그대로 가져오면 두 화면의 셀렉터가 충돌한다(G-U3-4).
    const offenders = sources
      .filter(({ source }) => source.includes('trip-wizard-'))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('C36 · 01b D9 — 409 접기 판정이 한 군데에만 있다', () => {
  it('shared/api 로 승격되고, 위저드 배선의 지역 정의는 사라진다', () => {
    // 긍정 — 승격 대상 파일이 실재하고 심볼을 내보낸다.
    expect(existsPair(PROMOTED_409)).toEqual({
      file: PROMOTED_409,
      exists: true,
    });
    expect(readOne(PROMOTED_409)).toMatch(
      /export function isAlreadyRegistered\b/
    );

    // 긍정 — 기존 사용처가 그것을 shared 층에서 실제로 가져다 쓴다.
    const step1 = readOne(STEP1_PAGE);
    expect(step1).toMatch(
      /import \{[^}]*isAlreadyRegistered[^}]*\} from '@\/shared\/api/
    );

    // 부정 — 같은 판정이 지역 함수로 또 있으면 승격의 값(한 군데)이 사라진다.
    // ⚠️ 이 단언은 **다른 티켓의 파일**을 이 칸이 고치게 만든다(01b D9 가 명시한 번짐).
    expect(step1).not.toMatch(/function isAlreadyRegistered\b/);
  });
});

describe('C37 · 라우트 두께 — 배선은 pages 층이 진다', () => {
  it('h05·h07 라우트 2개가 실재하고 pages 슬라이스를 가리키며 조회·변이를 하지 않는다', () => {
    [LIST_ROUTE, TIME_ROUTE].forEach((rel) => {
      // 긍정(짝) — 파일이 실재한다. `typedRoutes: true` 라 목적지 파일이 없으면 `router.push`
      // 가 타입 단계에서 막힌다 — h05→h07 이동을 쓰려면 둘 다 있어야 한다.
      expect(existsPair(rel)).toEqual({ file: rel, exists: true });

      const source = readOne(rel);
      // 긍정 — 배럴 경유로 pages 층을 참조한다(딥 임포트 금지 · `trips/new/step1.tsx` 선례).
      expect(source).toContain('@/pages/itinerary-mustvisit');
      // 부정 — 라우트는 얇다. 조회·변이가 여기 있으면 `pages` 층 가드의 사정거리 밖으로 샌다.
      expect(source).not.toMatch(/\buseQuery\b|\buseMutation\b/);
    });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-326 추가분 — features 경계(AC-19) · 지도 배럴(02a ★11).
 * ──────────────────────────────────────────────────────────────────────────── */

const SCREEN_REL = 'features/itinerary/ui/MustVisitPickerScreen.tsx';

/** 디렉토리 하나만 훑는다. 기존 `scanSources()` 는 두 디렉토리를 합쳐 주므로 "어느 쪽에
 * 있으면 안 되고 어느 쪽에는 있어야 하는가" 를 가를 수 없다. */
function scanOneDir(rel: string): { file: string; source: string }[] {
  return listSourceFiles(path.join(ROOT, rel)).map((full) => ({
    file: path.relative(ROOT, full).split(path.sep).join('/'),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

describe('C38 · AC-19 — features/itinerary 가 다른 feature 를 직접 가져오지 않는다', () => {
  it('탐지기 자가검사 — 주석 속 경계 설명은 걷히고 코드의 import 는 살아남는다', () => {
    // ★ 조합 검증(문제로그 2026-07-31). 이 파일들의 주석에는 `@/features/explore` 같은 경로가
    //   설명으로 잔뜩 등장한다 — 전처리가 그것을 안 걷으면 **거짓 RED**(주석 때문에 위반),
    //   너무 걷으면 **거짓 GREEN**(코드의 import 가 사라짐)이 된다. 둘 다 아님을 표본으로 잰다.
    const sample = [
      '/** 조합은 pages 층 몫이다 — 화면이 @/features/explore 를 직접 부르면 위반이다. */',
      '// import { useSavedPlaces } from "@/features/explore/model/savedPlaces";',
      "import { useSavedPlaces } from '@/features/explore/model/savedPlaces';",
      "const doc = 'https://example.com/features/explore';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 두 줄은 걷힌다 — 표본의 `@/features/explore` 3개(블록 주석 1 + 줄 주석 1 +
    //    코드 1) 중 **정확히 1개**만 남는다. URL 줄에는 `@` 가 없어 이 셈에 안 들어간다.
    expect(stripped.split('@/features/explore').length - 1).toBe(1);
    expect(stripped).not.toContain('직접 부르면 위반이다');

    // ② 코드의 import 문은 통째로 살아남는다. 순진한 `//.*` 제거는 URL 을 `'https:` 로 잘라
    //    뒤따르는 단언을 공짜로 통과시킨다.
    expect(stripped).toContain(
      "import { useSavedPlaces } from '@/features/explore/model/savedPlaces';"
    );
    expect(stripped).toContain('https://example.com/features/explore');

    // ③ 탐지기 자체 — import 문 형태만 잡고 URL 은 안 잡는다.
    const FOREIGN_FEATURE_IMPORT = /from\s+'@\/features\/(?!itinerary\/)/g;
    expect(stripped.match(FOREIGN_FEATURE_IMPORT)).toHaveLength(1);
    expect(
      "const doc = 'https://example.com/features/explore';".match(
        FOREIGN_FEATURE_IMPORT
      )
    ).toBeNull();
  });

  it('화면 층에는 0건이고, 조인이 실제로 일어나는 pages 층에는 실재한다', () => {
    const FOREIGN_FEATURE_IMPORT = /from\s+'@\/features\/(?!itinerary\/)/;

    // 긍정 앵커 — 모집단이 비어 있지 않다. 빈 디렉토리에서는 아래 부정 단언이 공허하다.
    const featureSources = scanOneDir('features/itinerary');
    expect(featureSources.map(({ file }) => file)).toContain(SCREEN_REL);

    // 🔴 부정 — 화면·모델이 남의 feature 를 직접 물면 두 슬라이스가 서로를 끌고 다닌다.
    //    **기계 강제가 없는 자리다**(머리말 정정 참조) — 이 줄이 유일한 심판이다.
    const offenders = featureSources
      .filter(({ source }) => FOREIGN_FEATURE_IMPORT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);

    // 🔴 짝 — 조인은 **어딘가에서는 실제로 일어나야 한다**. `pages` 층이 `features/explore` 의
    //    담기 훅을 물고 있다는 사실이 위 0건을 "아무도 안 쓰는 상태" 와 구별한다.
    const pageSources = scanOneDir('pages/itinerary-mustvisit');
    const joiners = pageSources
      .filter(({ source }) => source.includes("from '@/features/explore/"))
      .map(({ file }) => file);
    expect(joiners.length).toBeGreaterThan(0);
  });
});

describe('C39 · 02a ★11 — h05 화면이 지도를 배럴로 가져온다', () => {
  it('MustVisitPickerScreen 이 @/shared/map 배럴을 쓰고 딥 임포트가 0건이다', () => {
    const source = readOne(SCREEN_REL);

    // 긍정(짝) — 읽은 것이 정말 그 화면이다. 경로를 잘못 적으면 `readOne` 이 빈 문자열을
    // 돌려주므로 이 줄이 없으면 아래 부정 단언이 공짜로 통과한다.
    expect(source).toMatch(/export function MustVisitPickerScreen\b/);

    // 🔴 배럴 경유여야 한다. 딥 임포트면 화면 테스트의 `jest.mock('@/shared/map', …)` 이 안 붙어
    //    실물이 렌더되고, JS 키 없는 jest 에서 `map-failure` 로 떨어진다 — 테스트는 red 인데
    //    **이유가 AC 와 무관해** 구현자가 엉뚱한 곳을 고친다(`itineraryDraftStructure` G5 선례).
    expect(source).toContain("from '@/shared/map'");
    expect(source).not.toContain('@/shared/map/KakaoMapView');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-599 추가분 — h07 시작 시각이 shared 휠 primitive 를 **실제로 소비**하는가.
 *
 * 왜 소스로 재나: 렌더 테스트(`MustVisitTimeScreen.test.tsx` C26)는 "48개 시각 셀이 뜨고
 * press → onPickStart" 까지만 본다 — 그 계약은 **평면 리스트를 그대로 둬도** 통과한다. 즉 어떤
 * 렌더 심판도 "휠로 교체가 실제로 일어났는가" 를 못 본다(휠의 스냅 자체는 jest 사각 · 6-b 실기).
 * 그래서 최소한 "h07 이 신설 primitive 를 import·렌더한다" 만이라도 소스로 잠근다 —
 * `StateNotice` 승격 선례(`sharedUiStructure.test.ts` "승격은 이동이지 복제가 아니다")와 동형.
 * 휠 **내부** 구현은 지시하지 않는다(02a ★5 — 더 게으른 구현 여지). import+렌더만 계약이다.
 * ──────────────────────────────────────────────────────────────────────────── */

const SHARED_WHEEL = 'shared/ui/WheelPicker.tsx';
const TIME_SCREEN_REL = 'features/itinerary/ui/MustVisitTimeScreen.tsx';

describe('C40 · TRIP-599 — h07 시작 시각이 shared 휠 primitive 를 소비한다', () => {
  it('WheelPicker 가 shared/ui 에 실재하고, h07 화면이 그것을 import·렌더한다', () => {
    // 긍정 — 신설 primitive 파일이 실재하고 그 컴포넌트를 내보낸다.
    expect(existsPair(SHARED_WHEEL)).toEqual({
      file: SHARED_WHEEL,
      exists: true,
    });
    expect(readOne(SHARED_WHEEL)).toMatch(/export function WheelPicker\b/);

    // 긍정(짝) — h07 화면이 shared 경로로 가져와서 **실제로 렌더**한다. `@/` 접두가 URL 오탐을
    //   가른다(URL 에는 `@` 가 없다 · 02a §5-1). import 만 하고 안 그리는 상태(평면 리스트를 그대로
    //   두고 컴포넌트만 미사용)를 `<WheelPicker` 렌더 단언이 막는다.
    const screenSrc = readOne(TIME_SCREEN_REL);
    expect(screenSrc).toContain("from '@/shared/ui/WheelPicker'");
    expect(screenSrc).toMatch(/<WheelPicker\b/);
  });
});
