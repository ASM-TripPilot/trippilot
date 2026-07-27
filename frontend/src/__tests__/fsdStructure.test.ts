/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * AC-1 · AC-2 · AC-3 (01b Seed) — FSD 구조 가드: features 세그먼트 개명 + pages/app-shell 층 신설.
 *
 * 무엇을 보장하나: 렌더로는 관찰할 수 없는 **폴더 배치** 수준의 제약을 잠근다.
 *  - auth·onboarding·home 슬라이스가 FSD 5세그먼트(ui/model/lib/config)로만 구성된다
 *    (screens·components·hooks·containers·store 같은 옛 칸이 남아 있으면 red)
 *  - auth/lib에는 팩토리 2개(makeAuthorize·realAuthorize)만 남고, 설정·상수는 auth/config로 갈라졌다
 *  - 신설 pages 층 5슬라이스가 각각 `ui/*Page.tsx` + 재수출 `index.ts` 배럴을 갖고,
 *    대응 라우트가 옛 컨테이너 경로가 아니라 그 배럴을 참조한다
 *  - 신설 app-shell 층이 src/app **밖**에 있어 Expo Router가 라우트로 등록하지 않는다
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과
 * **같은 it 안에서** 짝을 이룬다 — 부정 단언만 두면 대상 디렉토리가 통째로 비어도(=미이동)
 * 초록으로 통과해 버린다. (onboardingStructure.test.ts · homeStructure.test.ts ·
 * onboardingPrefStructure.test.ts의 관례를 그대로 계승한다.)
 *
 * 이 가드를 **이동 전에 실행하면 src/pages·src/app-shell이 아직 존재하지 않는다.** 없는
 * 디렉토리에 readdirSync를 걸면 예외가 던져져 지저분하게 죽으므로, 아래 listDirNames·
 * listProdFileNames·listSourceFilesRecursive는 전부 대상 디렉토리 부재 시 빈 배열을 반환하도록
 * 방어한다 — 그래야 실패가 "무엇이 없다"를 읽을 수 있는 assertion diff로 남는다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * 단언이 두 종류이며 수명이 다르다.
 *
 * **A. 영구 규칙 — 유지한다.** eslint가 대체할 수 없다: 린트는 import를 보는 도구라
 * 부활한 폴더 안의 파일이 아무것도 import하지 않으면 규칙 자체가 돌지 않는다.
 * 폴더 이름을 금지하려면 파일 시스템을 읽어야 한다.
 *   - screens·components·containers·hooks·store 부활 금지 (it 1-1 · 1-2 · 1-3의 집합 단언)
 *   - app-shell이 src/app 밖에 있을 것 (it 3-1의 부정 단언)
 *   - pages 슬라이스가 배럴을 가질 것 (it 2-1의 배럴 단언)
 *
 * **B. 이행 체크포인트 — 한시적이다.** 이번 이동이 끝났는지 확인하는 스냅샷이라,
 * 정당한 신규 작업에도 red를 낸다(예: 화면을 하나 추가하면 pages 슬라이스가 6개가 된다).
 *   - auth/lib 파일이 정확히 2개 (it 1-4)
 *   - pages 슬라이스가 정확히 5개 (it 2-1 말미의 집합 단언)
 *   - 대표 파일 존재 단언 (it 1-1 · 1-2 · 1-3의 짝 단언)
 *
 * B의 완화·삭제 시점: **사이클 4 종료 시 재판정**한다. 단, 그 전에도
 * **정당한 신규 작업이 B 때문에 red를 낸 것이 2회 누적되면 즉시 부분집합 검사로 완화**한다
 * (사이클 4를 기다리지 않는다). 가드가 죽는 가장 흔한 경로가 "정당한 작업을 계속 막아서
 * 사람들이 통째로 지우는 것"이라, 그 전에 조건부로 격하하는 편이 낫다.
 *
 * **B 카운터 제외구**: 카운터에 세는 red는 ① 그 단언을 만든 사이클 밖의 작업이 낸 것이고
 * ② B 단언 자체를 갱신하지 않고는 통과할 수 없는 것이다(AND) — TDD red-first의 출생 red와,
 * 같은 티켓 안에서 그 이동을 완성하며 해소되는 red는 세지 않는다. 카운터가 재는 것은
 * 누적된 마찰이고, 출생 red는 가드가 실효함을 증명하는 정반대의 증거다. 카운터 단위는
 * 파일 1개(B 범주 전체에 하나) — home 대표 파일 3건이 늘어도 쪼개지거나 리셋되지 않고
 * B의 표면만 넓어진다. 이번 사이클(20260727-trip173-fsd-home-rename) 종료 시 현재값 =
 * **0**(출생 red 3건은 제외구에 걸려 세지 않는다).
 */

const ROOT = path.resolve('src');
const AUTH_DIR = path.join(ROOT, 'features', 'auth');
const ONB_DIR = path.join(ROOT, 'features', 'onboarding');
const HOME_DIR = path.join(ROOT, 'features', 'home');
const PAGES_DIR = path.join(ROOT, 'pages');
const SHELL_DIR = path.join(ROOT, 'app-shell');
const APP_DIR = path.join(ROOT, 'app');

/** 신설 pages 층 5슬라이스 — 슬라이스 이름 · 컴포넌트 심볼 · 대응 라우트 파일. */
const PAGE_SLICES = [
  {
    slice: 'login',
    symbol: 'LoginPage',
    route: path.join(APP_DIR, '(auth)', 'login.tsx'),
  },
  {
    slice: 'onboarding-terms',
    symbol: 'TermsPage',
    route: path.join(APP_DIR, '(onboarding)', 'terms.tsx'),
  },
  {
    slice: 'onboarding-nickname',
    symbol: 'NicknamePage',
    route: path.join(APP_DIR, '(onboarding)', 'nickname.tsx'),
  },
  {
    slice: 'onboarding-pref1',
    symbol: 'PrefStep1Page',
    route: path.join(APP_DIR, '(onboarding)', 'pref1.tsx'),
  },
  {
    slice: 'onboarding-pref2',
    symbol: 'PrefStep2Page',
    route: path.join(APP_DIR, '(onboarding)', 'pref2.tsx'),
  },
];

/** 디렉토리 바로 아래의 하위 "디렉토리" 이름만 정렬해 반환한다(세그먼트 목록 조회용). */
function listDirNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return []; // 이동 전에는 pages·app-shell이 아직 없다 — 조용히 빈 배열
  return fs
    .readdirSync(dir, { withFileTypes: true }) // Dirent[] — 파일/디렉토리 종류를 함께 준다
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** 디렉토리 바로 아래(재귀 없음)의 프로덕션 .ts/.tsx 파일명만 정렬해 반환한다(테스트 파일 제외). */
function listProdFileNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(
      (name) =>
        (name.endsWith('.ts') || name.endsWith('.tsx')) &&
        !/\.test\.[jt]sx?$/.test(name)
    )
    .sort();
}

/** src/app 전체를 재귀로 훑어 프로덕션 소스 파일의 절대경로만 모은다(옛 경로 잔재 검색용). */
function listSourceFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSourceFilesRecursive(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return []; // 테스트 파일은 가드 대상이 아니다
      return [full];
    })
    .sort();
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/** 존재 여부를 파일 경로와 함께 감싼다 — 실패 메시지에 어느 파일인지 남기는 이 리포의 표준 형태. */
function existsPair(file: string): { file: string; exists: boolean } {
  return { file, exists: fs.existsSync(file) };
}

describe('AC-1 · 슬라이스 세그먼트 개명 — FSD 5칸', () => {
  it('auth 슬라이스가 {config, lib, model, ui} 4칸뿐이고, 각 칸의 대표 파일이 실재한다', () => {
    const representativeFiles = [
      path.join(AUTH_DIR, 'ui', 'SocialLoginScreen.tsx'),
      path.join(AUTH_DIR, 'model', 'useSocialLogin.ts'),
      path.join(AUTH_DIR, 'config', 'oauthConfig.ts'),
      path.join(AUTH_DIR, 'lib', 'makeAuthorize.ts'),
    ];

    const segments = listDirNames(AUTH_DIR);

    // 부정 겸 긍정 — 4칸만 있어야 한다. 옛 칸(screens·components·hooks·containers)이
    // 하나라도 남아 있으면, 혹은 4칸 중 하나라도 없으면 즉시 빨개진다.
    expect(segments).toEqual(['config', 'lib', 'model', 'ui']);

    // 긍정(짝) — 칸(디렉토리)만 만들고 파일을 안 옮긴 상태를 차단한다.
    representativeFiles.forEach((file) => {
      expect(existsPair(file)).toEqual({ file, exists: true });
    });
  });

  it('onboarding 슬라이스가 {model, ui} 2칸뿐이고, 각 칸의 대표 파일이 실재한다', () => {
    const representativeFiles = [
      path.join(ONB_DIR, 'ui', 'TermsScreen.tsx'),
      path.join(ONB_DIR, 'model', 'preferenceStore.ts'),
      path.join(ONB_DIR, 'model', 'resolveOnboardingStep.ts'),
    ];

    const segments = listDirNames(ONB_DIR);

    // 부정 겸 긍정 — 2칸만 있어야 한다(screens·components·hooks·store·containers 부재).
    expect(segments).toEqual(['model', 'ui']);

    // 긍정(짝) — store/에서 옮겨온 preferenceStore.ts와 model/ 제자리인
    // resolveOnboardingStep.ts가 둘 다 도착했는지 본다. 하나만 보면 절반 이동을 놓친다.
    representativeFiles.forEach((file) => {
      expect(existsPair(file)).toEqual({ file, exists: true });
    });
  });

  it('home 슬라이스가 {model, ui} 2칸뿐이고, 각 칸의 대표 파일이 실재한다', () => {
    const representativeFiles = [
      path.join(HOME_DIR, 'ui', 'HomeScreen.tsx'),
      path.join(HOME_DIR, 'ui', 'HomeGlyphs.tsx'),
      path.join(HOME_DIR, 'model', 'homeFixtures.ts'),
    ];

    const segments = listDirNames(HOME_DIR);

    // 부정 겸 긍정 — 2칸만 있어야 한다(옛 두 칸 screens·components가 남아 있으면 red).
    expect(segments).toEqual(['model', 'ui']);

    // 긍정(짝) — 옛 두 칸(screens·components)에서 옮겨온 파일들이 실제로 ui/에
    // 도착했는지 본다. 하나만 보면 절반 이동을 놓친다.
    representativeFiles.forEach((file) => {
      expect(existsPair(file)).toEqual({ file, exists: true });
    });
  });

  it('auth/lib에는 팩토리 2개만 남고, 설정·상수는 auth/config로 갈라졌다', () => {
    const libFiles = listProdFileNames(path.join(AUTH_DIR, 'lib'));
    const configFiles = listProdFileNames(path.join(AUTH_DIR, 'config'));

    // 부정 — gradients.ts·oauthConfig.ts가 lib에 남아 있으면 즉시 빨개진다.
    expect(libFiles).toEqual(['makeAuthorize.ts', 'realAuthorize.ts']);

    // 긍정(짝) — 옮긴 곳(config)에 실제로 도착했는가.
    expect(configFiles).toEqual(['gradients.ts', 'oauthConfig.ts']);
  });
});

describe('AC-2 · pages 층 신설 + 라우트 배선', () => {
  it('pages 5슬라이스가 각각 ui/*Page.tsx와 심볼을 재수출하는 index.ts 배럴을 갖는다', () => {
    PAGE_SLICES.forEach(({ slice, symbol }) => {
      const componentFile = path.join(PAGES_DIR, slice, 'ui', `${symbol}.tsx`);
      const barrelFile = path.join(PAGES_DIR, slice, 'index.ts');

      // 긍정(짝) — 컴포넌트 파일이 실재한다. 이동 전에는 여기서 실패해 throw하므로
      // 아래 read()는 도달하지 않는다 — ENOENT 예외 대신 깨끗한 assertion diff로 남는다.
      expect(existsPair(componentFile)).toEqual({
        file: componentFile,
        exists: true,
      });
      // 긍정 — 배럴 파일도 실재한다.
      expect(existsPair(barrelFile)).toEqual({
        file: barrelFile,
        exists: true,
      });

      // 긍정 — 컴포넌트가 실제로 그 심볼을 export한다(파일만 있고 심볼이 없는 상태 차단).
      const componentSource = read(componentFile);
      expect(componentSource).toMatch(
        new RegExp(`export (?:function|const) ${symbol}\\b`)
      );

      // 긍정 — 배럴이 export {} 빈 스텁이 아니라 실제로 그 심볼을 재수출한다.
      const barrelSource = read(barrelFile);
      expect(barrelSource).toMatch(new RegExp(symbol));
    });

    // 부정 — 계획 밖 슬라이스가 끼어들거나 일부가 빠지면 red(위 forEach와 별개로 전체 집합을 잠근다).
    const slices = listDirNames(PAGES_DIR);
    expect(slices).toEqual([
      'login',
      'onboarding-nickname',
      'onboarding-pref1',
      'onboarding-pref2',
      'onboarding-terms',
    ]);
  });

  it('라우트 5개가 @/pages를 가리키고, src/app 어디에도 옛 컨테이너 경로 참조가 없다', () => {
    PAGE_SLICES.forEach(({ slice, route }) => {
      // 긍정(짝) — 라우트 파일 자체가 사라지지 않았다.
      expect(existsPair(route)).toEqual({ file: route, exists: true });

      // 긍정 — 라우트가 새 pages 층을 실제로 참조한다(배럴 경유든 딥 임포트든 허용).
      const routeSource = read(route);
      expect(routeSource).toContain(`@/pages/${slice}`);
    });

    // 부정 — src/app 어디에도 옛 컨테이너 경로 잔재가 없다.
    const offenders = listSourceFilesRecursive(APP_DIR).flatMap((file) => {
      const source = read(file);
      const match = source.match(
        /features\/(?:auth|onboarding)\/containers\/[^'"]*/
      );
      return match ? [`${path.relative(ROOT, file)}: ${match[0]}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});

describe('AC-3 · app-shell 층 — Expo Router 밖', () => {
  it('app-shell이 src/app 밖에 ui/SplashGate.tsx·index.ts로 존재하고, src/app 아래에는 없다', () => {
    const splashGateFile = path.join(SHELL_DIR, 'ui', 'SplashGate.tsx');
    const barrelFile = path.join(SHELL_DIR, 'index.ts');

    // 긍정(짝) — app-shell 층의 SplashGate.tsx가 실재한다. 이동 전에는 여기서 실패해
    // throw하므로 아래 read()는 도달하지 않는다.
    expect(existsPair(splashGateFile)).toEqual({
      file: splashGateFile,
      exists: true,
    });
    // 긍정 — 배럴도 실재한다.
    expect(existsPair(barrelFile)).toEqual({ file: barrelFile, exists: true });

    // 긍정 — 배럴이 빈 export {}가 아니라 실제로 SplashGate를 재수출한다.
    const barrelSource = read(barrelFile);
    expect(barrelSource).toMatch(/SplashGate/);

    // 부정(회귀 가드) — Expo Router가 src/app 아래 전부를 라우트로 등록하므로, 그 밑에
    // app-shell이라는 이름의 무언가가 생기면 안 된다. 이 단언은 이동 전에도 이미
    // 통과한다(선제 green) — 구현자가 실수로 src/app 아래 만드는 것을 막는 그물이다.
    expect(fs.existsSync(path.join(APP_DIR, 'app-shell'))).toBe(false);
  });

  it('루트 레이아웃이 @/app-shell을 import해 SplashGate를 그리고, 옛 컨테이너 경로는 참조하지 않는다', () => {
    const rootLayoutFile = path.join(APP_DIR, '_layout.tsx');
    const source = read(rootLayoutFile);

    // 긍정 — 새 층을 참조한다.
    expect(source).toContain('@/app-shell');

    // 긍정(짝) — import만 하고 안 그리는 상태를 차단한다(동작 보존의 최소 앵커).
    // 이 단언은 이동 전에도 이미 통과한다(선제 green — 지금도 <SplashGate />를 그린다).
    expect(source).toMatch(/<SplashGate\b/);

    // 부정 — 옛 컨테이너 경로를 더는 참조하지 않는다.
    expect(source).not.toMatch(/features\/auth\/containers/);
  });
});
