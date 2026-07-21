/**
 * @jest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AC-OA-1 (lazy 소스 스캔) — expo-auth-session 네이티브 모듈이 정적 그래프에 실리지 않게 강제.
 *
 * 무엇을 보장하나: makeAuthorize.ts 는 expo-auth-session 을 **top-level 정적 import 하지 않고**,
 * 실 어댑터가 **동적 경계(await import) 뒤에서만** 그것을 참조한다. 화상 이력(msw/Hermes 에서
 * 모듈 최상단 정적 import 한 줄이 부팅 크래시를 냈다)의 확장 — 사람 주의력이 아니라 기계가 막는다.
 *
 * 이 파일은 fs 로 소스 문자열의 성질만 본다(런타임 로드 아님). node 버킷 테스트다.
 * 지금은 makeAuthorize.ts 에 동적 import 도 실 어댑터도 없어 red 다(긍정 두 단언이 실패).
 */

const LIB_DIR = __dirname;
const MAKE_AUTHORIZE = join(LIB_DIR, 'makeAuthorize.ts');

/** 정적 형태의 expo-auth-session import(정적 from / side-effect import / require)만 잡는다. */
function hasStaticExpoAuthSessionImport(source: string): boolean {
  return (
    /\bfrom\s*['"]expo-auth-session['"]/.test(source) ||
    /\bimport\s+['"]expo-auth-session['"]/.test(source) ||
    /\brequire\(\s*['"]expo-auth-session['"]\s*\)/.test(source)
  );
}

/** 동적 import( … ) 호출이 소스에 존재하는가(지연 로드 구조의 증거). */
function hasDynamicImport(source: string): boolean {
  return /\bimport\s*\(/.test(source);
}

/** auth/lib 안의 프로덕션 파일(테스트 제외) 어딘가가 expo-auth-session 을 참조하는가. */
function libReferencesExpoAuthSession(): boolean {
  return readdirSync(LIB_DIR)
    .filter(
      (name) =>
        (name.endsWith('.ts') || name.endsWith('.tsx')) &&
        !/\.test\.[jt]sx?$/.test(name)
    )
    .some((name) =>
      /expo-auth-session/.test(readFileSync(join(LIB_DIR, name), 'utf8'))
    );
}

describe('AC-OA-1 · expo-auth-session lazy 경계 (소스 스캔)', () => {
  it('makeAuthorize.ts 는 expo-auth-session 을 정적으로 끌어오지 않고, 실 어댑터가 동적 경계 뒤에서만 참조한다', () => {
    // 탐지기 자가검사 — 탐지기가 고장 나 아무것도 못 잡는 채로 통과하는 것을 막는다.
    expect(
      hasStaticExpoAuthSessionImport(
        "import { AuthRequest } from 'expo-auth-session';"
      )
    ).toBe(true);
    expect(
      hasStaticExpoAuthSessionImport("const a = require('expo-auth-session');")
    ).toBe(true);
    expect(
      hasStaticExpoAuthSessionImport(
        "const m = await import('expo-auth-session');"
      )
    ).toBe(false);
    expect(hasDynamicImport("const m = await import('./realAuthorize');")).toBe(
      true
    );
    expect(hasDynamicImport("import x from 'expo-auth-session';")).toBe(false);

    const makeAuthorizeSource = readFileSync(MAKE_AUTHORIZE, 'utf8');

    // 긍정 1 — lazy 구조: makeAuthorize.ts 안에 동적 import 가 있다(실 경로를 지연 로드).
    expect(hasDynamicImport(makeAuthorizeSource)).toBe(true);
    // 긍정 2 — 실 어댑터 존재: auth/lib 어딘가가 expo-auth-session 을 참조한다.
    expect(libReferencesExpoAuthSession()).toBe(true);
    // 부정(격리 가드) — makeAuthorize.ts 는 expo-auth-session 을 정적으로 끌어오지 않는다.
    expect(hasStaticExpoAuthSessionImport(makeAuthorizeSource)).toBe(false);
  });
});
