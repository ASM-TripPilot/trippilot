/**
 * @jest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AC-11 (lazy 소스 스캔) — 네이티브 SDK 2종이 정적 import 그래프에 실리지 않게 강제.
 *
 * 무엇을 보장하나: `@react-native-seoul/kakao-login`·`naver-login` 은 **동적 경계 뒤에서만** 산다.
 * 근거는 화상 이력 — 모듈 최상단 정적 import 한 줄이 Hermes 부팅 크래시를 냈다. 기존
 * `expoAuthSessionLazyBoundary.test.ts` 와 같은 계약을 새 SDK 2종에 적용한다(AC-11).
 *
 * 이 파일은 fs 로 소스 **문자열의 성질**만 본다(런타임 로드 아님). node 버킷 테스트다.
 *
 * ★ 기존 가드보다 한 겹 강하다(케이스 T3-5): 기존 파일은 `makeAuthorize.ts` 에 SDK 이름이
 * 없으면 통과한다 — 그래서 `makeAuthorize.ts` 가 어댑터를 **정적으로** 끌어오면 SDK 가
 * 전이적으로 부팅 그래프에 실리는데도 조용히 green 이다. 여기서는 "SDK 를 정적 import 하는
 * 파일은 어떤 프로덕션 파일도 정적으로 import 하지 않는다"까지 본다.
 */

const LIB_DIR = __dirname;
const SRC_DIR = join(LIB_DIR, '..', '..', '..');
const MAKE_AUTHORIZE = join(LIB_DIR, 'makeAuthorize.ts');
const OAUTH_CONFIG = join(LIB_DIR, '..', 'config', 'oauthConfig.ts');
const TEST_ONLY_DIRS = ['__tests__', '__mocks__', 'test-support', 'mocks'];

const KAKAO_SDK = '@react-native-seoul/kakao-login';
const NAVER_SDK = '@react-native-seoul/naver-login';

/** 정적 형태의 import(정적 from / side-effect import / require)만 잡는다. 동적 import 는 제외. */
function hasStaticImportOf(source: string, moduleId: string): boolean {
  const id = moduleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`\\bfrom\\s*['"]${id}['"]`).test(source) ||
    new RegExp(`\\bimport\\s+['"]${id}['"]`).test(source) ||
    new RegExp(`\\brequire\\(\\s*['"]${id}['"]\\s*\\)`).test(source)
  );
}

/** 동적 import( … ) 호출이 소스에 존재하는가(지연 로드 구조의 증거). */
function hasDynamicImport(source: string): boolean {
  return /\bimport\s*\(/.test(source);
}

/** 주석 제거. `(?<!:)` 없이는 `https://` 의 `//` 를 주석으로 오인해 줄 나머지를 날린다. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*/g, '');
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/** auth/lib 안의 프로덕션 파일(테스트 제외). */
function libSources(): { file: string; source: string }[] {
  return readdirSync(LIB_DIR)
    .filter(
      (name) =>
        (name.endsWith('.ts') || name.endsWith('.tsx')) &&
        !/\.test\.[jt]sx?$/.test(name)
    )
    .map((name) => ({
      file: name,
      source: stripComments(readFileSync(join(LIB_DIR, name), 'utf8')),
    }));
}

/** `src/**` 프로덕션 파일 전체 — 테스트 파일도, 테스트 전용 디렉토리도 아닌 것. */
function productionSources(): { file: string; source: string }[] {
  return listSourceFiles(SRC_DIR)
    .filter((full) => {
      const rel = full.slice(SRC_DIR.length + 1).split('/');
      return !rel.some((segment) => TEST_ONLY_DIRS.includes(segment));
    })
    .map((full) => ({
      file: full.slice(SRC_DIR.length + 1),
      source: stripComments(readFileSync(full, 'utf8')),
    }));
}

describe('AC-11 · 네이티브 SDK lazy 경계 (소스 스캔)', () => {
  it('SDK 2종은 auth/lib 안에 실재하되 makeAuthorize.ts·oauthConfig.ts 의 정적 그래프에는 실리지 않는다', () => {
    // 탐지기 자가검사 — 탐지기가 고장 나 아무것도 못 잡는 채로 통과하는 것을 막는다.
    expect(
      hasStaticImportOf(`import { login } from '${KAKAO_SDK}';`, KAKAO_SDK)
    ).toBe(true);
    expect(
      hasStaticImportOf(`const a = require('${KAKAO_SDK}');`, KAKAO_SDK)
    ).toBe(true);
    expect(
      hasStaticImportOf(`const m = await import('${KAKAO_SDK}');`, KAKAO_SDK)
    ).toBe(false);
    // provider 를 섞어 잡지 않는다 — kakao 탐지기가 naver 를 잡으면 아래 긍정 2개가
    // 한 파일만으로 동시에 만족돼 공허해진다.
    expect(hasStaticImportOf(`import x from '${NAVER_SDK}';`, KAKAO_SDK)).toBe(
      false
    );
    expect(
      hasDynamicImport("const m = await import('./kakaoAuthorize');")
    ).toBe(true);
    expect(hasDynamicImport(`import x from '${KAKAO_SDK}';`)).toBe(false);

    const makeAuthorizeSource = stripComments(
      readFileSync(MAKE_AUTHORIZE, 'utf8')
    );
    const oauthConfigSource = stripComments(readFileSync(OAUTH_CONFIG, 'utf8'));
    const lib = libSources();

    // 도달 앵커 — 모집단이 채워졌고 진입점이 그 안에 있다.
    expect(lib.map((s) => s.file)).toContain('makeAuthorize.ts');

    // 긍정 1 — lazy 구조: makeAuthorize.ts 안에 동적 import 가 있다(실 경로를 지연 로드).
    expect(hasDynamicImport(makeAuthorizeSource)).toBe(true);
    // 긍정 2·3 — 어댑터 실재: auth/lib 어딘가가 각 SDK 를 참조한다. 지금은 0건이라 red 다.
    expect(lib.some((s) => s.source.includes(KAKAO_SDK))).toBe(true);
    expect(lib.some((s) => s.source.includes(NAVER_SDK))).toBe(true);

    // 부정(격리 가드) — 진입점은 두 SDK 를 정적으로 끌어오지 않는다.
    expect(hasStaticImportOf(makeAuthorizeSource, KAKAO_SDK)).toBe(false);
    expect(hasStaticImportOf(makeAuthorizeSource, NAVER_SDK)).toBe(false);
    // 간접 오염 차단 — provider 분기 데이터를 oauthConfig.ts 에 두다가 네이티브 모듈을
    // 딸려 오는 우회를 막는다(기존 파일 케이스 25 와 같은 취지).
    expect(hasStaticImportOf(oauthConfigSource, KAKAO_SDK)).toBe(false);
    expect(hasStaticImportOf(oauthConfigSource, NAVER_SDK)).toBe(false);
  });

  it('SDK 를 정적 import 하는 어댑터 파일을 다른 프로덕션 파일이 정적으로 import 하지 않는다 (전이 오염 차단)', () => {
    const sources = productionSources();

    // 도달 앵커 — src 전체 모집단이 채워졌다.
    expect(sources.length).toBeGreaterThan(20);

    // SDK 를 정적으로 끌어오는 파일 = 어댑터. 이들은 동적 경계 뒤에서만 살아야 한다.
    const adapters = sources.filter(
      (s) =>
        hasStaticImportOf(s.source, KAKAO_SDK) ||
        hasStaticImportOf(s.source, NAVER_SDK)
    );
    // 긍정 — 어댑터가 실제로 존재한다(0건이면 아래 부정 단언이 공허해진다). 지금은 red 다.
    expect(adapters.length).toBeGreaterThan(0);

    /** `./foo` · `../lib/foo` · `@/features/auth/lib/foo` 형태의 **정적** import 를 잡는다. */
    const staticallyImports = (source: string, basename: string): boolean =>
      new RegExp(
        `\\bfrom\\s*['"][^'"]*[/']?${basename}['"]|\\brequire\\(\\s*['"][^'"]*${basename}['"]\\s*\\)`
      ).test(source);

    // 탐지기 자가검사 — 정적은 잡고 동적은 안 잡는다.
    expect(
      staticallyImports(
        "import { a } from './kakaoAuthorize';",
        'kakaoAuthorize'
      )
    ).toBe(true);
    expect(
      staticallyImports(
        "import { a } from '@/features/auth/lib/kakaoAuthorize';",
        'kakaoAuthorize'
      )
    ).toBe(true);
    expect(
      staticallyImports(
        "const m = await import('./kakaoAuthorize');",
        'kakaoAuthorize'
      )
    ).toBe(false);

    const offenders = adapters.flatMap((adapter) => {
      const basename = adapter.file.replace(/^.*\//, '').replace(/\.tsx?$/, '');
      return sources
        .filter(
          (s) =>
            s.file !== adapter.file && staticallyImports(s.source, basename)
        )
        .map((s) => `${s.file} -> ${adapter.file}`);
    });

    // 본체 — 어댑터를 정적으로 끌어오는 프로덕션 파일이 하나도 없다. 있으면 SDK 가
    // 전이적으로 부팅 그래프에 실려 Hermes 크래시 경로가 되살아난다.
    expect(offenders).toEqual([]);
  });
});
