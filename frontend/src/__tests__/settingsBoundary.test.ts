/**
 * @jest-environment node
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * TRIP-604 · frontend-components §6 — `features/settings`는 다른 feature를 import 하지 않는다(G-U5-14 재발 방지).
 *
 * 무엇을 보장하나: `features/settings` 아래 모든 소스가 `@/features/<다른feature>`를 import 하지
 * 않는다(자기 자신 `@/features/settings/*`는 허용). l03 마이페이지가 `features/reflection`·`features/itinerary`
 * 컴포넌트를 직접 끌어다 쓰는 경로를 소스 층에서 막는다 — 조합은 `pages`가 전담한다.
 *
 * 왜 소스 스캔인가: `features` 간 import 금지의 **기계 강제(eslint)가 settings엔 없다**
 * (`eslint.config.js` FEATURES=`['onboarding','home']`뿐). 그래서 이 스캔이 settings 경계의 유일한 그물이다.
 *
 * ⚠️ 전처리(`stripComments`)의 줄 주석 정규식이 URL의 `//`를 주석으로 오인하면, 그 줄의 진짜 import가
 * 통째로 사라져 **거짓 green**이 난다(2026-07-31 실사고). `:` 뒤의 `//`는 주석으로 보지 않고, 그 성질을
 * 아래 자가검사 케이스가 회귀 가드로 잠근다.
 *
 * 가짜 통과 방지 규약(리포 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 짝을 이룬다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const SETTINGS_ROOT = join(SRC_ROOT, 'features', 'settings');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다).
 * 줄 주석은 **바로 앞 글자가 `:`이면 주석으로 보지 않는다** — `'https://…'`의 슬래시를 주석 시작으로
 * 오인하지 않기 위한 것(`tripDraftBoundary.test.ts` 확립 규약).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** import 대상(module specifier)을 뽑는다 — 정적·사이드이펙트·require·동적 네 형태 모두. */
function extractSpecifiers(source: string): string[] {
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.push(match[1]);
    }
  }
  return found;
}

/** 주석을 걷은 뒤 뽑는다 — 두 단계를 늘 붙여 쓰기 위한 한 함수. */
function specifiersOf(source: string): string[] {
  return extractSpecifiers(stripComments(source));
}

/**
 * 다른 feature import인가. `@/features/<name>`에서 name이 `settings`가 아니면 위반.
 * `@/shared/*`·상대경로·외부 패키지는 통과.
 */
function isForeignFeatureImport(specifier: string): boolean {
  const match = /^@\/features\/([^/]+)/.exec(specifier);
  return match !== null && match[1] !== 'settings';
}

/**
 * 디렉토리를 재귀로 훑어 **프로덕션** 소스 파일 절대경로를 모은다. 테스트 파일(`*.test.*`·`*.spec.*`)은
 * 제외한다 — G-U5-14가 막는 것은 **런타임 의존 방향**(프로덕션 코드가 다른 feature를 무는 것)이라,
 * 테스트가 비교용으로 타 feature를 import 하는 것까지 위반으로 몰지 않는다. (이 제외 덕에, features/settings에
 * 아직 이 가드의 테스트 파일밖에 없는 지금은 스캔 집합이 비어 아래 긍정 짝이 red를 낸다 — 구현 전 의도된 red.)
 */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full));
    } else if (
      SOURCE_EXTENSIONS.some((ext) => full.endsWith(ext)) &&
      !/\.(test|spec)\.[tj]sx?$/.test(full)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('G-U5-14 · features/settings 경계 가드', () => {
  it('탐지기 자가검사 — 주석·URL을 가공한 결과에 진짜 import가 살아남고, 위반 판정이 갈린다', () => {
    // ① 주석 안의 금칙어는 스캔에 안 걸린다.
    const commented = [
      '/**',
      ' * 이 모듈은 @/features/itinerary 도 @/features/reflection 도 import 하지 않는다.',
      ' */',
      "// import x from '@/features/trip/model/tripDraft';",
      'export const keep = 1;',
    ].join('\n');
    expect(specifiersOf(commented)).toEqual([]);
    expect(stripComments(commented)).toContain('export const keep = 1;');

    // ② 회귀 가드 — URL의 `//`를 줄 주석으로 오인하면 그 줄의 진짜 import가 사라져 거짓 green이
    //    난다(2026-07-31 실사고 재현·수정 확인, 02a §5-D).
    expect(
      specifiersOf(
        "const doc = 'https://example.com/a'; import x from '@/features/itinerary/ui/X';"
      )
    ).toEqual(['@/features/itinerary/ui/X']);

    // ③ 블록 주석을 먼저 지우는 순서라야 같은 줄의 코드가 살아남는다.
    expect(
      specifiersOf("/* a // b */ import y from '@/features/reflection/ui/Y';")
    ).toEqual(['@/features/reflection/ui/Y']);

    // ④ import 네 형태를 전부 본다.
    expect(specifiersOf("import { A } from '@/features/trip/x';")).toEqual([
      '@/features/trip/x',
    ]);
    expect(specifiersOf("import '@/features/home/x';")).toEqual([
      '@/features/home/x',
    ]);
    expect(specifiersOf("const a = require('@/features/explore/x');")).toEqual([
      '@/features/explore/x',
    ]);
    expect(
      specifiersOf("const m = await import('@/features/itinerary/x');")
    ).toEqual(['@/features/itinerary/x']);

    // ⑤ 위반 판정이 실제로 갈린다 — 다른 feature는 위반, 자기 자신·shared·상대경로는 통과.
    expect(isForeignFeatureImport('@/features/itinerary/ui/X')).toBe(true);
    expect(isForeignFeatureImport('@/features/reflection/ui/Y')).toBe(true);
    expect(
      isForeignFeatureImport('@/features/settings/model/tripBuckets')
    ).toBe(false);
    expect(isForeignFeatureImport('@/shared/ui/StateNotice')).toBe(false);
    expect(isForeignFeatureImport('./tripBuckets')).toBe(false);
  });

  it('features/settings의 어떤 소스도 다른 feature를 import 하지 않는다', () => {
    // 긍정 짝 — 디렉토리·파일이 실제로 있어야 "위반 0"이 의미를 갖는다(빈 스캔 거짓 통과 차단).
    expect(existsSync(SETTINGS_ROOT)).toBe(true);

    const files = collectSources(SETTINGS_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
        if (isForeignFeatureImport(specifier)) {
          offenders.push(
            `${relative(SRC_ROOT, file).split(sep).join('/')} → ${specifier}`
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
