/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-206 AC-7 — `/trips/new/step2`는 **자리만**이다.
 *
 * 무엇을 보장하나: 라우트 파일이 실재해 `router.push('/trips/new/step2')`가 타입에서 막히지
 * 않고(`typedRoutes: true`라 목적지 파일이 없으면 tsc가 이동을 거부한다), 그러면서도 g02
 * 내용(거점 숙소)을 이 칸이 떠안지 않는다 — 그 화면은 TRIP-84·TRIP-193 몫이다.
 *
 * 선례: `src/app/explore/destination/[region].tsx`(TRIP-183, 28줄)가 같은 이유로 서 있다.
 *
 * 왜 소스 스캔인가: "자리만"은 렌더로 관찰할 수 없다. 내용이 없다는 것은 **무엇을 안
 * 물어오는가**로만 잴 수 있고, 그것은 import 그래프의 성질이다.
 *
 * ⚠️ 전처리 함정(02a ★8): 리포의 다른 스캔 파일들이 쓰던 줄 주석 정규식 `/\/\/.*$/gm`은
 * **URL이 있는 줄의 진짜 import를 통째로 지운다**(2026-07-31 실사고). 화면·라우트 파일
 * 머리말에 Figma 노드 URL을 적는 것이 이 리포 관례라 이 함정은 실제로 밟힌다. 아래
 * `stripComments`는 `tripWizardStep1Boundary.test.ts:84-88`의 **고친 사본**이고, 첫 케이스가
 * 그 성질을 회귀 가드로 잠근다. (기존 파일들은 이 칸에서 고치지 않는다 — 승인 해시 대상이다.)
 *
 * 가짜 통과 방지 규약(리포 확립 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은
 * it 안에서 짝을 이룬다. 헬퍼는 공용화하지 않고 파일마다 각자 갖는다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const STEP2 = join(SRC_ROOT, 'app', 'trips', 'new', 'step2.tsx');

/** 자리만 라우트가 물어오면 안 되는 것 — 물어오는 순간 g02 내용을 떠안은 것이다. */
const FORBIDDEN_PREFIXES = ['@/pages', '@/features'];

/**
 * 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다).
 * 줄 주석 규칙에서 **바로 앞 글자가 `:`이면 주석으로 보지 않는다** — `'https://…'`의
 * 슬래시를 주석 시작으로 오인하지 않기 위한 것이고, 완전한 파서를 만들지 않는 것이 의도다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** import 대상(module specifier)을 뽑는다. 네 형태를 모두 본다 — 한 형태만 보면 우회된다. */
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
  return FORBIDDEN_PREFIXES.some(
    (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`)
  );
}

describe('P-0 · 탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('주석은 걷히고, URL이 있는 줄의 진짜 import는 살아남는다', () => {
    // 실제로 쓰일 자리만 라우트를 그대로 본뜬 문자열이다 — 머리말 Figma URL, 주석 속
    // 금칙 경로, 산문 속 컴포넌트 경로가 전부 들어 있다. 이 셋이 서로를 지우는지가 핵심이다.
    const sample = [
      "import { Text, View } from 'react-native';",
      '',
      '/**',
      ' * g02 거점 숙소 — 자리만.',
      ' * 화면 내용은 `@/features/trip/ui/TripWizardStep2Screen`이 아니라 TRIP-84 몫이다.',
      ' * Figma: https://figma.com/design/1MTF3dtptIrbg8gld5IdO2?node-id=1707-1183',
      ' */',
      "// import { Something } from '@/pages/trip-new-step2';",
      'export default function Step2Route() {',
      '  return null;',
      '}',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 회귀 가드 — URL의 `//`를 줄 주석으로 오인하면 그 줄의 진짜 import가 통째로
    //    사라져 **거짓 green**이 난다.
    expect(specifiersOf(sample)).toEqual(['react-native']);
    // ② 주석 안에 적힌 금칙 경로는 걸리지 않는다.
    expect(specifiersOf(sample).filter(isForbidden)).toEqual([]);
    // ③ 짝(긍정) — 전처리가 코드 본문을 지우지 않았다.
    expect(stripped).toContain('export default function Step2Route()');
    // ④ 산문에 남은 경로 이름이 문자열 스캔을 오염시키지 않는다.
    expect(stripped).not.toContain('@/features/trip/ui/TripWizardStep2Screen');
  });

  it('금칙 판정이 갈린다', () => {
    expect(isForbidden('@/pages/trip-new-step2')).toBe(true);
    expect(isForbidden('@/features/trip/ui/TripWizardStep2Screen')).toBe(true);
    // 자리만 라우트가 정당하게 쓰는 것들.
    expect(isForbidden('react-native')).toBe(false);
    expect(isForbidden('expo-router')).toBe(false);
    // 이름이 비슷한 것에 오탐하지 않는다.
    expect(isForbidden('@/pagesomething')).toBe(false);
  });
});

describe('P-1 · AC-7 — step2 라우트 파일이 실재한다', () => {
  it('파일이 있고 기본 내보내기와 준비 중 안내를 갖는다', () => {
    // 이 파일이 없으면 `typedRoutes: true`라 `router.push('/trips/new/step2')`가 **타입에서**
    // 막힌다 — AC-1(201 후 이동)을 구현할 수 없다. 그래서 경로만 먼저 만든다.
    expect({ file: STEP2, exists: existsSync(STEP2) }).toEqual({
      file: STEP2,
      exists: true,
    });

    const source = stripComments(readFileSync(STEP2, 'utf8'));

    // 긍정 짝 — 이게 없으면 **빈 파일도** 아래 금칙 0건을 통과한다.
    expect(source).toMatch(/export\s+default\s+function\s+\w+/);
    // 막다른 길로 보이지 않게 한다(`[region].tsx` 선례의 문구 관례).
    expect(source).toContain('준비 중');
  });
});

describe('P-2 · AC-7 — 자리만이다. g02 내용을 물어오지 않는다', () => {
  it('배선·기능 슬라이스를 import하지 않는다', () => {
    const source = readFileSync(STEP2, 'utf8');
    const specifiers = specifiersOf(source);

    // 본체 — 거점 숙소 화면을 붙이면 이 칸이 TRIP-84를 삼킨 것이다.
    expect(specifiers.filter(isForbidden)).toEqual([]);

    // 긍정 짝 — 그렇다고 아무것도 없는 파일은 아니다. 실제로 화면을 그린다.
    expect(specifiers).toContain('react-native');
  });
});
