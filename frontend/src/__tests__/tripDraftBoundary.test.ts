/**
 * @jest-environment node
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * TRIP-204 AC-8 — `tripDraft.ts`는 바깥 세상을 모른다.
 *
 * 무엇을 보장하나: 드래프트 판정 모듈이 UI·쿼리 훅·라우터를 import 하지 않는다 —
 * **전이 의존까지** 본다. 그래서 이 함수들을 어떤 입력으로 불러도 네트워크 호출도 화면
 * 렌더도 일어날 수 없다(01b AC-8 · 티켓 DoD).
 *
 * 왜 소스 스캔인가: "함수를 불러 봤더니 네트워크가 안 나갔다"는 *이번 호출 경로*만 증명한다.
 * 조건 분기 안에 숨은 호출이나 실행되지 않는 import는 소스 층이라야 잡힌다. 그리고 왜
 * **전이**인가: 평면 문자열 금지 목록은 `@/shared/api` 배럴 한 줄로 뚫린다 — 그 배럴은
 * `axios`를 끌어온다(02a §6-⑥ 실측). 순회는 그것을 잡고, 순수 타입만 있는
 * `@/shared/api/generated/schemas`는 통과시킨다.
 *
 * ⚠️ 전처리(`stripComments`)의 줄 주석 정규식이 URL의 `//`를 주석으로 오인하면, 그 줄의
 * 진짜 import가 통째로 사라져 **거짓 green**이 난다(2026-07-31 실사고). 그래서 이 파일은
 * `:` 뒤의 `//`를 주석으로 보지 않고, 그 성질을 아래 첫 케이스가 회귀 가드로 잠근다.
 *
 * 가짜 통과 방지 규약(리포 확립 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 단언과
 * 같은 it 안에서 짝을 이룬다. 헬퍼는 공용화하지 않고 파일마다 각자 갖는 것이 리포 관례다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const TRIP_DRAFT = join(SRC_ROOT, 'features', 'trip', 'model', 'tripDraft.ts');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/** 01b AC-8이 이름을 댄 세 가지 — UI · 쿼리 훅 · 라우터 — 와 그 실행 수단(네트워크). */
const FORBIDDEN = [
  // UI
  'react',
  'react-dom',
  'react-native',
  'react-native-safe-area-context',
  'nativewind',
  '@/shared/ui',
  '@/widgets',
  '@/pages',
  // 쿼리 훅 · 네트워크
  '@tanstack/react-query',
  'axios',
  // 라우터
  'expo-router',
  '@/app',
];

/** `tripDraft.ts`가 실제로 내보내야 하는 것. `export function`과 `export const` 둘 다 허용한다. */
const EXPECTED_EXPORTS = ['nightsSum', 'validateTripDraft', 'toCompanionType'];

/**
 * 스캔 전처리 — 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면
 * `/* a // b *​/ const keep = 2;` 한 줄에서 코드가 소실된다). 줄 주석 규칙이 리포의 다른
 * 사본과 다른 점은 **바로 앞 글자가 `:`이면 주석으로 보지 않는다**는 것 하나다 —
 * `'https://…'`의 슬래시를 주석 시작으로 오인하지 않기 위한 것이고, 완전한 파서를 만들지
 * 않는 것이 여전히 의도다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * import 대상(module specifier)을 뽑는다. 정적·사이드이펙트·require·동적 import 네 형태를
 * 모두 본다 — 한 형태만 보면 나머지로 우회가 가능해 가드가 무력해진다.
 */
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

function isForbidden(specifier: string): boolean {
  return FORBIDDEN.some(
    (banned) => specifier === banned || specifier.startsWith(`${banned}/`)
  );
}

/** `@/x`와 상대경로를 실제 파일로 해석한다. 해석 불가(외부 패키지)면 null. */
function resolveToFile(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = join(SRC_ROOT, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }
  const candidates = [
    ...SOURCE_EXTENSIONS.map((ext) => base + ext),
    ...SOURCE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // 존재하지 않는 후보는 건너뛴다.
    }
  }
  return null;
}

/** 한 파일에서 시작해 import를 따라가며 도달 가능한 모듈 집합을 만든다(번들러의 축소판). */
function walkFrom(entry: string): { reached: string[]; offenders: string[] } {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    for (const specifier of specifiersOf(readFileSync(current, 'utf8'))) {
      if (isForbidden(specifier)) {
        offenders.push(`${relative(SRC_ROOT, current)} → ${specifier}`);
        continue;
      }
      const next = resolveToFile(specifier, current);
      if (next !== null && !seen.has(next)) {
        queue.push(next);
      }
    }
  }

  return { reached: [...seen], offenders };
}

describe('AC-8 · tripDraft.ts 경계 가드', () => {
  it('탐지기 자가검사 — 주석은 걷히고, URL이 있는 줄의 진짜 import는 살아남는다', () => {
    // ① 주석 안에 적힌 금칙어는 스캔에 걸리지 않는다. 걷지 않으면 헤더 산문이 부정 단언을
    //    대신 만족시켜 거짓 red를 낸다(`tabbarVisual` 게이트①-2 실사고).
    const commented = [
      '/**',
      ' * 이 모듈은 react-native 도 @tanstack/react-query 도 import 하지 않는다.',
      ' */',
      "// const a = require('axios');",
      'export const keep = 1;',
    ].join('\n');
    expect(specifiersOf(commented)).toEqual([]);
    expect(stripComments(commented)).toContain('export const keep = 1;');

    // ② 회귀 가드 — URL의 `//`를 줄 주석으로 오인하면 그 줄의 진짜 import가 통째로 사라져
    //    **거짓 green**이 난다(2026-07-31 실사고 재현·수정 확인, 02a §6-⑤).
    expect(
      specifiersOf(
        "const doc = 'https://example.com/a'; import x from 'react-native';"
      )
    ).toEqual(['react-native']);

    // ③ 블록 주석을 먼저 지우는 순서라야 같은 줄의 코드가 살아남는다.
    expect(specifiersOf("/* a // b */ import y from 'expo-router';")).toEqual([
      'expo-router',
    ]);

    // ④ import 네 형태를 전부 본다 — 한 형태만 보면 나머지로 우회된다.
    expect(specifiersOf("import { View } from 'react-native';")).toEqual([
      'react-native',
    ]);
    expect(specifiersOf("import 'expo-router';")).toEqual(['expo-router']);
    expect(specifiersOf("const a = require('axios');")).toEqual(['axios']);
    expect(
      specifiersOf("const m = await import('@tanstack/react-query');")
    ).toEqual(['@tanstack/react-query']);

    // ⑤ 금칙 판정이 실제로 갈린다 — 이름이 비슷한 패키지·정당한 타입 import는 오탐하지 않는다.
    expect(isForbidden('react-native')).toBe(true);
    expect(isForbidden('@tanstack/react-query')).toBe(true);
    expect(isForbidden('expo-router')).toBe(true);
    expect(isForbidden('react-native-web-fake')).toBe(false);
    expect(isForbidden('@/shared/api/generated/schemas')).toBe(false);
  });

  it('tripDraft.ts가 세 함수를 내보내고, 금칙 모듈을 직접 import 하지 않는다', () => {
    // 긍정 짝 ① — 파일이 없으면 아래 읽기가 예외로 죽어 "무엇이 없는가"를 읽을 diff가
    // 안 남는다(선례 `staySearchStructure.test.ts:66`).
    expect(existsSync(TRIP_DRAFT)).toBe(true);

    const source = stripComments(readFileSync(TRIP_DRAFT, 'utf8'));

    // 긍정 짝 ② — 이게 없으면 **빈 파일도** "금칙 0건"을 통과한다.
    const missing = EXPECTED_EXPORTS.filter(
      (name) =>
        !new RegExp(`export\\s+(?:function\\s+|const\\s+)${name}\\b`).test(
          source
        )
    );
    expect(missing).toEqual([]);

    expect(extractSpecifiers(source).filter(isForbidden)).toEqual([]);
  });

  it('tripDraft.ts에서 import를 전이적으로 따라간 그래프 어디에도 UI·쿼리 훅·라우터가 없다', () => {
    expect(existsSync(TRIP_DRAFT)).toBe(true);

    const { reached, offenders } = walkFrom(TRIP_DRAFT);
    const reachedRelative = reached.map((full) =>
      relative(SRC_ROOT, full).split(sep).join('/')
    );

    // 순회기 자가검사 — 여기가 비면 "위반 0"은 아무 뜻이 없다. 계약 타입을 생성 스키마에서
    // 파생한다는 것(브리프 §기존 활용)이 곧 "스캔이 한 걸음 이상 걸었다"는 증거가 된다.
    expect(reachedRelative).toContain('features/trip/model/tripDraft.ts');
    expect(
      reachedRelative.some((file) =>
        file.startsWith('shared/api/generated/schemas/')
      )
    ).toBe(true);
    expect(reached.length).toBeGreaterThan(2);

    expect(offenders).toEqual([]);
  });
});
