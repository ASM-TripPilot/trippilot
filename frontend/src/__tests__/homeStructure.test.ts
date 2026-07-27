/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * SC-2 · SC-3 · AC-V1(기계 절반) · §7-14 SafeArea 규약 · AC-9 — 홈 소스 스캔 가드.
 *
 * 무엇을 보장하나: 렌더로는 관찰할 수 없는 **소스·파일 배치 수준의 제약**을 잠근다.
 *  - 픽스처가 Figma 표시값 그대로 상수화돼 있고, 홈이 서버 호출·네비 심볼을 직접 물지 않는다
 *  - INV-3: home·(tabs) 소스 어디에도 `duration` 식별자가 없다(표시 문구 수준 검증은
 *    HomeScreen.test.tsx의 A-5가 런타임·스코프 단언으로 맡는다 — 이원화 이유는 02a §6-6)
 *  - 색을 토큰이 아닌 하드코딩 hex로 박지 않았다
 *  - 상태바 여백을 50px로 굽지 않고 inset으로 잡았다(§7-14 규약, trip163 선례)
 *  - 탭바가 (tabs) 그룹 밖(몰입 화면)으로 스며들지 않는다
 *
 * **가짜 통과 방지 규약(onboardingStructure 관례 계승)**: 모든 "없어야 한다" 단언은
 * "있어야 한다" 단언과 **같은 it 안에서** 짝을 이룬다. 부정 단언만 두면 대상 파일이
 * 통째로 비어 있어도(=미구현) 초록으로 통과해 버리기 때문이다.
 */

const ROOT = path.resolve('src');
const HOME_DIR = path.join(ROOT, 'features', 'home');
const TABS_ROUTE_DIR = path.join(ROOT, 'app', '(tabs)');
const APP_DIR = path.join(ROOT, 'app');

/** Figma 토큰으로 이미 존재하는 13색 (onboardingStructure.test.ts의 목록 재사용). */
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

/**
 * 화면 표면 스캔이 실제로 이 1개를 찾았는지 단언하는 모집단 목록(순서 고정) — 이동 전에는
 * `sources.length`만 봤지만, `ui/` 합류로 HomeGlyphs.tsx가 같은 폴더에 섞이면서
 * `*Screen.tsx` 필터만으로는 "몇 개를 찾았나"까지는 보장하지 못한다. 파일 목록을
 * 통째로 단언해야 필터가 조용히 축소되는 회귀를 잡는다(선례: onboardingStructure.test.ts의
 * SCREEN_SOURCE_FILES).
 */
const HOME_SCREEN_SOURCE_FILES = ['features/home/ui/HomeScreen.tsx'];

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

/** 홈 표면 전체(화면·컴포넌트·모델). */
function homeSources() {
  return readAll(listSourceFiles(HOME_DIR));
}

/**
 * 화면 표면만 — 토큰·인셋 가드 대상. `ui/` 합류로 글리프(HomeGlyphs.tsx)가 같은 폴더에
 * 들어오므로 폴더 이름은 더는 스코프가 아니다 — `*Screen.tsx` 파일명 규칙이 그 역할을
 * 물려받는다. 토큰(D-3)·SafeArea(D-4) 두 도메인의 규칙 주체가 똑같이 "화면"이라
 * 모집단을 하나로 공유한다.
 */
function homeScreenSources() {
  return readAll(
    listSourceFiles(path.join(HOME_DIR, 'ui')).filter((f) =>
      f.endsWith('Screen.tsx')
    )
  );
}

/** 홈 + (tabs) 라우트 — INV-3 grep 모집단(§0 확정: duration은 DTO/식별자 수준 금지). */
function homeAndTabsSources() {
  return readAll([
    ...listSourceFiles(HOME_DIR),
    ...listSourceFiles(TABS_ROUTE_DIR),
  ]);
}

describe('홈 픽스처 상수화 + 프레젠테이션 전용 (SC-2 · D-1)', () => {
  it('homeFixtures.ts가 Figma 표시값을 상수화하고, 홈 소스는 서버 호출·네비 심볼을 import하지 않는다', () => {
    const fixturesPath = path.join(HOME_DIR, 'model', 'homeFixtures.ts');

    // 긍정 — 픽스처 파일 존재 + Q2 고정 목업 표시값 그대로.
    expect(fs.existsSync(fixturesPath)).toBe(true);
    const fixturesSource = fs.readFileSync(fixturesPath, 'utf8');
    expect(fixturesSource).toContain('부산 여행');
    expect(fixturesSource).toContain('D-12');
    expect(fixturesSource).toContain('감천문화마을');
    expect(fixturesSource).toContain('도보 850m');

    // 부정 — 서버 호출·네비 유입 차단(브리프 §6-1·§6-7).
    const sources = homeSources();
    expect(sources.length).toBeGreaterThan(0);
    const offenders = sources.flatMap(({ file, source }) =>
      ['@/shared/api', 'axios', '@tanstack/react-query', 'expo-router']
        .filter((needle) => source.includes(needle))
        .map((needle) => `${file}: ${needle}`)
    );
    expect(offenders).toEqual([]);
  });
});

describe('INV-3 grep — duration 식별자 금지 (SC-3 · D-2)', () => {
  it('홈 소스에 거리 표기(도보 850m)는 있고, home·(tabs) 어디에도 duration 식별자는 없다', () => {
    // 긍정 — 스캔 모집단이 실제로 채워졌다는 증거 겸 거리 표기 확인.
    const sources = homeSources();
    expect(sources.length).toBeGreaterThan(0);
    const hasDistance = sources.some(({ source }) =>
      source.includes('도보 850m')
    );
    expect(hasDistance).toBe(true);

    // 부정 — DTO·식별자 수준 duration 전면 금지(INV-3). '3분 전'류 표시 문구는
    // 여기서 다루지 않는다 — 그건 정당한 상대시각 카피라 식별자 grep 대상이 아니다.
    const combined = homeAndTabsSources();
    expect(combined.length).toBeGreaterThan(0);
    const offenders = combined
      .filter(({ source }) => /\bduration\b/i.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('토큰 사용 — 홈 화면 (AC-V1 기계 절반 · D-3)', () => {
  it('홈 화면이 className으로 스타일링돼 있고, 토큰화된 13색 raw hex는 어디에도 없다', () => {
    const sources = homeScreenSources();
    // 필터 자기검증 — 모집단이 정확히 이 파일들인지 잠근다(조용한 0개/2개 반환을 잡는다).
    expect(sources.map(({ file }) => file)).toEqual(HOME_SCREEN_SOURCE_FILES);
    sources.forEach(({ file, source }) => {
      expect({ file, styled: /className=/.test(source) }).toEqual({
        file,
        styled: true,
      });
    });

    // 부정 — 13색은 전부 tailwind 토큰에 있으므로 raw hex는 토큰 우회다.
    // (그림자 rgba·스크림 그라디언트는 13색 hex가 아니므로 자동 허용 — 브리프 §3-D 명시 예외.)
    const offenders = sources.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('SafeArea 규약 — 상태바 여백 (§7-14 · D-4)', () => {
  it('홈 화면이 SafeAreaView/useSafeAreaInsets를 쓰고, pt50 하드코딩은 없다', () => {
    const sources = homeScreenSources();
    // 필터 자기검증 — 모집단이 정확히 이 파일들인지 잠근다(조용한 0개/2개 반환을 잡는다).
    expect(sources.map(({ file }) => file)).toEqual(HOME_SCREEN_SOURCE_FILES);

    // 긍정 — 어느 화면이든 인셋을 실제로 읽어야 한다.
    // Figma의 pt-50px은 상태바 영역을 프레임에 구워 넣은 값이라 기기마다 어긋난다(trip163 §7-14).
    // 방아쇠 — 동결목록이 1건인 동안 some≡forEach; 2건↑이 되면 새 화면 누락을 못 잡으니 forEach로 강화한다.
    const usesInsets = sources.some(
      ({ source }) =>
        /useSafeAreaInsets/.test(source) || /SafeAreaView/.test(source)
    );
    expect(usesInsets).toBe(true);

    // 부정 — 하드코딩된 상단 50px이 남아 있으면 안 된다.
    const offenders = sources
      .filter(({ source }) => /pt-\[50px\]|paddingTop:\s*50\b/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('탭바 격리 — 몰입 화면에 스며들지 않는다 (AC-9 · D-5)', () => {
  it('(tabs)/_layout.tsx는 shared/ui 탭바를 import하고, 몰입 화면 레이아웃·화면에는 BottomTabBar 참조가 없다', () => {
    const layoutPath = path.join(TABS_ROUTE_DIR, '_layout.tsx');

    // 긍정 — (tabs) 레이아웃이 shared/ui 탭바를 실제로 가져와야 한다.
    expect(fs.existsSync(layoutPath)).toBe(true);
    const layoutSource = fs.readFileSync(layoutPath, 'utf8');
    expect(layoutSource).toMatch(/shared\/ui/);
    expect(layoutSource).toMatch(/BottomTabBar/);

    // 부정 — 탭 그룹 밖(몰입 화면) 레이아웃·화면에 탭바가 스며들면 안 된다.
    // 이 파일들이 (tabs) 밖에 있다는 라우팅 사실 자체는 기존 SplashGate one-hot 가드·
    // onboardingStructure BR-U0-29가 이미 커버한다 — 여기서는 참조 부재만 새로 잠근다.
    const immersiveFiles = [
      path.join(APP_DIR, '_layout.tsx'),
      path.join(APP_DIR, '(auth)', '_layout.tsx'),
      path.join(APP_DIR, '(onboarding)', '_layout.tsx'),
      path.join(APP_DIR, 'force-update.tsx'),
      path.join(APP_DIR, 'reconsent.tsx'),
      path.join(APP_DIR, '_dev', 'preview.tsx'),
    ];
    const offenders = immersiveFiles
      .filter((file) => fs.existsSync(file))
      .map((file) => ({
        file: path.relative(ROOT, file),
        source: fs.readFileSync(file, 'utf8'),
      }))
      .filter(({ source }) => /BottomTabBar/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
