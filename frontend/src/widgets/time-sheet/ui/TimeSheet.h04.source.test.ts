/**
 * @jest-environment node
 */
// TRIP-787 AC-E1 → TRIP-927 AC-5 재조준 — endsNextDay 유도(`end <= start`)는 리포에 단 한 벌.
//
// 무엇을 보장하나: 유도식이 공유 헬퍼 `entities/itinerary-slot/lib/endsNextDay.ts` 한 곳에만 있고,
//   그것을 쓰는 두 곳(TimeSheet 위젯·ItineraryEditPage 의 종료 미설정 풀이)은 `<=` 를 새로 쓰지 않고
//   헬퍼를 import 한다. 한쪽에 식을 다시 쓰면 두 벌이 되어 한쪽만 고쳐질 때 INV-2 계약이 드리프트한다.
//   (TRIP-787 때는 TimeSheet.tsx 안의 `<=` 1개를 셌다 — 헬퍼 추출로 대상이 헬퍼로 옮겨갔다.)
//
// jest 는 "유도가 실제로 공유되는가"를 행동으로는 못 본다 — 소스 스캔이 유일한 그물이다.
// import 판정은 `from` 절을 먼저 전수 추출한 뒤 그 명세자 안에서 대상 경로를 찾는다(심볼명 선탐 금지).
import fs from 'fs';
import path from 'path';

const HELPER = path.resolve('src/entities/itinerary-slot/lib/endsNextDay.ts');
const SHEET = path.resolve('src/widgets/time-sheet/ui/TimeSheet.tsx');
const PAGE = path.resolve('src/pages/itinerary-edit/ui/ItineraryEditPage.tsx');
const HELPER_SPEC = 'entities/itinerary-slot/lib/endsNextDay';

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석을 먼저(순서 바꾸면 한 줄 안 코드 소실). 줄 주석은 바로 앞
 * 글자가 `:` 이면(=`https://`) 주석으로 안 본다(동결 가드들과 같은 규칙).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function countLte(source: string): number {
  return (source.match(/<=/g) ?? []).length;
}

/** `from '…'` 절의 모듈 명세자 전수(여러 줄 import 도 from 절은 한 줄에 있다). */
function fromSpecifiers(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function importsHelper(source: string): boolean {
  return fromSpecifiers(source).some((spec) => spec.endsWith(HELPER_SPEC));
}

function scan(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf8'));
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 `<=`·import 는 걷히고, 코드의 `<=`·URL·여러 줄 import 의 from 절은 살아남는다', () => {
    const sample = [
      '/** endsNextDay 는 end <= start 유도다. raw <= 주석. */',
      "// import { deriveEndsNextDay } from '@/entities/itinerary-slot/lib/endsNextDay';",
      '// const dead = a <= b;',
      'import {',
      '  deriveEndsNextDay,',
      "} from '@/entities/itinerary-slot/lib/endsNextDay';",
      "import { View } from 'react-native';",
      'const live = endAt <= startAt;',
      "const url = 'https://x/y';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 `<=`·문구는 걷힌다.
    expect(countLte(stripped)).toBe(1);
    expect(stripped).not.toContain('end <= start 유도');
    expect(stripped).not.toContain('dead');

    // ② 코드의 `<=`·URL 은 살아남는다(콜론 뒤 `//` 는 주석이 아니다).
    expect(stripped).toContain('endAt <= startAt');
    expect(/https?:\/\//.test(stripped)).toBe(true);

    // ③ from 절 추출 — 여러 줄 import 1건 + 한 줄 import 1건, 주석 처리된 import 는 빠진다.
    expect(fromSpecifiers(stripped)).toEqual([
      '@/entities/itinerary-slot/lib/endsNextDay',
      'react-native',
    ]);
    expect(importsHelper(stripped)).toBe(true);
    expect(importsHelper(stripComments(sample.split('\n')[1]))).toBe(false);
  });
});

describe('🔴 AC-5 · endsNextDay 유도는 헬퍼 한 벌 — 위젯·페이지는 import 만 한다', () => {
  it('S1 · 헬퍼가 deriveEndsNextDay 를 export 하고 `<=` 가 정확히 1개', () => {
    expect(fs.existsSync(HELPER)).toBe(true);
    const helper = scan(HELPER);

    expect(helper).toMatch(/export\s+(function|const)\s+deriveEndsNextDay\b/);
    expect(countLte(helper)).toBe(1);
  });

  it('S2 · TimeSheet.tsx 는 `<=` 0개 + 헬퍼 import + endsNextDay 페이로드 실재(긍정 짝)', () => {
    const sheet = scan(SHEET);

    expect(sheet).toContain('endsNextDay');
    expect(importsHelper(sheet)).toBe(true);
    expect(countLte(sheet)).toBe(0);
  });

  it('S3 · ItineraryEditPage.tsx 는 `<=` 0개 + 헬퍼 import (종료 미설정 풀이도 같은 규칙)', () => {
    const page = scan(PAGE);

    expect(importsHelper(page)).toBe(true);
    expect(countLte(page)).toBe(0);
  });
});
