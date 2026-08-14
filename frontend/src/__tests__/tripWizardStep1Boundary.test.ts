/**
 * @jest-environment node
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * TRIP-205 AC-14 · AC-5 · AC-1 · AC-10c — 렌더로는 볼 수 없는 제약을 소스 층에서 잠근다.
 *
 * 무엇을 보장하나:
 *  - **AC-14** 위저드 화면이 쿼리 훅·라우터·`expo-location`을 **전이 의존으로도** 물지 않는다.
 *    (DoD ① — 화면은 props만 받는다. `RegionPickerScreen`·`tripDraftBoundary.test.ts` 선례)
 *  - **AC-5** 화면과 프리셋 계산 함수가 **시계를 읽지 않는다**. 기준일은 주입받는다(01b D5).
 *  - **AC-1** 위저드 라우트가 `(tabs)` **밖**에 있다 — 몰입 화면이라 탭바가 붙으면 안 된다.
 *  - **AC-10c** 화면 소스가 위반 코드를 **이름조차 대지 않는다** — 그릴 재료 자체를 안 갖는다.
 *
 * 왜 소스 스캔인가: "렌더해 봤더니 네트워크가 안 나갔다"는 *이번 렌더 경로*만 증명한다.
 * 조건 분기 안에 숨은 호출이나 실행되지 않는 import는 소스 층이라야 잡힌다. 그리고 왜
 * **전이**인가: 평면 문자열 금지 목록은 `@/shared/api` 배럴 한 줄로 뚫린다(그 배럴이 `axios`를
 * 끌어온다). 순회는 그것을 잡고, 순수 타입만 있는 `@/shared/api/generated/schemas`는 통과시킨다.
 *
 * ⚠️ 전처리(`stripComments`)의 줄 주석 정규식이 URL의 `//`를 주석으로 오인하면, 그 줄의 진짜
 * import가 통째로 사라져 **거짓 green**이 난다(2026-07-31 실사고). 화면 파일 머리말에 Figma
 * 노드 URL을 적는 것이 이 리포 관례라 이 함정은 실제로 밟힌다 — 그래서 여기서는 `:` 뒤의
 * `//`를 주석으로 보지 않고, 그 성질을 아래 첫 케이스가 회귀 가드로 잠근다.
 *
 * 가짜 통과 방지 규약(리포 확립 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은
 * it 안에서 짝을 이룬다. 헬퍼는 공용화하지 않고 파일마다 각자 갖는다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const SCREEN = join(
  SRC_ROOT,
  'features',
  'trip',
  'ui',
  'TripWizardStep1Screen.tsx'
);
const PURE = join(SRC_ROOT, 'features', 'trip', 'model', 'tripWizardStep1.ts');
// TRIP-368 날짜 시트 두 파일 — 화면 전이 그래프에 들어오므로 같은 시계 금지(01b D5)를 받는다.
// 신설 당시 이 스캔 모집단([SCREEN, PURE])에 안 들어와, 실클럭을 넣어도 통과하던 구멍(TRIP-375).
const DATE_PICKER = join(
  SRC_ROOT,
  'features',
  'trip',
  'model',
  'tripDatePicker.ts'
);
const DATE_SHEET = join(SRC_ROOT, 'features', 'trip', 'ui', 'TripDateSheet.tsx');
const WIZARD_ROUTE_DIR = join(SRC_ROOT, 'app', 'trips', 'new');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * 01b AC-14가 이름을 댄 것들. `tripDraft.ts` 가드와 달리 **UI 패키지는 금칙이 아니다** —
 * 이쪽은 화면이라 `react-native`·`nativewind`·`react-native-svg`가 정당하다.
 */
const FORBIDDEN = [
  // 쿼리 훅 · 네트워크
  '@tanstack/react-query',
  'axios',
  '@/shared/api',
  // 라우터
  'expo-router',
  '@/app',
  // 기기 권한
  'expo-location',
  // 층 역행 — 화면이 배선/라우트를 되짚어 올라가면 안 된다
  '@/pages',
];

/**
 * 금칙 접두보다 **먼저** 보는 예외. `@/shared/api`를 금칙에 넣는 순간 접두 규칙이
 * 생성 스키마(순수 타입 — `CompanionType`·`TripDestination`)까지 잡아먹는다.
 */
const ALLOWED_EXCEPTIONS = ['@/shared/api/generated/schemas'];

/** 화면이 실제로 내보내야 하는 것. */
const SCREEN_EXPORT = 'TripWizardStep1Screen';

/** 이 칸이 그리지 말아야 할 위반 코드 어휘(TRIP-204 동결 4종). */
const VIOLATION_CODES = [
  'NO_DESTINATION',
  'END_BEFORE_START',
  'NIGHTS_EXCEED_PERIOD',
  'PARTY_BELOW_ONE',
];

/**
 * 스캔 전처리 — 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가
 * 소실된다). 줄 주석 규칙에서 **바로 앞 글자가 `:`이면 주석으로 보지 않는다** —
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

function matchesPrefix(specifier: string, prefix: string): boolean {
  return specifier === prefix || specifier.startsWith(`${prefix}/`);
}

/** 예외를 **먼저** 본다 — 순서가 뒤바뀌면 정당한 타입 import가 위반으로 잡힌다. */
function isForbidden(specifier: string): boolean {
  if (ALLOWED_EXCEPTIONS.some((allowed) => matchesPrefix(specifier, allowed))) {
    return false;
  }
  return FORBIDDEN.some((banned) => matchesPrefix(specifier, banned));
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

function existsPair(file: string): { file: string; exists: boolean } {
  return { file, exists: existsSync(file) };
}

describe('탐지기 자가검사 — 이게 통과해야 아래 단언들이 의미를 갖는다', () => {
  it('주석은 걷히고, URL이 있는 줄의 진짜 import는 살아남는다', () => {
    // ① 주석 안에 적힌 금칙어는 스캔에 걸리지 않는다. 걷지 않으면 머리말 산문이 부정
    //    단언을 대신 만족시켜 거짓 red를 낸다.
    const commented = [
      '/**',
      ' * 이 화면은 expo-router 도 @tanstack/react-query 도 import 하지 않는다.',
      ' */',
      "// const a = require('axios');",
      'export const keep = 1;',
    ].join('\n');
    expect(specifiersOf(commented)).toEqual([]);
    expect(stripComments(commented)).toContain('export const keep = 1;');

    // ② 회귀 가드 — Figma 노드 URL을 머리말에 적는 것이 이 리포 화면 파일의 관례다.
    //    URL의 `//`를 줄 주석으로 오인하면 그 줄의 진짜 import가 통째로 사라져 **거짓
    //    green**이 난다(2026-07-31 실사고 재현·수정 확인).
    expect(
      specifiersOf(
        "const doc = 'https://figma.com/x'; import type { CompanionType } from '@/shared/api/generated/schemas';"
      )
    ).toEqual(['@/shared/api/generated/schemas']);

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
  });

  it('금칙 판정이 갈린다 — 예외가 금칙 접두보다 먼저 본다', () => {
    // 화면이라 UI 패키지는 정당하다.
    expect(isForbidden('react-native')).toBe(false);
    expect(isForbidden('nativewind')).toBe(false);
    expect(isForbidden('react-native-svg')).toBe(false);

    // 금칙.
    expect(isForbidden('@tanstack/react-query')).toBe(true);
    expect(isForbidden('expo-router')).toBe(true);
    expect(isForbidden('expo-location')).toBe(true);
    expect(isForbidden('@/shared/api')).toBe(true);
    expect(isForbidden('@/shared/api/generated/trips/trips')).toBe(true);

    // 예외 — 순수 타입. 이 한 줄이 뒤집히면 정당한 계약 타입 import가 위반으로 잡혀
    // 구현자가 타입을 손으로 베끼게 된다(계약 드리프트의 시작).
    expect(isForbidden('@/shared/api/generated/schemas')).toBe(false);
    expect(isForbidden('@/shared/api/generated/schemas/companionType')).toBe(
      false
    );

    // 이름이 비슷한 것에 오탐하지 않는다.
    expect(isForbidden('expo-linear-gradient')).toBe(false);
  });
});

describe('AC-14 · 화면이 쿼리 훅·라우터·위치를 물지 않는다', () => {
  it('화면 파일이 실재하고 컴포넌트를 내보내며, 직접 import에 금칙이 없다', () => {
    // 긍정 짝 ① — 파일이 없으면 아래 읽기가 예외로 죽어 "무엇이 없는가"를 읽을 diff가 안 남는다.
    expect(existsPair(SCREEN)).toEqual({ file: SCREEN, exists: true });

    const source = stripComments(readFileSync(SCREEN, 'utf8'));

    // 긍정 짝 ② — 이게 없으면 **빈 파일도** "금칙 0건"을 통과한다.
    expect(source).toMatch(
      new RegExp(`export\\s+(?:function\\s+|const\\s+)${SCREEN_EXPORT}\\b`)
    );

    expect(extractSpecifiers(source).filter(isForbidden)).toEqual([]);
  });

  it('화면에서 import를 전이적으로 따라간 그래프 어디에도 금칙이 없다', () => {
    expect(existsPair(SCREEN)).toEqual({ file: SCREEN, exists: true });

    const { reached, offenders } = walkFrom(SCREEN);
    const reachedRelative = reached.map((full) =>
      relative(SRC_ROOT, full).split(sep).join('/')
    );

    // 순회기 자가검사 — 여기가 비면 "위반 0"은 아무 뜻이 없다. 화면이 순수 함수 모듈을
    // 실제로 물고 있다는 사실이 곧 "스캔이 한 걸음 이상 걸었다"는 증거가 된다.
    expect(reachedRelative).toContain(
      'features/trip/ui/TripWizardStep1Screen.tsx'
    );
    expect(reachedRelative).toContain('features/trip/model/tripWizardStep1.ts');
    expect(reached.length).toBeGreaterThan(2);

    expect(offenders).toEqual([]);
  });
});

describe('AC-5 · 시계를 읽지 않는다 (01b D5 — 기준일은 주입받는다)', () => {
  it('화면과 프리셋 계산 함수, 날짜 시트 두 파일 어디에도 현재 시각 읽기가 없다', () => {
    [SCREEN, PURE, DATE_PICKER, DATE_SHEET].forEach((file) => {
      expect(existsPair(file)).toEqual({ file, exists: true });

      // 주석은 먼저 걷는다 — 머리말에 "화면이 new Date()를 부르면 안 된다"고 적는 것이
      // 이 리포 관례라, 걷지 않으면 그 산문 자체가 red를 낸다.
      const source = stripComments(readFileSync(file, 'utf8'));
      expect(source).not.toMatch(/new\s+Date\s*\(/);
      expect(source).not.toMatch(/Date\.now\s*\(/);
    });

    // 긍정 짝 — 순수 모듈이 실제로 계산 함수를 갖고 있다. 없으면 빈 파일이 위를 통과한다.
    const pureSource = stripComments(readFileSync(PURE, 'utf8'));
    [
      'presetRange',
      'formatDateRange',
      'PERIOD_PRESETS',
      'COMPANION_OPTIONS',
    ].forEach((symbol) => {
      expect(pureSource).toMatch(
        new RegExp(`export\\s+(?:function\\s+|const\\s+)${symbol}\\b`)
      );
    });
  });
});

describe('AC-10c · 화면이 위반 코드를 이름조차 대지 않는다', () => {
  it('화면 소스에 validateTripDraft도 위반 코드 리터럴도 없다', () => {
    expect(existsPair(SCREEN)).toEqual({ file: SCREEN, exists: true });
    const source = stripComments(readFileSync(SCREEN, 'utf8'));

    // 그릴 재료를 아예 안 갖는 것이 AC-10c 설계의 절반이다. 나머지 절반(배선이 우회로
    // 내려보내는 경로)은 `TripNewStep1Page.test.tsx`가 렌더로 잡는다.
    expect(source).not.toContain('validateTripDraft');
    VIOLATION_CODES.forEach((code) => {
      expect(source).not.toContain(code);
    });

    // 긍정 짝 — 그렇다고 게이트를 아예 모르는 것은 아니다. 판정 **결과**는 받는다.
    expect(source).toContain('canProceed');
  });
});

describe('AC-1 · 위저드 라우트가 탭바 밖에 있다 (BR-U0-29)', () => {
  it('trips/new 셸과 step1 라우트가 있고 배선 배럴을 가리킨다', () => {
    const layout = join(WIZARD_ROUTE_DIR, '_layout.tsx');
    const step1 = join(WIZARD_ROUTE_DIR, 'step1.tsx');

    expect(existsPair(layout)).toEqual({ file: layout, exists: true });
    expect(existsPair(step1)).toEqual({ file: step1, exists: true });

    // 얇은 라우트 관례 — 라우트는 pages 층 배럴만 가리킨다(`stays/index.tsx` 선례).
    expect(readFileSync(step1, 'utf8')).toContain('@/pages/trip-new-step1');
  });

  it('(tabs) 아래에 위저드 라우트가 없다 — 몰입 화면이라 탭바가 붙으면 안 된다', () => {
    // 이 부정 단언은 구현 전에도 통과한다(선제 green — 구현자가 실수로 (tabs) 아래
    // 만드는 것을 막는 그물이다). 짝은 위 it의 존재 단언이 진다.
    expect(existsSync(join(SRC_ROOT, 'app', '(tabs)', 'trips'))).toBe(false);
    expect(existsSync(join(SRC_ROOT, 'app', '(tabs)', 'trips.tsx'))).toBe(
      false
    );
  });
});
