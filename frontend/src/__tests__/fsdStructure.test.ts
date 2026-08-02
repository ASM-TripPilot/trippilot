/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * AC-1 · AC-2 · AC-3 (01b Seed) — FSD 구조 가드: features 세그먼트 개명 + pages/app-shell 층 신설.
 * AC-4 (20260728 배럴 정리 사이클 — 경량 진행이라 01/01b 미생성, 근거는 워크스페이스 RESUME.md).
 *
 * 무엇을 보장하나: 렌더로는 관찰할 수 없는 **폴더 배치** 수준의 제약을 잠근다.
 *  - auth·onboarding·home 슬라이스가 FSD 5세그먼트(ui/model/lib/config)로만 구성된다
 *    (screens·components·hooks·containers·store 같은 옛 칸이 남아 있으면 red)
 *  - auth/lib에 팩토리(makeAuthorize·realAuthorize)가 남아 있고, 설정·상수는 auth/config로 갈라져
 *    되돌아오지 않았다 (20260802-trip210에서 "정확히 2개" 완전일치 → 부분집합으로 격하)
 *  - 신설 pages 층 5슬라이스가 각각 `ui/*Page.tsx` + 재수출 `index.ts` 배럴을 갖고,
 *    대응 라우트가 옛 컨테이너 경로가 아니라 그 배럴을 참조한다
 *  - 신설 app-shell 층이 src/app **밖**에 있어 Expo Router가 라우트로 등록하지 않는다
 *  - features/*·shared/* 슬라이스 배럴(index.ts)이 `export {};` 빈 스텁으로 남아 있지 않다
 *    — 단, 배럴이 아예 **없는** 슬라이스는 정상이다(features/auth·shared/version이 그렇게 돈다)
 *  - 그 빈 배럴 스캔이 **실제로 두 층을 훑었다**(스캔 범위가 비면 "위반 0개"는 공허하다)
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
 *   - features·shared 배럴이 빈 스텁이 아닐 것 (it 4-1의 집합 단언) — 빈 배럴은 import도
 *     export도 하나 없어서 import 그래프를 보는 린트 규칙에는 아예 안 걸린다. 게다가 모집단이
 *     "그때 존재하는 슬라이스 전수"라 새 슬라이스가 늘어도 이 단언은 갱신할 필요가 없다.
 *   - 그 스캔이 두 층을 실제로 훑을 것 (it 4-1의 scannedLayers 앵커) — 잠그는 대상이 FSD
 *     층 이름이라 새 슬라이스·새 파일로는 red가 나지 않는다(= A의 판정 기준 충족). 갱신이
 *     필요한 순간은 층을 개명·증설할 때뿐이고, 그때는 어차피 BARREL_LAYERS를 손대야 한다.
 *
 * **B. 이행 체크포인트 — 한시적이다.** 이번 이동이 끝났는지 확인하는 스냅샷이라,
 * 정당한 신규 작업에도 red를 낸다(예: 화면을 하나 추가하면 pages 슬라이스가 6개가 된다).
 *   - auth/lib 파일이 정확히 2개 (it 1-4) — 20260802-trip210에서 부분집합으로 격하·종료
 *   - pages 슬라이스가 정확히 6개 (it 2-1 말미의 집합 단언)
 *   - 대표 파일 존재 단언 (it 1-1 · 1-2 · 1-3의 짝 단언)
 *   - 유지 배럴 대표 심볼 단언 (it 4-1의 짝 단언 — shared/api·shared/storage)
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
 *
 * 갱신(20260728-trip173-fsd-barrel-cleanup): it 4-1의 짝 단언이 B 표면을 1건 넓혔다. 이번
 * 사이클의 출생 red는 A 단언(빈 배럴 집합)에서만 나오므로 **카운터는 그대로 0**이다.
 * 같은 사이클 [리팩토링/보강]에서 더한 scannedLayers 앵커는 **A**라 B 표면·카운터 모두
 * 변동 없다(카운터 = 0 유지).
 *
 * 갱신(20260729-trip181-stay-search-list): it 2-1 말미의 PAGE_SLICES 집합 단언(5슬라이스
 * 완전일치)이 `stay-search` 슬라이스 신설로 정당하게 red가 났다 — 제외구 AND 조건 둘 다
 * 충족한다(① 그 단언을 만든 20260727 사이클 밖의 작업이고 ② 배열 갱신 없이는 통과 불가).
 * **카운터 0 → 1.** 헤더 규약상 다음 pages 슬라이스 추가에서 2가 되면 그 사이클에서 즉시
 * 부분집합 검사로 완화한다(사이클 4를 기다리지 않는다).
 *
 * 갱신(20260731-trip198-stay-register): `stay-register` 슬라이스 신설로 같은 단언이 또 red를
 * 냈다 — 제외구 AND 조건 둘 다 충족(① 20260727 사이클 밖 ② 배열 갱신 없이는 통과 불가).
 * **카운터 1 → 2 = 위 규약의 완화 시점.** 그래서 이 사이클에서 완전일치 → **부분집합 검사**로
 * 격하한다. 잠그는 것은 "알려진 슬라이스가 사라지지 않았다"로 남고, 새 슬라이스 추가는 더는
 * red를 내지 않는다. 슬라이스 **삭제·개명**은 여전히 잡힌다(그쪽이 이 단언의 실질이다).
 * 격하했으므로 카운터는 여기서 **닫는다** — 더 셀 대상이 없다.
 *
 * 갱신(20260802-trip210-social-sdk): **it 1-4의 `auth/lib 파일이 정확히 2개` 단언**이 이번 칸의
 * 네이티브 SDK 인가 어댑터 2파일 신설로 red를 냈다. 제외구 AND 조건 둘 다 충족한다 — ① 그
 * 단언을 만든 20260727-trip173-fsd-home-rename 사이클 **밖**의 작업이고, ② 완전일치 배열을
 * 갱신하지 않고는 통과할 수 없다. 위 PAGE_SLICES 선례(20260731-trip198)와 **같은 규약·같은
 * 방식**으로, 이 단언도 완전일치 → **부분집합 검사**로 격하한다:
 *   - 남기는 것: `makeAuthorize.ts`·`realAuthorize.ts`가 여전히 lib에 있다(arrayContaining) +
 *     모집단 비지 않음 앵커 + 갈라낸 설정 파일(gradients·oauthConfig)이 lib으로 되돌아오지
 *     않았다(원 취지). → **삭제·개명은 여전히 잡힌다.**
 *   - 푸는 것: lib에 새 파일이 늘어도 더는 red가 아니다.
 * 이 단언도 격하로 **닫혔다**. **B 범주에 완전일치로 남은 단언**: it 1-1·1-2·1-3의 세그먼트
 * 집합 단언(`toEqual(['model','ui',…])`)과 it 1-4의 configFiles 완전일치, it 4-1의 유지 배럴
 * 대표 심볼 단언. 이들은 아직 정당한 작업에 red를 낸 적이 없어 카운터 0에서 시작한다 —
 * 세그먼트 집합 쪽은 A(폴더 이름 금지)와 겹쳐 있어 격하 시 A까지 무뎌지지 않도록
 * 주의해야 한다(격하한다면 "옛 칸 부재"만 남기는 형태여야 한다).
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

/**
 * "빈 배럴" 판정 정규식 — 재수출을 하나도 하지 않는 스텁 형태.
 * 근거(실측): 이 리포 prettier 3.9.5 설정으로 `export {}` · `export{};` · `export {  };` ·
 * 앞 빈 줄은 모두 `export {};` 한 형태로 정규화되지만 `export type {};`는 그대로 보존된다.
 * 그래서 완전 일치 비교(=== 'export {};') 대신 두 변형을 함께 잡는다 — 포맷을 돌리지 않고
 * 커밋된 파일도 걸리고, 비용은 똑같이 한 줄이다.
 */
const EMPTY_BARREL = /^export\s+(?:type\s+)?\{\s*\}\s*;?$/;

/** 이 가드의 모집단 — features·shared 두 층 전수. pages 층은 AC-2 소관이라 넣지 않는다. */
const BARREL_LAYERS = ['features', 'shared'];

/**
 * 가짜 통과 방지 짝 — 모집단 안에서 "내용 있는 배럴"로 반드시 살아남아야 하는 파일과 대표 심볼.
 * 이것이 없으면 features·shared의 index.ts를 전부 지워도 "빈 배럴 0개"가 초록으로 통과한다.
 */
const KEPT_BARRELS = [
  {
    file: path.join(ROOT, 'shared', 'api', 'index.ts'),
    symbol: 'createAuthedApiClient',
  },
  {
    file: path.join(ROOT, 'shared', 'storage', 'index.ts'),
    symbol: 'saveTokens',
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

  it('auth/lib에는 팩토리가 남아 있고, 설정·상수는 auth/config로 갈라졌다', () => {
    const libFiles = listProdFileNames(path.join(AUTH_DIR, 'lib'));
    const configFiles = listProdFileNames(path.join(AUTH_DIR, 'config'));

    // 앵커 — 모집단이 비지 않았다(디렉토리 부재 시 빈 배열이라 아래 포함 단언이 공허해진다).
    expect(libFiles.length).toBeGreaterThan(0);

    // 긍정(부분집합) — 알려진 팩토리 2개가 여전히 lib에 있다. 20260802-trip210에서 완전일치
    // → 부분집합으로 격하했다(헤더 갱신 문단 참조): 신규 lib 파일 추가는 더는 red를 내지
    // 않되, 이 둘의 **삭제·개명**은 여전히 잡힌다 — 그쪽이 이 단언의 실질이다.
    expect(libFiles).toEqual(
      expect.arrayContaining(['makeAuthorize.ts', 'realAuthorize.ts'])
    );

    // 부정 — 원 취지 보존: 설정·상수 파일이 lib으로 되돌아오지 않았다. config 목록과
    // 대조하는 방식은 "되돌리기"를 놓친다(config에서 빠지면 대조군도 같이 사라진다) —
    // 그래서 갈라낸 파일 이름을 직접 못박는다.
    const CONFIG_ONLY_FILES = ['gradients.ts', 'oauthConfig.ts'];
    const misplaced = libFiles.filter((file) =>
      CONFIG_ONLY_FILES.includes(file)
    );
    expect(misplaced).toEqual([]);

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

    // 부정 — 알려진 슬라이스가 사라지거나 개명되면 red. 헤더 규약(B 카운터 2)대로
    // 완전일치에서 **부분집합**으로 격하했다: 새 슬라이스 추가는 더는 red를 내지 않는다.
    const slices = listDirNames(PAGES_DIR);
    expect(slices).toEqual(
      expect.arrayContaining([
        'login',
        'onboarding-nickname',
        'onboarding-pref1',
        'onboarding-pref2',
        'onboarding-terms',
        'region-picker',
        'stay-search',
        'stay-register',
      ])
    );
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

describe('AC-4 · 빈 배럴 금지 — features·shared 층 전수', () => {
  it('features·shared 슬라이스에 빈 배럴이 하나도 없고, 내용 있는 배럴(api·storage)은 그대로 남아 있다', () => {
    // 준비 — 두 층의 슬라이스를 훑어 "실재하는 index.ts"만 모은다. 배럴이 아예 없는
    // 슬라이스(features/auth·shared/version)는 정상이므로 existsSync 필터에서 조용히 빠진다.
    // 슬라이스 이름을 화이트리스트로 박지 않기 때문에, 앞으로 생길 슬라이스도 자동으로 모집단이다.
    const barrels = BARREL_LAYERS.flatMap((layer) =>
      listDirNames(path.join(ROOT, layer))
        .map((slice) => path.join(ROOT, layer, slice, 'index.ts'))
        .filter((file) => fs.existsSync(file))
    );

    // 긍정(앵커) — **스캔이 실제로 돌았는가**를 먼저 잠근다. listDirNames는 없는
    // 디렉토리에 조용히 []를 주므로(:134), BARREL_LAYERS를 []·오타·한 층 누락으로
    // 바꾸면 모집단이 0이 되고 아래 "빈 배럴 0개"가 **아무 데도 안 보면서** 통과한다.
    // filter로 "슬라이스가 하나라도 잡힌 층"만 남겨 목록 전체를 고정한다 — 개수(>0)가
    // 아니라 목록을 잠가야 한 층이 조용히 빠지는 것도 잡힌다(동결 파일목록 단언).
    const scannedLayers = BARREL_LAYERS.filter(
      (layer) => listDirNames(path.join(ROOT, layer)).length > 0
    );
    expect(scannedLayers).toEqual(['features', 'shared']);

    // 실행 — 각 배럴의 내용을 읽어 빈 스텁인 것만 src 기준 상대경로로 추린다.
    const emptyBarrels = barrels
      .filter((file) => EMPTY_BARREL.test(read(file).trim()))
      .map((file) => path.relative(ROOT, file));

    // 부정 — 빈 배럴은 0개여야 한다. 실패하면 위반 파일이 diff에 목록으로 찍힌다.
    expect(emptyBarrels).toEqual([]);

    // 긍정(짝) — 위 부정 단언만 두면 features·shared의 index.ts를 몽땅 지워도 초록이다.
    // 참조가 있는 진짜 배럴 2개가 실재하고, 실제로 그 심볼을 내보내는지까지 본다.
    KEPT_BARRELS.forEach(({ file, symbol }) => {
      expect(existsPair(file)).toEqual({ file, exists: true });

      // 파일이 없으면 위 단언이 먼저 throw하므로 아래 read()는 도달하지 않는다.
      // `export ...<심볼>` 이 한 줄에 있어야 한다(. 은 개행을 넘지 않는다) — 파일만
      // 남기고 내용을 스텁으로 바꾸는 것을 막는다.
      expect(read(file)).toMatch(new RegExp(`export .*\\b${symbol}\\b`));
    });
  });
});
