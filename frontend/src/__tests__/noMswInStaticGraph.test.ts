/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * 정적 그래프 가드 — 목(mock)이 앱 번들에 섞이지 않음을 **기계적으로** 강제한다.
 *
 * 무엇을 보장하나:
 *  (1) 프로덕션 코드(테스트 파일이 아닌 `src/**`)가 `@/mocks/*` 를 import 하지 않는다.
 *  (2) 프로덕션 코드가 `msw` 를 import 하지 않는다(회귀 가드 — 지금도 참).
 *  (3) 앱 엔트리(`src/app/**` 라우트)에서 import 를 **전이적으로** 따라간 정적 그래프 어디에도
 *      `msw` 도 `@/mocks/*` 도 없다.
 *
 * 왜 필요한가: 직전 사이클(`20260721-trip161-mock-removal`)이 dev 런타임 목을 앱에서 걷어냈지만,
 * 그와 함께 가드 테스트도 삭제돼 **기계적 강제가 0** 이 됐다. 사람의 주의력만으로는 유지되지 않는다.
 *
 * 이 파일은 fs 만 쓰는 node 버킷 테스트다 — 런타임 로드가 아니라 **소스의 성질**을 본다.
 * 렌더로는 관측할 수 없는 제약이라 소스 스캔이 정확한 검증 수단이다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const APP_ROOT = join(SRC_ROOT, 'app');

/** 테스트 전용 자리 — 앱이 참조하지 않는 것이 계약이므로 프로덕션 스캔에서 제외한다. */
const TEST_ONLY_DIRS = ['mocks', 'test-support', '__tests__', '__mocks__'];

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(path);
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 프로덕션 파일 = `src/**` 중 테스트 파일도 아니고 테스트 전용 디렉토리에도 없는 것.
 * 앱 번들에 실릴 수 있는 파일 전부가 대상이다.
 */
function listProductionFiles(): string[] {
  return listSourceFiles(SRC_ROOT).filter((full) => {
    if (isTestFile(full)) {
      return false;
    }
    const segments = relative(SRC_ROOT, full).split(sep);
    return !segments.some((segment) => TEST_ONLY_DIRS.includes(segment));
  });
}

/**
 * 소스 문자열에서 import 대상(module specifier)을 전부 뽑는다.
 * 정적 import·side-effect import·require·동적 import 네 형태를 모두 본다 —
 * 한 형태만 보면 나머지로 우회가 가능해 가드가 무력해진다.
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

function isMswSpecifier(specifier: string): boolean {
  return specifier === 'msw' || specifier.startsWith('msw/');
}

function isMockSpecifier(specifier: string): boolean {
  return (
    specifier === '@/mocks' ||
    specifier.startsWith('@/mocks/') ||
    /(^|\/)\.\.?\/mocks(\/|$)/.test(specifier)
  );
}

/** 위반 1건을 사람이 읽을 수 있는 한 줄로 만든다(어느 파일이 무엇을 끌어왔는지). */
function violationsIn(
  files: string[],
  predicate: (specifier: string) => boolean
): string[] {
  const out: string[] = [];
  for (const full of files) {
    const source = readFileSync(full, 'utf8');
    for (const specifier of extractSpecifiers(source)) {
      if (predicate(specifier)) {
        out.push(`${relative(SRC_ROOT, full)} → ${specifier}`);
      }
    }
  }
  return out;
}

/** `@/x` 와 상대경로를 실제 파일로 해석한다. 해석 불가(외부 패키지)면 null. */
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

interface GraphWalk {
  /** 엔트리에서 전이적으로 도달 가능한 프로덕션 파일 전부 */
  reached: string[];
  /** 그래프 안에서 발견된 목/msw 유입 지점 */
  violations: string[];
}

/**
 * 앱 엔트리(expo-router 는 `src/app/**` 파일을 전부 라우트로 등록한다)에서 시작해
 * import 를 따라가며 도달 가능한 모듈 집합을 만든다. 번들러가 하는 일의 축소판이다.
 */
function walkAppGraph(): GraphWalk {
  const entries = listSourceFiles(APP_ROOT).filter((full) => !isTestFile(full));
  const seen = new Set<string>();
  const violations: string[] = [];
  const queue = [...entries];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    const source = readFileSync(current, 'utf8');
    for (const specifier of extractSpecifiers(source)) {
      if (isMswSpecifier(specifier) || isMockSpecifier(specifier)) {
        violations.push(`${relative(SRC_ROOT, current)} → ${specifier}`);
        continue;
      }
      const next = resolveToFile(specifier, current);
      if (next !== null && !seen.has(next)) {
        queue.push(next);
      }
    }
  }

  return { reached: [...seen], violations };
}

describe('정적 그래프 가드 — 프로덕션 코드의 목 의존 금지', () => {
  it('프로덕션 코드(src/** 중 테스트가 아닌 파일)가 @/mocks/* 를 import 하지 않는다', () => {
    // 탐지기 자가검사 — 탐지기가 고장 나 아무것도 못 잡는 상태로 통과하는 것을 막는다.
    expect(
      extractSpecifiers(
        "import { getScenario } from '@/mocks/scenarios';"
      ).some(isMockSpecifier)
    ).toBe(true);
    expect(
      extractSpecifiers("const s = require('../mocks/scenarios');").some(
        isMockSpecifier
      )
    ).toBe(true);
    expect(
      extractSpecifiers("const m = await import('@/mocks/server');").some(
        isMockSpecifier
      )
    ).toBe(true);
    // 정상 import 를 오탐하지 않는다.
    expect(
      extractSpecifiers("import { api } from '@/shared/api';").some(
        isMockSpecifier
      )
    ).toBe(false);

    const productionFiles = listProductionFiles();
    // 스캔 대상이 비면 어떤 위반도 못 찾는다 — 목록이 실제로 채워졌는지 먼저 확인한다.
    expect(productionFiles.length).toBeGreaterThan(20);
    expect(
      productionFiles.map((full) =>
        relative(SRC_ROOT, full).split(sep).join('/')
      )
    ).toContain('features/auth/lib/makeAuthorize.ts');

    expect(violationsIn(productionFiles, isMockSpecifier)).toEqual([]);
  });

  it('프로덕션 코드가 msw 를 import 하지 않는다 (앱 런타임에서 구조적으로 사용 불가)', () => {
    // 탐지기 자가검사 — msw 형태 3종을 실제로 잡는가.
    expect(
      extractSpecifiers("import { http } from 'msw';").some(isMswSpecifier)
    ).toBe(true);
    expect(
      extractSpecifiers("import { setupServer } from 'msw/node';").some(
        isMswSpecifier
      )
    ).toBe(true);
    expect(
      extractSpecifiers("require('msw/browser');").some(isMswSpecifier)
    ).toBe(true);
    // 이름이 비슷한 다른 패키지를 오탐하지 않는다.
    expect(
      extractSpecifiers("import x from 'mswjs-helper';").some(isMswSpecifier)
    ).toBe(false);

    const productionFiles = listProductionFiles();
    expect(productionFiles.length).toBeGreaterThan(20);

    expect(violationsIn(productionFiles, isMswSpecifier)).toEqual([]);
  });

  it('앱 엔트리에서 전이적으로 도달하는 정적 그래프 어디에도 msw·@/mocks 가 없다', () => {
    const { reached, violations } = walkAppGraph();
    const reachedRelative = reached.map((full) =>
      relative(SRC_ROOT, full).split(sep).join('/')
    );

    // 순회기 자가검사 — 그래프를 실제로 따라갔는지. 여기가 비면 "위반 0" 은 의미가 없다.
    expect(reachedRelative).toContain('app/_layout.tsx');
    expect(reachedRelative).toContain('pages/login/ui/LoginPage.tsx');
    expect(reachedRelative).toContain('features/auth/lib/makeAuthorize.ts');
    expect(reached.length).toBeGreaterThan(20);

    expect(violations).toEqual([]);
  });
});
