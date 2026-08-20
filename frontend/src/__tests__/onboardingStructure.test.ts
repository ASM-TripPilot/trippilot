/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * AC C5 · C6(라우트) · D4 · E2 · F2 + 서버 권한 경계(구조 가드).
 *
 * 무엇을 보장하나: 렌더로는 관찰할 수 없는 **소스·파일 배치 수준의 제약**을 잠근다.
 *  - 온보딩 체인 라우트가 제자리에 있고 위치 라우트는 없다(D7 회귀 방지)
 *  - 색을 토큰이 아닌 하드코딩 hex 로 박지 않았다
 *  - 상태바 여백을 44px 로 굽지 않고 inset 으로 잡았다
 *  - 금칙어 사전이 클라이언트로 새어 들어오지 않았다
 *
 * **가짜 통과 방지 규약**: 이 파일의 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 **같은 it 안에서**
 * 짝을 이룬다. 부정 단언만 두면 대상 파일이 통째로 비어 있어도(=미구현) 초록으로 통과해 버린다.
 * 직전 사이클의 이해부채 「가짜 통과와 그것을 막는 단언」이 지적한 실패 양식이다.
 */

const ROOT = path.resolve('src');
const ONBOARDING_ROUTE_DIR = path.join(ROOT, 'app', '(onboarding)');
const TABS_ROUTE_DIR = path.join(ROOT, 'app', '(tabs)');
const FEATURE_DIR = path.join(ROOT, 'features', 'onboarding');
const LOCATION_DIR = path.join(ROOT, 'shared', 'location');
const PAGES_DIR = path.join(ROOT, 'pages');
/**
 * 온보딩 전용 페이지 슬라이스만 나열한다(`login`은 제외 — 이 가드는 온보딩 전용이다).
 * TRIP-173 사이클1에서 컨테이너 4개가 여기로 옮겨오면서 사정거리에 다시 넣어야 했다
 * (onboardingPrefStructure.test.ts:75-84와 같은 성격의 보정).
 */
const ONBOARDING_PAGE_SLICES = [
  'onboarding-location',
  'onboarding-nickname',
  'onboarding-pref1',
  'onboarding-pref2',
  'onboarding-terms',
];

/**
 * 화면 표면 스캔이 실제로 이 6개를 찾았는지 단언하는 모집단 목록(순서 고정) — 이동 전에는
 * `sources.length`만 봤지만, `ui/` 합류로 OnboardingGlyphs.tsx(raw-hex 12곳)가 같은 폴더에
 * 섞이면서 `*Screen.tsx` 필터만으로는 "몇 개를 찾았나"까지는 보장하지 못한다. 파일 목록을
 * 통째로 단언해야 필터가 조용히 축소되는 회귀를 잡는다(02a §3-C-4).
 */
const SCREEN_SOURCE_FILES = [
  'features/onboarding/ui/NicknameScreen.tsx',
  'features/onboarding/ui/PrefStep1Screen.tsx',
  'features/onboarding/ui/PrefStep2Screen.tsx',
  'features/onboarding/ui/TermsScreen.tsx',
  'shared/location/LocationGlyphs.tsx',
  'shared/location/LocationPreprompt.tsx',
];

/** Figma 토큰으로 이미 존재하는 13색 (브리프 §4-5) — 소스에 raw hex 로 나타나면 안 된다. */
const TOKENIZED_HEX = [
  '#ff385c',
  '#ffe4e9',
  '#c13515',
  '#f2f2f2',
  '#f7f7f7',
  '#222222',
  '#6a6a6a',
  '#9aa1ab',
  '#0b6e63',
  '#f0fcfa',
  '#a1e8dd',
  '#ededed',
  '#dddddd',
];

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
    source: fs.readFileSync(file, 'utf8'),
  }));
}

/** 온보딩 표면 전체(화면·컨테이너·컴포넌트·라우트·위치 프레임·페이지 배선). */
function onboardingSources() {
  return readAll([
    ...listSourceFiles(FEATURE_DIR),
    ...listSourceFiles(LOCATION_DIR),
    ...listSourceFiles(ONBOARDING_ROUTE_DIR),
    ...ONBOARDING_PAGE_SLICES.flatMap((slice) =>
      listSourceFiles(path.join(PAGES_DIR, slice))
    ),
  ]);
}

/** 화면 표면만 — 스타일·인셋 가드 대상. */
function screenSources() {
  return readAll([
    ...listSourceFiles(path.join(FEATURE_DIR, 'ui')).filter((f) =>
      f.endsWith('Screen.tsx')
    ),
    ...listSourceFiles(LOCATION_DIR).filter((f) => f.endsWith('.tsx')),
  ]);
}

describe('온보딩 라우트 배치 (AC C5 · D4)', () => {
  it('terms·nickname·location 라우트가 (onboarding) 체인에 있고, 위치 라우트는 (tabs) 밖이다 (D7 반전 · AC-10 · AC-2)', () => {
    // 긍정 — 체인 라우트가 실제로 있어야 한다.
    expect(fs.existsSync(path.join(ONBOARDING_ROUTE_DIR, 'terms.tsx'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(ONBOARDING_ROUTE_DIR, 'nickname.tsx'))).toBe(
      true
    );

    // 긍정(D7 반전, TRIP-459) — c08 이 nickname→pref1 체인에 라우트로 삽입됐다. Q4 로 라우트명은
    // `location`(도메인명 관례 terms/nickname/pref1/pref2 와 일치). 예전엔 "위치 라우트 0건" 을
    // 강제했으나, 온보딩 체인 안 프리프롬프트를 3-a 에서 채택하면서 뒤집는다.
    const onbRouteFiles = fs.readdirSync(ONBOARDING_ROUTE_DIR);
    expect(onbRouteFiles.filter((f) => /location/i.test(f))).toEqual([
      'location.tsx',
    ]);

    // 부정(짝) — 위치 라우트는 (tabs) 밖이다(BR-U0-29 무회귀 — 온보딩 전이 화면이라 탭바 없음).
    const tabsFiles = fs.existsSync(TABS_ROUTE_DIR)
      ? fs.readdirSync(TABS_ROUTE_DIR)
      : [];
    expect(tabsFiles.filter((f) => /location/i.test(f))).toEqual([]);
  });

  it('온보딩 라우트는 탭 그룹 밖에 있어 탭바가 그려지지 않는다 (BR-U0-29)', () => {
    // 긍정 — 온보딩 레이아웃이 존재한다.
    const layoutPath = path.join(ONBOARDING_ROUTE_DIR, '_layout.tsx');
    expect(fs.existsSync(layoutPath)).toBe(true);
    expect(fs.existsSync(path.join(ONBOARDING_ROUTE_DIR, 'terms.tsx'))).toBe(
      true
    );

    // 부정 — 온보딩 레이아웃이 Tabs 를 그리거나, 온보딩 화면이 탭 그룹에 있으면 탭바가 보인다.
    const layout = fs.readFileSync(layoutPath, 'utf8');
    expect(layout).not.toMatch(/\bTabs\b/);
    const tabsFiles = fs.existsSync(TABS_ROUTE_DIR)
      ? fs.readdirSync(TABS_ROUTE_DIR)
      : [];
    expect(tabsFiles.filter((f) => /terms|nickname/i.test(f))).toEqual([]);
  });
});

describe('색 토큰 사용 (AC F2)', () => {
  it('온보딩 화면이 실제로 스타일을 입고 있고, 그 어디에도 토큰화된 hex 를 직접 박지 않았다', () => {
    const sources = screenSources();
    expect(sources.map(({ file }) => file)).toEqual(SCREEN_SOURCE_FILES);

    // 긍정 — 화면이 NativeWind 클래스로 스타일링돼 있어야 한다(미구현 스텁이면 여기서 빨개진다).
    sources.forEach(({ file, source }) => {
      expect({ file, styled: /className=/.test(source) }).toEqual({
        file,
        styled: true,
      });
    });

    // 부정 — 13색은 전부 tailwind 토큰에 있으므로 raw hex 는 토큰 우회다.
    const offenders = sources.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('상태바 여백 (AC E2 · D4 결정)', () => {
  it('온보딩 화면이 safe-area inset 을 사용하고, Figma 의 44px 을 그대로 굽지 않았다', () => {
    const sources = screenSources();
    expect(sources.map(({ file }) => file)).toEqual(SCREEN_SOURCE_FILES);

    // 긍정 — 어느 화면이든 inset 을 실제로 읽어야 한다.
    // Figma 의 pt-44px 은 상태바 영역을 프레임에 구워 넣은 값이라 기기마다 어긋난다.
    const usesInsets = sources.some(
      ({ source }) =>
        /useSafeAreaInsets/.test(source) || /SafeAreaView/.test(source)
    );
    expect(usesInsets).toBe(true);

    // 부정 — 하드코딩된 상단 44px 이 남아 있으면 안 된다.
    const offenders = sources
      .filter(({ source }) => /pt-\[44px\]|paddingTop:\s*44\b/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('서버 권한 경계 — 금칙어·중복 판정 (BR-U0-17 · 루트 CLAUDE.md)', () => {
  it('클라이언트는 서버 검사 엔드포인트에 물어보고, 자체 금칙어 사전을 두지 않는다', () => {
    const sources = onboardingSources();
    expect(sources.length).toBeGreaterThan(0);

    // 긍정 — 판정을 서버에 위임한 흔적(check 엔드포인트 호출)이 실제로 있어야 한다.
    const asksServer = sources.some(({ source }) =>
      /nickname\/check|checkNickname/.test(source)
    );
    expect(asksServer).toBe(true);

    // 부정 — 금칙어 사전/차단 목록이 클라에 있으면 서버와 규칙이 갈라진다.
    // ('BANNED_WORD' 단수는 서버 응답 사유 코드라 정상 — 복수형 사전 식별자만 잡는다.)
    const offenders = sources
      .filter(({ source }) =>
        /BANNED_WORDS|bannedWords|forbiddenWords|profanityList|금칙어\s*사전/.test(
          source
        )
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
